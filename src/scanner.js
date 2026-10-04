// Card scanner helpers, handed to the logic script through window.dpaReady.
//
//  - scanDevice(): 'desktop' (till / PC: USB QR reader + keyboard, never the camera)
//    or 'mobile' (phone / tablet: camera, keyboard as fallback).
//  - requestCamera() / makeCameraView(React): real back camera in a <video>, QR codes read
//    with BarcodeDetector when the browser has it, jsQR otherwise (iOS Safari).
//  - decodeKeys(): rebuilds what a USB reader typed from physical key codes, so a
//    reader configured as a US keyboard still works on an AZERTY PC.
//  - qrPath(): real QR code geometry for the card shown on screen.
// A QR only identifies a card ("DPA1:<qr_token>"); the server checks ownership.

import QRCode from 'qrcode';

const OVERRIDE_KEY = 'dpa.scanner';

export function scanDevice() {
  try {
    // Explicit choice for unusual setups, e.g. an Android tablet used as a till:
    // ?scanner=pos or ?scanner=camera (remembered on this device).
    const q = new URLSearchParams(location.search).get('scanner');
    if (q === 'pos' || q === 'camera') localStorage.setItem(OVERRIDE_KEY, q);
    const forced = localStorage.getItem(OVERRIDE_KEY);
    if (forced === 'pos') return 'desktop';
    if (forced === 'camera') return 'mobile';
  } catch (e) { /* storage unavailable: fall through */ }
  const uad = navigator.userAgentData;
  if (uad && uad.mobile === true) return 'mobile';
  const ua = navigator.userAgent || '';
  if (/Android|iPhone|iPod|iPad|Mobile|Windows Phone/i.test(ua)) return 'mobile';
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'mobile'; // iPadOS reports a Mac
  // Desktop OS: a till, even with a touch screen.
  return 'desktop';
}

export function canUseCamera() {
  return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

// 'granted' | 'denied' | 'prompt' | 'unknown' — without triggering the browser prompt.
export async function cameraPermission() {
  try {
    const r = await navigator.permissions.query({ name: 'camera' });
    return r.state;
  } catch (e) { return 'unknown'; }
}

// ---------------------------------------------------------------- USB reader

const US = {
  Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'], Digit4: ['4', '$'], Digit5: ['5', '%'],
  Digit6: ['6', '^'], Digit7: ['7', '&'], Digit8: ['8', '*'], Digit9: ['9', '('], Digit0: ['0', ')'],
  Minus: ['-', '_'], Equal: ['=', '+'], Semicolon: [';', ':'], Quote: ["'", '"'], Comma: [',', '<'],
  Period: ['.', '>'], Slash: ['/', '?'], Space: [' ', ' '],
  Numpad0: ['0', '0'], Numpad1: ['1', '1'], Numpad2: ['2', '2'], Numpad3: ['3', '3'], Numpad4: ['4', '4'],
  Numpad5: ['5', '5'], Numpad6: ['6', '6'], Numpad7: ['7', '7'], Numpad8: ['8', '8'], Numpad9: ['9', '9'],
  NumpadSubtract: ['-', '-'], NumpadDecimal: ['.', '.'],
};
// Candidates for one burst of keys: as typed, and as a US-layout reader meant it.
export function decodeKeys(keys) {
  const typed = keys.map(k => (k.key && k.key.length === 1 ? k.key : '')).join('');
  const us = keys.map(k => {
    const m = /^Key([A-Z])$/.exec(k.code || '');
    if (m) return k.shift ? m[1] : m[1].toLowerCase();
    const e = US[k.code]; return e ? e[k.shift ? 1 : 0] : '';
  }).join('');
  return [...new Set([typed, us].filter(Boolean))];
}

// What the scanner accepts: a DPA Cards QR, a card number, or its last digits.
export function parseCode(raw) {
  const s = String(raw || '').trim();
  const tok = /^(?:dpa1:)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(s);
  if (tok) return { kind: 'qr', code: 'DPA1:' + tok[1].toLowerCase() };
  if (/^(dpa)?[\d .-]+$/i.test(s)) {
    const d = s.replace(/\D/g, '');
    if (d.length >= 4 && d.length <= 8) return { kind: d.length === 8 ? 'number' : 'suffix', code: d };
    return { kind: 'incomplete' };
  }
  return { kind: 'invalid' };
}

// ---------------------------------------------------------------- QR on screen

export function qrPath(text) {
  const q = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = q.modules.size, data = q.modules.data; let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (data[y * n + x]) d += `M${x} ${y}h1v1h-1z`;
  return { n, d };
}

// ---------------------------------------------------------------- camera

// ---------------------------------------------------------------- camera (phone only)

// Opens the back camera. getUserMedia is the very first call, so this can run straight
// from a click handler and keep the user gesture iOS Safari expects.
export function requestCamera() {
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) {
    const e = new Error('navigator.mediaDevices.getUserMedia is not available'); e.name = 'NoMediaDevices';
    return Promise.reject(e);
  }
  return md.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    .catch(e => {
      // Some devices reject the facing hint: retry with any camera.
      if (e && e.name === 'OverconstrainedError') return md.getUserMedia({ video: true, audio: false });
      throw e;
    });
}

