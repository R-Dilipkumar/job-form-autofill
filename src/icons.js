// Small line icons for the popup and the Manage answers page, built with DOM calls (no innerHTML).
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const P = (d) => ['path', { d }];
  const SHAPES = {
    x: [P('M18 6 6 18'), P('m6 6 12 12')],
    trash: [P('M3 6h18'), P('M8 6V4h8v2'), P('M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14')],
    globe: [['circle', { cx: 12, cy: 12, r: 9 }], P('M3 12h18'), P('M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z')],
    check: [P('M20 6 9 17l-5-5')],
    list: [P('M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01')],
  };

  function icon(name) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'i');
    svg.setAttribute('aria-hidden', 'true');
    for (const [tag, attrs] of SHAPES[name] || []) {
      const node = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
      svg.append(node);
    }
    return svg;
  }

  globalThis.JFA = globalThis.JFA || {};
  globalThis.JFA.icon = icon;
})();
