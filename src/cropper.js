// Image cropper for the card design step. Built on the page's React (window.React,
// the same instance dc-runtime renders with) and handed to the logic script through
// window.dpaReady. Drag to move, slider to zoom; exports exactly outW × outH pixels.

export function makeCropper(React) {
  const { useState, useRef, useEffect, useCallback } = React;
  const h = React.createElement;

  return function Cropper({ src, aspect, outW, outH, mime, round, title, hint, onDone, onCancel }) {
    const [img, setImg] = useState(null);
    const [failed, setFailed] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [off, setOff] = useState({ x: 0, y: 0 });
    const [fw, setFw] = useState(0);
    const [busy, setBusy] = useState(false);
    const frame = useRef(null);
    const drag = useRef(null);

    useEffect(() => {
      const i = new Image();
      i.onload = () => setImg(i);
      i.onerror = () => setFailed(true);
      i.src = src;
    }, [src]);
    useEffect(() => {
      const el = frame.current; if (!el) return undefined;
      const ro = new ResizeObserver(() => setFw(el.clientWidth));
      ro.observe(el); setFw(el.clientWidth);
      return () => ro.disconnect();
    }, []);

    const fh = fw / aspect;
    const base = img && fw ? Math.max(fw / img.naturalWidth, fh / img.naturalHeight) : 1;
    const scale = base * zoom;
    const dw = img ? img.naturalWidth * scale : 0, dh = img ? img.naturalHeight * scale : 0;
    const clamp = useCallback(o => ({ x: Math.min(0, Math.max(fw - dw, o.x)), y: Math.min(0, Math.max(fh - dh, o.y)) }), [fw, fh, dw, dh]);

    // Center the image whenever it loads or the frame is resized.
    useEffect(() => { if (img && fw) setOff({ x: (fw - img.naturalWidth * base) / 2, y: (fh - img.naturalHeight * base) / 2 }); }, [img, fw]);

    const setZoomKeepCenter = z => {
      const ns = base * z, k = ns / scale, cx = fw / 2, cy = fh / 2;
      const next = { x: cx - (cx - off.x) * k, y: cy - (cy - off.y) * k };
      const ndw = img.naturalWidth * ns, ndh = img.naturalHeight * ns;
      setZoom(z);
      setOff({ x: Math.min(0, Math.max(fw - ndw, next.x)), y: Math.min(0, Math.max(fh - ndh, next.y)) });
    };
    const down = e => { if (!img) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y }; };
    const move = e => { const d = drag.current; if (!d) return; setOff(clamp({ x: d.ox + e.clientX - d.px, y: d.oy + e.clientY - d.py })); };
    const up = () => { drag.current = null; };
    const key = e => {
      const step = 10, map = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
      if (map) { e.preventDefault(); setOff(clamp({ x: off.x + map[0], y: off.y + map[1] })); }
    };

    const confirm = () => {
      if (!img || busy) return;
      setBusy(true);
      const c = document.createElement('canvas'); c.width = outW; c.height = outH;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      if (mime === 'image/jpeg') { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, outW, outH); }
      ctx.drawImage(img, -off.x / scale, -off.y / scale, fw / scale, fh / scale, 0, 0, outW, outH);
      c.toBlob(b => { setBusy(false); if (b) onDone(b); }, mime, 0.88);
    };

    const btn = (label, onClick, primary, disabled) => h('button', {
      type: 'button', onClick, disabled,
      style: { flex: primary ? 2 : 1, minWidth: 120, height: 54, borderRadius: 14, fontWeight: primary ? 700 : 600, fontSize: 16,
        border: primary ? 0 : '1.5px solid #D4D1C9', background: primary ? '#2448F0' : '#FFFFFF', color: primary ? '#FFFFFF' : '#1C1F24', opacity: disabled ? 0.6 : 1 },
    }, label);

    return h(React.Fragment, null,
      h('h2', { id: 'dlg-t', style: { margin: 0, fontWeight: 800, fontSize: 22 } }, title),
      hint ? h('p', { style: { margin: 0, color: '#4A4E55', fontSize: 14, lineHeight: 1.45 } }, hint) : null,
      failed ? h('div', { role: 'alert', style: { padding: '12px 14px', borderRadius: 12, background: '#FCEBEA', color: '#A11D14', fontSize: 15 } }, 'Cette image ne peut pas être lue. Choisissez un fichier PNG ou JPEG.') : null,
      h('div', {
        ref: frame, tabIndex: 0, role: 'application', 'aria-label': 'Zone de recadrage : glissez l’image ou utilisez les flèches du clavier',
        onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up, onKeyDown: key,
        style: { position: 'relative', width: '100%', aspectRatio: String(aspect), overflow: 'hidden', borderRadius: 14, touchAction: 'none', cursor: img ? 'grab' : 'default',
          background: 'repeating-conic-gradient(#ECEAE4 0% 25%, #F6F5F1 0% 50%) 0 0/20px 20px', userSelect: 'none' },
      },
        img ? h('img', { src, alt: '', draggable: false, style: { position: 'absolute', left: off.x, top: off.y, width: dw, height: dh, maxWidth: 'none', pointerEvents: 'none' } }) : null,
        round ? h('div', { 'aria-hidden': true, style: { position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: '0 0 0 9999px rgba(20,22,28,0.45)', pointerEvents: 'none' } }) : null,
        round ? h('div', { 'aria-hidden': true, style: { position: 'absolute', inset: '15%', borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,0.9)', pointerEvents: 'none' } }) : null,
      ),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 12, fontSize: 14, color: '#3E424A' } },
        h('span', { className: 'material-symbols-rounded', 'aria-hidden': true, style: { fontSize: 20 } }, 'zoom_in'),
        h('span', { style: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' } }, 'Zoom'),
        h('input', { type: 'range', min: 1, max: 4, step: 0.01, value: zoom, disabled: !img, onChange: e => setZoomKeepCenter(+e.target.value), style: { flex: 1, accentColor: '#2448F0' } })),
      h('div', { style: { display: 'flex', gap: 10, flexWrap: 'wrap' } },
        btn('Annuler', onCancel, false, busy),
        btn(busy ? 'Préparation…' : 'Valider le recadrage', confirm, true, !img || busy)),
    );
  };
}
