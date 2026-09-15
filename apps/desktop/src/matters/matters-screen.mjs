// Native, session-view-only scene. No persistence, network, or model inference.
import { mark, icon as homeIcon } from '../home-icons.js';
const NS = 'http://www.w3.org/2000/svg';
const W = 1672, H = 941;
let instanceCounter = 0;
const BUBBLE = 'M 90 20 C 224 -3 366 18 489 13 C 655 4 789 8 906 32 C 974 46 1002 85 991 153 C 1008 217 964 269 891 278 C 675 302 576 277 446 287 C 309 303 188 290 102 273 C 27 260 7 219 14 153 C 0 91 19 39 90 20 Z';
const MERGED = 'M 17 137 C 3 109 22 60 82 21 C 128 -9 186 4 216 43 C 250 88 258 54 345 57 C 405 60 431 51 477 56 C 530 62 559 40 622 47 C 688 53 711 14 777 22 C 851 29 886 70 914 76 C 967 87 1007 112 991 173 C 981 205 980 237 932 263 C 882 290 821 284 774 267 C 723 250 704 287 637 291 C 552 309 499 267 447 276 C 350 307 313 265 257 275 C 163 303 100 274 73 248 C 31 211 31 178 17 137 Z';
const DEEP = 'M 33 92 C 71 54 137 57 213 47 C 285 33 352 52 419 35 C 487 15 562 22 597 9 C 630 -8 657 5 667 34 C 695 70 747 27 819 37 C 877 38 933 64 966 104 C 1009 155 1002 224 962 252 C 925 285 824 283 744 283 C 643 308 567 290 492 292 C 375 278 322 303 241 279 C 140 287 81 265 52 230 C 14 185 1 128 33 92 Z';
const POSITIONS = {
  collection: [566, 425, 557, 148], work: [140, 342, 354, 112],
  fresh: [1226, 362, 391, 112], handoff: [158, 568, 412, 137],
  ideas: [1334, 548, 280, 98], team: [970, 640, 415, 130],
};
const TABS = [
  ['care', '当时在意', '为什么在意这篇', 247, 194],
  ['understanding', '原来的理解', '我当时是怎么想的', 645, 188],
  ['comparison', '新的对照', '它改变了什么', 1020, 178],
  ['stop', '当前停点', '我现在的判断', 1437, 190],
];
const ICONS = {
  collection: '<path d="M6 3h8l5 5v13H6zM14 3v6h5M9 13h6M9 17h6"/>',
  work: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10M7 5l10 5"/>',
  fresh: '<path d="M6 3h8l5 5v13H6zM14 3v6h5M9 13h6M9 17h6"/>',
  message: '<path d="M4 4h16v13H9l-5 4V4Z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  handoff: '<path d="M3 5h7v6H3zM14 13h7v6h-7zM10 8h7v5M8 17h6M8 11v6"/>',
  ideas: '<path d="M8 16c-6-6-2-13 4-13s10 7 4 13l-1 3H9zM9 22h6M9 16h6"/>',
  team: '<circle cx="12" cy="6" r="3"/><circle cx="4" cy="15" r="2"/><circle cx="20" cy="15" r="2"/><path d="M7 19v-4c0-6 10-6 10 0v4M1 21v-2M23 21v-2"/>',
  search: '<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  link: '<path d="m9 15 6-6M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 10a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1"/>',
  quote: '<path d="M9 5H3v7h4c0 4-2 5-4 6m18-13h-6v7h4c0 4-2 5-4 6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  balance: '<path d="M12 3v18M5 6h14M5 6l-4 9h8zm14 0-4 9h8zM8 21h8"/>',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  return node;
}
function icon(name, className = '') {
  const svg = svgNode('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.45', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', class: `matters-icon ${className}` });
  svg.innerHTML = ICONS[name] || ICONS.collection; // Only the static, local icon table; never view data.
  return svg;
}
function button(label, className, action) {
  const node = el('button', className, label);
  node.type = 'button';
  if (action) node.addEventListener('click', action);
  return node;
}
function place(node, [left, top, width, height]) {
  Object.assign(node.style, { left: `${left}px`, top: `${top}px` });
  if (width != null) node.style.width = `${width}px`;
  if (height != null) node.style.height = `${height}px`;
  return node;
}
function words(value) { return Array.isArray(value) ? value.join('\n') : String(value ?? ''); }
function fingerprint(view) {
  return JSON.stringify(view, (key, value) => ['draft', 'understandingDraft', 'notice', 'freshDraft', 'freshUnderstandingDraft'].includes(key) ? undefined : value);
}

export function mountMattersScreen({ root, view: initialView, onAction, onHome = () => {}, onAll, assets = {}, services = {} }) {
  if (!root?.append || typeof onAction !== 'function') throw new TypeError('mountMattersScreen requires root and onAction');
  const id = `matters-${++instanceCounter}`;
  const shell = el('section', 'matters-shell');
  shell.setAttribute('aria-label', '在意的事');
  const stage = el('div', 'matters-stage');
  const header = el('header', 'matters-header');
  const sceneBody = el('main', 'matters-body');
  const brand = button('', 'matters-brand', onHome);
  brand.innerHTML = mark; // Authored, local brand SVG; no user content.
  brand.append(el('span', '', 'Trace'));
  brand.setAttribute('aria-label', 'Trace，返回首页');
  const breadcrumb = button('', 'matters-breadcrumb', () => send({ type: 'BACK' }));
  const utilities = el('nav', 'matters-utilities');
  utilities.setAttribute('aria-label', '页面导航');
  const mattersShortcut = button('在意的事', 'matters-text-button matters-shortcut-active', onHome);
  mattersShortcut.setAttribute('aria-current', 'page');
  const allShortcut = button('全部痕迹', 'matters-text-button', () => onAll ? onAll() : send({ type: 'OVERVIEW' }));
  const allMark = el('span', 'matters-utility-mark'); allMark.innerHTML = homeIcon('layers'); allShortcut.prepend(allMark);
  const worksShortcut = button('工作现场', 'matters-text-button', () => typeof services.onWorks === 'function' ? services.onWorks() : location.assign(new URL('?view=works', location.href).href));
  const searchShortcut = button('', 'matters-text-button matters-search-shortcut', () => {
    if (!['overview', 'search'].includes(view.mode)) send({ type: 'OVERVIEW' });
    searchInput.focus({ preventScroll: true });
  });
  searchShortcut.setAttribute('aria-label', '搜索');
  const searchMark = el('span', 'matters-utility-mark'); searchMark.innerHTML = homeIcon('search'); searchShortcut.append(searchMark);
  utilities.append(mattersShortcut, allShortcut, worksShortcut, searchShortcut);
  header.append(brand, breadcrumb, utilities);
  const hero = el('h1', 'matters-hero', '在意的事');
  hero.append(el('span', 'matters-hero-stop', '。'));
  const searchForm = el('form', 'matters-search');
  searchForm.setAttribute('role', 'search');
  const searchInput = el('input', 'matters-search-input');
  searchInput.type = 'search'; searchInput.placeholder = '找一下之前在意的事……';
  searchInput.setAttribute('aria-label', '找一下之前在意的事');
  searchInput.autocomplete = 'off'; searchInput.maxLength = 500;
  const clearSearch = button('', 'matters-clear-search', () => { send({ type: 'SEARCH', query: '' }); searchInput.focus(); });
  clearSearch.append(icon('close')); clearSearch.setAttribute('aria-label', '清空搜索');
  searchForm.append(icon('search'), searchInput, clearSearch);
  let searchComposing = false;
  searchInput.addEventListener('compositionstart', () => { searchComposing = true; });
  searchInput.addEventListener('compositionend', () => { searchComposing = false; send({ type: 'SEARCH', query: searchInput.value }); });
  searchInput.addEventListener('input', event => { if (!searchComposing && !event.isComposing) send({ type: 'SEARCH', query: searchInput.value }); });
  searchForm.addEventListener('submit', event => { event.preventDefault(); if (!searchComposing) send({ type: 'SEARCH', query: searchInput.value }); });
  const prototypeNote = el('p', 'matters-prototype-note', '示例内容 · 仅本次会话');
  const notice = el('div', 'matters-notice'); notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const announcement = el('div', 'matters-sr-only'); announcement.setAttribute('role', 'status');
  const dialog = el('dialog', 'matters-material-dialog');
  dialog.setAttribute('aria-labelledby', `${id}-material-title`);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeMaterial(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeMaterial(); });
  stage.append(header, hero, searchForm, sceneBody, prototypeNote, notice, announcement);
  shell.append(stage, dialog); root.append(shell);

  if (assets.background) {
    const background = `url(${JSON.stringify(String(assets.background))})`;
    // One environment plane fills the host; only UI coordinates are letterboxed.
    // This prevents a second, differently cropped photograph appearing at 880×620.
    shell.style.backgroundImage = background;
  }
  const fontStyle = el('style');
  const fontRules = [];
  if (assets.serifFont) fontRules.push(`@font-face{font-family:"${id}-serif";src:url(${JSON.stringify(String(assets.serifFont))}) format("woff2");font-weight:250 900;font-display:swap;}`);
  if (assets.sansFont) fontRules.push(`@font-face{font-family:"${id}-sans";src:url(${JSON.stringify(String(assets.sansFont))}) format("woff2");font-weight:100 900;font-display:swap;}`);
  fontStyle.textContent = fontRules.join('\n'); shell.prepend(fontStyle);
  shell.style.setProperty('--matters-serif', `"${id}-serif", "Noto Serif SC", "Songti SC", "SimSun", serif`);
  shell.style.setProperty('--matters-sans', `"${id}-sans", "Microsoft YaHei", "PingFang SC", sans-serif`);
  let view = initialView, lastFingerprint = '', destroyed = false;
  let materials = [], animations = [], pendingEntry = null, growth = null, growthTimer = null;
  let focusReturn = null, noticeTimer = null, lastNotice = '', materialOpen = false;
  const reducedQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const reduced = () => Boolean(reducedQuery?.matches);

  function send(action) { if (!destroyed) onAction(action); }
  function disposeMaterials() { for (const material of materials) { try { material.destroy?.(); } catch { /* decorative fallback remains */ } } materials = []; }
  function stopAnimations() { for (const animation of animations) { try { animation.cancel?.(); } catch { /* no interaction dependency */ } } animations = []; }
  function resize() {
    if (destroyed) return;
    const rect = root.getBoundingClientRect();
    const width = rect.width || W, height = rect.height || H;
    const scale = Math.min(width / W, height / H);
    stage.style.transform = `translate(-50%, -50%) scale(${scale})`;
    shell.style.setProperty('--matters-copy-boost', String(Math.max(1, Math.min(1.36, .70 / scale))));
    shell.dataset.compact = scale < .68 ? 'true' : 'false';
    // The material adapter has its own settled-resize debounce; no animation-frame displacement rebuild.
    for (const material of materials) { try { material.refresh?.(); } catch { /* static surface still usable */ } }
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(root); window.addEventListener('resize', resize);
  function motionPreferenceChanged() { if (reduced()) finishGrowth(); }
  reducedQuery?.addEventListener?.('change', motionPreferenceChanged);

  function surface(parent, shape = BUBBLE, options = {}) {
    const host = el('div', `matters-surface ${options.large ? 'matters-surface-large' : ''}`);
    host.setAttribute('aria-hidden', 'true');
    const unique = `${id}-glass-${++instanceCounter}`;
    const svg = svgNode('svg', { viewBox: '0 0 1000 300', preserveAspectRatio: 'none', class: 'matters-surface-svg' });
    const defs = svgNode('defs');
    const fill = svgNode('linearGradient', { id: `${unique}-fill`, x1: '0', y1: '0', x2: '.2', y2: '1' });
    for (const [offset, color, opacity] of [['0%', '#ffffff', '.85'], ['34%', '#f5fffd', options.large ? '.88' : '.73'], ['77%', '#dcefe9', options.large ? '.78' : '.43'], ['100%', '#ffffff', '.78']]) fill.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
    const rim = svgNode('linearGradient', { id: `${unique}-rim`, x1: '0', y1: '0', x2: '1', y2: '1' });
    for (const [offset, color, opacity] of [['0%', '#ffffff', '1'], ['40%', '#ffffff', '.87'], ['65%', '#9cbbb0', '.50'], ['82%', '#e6c46f', '.80'], ['100%', '#ffffff', '.98']]) rim.append(svgNode('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
    const clip = svgNode('clipPath', { id: `${unique}-clip`, clipPathUnits: 'objectBoundingBox' });
    clip.append(svgNode('path', { d: shape, transform: 'scale(.001 .0033333333)' }));
    defs.append(fill, rim, clip); svg.append(defs);
    svg.append(svgNode('path', { d: shape, fill: `url(#${unique}-fill)`, stroke: `url(#${unique}-rim)`, 'stroke-width': options.large ? '1.6' : '3.3', 'vector-effect': 'non-scaling-stroke' }));
    if (options.large) {
      const core = svgNode('radialGradient', { id: `${unique}-core`, cx: '.51', cy: '.53', r: '.66' });
      for (const [offset, opacity] of [['0%', '.94'], ['62%', '.84'], ['100%', '0']]) core.append(svgNode('stop', { offset, 'stop-color': '#f5faf3', 'stop-opacity': opacity }));
      defs.append(core); svg.append(svgNode('path', { d: shape, fill: `url(#${unique}-core)` }));
    }
    svg.append(svgNode('path', { d: shape, fill: 'none', stroke: '#ffffff', 'stroke-opacity': '.65', 'stroke-width': '1', transform: 'translate(7 4) scale(.985 .969)', 'vector-effect': 'non-scaling-stroke' }));
    const backdrop = el('div', 'matters-surface-backdrop'); backdrop.style.clipPath = `url(#${unique}-clip)`;
    host.append(backdrop, svg); parent.prepend(host);
    // Refraction samples SourceGraphic, not arbitrary backdrop. Only a small selected bubble uses
    // the injected, scene-aligned sampler. Large merged surfaces deliberately keep the SVG membrane.
    if (options.refract && assets.background && typeof services.mountSceneGlass === 'function') {
      const refractHost = el('div', 'matters-refraction'); host.prepend(refractHost);
      try {
        const material = services.mountSceneGlass({ host: refractHost, backgroundUrl: assets.background, scene: shell, path: shape, width: options.width, height: options.height, tone: options.tone || 'cool' });
        if (material) { materials.push(material); host.classList.add('matters-has-refraction'); }
      } catch { refractHost.remove(); }
    }
    return host;
  }
  function bird(parent, x, y, takeoff = false) {
    const url = takeoff ? assets.birdTakeoff || assets.birdPerched : assets.birdPerched;
    if (!url) return null;
    const anchor = place(el('span', 'matters-bird'), [x, y]); anchor.setAttribute('aria-hidden', 'true');
    const img = el('img'); img.alt = ''; img.src = url; img.draggable = false;
    const s = .11;
    const actualTakeoff = takeoff && assets.birdTakeoff;
    Object.assign(img.style, { width: `${(actualTakeoff ? 1156 : 1086) * s}px`, left: `${-(actualTakeoff ? 750 : 772) * s}px`, top: `${-(actualTakeoff ? 955 : 588) * s}px` });
    anchor.append(img); parent.append(anchor); return anchor;
  }
  function filament(parent, paths, dots = [], className = '') {
    const svg = svgNode('svg', { viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true', class: `matters-filaments ${className}` });
    for (const d of paths) {
      svg.append(svgNode('path', { d, class: 'matters-filament-halo' }));
      svg.append(svgNode('path', { d, class: 'matters-filament-line' }));
    }
    for (const [x, y, warm] of dots) {
      svg.append(svgNode('circle', { cx: x, cy: y, r: warm ? 15 : 8, class: warm ? 'matters-node-halo' : 'matters-node-soft' }));
      svg.append(svgNode('circle', { cx: x, cy: y, r: warm ? 4 : 2.8, class: warm ? 'matters-node matters-node-warm' : 'matters-node' }));
    }
    parent.append(svg); return svg;
  }
  function getPosition(matter) {
    if(view.example===false)return Object.values(POSITIONS)[view.matters.findIndex(item=>item.id===matter.id)%6];
    if (matter.id === view.featuredId) return POSITIONS.collection;
    if (view.matters.some(item => item.changed && item.branch) && matter.id === 'team') return [1145, 637, 404, 132];
    return POSITIONS[matter.id] || [566, 425, 557, 148];
  }
  function openMatter(matter, animateEntry = true) {
    closeMaterial(false);
    pendingEntry = animateEntry && view.mode === 'overview' ? { id: matter.id, origin: getPosition(matter) } : null;
    send({ type: 'OPEN', id: matter.id });
  }
  function renderOverview() {
    const plane = el('div', 'matters-overview'); sceneBody.append(plane);
    filament(plane, [
      'M 360 445 C 396 473 480 444 576 486',
      'M 1024 449 C 1120 409 1183 413 1237 417',
      'M 569 517 C 455 520 463 603 365 621',
      'M 1071 512 C 1190 511 1269 584 1361 584',
      'M 862 555 C 847 628 1005 656 1150 672',
    ], [[1024, 449, true], [566, 492, false], [867, 558, false]]);
    const bubbles = [];
    const hint = el('div', 'matters-hover-hint'); hint.id = `${id}-hover-hint`; hint.hidden = true;
    const hintCopy = el('span'); const hintAction = el('span', 'matters-hint-action', '点击，从这里接着 →');
    hint.append(hintCopy, hintAction); plane.append(hint);
    function hover(matter, active) {
      const target = active ? matter.id : '';
      plane.dataset.hover = target;
      for (const [node, entry] of bubbles) node.classList.toggle('matters-bubble-muted', Boolean(target) && entry.id !== target);
      hint.hidden = !active;
      if (active) {
        const [x, y, width, height] = getPosition(matter);
        hintCopy.textContent = matter.contextHint || '回到这件事上次真正停下的位置。';
        place(hint, [Math.max(70, Math.min(x + width / 2 - 282, 1035)), y + height + 7, 565]);
      }
    }
    // Keep six scene slots. All earlier captures remain in the shared search model.
    const featuredId = view.featuredId || 'collection';
    const visibleMatters = view.example===false ? view.matters.slice(0,6) : view.matters.filter(matter => matter.id === featuredId || ['work', 'fresh', 'handoff', 'ideas', 'team'].includes(matter.id));
    if(!visibleMatters.length){const empty=place(el('div','matters-empty','还没有留下的事。回到首页，写下第一点。'),[540,490,620]);empty.append(button('回首页留下一点','matters-text-button',onHome));plane.append(empty);}
    for (const matter of visibleMatters) {
      const rect = getPosition(matter);
      const node = place(button('', `matters-bubble matters-bubble-${matter.id}${matter.changed ? ' matters-bubble-changed' : ''}`, () => openMatter(matter)), rect);
      node.dataset.matterId = matter.id;
      if (matter.id === featuredId) node.classList.add('matters-bubble-collection');
      node.setAttribute('aria-label', `${matter.title}。${matter.changed ? '现在' : '上次'}停在：${matter.lastStop}`);
      node.setAttribute('aria-describedby', hint.id);
      surface(node, BUBBLE, { refract: matter.id === featuredId, width: rect[2], height: rect[3] });
      const content = el('span', 'matters-bubble-content');
      const row = el('span', 'matters-bubble-heading'); row.append(icon(matter.id), el('span', 'matters-bubble-title', matter.title));
      if (matter.changed) row.append(el('span', 'matters-change-badge', '刚有变化'));
      else if (matter.hasComparison) row.append(el('span', 'matters-change-badge matters-comparison-badge', '刚有新的对照'));
      content.append(row, el('span', 'matters-bubble-stop', `${matter.id === 'collection' ? matter.changed ? '现在停在：' : '上次停在：' : ''}${matter.lastStop}`));
      if (matter.changed) content.append(el('span', 'matters-next-stop', '↑ 下次从这里接着'));
      node.append(content);
      node.addEventListener('pointerenter', () => hover(matter, true));
      node.addEventListener('pointerleave', () => { if (document.activeElement !== node) hover(matter, false); });
      node.addEventListener('focus', () => hover(matter, true));
      node.addEventListener('blur', () => hover(matter, false));
      plane.append(node); bubbles.push([node, matter]);
    }
    const changed = visibleMatters.find(item => item.changed && item.branch);
    bird(plane, changed ? 1024 : 708, changed ? 449 : 432);
    if (changed) {
      filament(plane, ['M 1024 449 C 1082 446 1089 470 1134 481'], [[1134, 481, true]], 'matters-branch-line');
      const branch = place(button('', 'matters-branch', () => openMatter(changed)), [1136, 494, 190, 110]);
      branch.title = changed.branch.title;
      branch.setAttribute('aria-label', `${changed.branch.title}。进入查看完整停点`);
      branch.append(el('span', 'matters-branch-title', changed.branch.title), el('span', 'matters-branch-subtitle', changed.branch.subtitle));
      plane.append(branch, place(el('div', 'matters-water-ripple'), [735, 789, 275, 55]));
    }
  }
  function textBlock(title, text, className) {
    const section = el('section', className); section.append(el('h2', '', title), el('p', '', words(text))); return section;
  }
  function originalOf(matter) { return matter?.sources?.find(source => !source.id?.includes('comparison')) || matter?.sources?.[0]; }
  function showOriginal() { const source = originalOf(view.selected); if (source) showMaterial(source, 'source'); }
  function renderReentry() {
    const matter = view.selected;
    const back = place(button('← 回到 在意的事', 'matters-back', () => send({ type: 'BACK' })), [131, 189]); sceneBody.append(back);
    const merged = place(el('article', 'matters-reentry'), [174, 221, 1390, 551]);
    merged.setAttribute('aria-label', matter.title); surface(merged, MERGED, { large: true });
    const content = el('div', 'matters-reentry-content');
    const left = textBlock('当时为什么在意', matter.whyCare, 'matters-lobe matters-lobe-care');
    left.prepend(icon(matter.id, 'matters-lobe-icon'));
    left.append(button(`${originalOf(matter)?.title?.startsWith('知乎') ? '知乎原文 · ' : ''}原现场 ›`, 'matters-inline-link', showOriginal));
    const fresh = view.contextMode === 'fresh';
    const stopText = fresh ? matter.currentJudgment || '先写下此刻的感受' : matter.currentJudgment || matter.unresolved || matter.lastStop;
    const center = textBlock('上次真正停在', stopText, 'matters-lobe matters-lobe-stop');
    center.prepend(icon('message', 'matters-lobe-icon'));
    if (fresh) center.append(el('span', 'matters-context-note', '本次先不带回旧理解'));
    const right = textBlock('后来发生了什么', matter.laterChange, 'matters-lobe matters-lobe-change');
    right.prepend(icon('ideas', 'matters-lobe-icon'));
    right.append(button('新的对照 ›', 'matters-inline-link', () => send({ type: 'CONTINUE', tab: 'comparison' })));
    content.append(left, center, right);
    const footer = el('div', 'matters-reentry-actions');
    footer.append(button('查看原现场', 'matters-text-button', showOriginal), el('span', 'matters-action-divider', '|'), button('从这里接着', 'matters-text-button', () => send({ type: 'CONTINUE', tab: 'stop' })), el('span', 'matters-action-divider', '|'), button('先不带回旧理解', 'matters-text-button', () => send({ type: 'FRESH' })));
    const continueButton = button('看看它改变了什么', 'matters-primary matters-reentry-primary', () => send({ type: 'CONTINUE', tab: 'comparison' })); continueButton.append(icon('arrow'));
    merged.append(content, footer, continueButton); sceneBody.append(merged);
    filament(sceneBody, ['M 350 255 C 405 223 445 310 800 310 C 973 317 1105 280 1223 289'], [[351, 255, false], [800, 310, true], [1223, 289, false]], 'matters-reentry-filament');
    bird(sceneBody, 800, 310);
  }
  function relationControls(parent) {
    const row = el('div', 'matters-relation-actions');
    const comparisonSource = view.selected.sources.find(item => item.id === view.selected.comparison?.sourceId);
    for (const [relation, label] of [['challenge', '接为挑战'], ['irrelevant', '这次无关']]) {
      const node = button(label, relation === 'challenge' ? 'matters-primary' : 'matters-secondary', () => send({ type: 'RELATE', relation }));
      node.disabled = !comparisonSource;
      node.setAttribute('aria-pressed', String(view.selected.relation === relation)); row.append(node);
    }
    row.append(button(comparisonSource ? '查看原文' : '查看原现场', 'matters-text-button', () => {
      const source = comparisonSource || originalOf(view.selected);
      if (source) showMaterial(source, 'source');
    }));
    if (view.selected.relation === 'challenge') row.append(el('span', 'matters-relation-state', '已接为挑战 · 尚未采用为判断'));
    if (view.selected.relation === 'irrelevant') row.append(el('span', 'matters-relation-state', '本次不关联 · 原材料仍保留'));
    parent.append(row);
  }
  function composer(kind = 'judgment') {
    const understanding = kind === 'understanding';
    const form = el('form', `matters-composer ${understanding ? 'matters-composer-understanding' : ''}`);
    const input = el('textarea', 'matters-draft');
    input.rows = 2; input.dataset.draftKind = kind; input.maxLength = 6000;
    input.value = understanding ? view.selected.understandingDraft || '' : view.selected.draft || '';
    input.placeholder = understanding ? '写下这次想保留的理解……' : view.contextMode === 'fresh' ? '先写下此刻的感受……' : '我现在更倾向于……';
    input.setAttribute('aria-label', understanding ? '我的理解草稿' : '当前判断草稿');
    const submit = button('', 'matters-submit'); submit.type = 'submit'; submit.append(icon('arrow'));
    submit.setAttribute('aria-label', understanding ? '保存我的理解' : '保存当前判断，回到总览');
    submit.disabled = !input.value.trim();
    const draftAction = understanding ? 'UNDERSTANDING_DRAFT' : 'DRAFT';
    const saveAction = understanding ? 'SAVE_UNDERSTANDING' : 'SAVE_JUDGMENT';
    let composing = false;
    const draftChanged = () => { submit.disabled = !input.value.trim(); send({ type: draftAction, text: input.value }); };
    input.addEventListener('compositionstart', () => { composing = true; });
    input.addEventListener('compositionend', () => { composing = false; draftChanged(); });
    input.addEventListener('input', event => { submit.disabled = !input.value.trim(); if (!composing && !event.isComposing) draftChanged(); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !composing && !event.isComposing && event.keyCode !== 229) { event.preventDefault(); if (input.value.trim()) send({ type: saveAction, text: input.value }); }
    });
    form.addEventListener('submit', event => { event.preventDefault(); if (!composing && input.value.trim()) send({ type: saveAction, text: input.value }); });
    const linkButton = button('', 'matters-composer-link', showOriginal); linkButton.append(icon('link')); linkButton.setAttribute('aria-label', '查看原现场');
    form.append(linkButton, input, submit);
    return form;
  }
  function renderDeep() {
    const matter = view.selected;
    filament(sceneBody, ['M 180 220 C 202 187 232 181 247 194 C 392 196 509 187 645 188 C 769 185 901 186 1020 178 C 1185 178 1300 201 1437 190'], TABS.map(([tab, , , x, y]) => [x, y, tab === view.deepTab]), 'matters-deep-filament');
    const nav = el('nav', 'matters-deep-tabs'); nav.setAttribute('aria-label', '思考脉络');
    for (const [tab, label, sub, x, y] of TABS) {
      const node = place(button('', `matters-deep-tab${view.deepTab === tab ? ' matters-deep-tab-active' : ''}`, () => send({ type: 'TAB', tab })), [x - 160, y + 14, 320, 85]);
      node.append(el('span', 'matters-tab-title', label), el('span', 'matters-tab-subtitle', sub));
      if (view.deepTab === tab) node.setAttribute('aria-current', 'step');
      node.dataset.tab = tab; nav.append(node);
    }
    sceneBody.append(nav); bird(sceneBody, 1437, 190);
    const deep = place(el('article', `matters-deep matters-deep-${view.deepTab}`), [329, 279, 1117, 577]);
    deep.setAttribute('aria-label', TABS.find(item => item[0] === view.deepTab)?.[1] || '深度继续');
    surface(deep, DEEP, { large: true });
    const body = el('div', 'matters-deep-content');
    if (view.contextMode === 'fresh') body.append(el('p', 'matters-fresh-note', '本次先不带回旧理解 · 先写下此刻的感受'));
    if (view.deepTab === 'comparison') {
      const eyebrow = el('p', 'matters-deep-eyebrow', matter.comparison?.sourceId ? '挑战' : '尚无对照'); eyebrow.prepend(icon('balance'));
      const title = el('h2', 'matters-comparison-title', matter.comparison?.title || '还没有新的对照');
      const columns = el('div', 'matters-comparison-columns');
      columns.append(textBlock('它挑战了哪一点', matter.comparison?.challenges, 'matters-comparison-column'), textBlock('还不能确认什么', matter.comparison?.uncertain, 'matters-comparison-column'));
      body.append(eyebrow, title, columns);
    } else if (view.deepTab === 'care') {
      body.append(el('p', 'matters-deep-eyebrow', '当时，为什么留下它'), el('h2', 'matters-reading-title', matter.title), el('p', 'matters-reading-copy', matter.whyCare), el('p', 'matters-reading-context', matter.contextHint));
      body.append(button('查看原现场 ›', 'matters-inline-link', showOriginal));
    } else if (view.deepTab === 'understanding') {
      body.append(el('p', 'matters-deep-eyebrow', '我的理解'), el('h2', 'matters-reading-title', view.contextMode === 'fresh' ? '先让此刻的感受出现' : '我当时是怎么想的'), el('p', 'matters-reading-copy', matter.understanding || matter.originalUnderstanding || '先写下此刻的感受'));
      if (view.contextMode !== 'fresh' && matter.understanding && matter.originalUnderstanding) body.append(el('p', 'matters-reading-context', `原来的理解：${matter.originalUnderstanding}`));
      body.append(el('p', 'matters-reading-context', '只保存你明确写下的理解，不自动采用对照中的结论。'));
    } else {
      body.append(el('p', 'matters-deep-eyebrow', '当前停点'), el('h2', 'matters-reading-title', '我现在的判断'), el('p', 'matters-reading-copy', matter.currentJudgment || (view.contextMode === 'fresh' ? '' : matter.lastStop) || '先写下此刻的感受'));
      body.append(el('p', 'matters-reading-context', '写下你现在真正停在的位置，下次从这里接着。'));
    }
    const footer = el('div', 'matters-deep-footer');
    if (view.deepTab === 'comparison') relationControls(footer);
    footer.append(composer(view.deepTab === 'understanding' ? 'understanding' : 'judgment'));
    const helper = el('div', 'matters-composer-helper');
    helper.append(el('span', '', 'Enter 保存 · Shift + Enter 换行'), button(view.deepTab === 'understanding' ? '回到当前停点 ›' : '先写进我的理解 ›', 'matters-inline-link', () => send({ type: 'TAB', tab: view.deepTab === 'understanding' ? 'stop' : 'understanding' })));
    footer.append(helper); deep.append(body, footer); sceneBody.append(deep);
  }
  function searchSection(parent, title, count, name, renderItems) {
    const group = el('section', 'matters-search-group');
    const heading = el('h2', 'matters-search-group-title'); heading.append(icon(name), el('span', '', title), el('span', 'matters-search-group-count', `(${count})`), el('span', 'matters-search-rule'));
    group.append(heading); renderItems(group); parent.append(group);
  }
  function renderSearch() {
    const results = view.search || { matters: [], quotes: [], sources: [], counts: {} };
    const counts = results.counts;
    sceneBody.append(place(el('p', 'matters-search-counts', `找到 ${counts.matters || 0} 件事、${counts.quotes || 0} 句话、${counts.sources || 0} 个现场`), [450, 249, 772]));
    const panel = place(el('section', 'matters-search-results'), [311, 293, 1048, 590]);
    panel.setAttribute('aria-label', '分类搜索结果'); panel.tabIndex = 0;
    if (!results.matters.length && !results.quotes.length && !results.sources.length) {
      panel.append(el('h2', 'matters-empty-title', '当前没有匹配结果'), el('p', 'matters-empty-copy', '试试换一个词，或清空搜索看看所有在意的事。'), button('清空搜索', 'matters-secondary', () => send({ type: 'SEARCH', query: '' })));
    } else {
      searchSection(panel, '在意的事', counts.matters || 0, 'collection', group => {
        for (const matter of results.matters) {
          const row = button('', 'matters-search-result matters-search-matter', () => openMatter(matter, false));
          row.append(el('span', 'matters-result-title', matter.title), el('span', 'matters-result-stop', `现在停在：${matter.lastStop}`), el('span', 'matters-result-return', '回到上次停点 →'));
          group.append(row);
        }
        if (!results.matters.length) group.append(el('p', 'matters-no-group-results', '没有匹配的事'));
      });
      searchSection(panel, '你曾经说过', counts.quotes || 0, 'quote', group => {
        for (const quote of results.quotes) {
          const owner = view.matters.find(item => item.id === quote.matterId);
          const row = button('', 'matters-search-result matters-search-quote', () => { if (owner) { openMatter(owner, false); showMaterial(quote, 'quote'); } });
          row.append(el('span', 'matters-result-title', `“${quote.text}”`), el('span', 'matters-result-owner', `属于「${owner?.title || '在意的事'}」`)); group.append(row);
        }
        if (!results.quotes.length) group.append(el('p', 'matters-no-group-results', '没有匹配的话'));
      });
      searchSection(panel, '来源与现场', counts.sources || 0, 'link', group => {
        for (const source of results.sources) {
          const owner = view.matters.find(item => item.id === source.matterId);
          const row = button('', 'matters-search-result matters-search-source', () => { if (owner) { openMatter(owner, false); showMaterial(source, 'source'); } });
          const sourceMark = el('span', `matters-source-mark${source.title.startsWith('知乎') ? ' matters-source-zhihu' : ''}`, source.title.startsWith('知乎') ? '知' : source.title.startsWith('Codex') ? 'C' : '↗');
          const copy = el('span', 'matters-source-copy'); copy.append(el('span', 'matters-result-title', source.title), el('span', 'matters-result-owner', `${source.kind} · 关联「${owner?.title || '在意的事'}」`));
          row.append(sourceMark, copy, el('span', 'matters-source-open', '›')); group.append(row);
        }
        if (!results.sources.length) group.append(el('p', 'matters-no-group-results', '没有匹配的现场'));
      });
    }
    sceneBody.append(panel);
  }
  function showMaterial(item, kind) {
    closeMaterial(false);
    focusReturn = document.activeElement;
    const frame = el('div', 'matters-material-frame');
    const close = button('', 'matters-material-close', () => closeMaterial()); close.append(icon('close')); close.setAttribute('aria-label', '关闭原现场');
    const title = el('h2', 'matters-material-title', kind === 'quote' ? '你曾经说过' : item.title); title.id = `${id}-material-title`;
    const owner = view.matters.find(matter => matter.id === item.matterId);
    const kindLabel = kind === 'quote' ? item.example === false ? '本次输入' : '示例引文' : item.kind || '示例现场';
    frame.append(close, el('p', 'matters-material-kind', `${kindLabel} · 仅本次会话`), title, el('p', 'matters-material-excerpt', kind === 'quote' ? item.text : item.excerpt), el('p', 'matters-material-owner', `关联「${owner?.title || view.selected?.title || '在意的事'}」`), el('p', 'matters-material-footnote', item.example === false ? '这是你在本次页面会话中留下的内容，刷新后重置。' : '这是用于演示交互的现场摘录，不是已连接的外部原文。'));
    frame.append(button('回到这件事', 'matters-primary', () => closeMaterial()));
    dialog.replaceChildren(frame); materialOpen = true;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
    close.focus({ preventScroll: true });
  }
  function closeMaterial(restore = true) {
    if (!materialOpen) return;
    materialOpen = false;
    if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
    if (restore) {
      if (focusReturn?.isConnected) focusReturn.focus({ preventScroll: true });
      else (sceneBody.querySelector('button') || brand).focus({ preventScroll: true });
    }
    focusReturn = null;
  }
  function finishGrowth(restoreFocus = true) {
    if (!growth) return;
    clearTimeout(growthTimer); growthTimer = null; stopAnimations();
    growth.remove(); growth = null; shell.classList.remove('matters-entering');
    sceneBody.inert = false;
    if (restoreFocus) (sceneBody.querySelector('button') || brand).focus({ preventScroll: true });
    for (const material of materials) { try { material.refresh?.(); } catch { /* settled fallback */ } }
  }
  function startGrowth(entry) {
    if (reduced() || typeof services.animate !== 'function') return;
    shell.classList.add('matters-entering'); sceneBody.inert = true;
    growth = place(el('div', 'matters-growth'), entry.origin);
    surface(growth, BUBBLE, { large: true });
    const copy = el('div', 'matters-growth-copy'); copy.append(icon(view.selected.id), el('h2', '', view.selected.title), el('p', '', `上次停在：${view.selected.lastStop}`), el('span', 'matters-growth-label', '正在展开这件事的脉络…'));
    const progress = el('span', 'matters-growth-progress'); copy.append(progress); growth.append(copy); stage.append(growth);
    const skip = button('跳过展开', 'matters-skip-growth', finishGrowth); growth.append(skip);
    bird(growth, 243, 6, true);
    try {
      animations.push(services.animate(growth, { left: 475, top: 300, width: 743, height: 404, duration: 680, ease: 'out(4)' }));
      animations.push(services.animate(copy, { opacity: [0, 1], duration: 390, delay: 140, ease: 'out(3)' }));
      animations.push(services.animate(progress, { scaleX: [0, 1], duration: 680, ease: 'linear' }));
      growthTimer = setTimeout(finishGrowth, 720);
      skip.focus({ preventScroll: true });
    } catch { finishGrowth(); }
  }
  function syncInputs() {
    if (!searchComposing && document.activeElement !== searchInput) searchInput.value = view.query || '';
    clearSearch.hidden = !view.query;
    for (const input of sceneBody.querySelectorAll('[data-draft-kind]')) {
      const value = input.dataset.draftKind === 'understanding' ? view.selected?.understandingDraft : view.selected?.draft;
      if (document.activeElement !== input) input.value = value || '';
      const submit = input.closest('form')?.querySelector('[type="submit"]');
      if (submit) submit.disabled = !input.value.trim();
    }
    notice.textContent = view.notice || ''; notice.hidden = !view.notice;
    if (view.notice !== lastNotice) {
      clearTimeout(noticeTimer); lastNotice = view.notice;
      if (view.notice) noticeTimer = setTimeout(() => send({ type: 'CLEAR_NOTICE' }), 5000);
    }
  }
  function update(nextView) {
    if (destroyed) return;
    const previousMode = view?.mode;
    view = nextView;
    prototypeNote.textContent=view.example===false?'你的内容 · 已保存在本机':'示例内容 · 仅本次会话';
    const key = fingerprint(view);
    if (key === lastFingerprint) { syncInputs(); return; }
    const active = document.activeElement;
    const retainedDraft = active?.dataset?.draftKind;
    const retainedTab = active?.dataset?.tab;
    const oldSelection = retainedDraft ? [active.selectionStart, active.selectionEnd] : null;
    finishGrowth(false); disposeMaterials(); sceneBody.replaceChildren();
    shell.dataset.mode = view.mode;
    hero.hidden = view.mode === 'deep';
    searchForm.hidden = view.mode === 'deep' || view.mode === 'reentry';
    breadcrumb.hidden = view.mode !== 'deep';
    breadcrumb.textContent = `←  ${view.selected?.title || '在意的事'}`;
    if (view.mode === 'overview') renderOverview();
    else if (view.mode === 'reentry') renderReentry();
    else if (view.mode === 'deep') renderDeep();
    else if (view.mode === 'search') renderSearch();
    lastFingerprint = key; syncInputs(); resize();
    const entry = pendingEntry; pendingEntry = null;
    if (entry && view.mode === 'reentry' && entry.id === view.selectedId) startGrowth(entry);
    else if (retainedDraft && previousMode === view.mode) {
      const target = sceneBody.querySelector(`[data-draft-kind="${retainedDraft}"]`);
      target?.focus({ preventScroll: true }); if (target && oldSelection) target.setSelectionRange(...oldSelection);
    } else if (retainedTab && previousMode === view.mode) sceneBody.querySelector(`[data-tab="${retainedTab}"]`)?.focus({ preventScroll: true });
    else if (previousMode !== view.mode && view.mode !== 'search' && document.activeElement !== searchInput) {
      (sceneBody.querySelector('button') || brand).focus({ preventScroll: true });
    }
    announcement.textContent = view.mode === 'overview' ? '在意的事总览' : view.mode === 'search' ? '搜索结果已更新' : `${view.selected?.title || ''}，${view.mode === 'deep' ? '深度继续' : '重新进入'}`;
  }
  function onKeydown(event) {
    if (event.key !== 'Escape' || event.isComposing) return;
    if (materialOpen) { event.preventDefault(); event.stopPropagation(); closeMaterial(); return; }
    if (growth) { event.preventDefault(); finishGrowth(); send({ type: 'BACK' }); return; }
    if (view.mode !== 'overview') { event.preventDefault(); send({ type: 'BACK' }); }
  }
  shell.addEventListener('keydown', onKeydown);
  update(initialView);
  return {
    update,
    destroy() {
      if (destroyed) return;
      finishGrowth(false); closeMaterial(false); destroyed = true;
      clearTimeout(noticeTimer); clearTimeout(growthTimer); stopAnimations(); disposeMaterials();
      observer?.disconnect(); window.removeEventListener('resize', resize);
      reducedQuery?.removeEventListener?.('change', motionPreferenceChanged);
      shell.removeEventListener('keydown', onKeydown); shell.remove();
    },
  };
}