// 'denied' | 'notfound' | 'busy' | 'nomedia' | 'error'
export function cameraErrorKind(e) {
  const name = e && e.name;
  if (name === 'NoMediaDevices') return 'nomedia';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'notfound';
  if (name === 'NotReadableError' || name === 'TrackStartError') return 'busy';
  return 'error';
}

// Shows a MediaStream in a real <video> and reads QR codes from its frames:
// BarcodeDetector("qr_code") when the browser has it (Chrome Android), jsQR otherwise
// (iOS Safari). The stream belongs to the page, which stops its tracks.
//  onCode(text) → true to stop reading, false to keep reading
//  onDecodeError() → QR reading impossible on this browser (the video stays on)
//  onEnded() → the camera track stopped by itself
export function makeCameraView(React) {
  const { useEffect, useRef } = React;
  const h = React.createElement;
  return function CameraView({ stream, onCode, onDecodeError, onEnded }) {
    const video = useRef(null);
    const cb = useRef({ onCode, onDecodeError, onEnded });
    cb.current = { onCode, onDecodeError, onEnded };
    useEffect(() => {
      if (!stream) return undefined;
      const v = video.current;
      // iOS Safari: inline playback needs muted + playsinline; autoplay starts it.
      v.muted = true; v.setAttribute('muted', ''); v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.setAttribute('autoplay', '');
      v.srcObject = stream;
      const played = v.play(); if (played && played.catch) played.catch(e => console.error('[DPA scanner] video.play()', e));
      const tracks = stream.getVideoTracks();
      tracks.forEach(t => { t.onended = () => { if (!stopped) cb.current.onEnded && cb.current.onEnded(); }; });

      let stopped = false, done = false, timer = null, detector = null, jsQR = null, detectorErrors = 0;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const loadJsQR = async () => {
        try { jsQR = (await import('jsqr')).default; }
        catch (e) { console.error('[DPA scanner] jsQR could not be loaded', e); jsQR = null; }
      };
      const tick = async () => {
        if (stopped || done) return;
        let text = null;
        if (v.readyState >= 2 && v.videoWidth) {
          if (detector) {
            try {
              const codes = await detector.detect(v);
              if (codes.length) text = codes[0].rawValue;
              detectorErrors = 0;
            } catch (e) {
              detectorErrors++;
              console.error('[DPA scanner] BarcodeDetector.detect', e);
              if (detectorErrors >= 3) { detector = null; await loadJsQR(); if (!jsQR) { cb.current.onDecodeError && cb.current.onDecodeError(); return; } }
            }
          } else if (jsQR) {
            try {
              const w = Math.min(640, v.videoWidth), hh = Math.round(v.videoHeight * (w / v.videoWidth));
              canvas.width = w; canvas.height = hh;
              ctx.drawImage(v, 0, 0, w, hh);
              const r = jsQR(ctx.getImageData(0, 0, w, hh).data, w, hh, { inversionAttempts: 'dontInvert' });
              if (r && r.data) text = r.data;
            } catch (e) { console.error('[DPA scanner] jsQR decode', e); }
          }
          // Accepting a code locks the reader: the same QR is not read twice.
          if (text && !stopped && !done && cb.current.onCode(text) !== false) { done = true; return; }
        }
        timer = setTimeout(tick, 120);
      };
      (async () => {
        try {
          if ('BarcodeDetector' in window) {
            const formats = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : ['qr_code'];
            if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          }
        } catch (e) { console.error('[DPA scanner] BarcodeDetector unavailable', e); detector = null; }
        if (!detector) await loadJsQR();
        if (stopped) return;
        if (!detector && !jsQR) { cb.current.onDecodeError && cb.current.onDecodeError(); return; }
        tick();
      })();
      return () => {
        stopped = true; clearTimeout(timer);
        tracks.forEach(t => { t.onended = null; });
        try { v.pause(); } catch (e) {}
        v.srcObject = null;
      };
    }, [stream]);
    return h('video', { ref: video, muted: true, playsInline: true, autoPlay: true, 'aria-hidden': true,
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' } });
  };
}
