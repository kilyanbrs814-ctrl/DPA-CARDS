const build = __DPA_BUILD__;

class BuildInfo extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' }).innerHTML = '<style>:host{display:inline-block;color:var(--dpa-muted,#5e636b);font:500 12px/1.5 system-ui,sans-serif}span{overflow-wrap:anywhere}</style><span></span>';
  }
  connectedCallback() {
    const native = window.location.protocol === 'capacitor:';
    this.dataset.release = build.releaseId;
    this.shadowRoot.querySelector('span').textContent = 'MAJ ' + build.date + ' · ' + build.label + (native && build.iosBuild ? ' · iOS ' + build.iosBuild : '');
    this.title = 'DPA Cards ' + build.appVersion + ' — mise à jour ' + build.releaseId + ' — révision ' + build.revision.slice(0, 8);
  }
}
document.documentElement.dataset.dpaRelease = build.releaseId;
if (!customElements.get('dpa-build-info')) customElements.define('dpa-build-info', BuildInfo);
