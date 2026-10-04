// Card scanner helpers, handed to the logic script through window.dpaReady.
//
//  - scanDevice(): 'desktop' (till / PC: USB QR reader + keyboard, never the camera)
//    or 'mobile' (phone / tablet: camera, keyboard as fallback).
//  - makeCamera(React): live camera view that decodes QR codes (BarcodeDetector when
//    the browser has it, jsQR otherwise) and reports each code once.
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

// Error kinds reported to the page: 'unavailable' (no camera API / not HTTPS / old browser),
// 'denied' (permission refused), 'notfound' (no camera on the device), 'busy' (camera could not
// be opened, e.g. used by another app), 'error' (stream stopped or anything else).
function cameraErrorKind(e) {
  const name = e && e.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'notfound';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'error';
}

// Live camera reading QR codes. The parent mounts it only while the scanner is waiting for a
// card (and the page is visible); unmounting stops every MediaStreamTrack.
//  onStatus('requesting' | 'live'), onError(kind), onCode(text) → true to stop, false to keep reading.
export function makeCamera(React) {
  const { useEffect, useRef } = React;
  const h = React.createElement;
  return function Camera({ onCode, onError, onStatus }) {
    const video = useRef(null);
    const cb = useRef({ onCode, onError, onStatus });
    cb.current = { onCode, onError, onStatus };
    useEffect(() => {
      let stream = null, stopped = false, timer = null, done = false, detector = null, jsQR = null;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const stopAll = () => { if (stream) stream.getTracks().forEach(t => { t.onended = null; t.stop(); }); stream = null; };
      const fail = kind => { if (stopped || done) return; done = true; clearTimeout(timer); stopAll(); if (cb.current.onError) cb.current.onError(kind); };
      const tick = async () => {
        if (stopped || done) return;
        const v = video.current;
        if (v && v.readyState >= 2 && v.videoWidth) {
          let text = null;
          try {
            if (detector) {
              const codes = await detector.detect(v);
              if (codes.length) text = codes[0].rawValue;
            } else {
              const w = Math.min(640, v.videoWidth), hh = Math.round(v.videoHeight * (w / v.videoWidth));
              canvas.width = w; canvas.height = hh;
              ctx.drawImage(v, 0, 0, w, hh);
              const r = jsQR(ctx.getImageData(0, 0, w, hh).data, w, hh, { inversionAttempts: 'dontInvert' });
              if (r && r.data) text = r.data;
            }
          } catch (e) { /* frame not ready: try the next one */ }
          // The page decides: accepting locks the reader (no second read of the same QR).
          if (text && !stopped && !done && cb.current.onCode(text) !== false) { done = true; return; }
        }
        timer = setTimeout(tick, 120);
      };
      (async () => {
        if (!canUseCamera()) return fail('unavailable');
        // Native detector only if it really reads QR codes; otherwise jsQR (e.g. iOS Safari).
        try {
          if ('BarcodeDetector' in window) {
            const formats = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : ['qr_code'];
            if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          }
        } catch (e) { detector = null; }
        if (!detector) jsQR = (await import('jsqr')).default;
        if (stopped) return;
        if (cb.current.onStatus) cb.current.onStatus('requesting');
        try {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } });
          } catch (e) {
            // Some devices reject the size/facing hints: retry with any camera before giving up.
            if (e && (e.name === 'OverconstrainedError' || e.name === 'NotReadableError')) stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
            else throw e;
          }
          if (stopped) return stopAll();
          stream.getVideoTracks().forEach(t => { t.onended = () => fail('error'); });
          const v = video.current;
          // iOS Safari plays inline video only when it is muted and marked playsinline.
          v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', ''); v.muted = true;
          v.srcObject = stream;
          await v.play().catch(() => {});
          if (stopped) return stopAll();
          if (cb.current.onStatus) cb.current.onStatus('live');
          tick();
        } catch (e) {
          fail(cameraErrorKind(e));
        }
      })();
      return () => { stopped = true; clearTimeout(timer); stopAll(); const v = video.current; if (v) v.srcObject = null; };
    }, []);
    return h('video', { ref: video, muted: true, playsInline: true, autoPlay: true, 'aria-hidden': true,
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit' } });
  };
}
