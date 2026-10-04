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
  // Without a size hint most phones deliver 640×480: too few pixels for a small QR shown on a screen.
  return md.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
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
      tracks.forEach(t => {
        t.onended = () => { if (!stopped) cb.current.onEnded && cb.current.onEnded(); };
        // Continuous autofocus where supported; ignored elsewhere.
        try { const caps = t.getCapabilities ? t.getCapabilities() : {}; if (caps.focusMode && caps.focusMode.includes('continuous')) t.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {}); } catch (e) {}
        try { const st = t.getSettings ? t.getSettings() : {}; console.log('[DPA scanner] camera ready', { width: st.width, height: st.height, frameRate: st.frameRate, facingMode: st.facingMode }); } catch (e) {}
      });

      // Engines: BarcodeDetector when the browser has it, jsQR otherwise. Some Android builds expose
      // BarcodeDetector but never return anything, so jsQR also runs once it has stayed silent for
      // FALLBACK_MS. jsQR alternates a downscaled full frame with a full-resolution centre crop
      // (the area inside the on-screen frame), so a small QR shown on another screen stays readable.
      const FALLBACK_MS = 2500;
      let stopped = false, done = false, timer = null, detector = null, jsQR = null, jsQRLoading = null, detectorErrors = 0;
      let frames = 0, detectRuns = 0, jsqrRuns = 0, startedAt = 0, crop = false, waitLogged = false;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const loadJsQR = () => jsQRLoading || (jsQRLoading = import('jsqr')
        .then(m => { jsQR = m.default; console.log('[DPA scanner] engine: jsQR loaded'); })
        .catch(e => { console.error('[DPA scanner] jsQR could not be loaded', e); jsQR = null; }));
      const runJsQR = () => {
        const vw = v.videoWidth, vh = v.videoHeight;
        let sx = 0, sy = 0, sw = vw, sh = vh, w, hh;
        if (crop) { const side = Math.round(Math.min(vw, vh) * 0.7); sx = Math.round((vw - side) / 2); sy = Math.round((vh - side) / 2); sw = sh = side; w = hh = Math.min(side, 960); }
        else { w = Math.min(960, vw); hh = Math.round(vh * (w / vw)); }
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== hh) canvas.height = hh;
        ctx.drawImage(v, sx, sy, sw, sh, 0, 0, w, hh);
        jsqrRuns++;
        if (jsqrRuns === 1 || jsqrRuns % 25 === 0) console.log('[DPA scanner] jsQR running', { run: jsqrRuns, canvas: w + 'x' + hh, region: crop ? 'centre crop' : 'full frame' });
        const r = jsQR(ctx.getImageData(0, 0, w, hh).data, w, hh, { inversionAttempts: 'attemptBoth' });
        crop = !crop;
        return r && r.data ? r.data : null;
      };
      const tick = async () => {
        if (stopped || done) return;
        let text = null, engine = null;
        if (v.readyState >= 2 && v.videoWidth > 0) {
          if (frames++ === 0) { startedAt = performance.now(); console.log('[DPA scanner] first video frame', { videoWidth: v.videoWidth, videoHeight: v.videoHeight, readyState: v.readyState }); }
          if (detector) {
            try {
              detectRuns++;
              const codes = await detector.detect(v);
              if (detectRuns === 1 || detectRuns % 25 === 0) console.log('[DPA scanner] BarcodeDetector.detect running', { run: detectRuns, results: codes.length });
              if (codes.length) { text = codes[0].rawValue; engine = 'BarcodeDetector'; }
              detectorErrors = 0;
            } catch (e) {
              detectorErrors++;
              console.error('[DPA scanner] BarcodeDetector.detect error', e);
              if (detectorErrors >= 3) { console.warn('[DPA scanner] BarcodeDetector keeps failing: jsQR only'); detector = null; }
            }
            // Silent or failing detector: bring jsQR in.
            if (!text && !jsQR && (!detector || performance.now() - startedAt > FALLBACK_MS)) {
              console.warn('[DPA scanner] no QR from BarcodeDetector after ' + Math.round(performance.now() - startedAt) + ' ms: adding jsQR fallback');
              await loadJsQR();
              if (!jsQR && !detector) { cb.current.onDecodeError && cb.current.onDecodeError(); return; }
            }
          }
          if (!text && jsQR && !stopped) {
            try { const d = runJsQR(); if (d) { text = d; engine = 'jsQR'; } }
            catch (e) { console.error('[DPA scanner] jsQR decode error', e); }
          }
          if (text && !stopped && !done) {
            console.log('[DPA scanner] QR found', { engine, raw: text, parsed: parseCode(text) });
            // Accepting a code locks the reader: the same QR is not read twice.
            const accepted = cb.current.onCode(text);
            console.log('[DPA scanner] onCode returned', accepted);
            if (accepted !== false) { done = true; return; }
          }
        } else if (!frames && !waitLogged) {
          waitLogged = true; console.log('[DPA scanner] waiting for video frames', { readyState: v.readyState, videoWidth: v.videoWidth });
        }
        timer = setTimeout(tick, 100);
      };
      (async () => {
        try {
          if ('BarcodeDetector' in window) {
            const formats = window.BarcodeDetector.getSupportedFormats ? await window.BarcodeDetector.getSupportedFormats() : ['qr_code'];
            console.log('[DPA scanner] BarcodeDetector formats', formats);
            if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          }
        } catch (e) { console.error('[DPA scanner] BarcodeDetector unavailable', e); detector = null; }
        console.log('[DPA scanner] engine:', detector ? 'BarcodeDetector (+ jsQR after ' + FALLBACK_MS + ' ms without result)' : 'jsQR');
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
