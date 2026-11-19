// A fixed number of samples lets a daily curve morph into a monthly curve.
export function sampleCurve(points, ceiling, count = 61) {
  return Array.from({ length: count }, (_, i) => {
    const at = i * Math.max(0, points.length - 1) / (count - 1);
    const a = Math.floor(at), mix = at - a;
    const value = (points[a]?.value || 0) * (1 - mix) + (points[Math.min(a + 1, points.length - 1)]?.value || 0) * mix;
    return [i * 600 / (count - 1), 150 - value * 150 / Math.max(1, ceiling)];
  });
}

export function makeDashboardMotion(React) {
  function useReducedMotion() {
    const [reduced, set] = React.useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    React.useEffect(() => {
      const query = window.matchMedia('(prefers-reduced-motion: reduce)'), change = () => set(query.matches);
      query.addEventListener('change', change); change();
      return () => query.removeEventListener('change', change);
    }, []);
    return reduced;
  }
  function useTween(target, duration = 640) {
    const reduced = useReducedMotion();
    const [value, set] = React.useState(target.map(point => [point[0], 150]));
    const current = React.useRef(value), fingerprint = JSON.stringify(target);
    React.useEffect(() => {
      if (reduced) { current.current = target; set(target); return; }
      const from = current.current, start = performance.now(); let frame;
      const tick = now => {
        const progress = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - progress, 3);
        const next = target.map((point, i) => point.map((v, axis) => (from[i]?.[axis] ?? v) + (v - (from[i]?.[axis] ?? v)) * eased));
        current.current = next; set(next);
        if (progress < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(frame);
    }, [fingerprint, reduced, duration]);
    return reduced ? target : value;
  }
  function Counter({ value }) {
    const text = String(value), numeric = /^[\d\s\u00a0\u202f]+$/.test(text), target = Number(text.replace(/\s/g, ''));
    const reduced = useReducedMotion();
    const [shown, set] = React.useState(0), current = React.useRef(0);
    React.useEffect(() => {
      if (!numeric || reduced) { current.current = target; set(target); return; }
      const start = performance.now(), from = current.current; let frame;
      const tick = now => {
        const t = Math.min(1, (now - start) / 800);
        current.current = from + (target - from) * (1 - Math.pow(1 - t, 4));
        set(Math.round(current.current));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
    }, [target, numeric, reduced]);
    return React.createElement('span', { className: 'dpa-counter', 'aria-label': text },
      React.createElement('span', { 'aria-hidden': true }, numeric && !reduced ? shown.toLocaleString('fr-FR') : text));
  }
  return { Counter, useTween, useReducedMotion };
}
