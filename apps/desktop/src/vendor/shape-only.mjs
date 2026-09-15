/* Derived local bundle of @liquidglassjs/core 0.5.2.
 * Upstream commit: 07ad06ea197a07269af56da83d1fc9498bca94f5
 * MIT Copyright (c) 2026 Amir Abushanab. Full text: ./LICENSE
 * Source-only preparation: not runtime or visual acceptance. */

// originals/liquidglassjs/packages/core/src/map-encode.ts
var NEUTRAL = 0.5019607843137255;
var clamp1 = (x) => x < -1 ? -1 : x > 1 ? 1 : x;
function encodeOffset(dir) {
  return Math.round((0.5 + 0.5 * clamp1(dir)) * 255);
}
function encodeSpec(r) {
  return Math.round(127 * clamp1(r) + 128);
}
function specMaskValues(tint = [1, 1, 1]) {
  return `0 0 0 0 ${tint[0]}  0 0 0 0 ${tint[1]}  0 0 0 0 ${tint[2]}  0 0 1 0 -${NEUTRAL}`;
}
function darkMaskValues() {
  return `0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 -1 0 ${NEUTRAL}`;
}

// originals/liquidglassjs/packages/core/src/glyph-map.ts
function boxesForGauss(sigma) {
  const n = 3;
  const wIdeal = Math.sqrt(12 * sigma * sigma / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}
function boxBlurH(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = 0; x <= r && x < w; x++) acc += src[row + x];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * norm;
      const add = x + r + 1;
      const sub = x - r;
      if (add < w) acc += src[row + add];
      if (sub >= 0) acc -= src[row + sub];
    }
  }
}
function boxBlurV(src, dst, w, h, r) {
  const norm = 1 / (2 * r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = 0; y <= r && y < h; y++) acc += src[y * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * norm;
      const add = y + r + 1;
      const sub = y - r;
      if (add < h) acc += src[add * w + x];
      if (sub >= 0) acc -= src[sub * w + x];
    }
  }
}
function gaussBlur(data, tmp, w, h, sigma) {
  if (sigma <= 0) return;
  for (const size of boxesForGauss(sigma)) {
    const r = (size - 1) / 2;
    if (r < 1) continue;
    boxBlurH(data, tmp, w, h, r);
    boxBlurV(tmp, data, w, h, r);
  }
}
function buildAlphaDisplacementMap(o, cache = {}) {
  const margin = Math.ceil(Math.max(3 * o.bevel, o.marginBoost ?? 0)) + 2;
  const w = Math.max(1, Math.ceil((o.rectW + 2 * margin) * o.dpr));
  const h = Math.max(1, Math.ceil((o.rectH + 2 * margin) * o.dpr));
  if (!cache.canvas) cache.canvas = document.createElement("canvas");
  const cv = cache.canvas;
  if (cache.w !== w || cache.h !== h) {
    cv.width = w;
    cv.height = h;
    cache.w = w;
    cache.h = h;
    cache.img = void 0;
    cache.hn = new Float32Array(w * h);
    cache.hw = new Float32Array(w * h);
    cache.tmp = new Float32Array(w * h);
  }
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { url: "", margin, cssW: w / o.dpr, cssH: h / o.dpr };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.setTransform(o.dpr, 0, 0, o.dpr, 0, 0);
  o.draw(ctx, margin);
  const src = ctx.getImageData(0, 0, w, h).data;
  const hn = cache.hn;
  const hw = cache.hw;
  const tmp = cache.tmp;
  const N = w * h;
  for (let i = 0; i < N; i++) hn[i] = src[i * 4 + 3] / 255;
  let area = 0;
  let tv = 0;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const a = hn[row + x];
      area += a;
      if (x + 1 < w) tv += Math.abs(a - hn[row + x + 1]);
      if (y + 1 < h) tv += Math.abs(a - hn[row + w + x]);
    }
  }
  const strokePx = tv > 1e-6 ? 2 * area / tv : 0;
  const want = Math.max(0.5, o.bevel * o.dpr);
  const hi = strokePx > 0 ? Math.min(strokePx / 3, margin * o.dpr / 3) : want;
  const lo = Math.min(strokePx / 8, hi);
  const sn = Math.max(0.5, Math.min(Math.max(want, lo), hi));
  gaussBlur(hn, tmp, w, h, sn);
  hw.set(hn);
  gaussBlur(hw, tmp, w, h, sn * Math.sqrt(8));
  if (!cache.img) cache.img = ctx.createImageData(w, h);
  const out = cache.img.data;
  const nrmN = sn * Math.sqrt(2 * Math.PI);
  const nrmW = 3 * sn * Math.sqrt(2 * Math.PI);
  const domeMix = o.dome / 6;
  const shade = o.shade ?? 0;
  const SQ2 = Math.SQRT1_2;
  for (let y = 0; y < h; y++) {
    const ymRow = (y > 0 ? y - 1 : y) * w;
    const ypRow = (y < h - 1 ? y + 1 : y) * w;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      const xm = x > 0 ? i - 1 : i;
      const xp = x < w - 1 ? i + 1 : i;
      const gxN = (hn[xp] - hn[xm]) / 2;
      const gyN = (hn[ypRow + x] - hn[ymRow + x]) / 2;
      const gxW = (hw[xp] - hw[xm]) / 2;
      const gyW = (hw[ypRow + x] - hw[ymRow + x]) / 2;
      const u = Math.max(-1, Math.min(1, (gxN + domeMix * gxW) * nrmN));
      const v = Math.max(-1, Math.min(1, (gyN + domeMix * gyW) * nrmN));
      const t = i * 4;
      out[t] = encodeOffset(u);
      out[t + 1] = encodeOffset(v);
      let r = 0;
      const magN = Math.hypot(gxN, gyN);
      if (magN > 1e-6) {
        const linSigned = (gxN + gyN) / magN * SQ2;
        const bandE = Math.pow(Math.min(1, magN * nrmN), 1.5);
        const shadow = Math.max(0, -linSigned);
        r = o.edge * bandE * Math.max(0, linSigned) + o.edge * bandE * (1 - shade) * shadow;
        const magW = Math.hypot(gxW, gyW);
        if (magW > 1e-6) {
          const linW = Math.abs((gxW + gyW) / magW) * SQ2;
          const bandW = Math.min(1, magW * nrmW);
          r += o.glow * Math.pow(bandW, 1.5) * linW;
        }
        if (shade > 0) r -= shade * bandE * shadow;
      }
      out[t + 2] = encodeSpec(r);
      out[t + 3] = 255;
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(cache.img, 0, 0);
  return { url: cv.toDataURL(), margin, cssW: w / o.dpr, cssH: h / o.dpr };
}

// originals/liquidglassjs/packages/core/src/color.ts
function parseCssColor(css) {
  const cv = document.createElement("canvas");
  cv.width = 1;
  cv.height = 1;
  const ctx = cv.getContext("2d");
  if (!ctx) return [1, 1, 1];
  ctx.fillStyle = css;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

// originals/liquidglassjs/packages/core/src/filter-origin.ts
var _isWebKit = null;
function isWebKit() {
  if (_isWebKit !== null) return _isWebKit;
  try {
    if (typeof window !== "undefined" && "webkitConvertPointFromNodeToPage" in window) {
      _isWebKit = true;
      return true;
    }
    const ua = navigator.userAgent;
    _isWebKit = /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  } catch {
    _isWebKit = false;
  }
  return _isWebKit;
}
var TRANSFORM_PROPS = ["transform", "translate", "scale", "rotate"];
var PINNED = "lgFilterOrigin";
function hasOwnOrigin(el) {
  const cs = getComputedStyle(el);
  return TRANSFORM_PROPS.some((p) => {
    const v = cs[p];
    return !!v && v !== "none";
  });
}
function hasFixedBackground(el) {
  return getComputedStyle(el).backgroundAttachment.includes("fixed");
}
function willPin(el) {
  return isWebKit() && !hasOwnOrigin(el) && !hasFixedBackground(el);
}
function glassOriginOffset(el) {
  if (!isWebKit() || willPin(el) || hasOwnOrigin(el)) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  return {
    x: r.left + (window.scrollX || 0),
    y: r.top + (window.scrollY || 0)
  };
}
function applyGlassFilter(el, id) {
  if (willPin(el) && !el.dataset[PINNED]) {
    el.style.rotate = "0deg";
    el.dataset[PINNED] = "1";
  }
  el.style.filter = `url(#${id})`;
  el.style.setProperty("-webkit-filter", `url(#${id})`);
}
function refreshGlassFilter(el, filter, id) {
  if (!isWebKit()) return filter.id;
  filter.setAttribute("id", id);
  el.style.filter = `url(#${id})`;
  el.style.setProperty("-webkit-filter", `url(#${id})`);
  return id;
}
function primitiveScale(el) {
  if (!isWebKit()) return 1;
  if (typeof SVGSVGElement === "undefined" || !(el instanceof SVGSVGElement)) return 1;
  const vb = el.viewBox?.baseVal;
  const r = el.getBoundingClientRect();
  if (!vb || !vb.width || !vb.height || !r.width || !r.height) return 1;
  return vb.width / r.width;
}
function clearGlassFilter(el) {
  el.style.filter = "";
  el.style.removeProperty("-webkit-filter");
  if (el.dataset[PINNED]) {
    el.style.removeProperty("rotate");
    delete el.dataset[PINNED];
  }
}

// originals/liquidglassjs/packages/core/src/blur-quantize.ts
var K = 3 * Math.sqrt(2 * Math.PI) / 4;
var rungSigma = (d) => Math.sqrt(d * d - 1) / 2;
var rungStd = (d) => d === 3 ? Math.SQRT2 : d / K;
var FIRST_RUNG = rungSigma(3);
var ZERO_CUTOFF = FIRST_RUNG / 2;
function preBlurStd(blur) {
  if (!(blur >= ZERO_CUTOFF)) return 0;
  const ideal = Math.sqrt(4 * blur * blur + 1);
  const d = Math.max(3, Math.round((ideal - 1) / 2) * 2 + 1);
  return rungStd(d);
}

// originals/liquidglassjs/packages/core/src/mount-alpha-glass.ts
var MAP_KEYS = ["bevel", "dome", "edge", "glow", "shade"];
function mountAlphaGlass(core) {
  const cur = { ...core.params };
  const glintRgb = parseCssColor(core.glint ?? "#ffffff");
  const cache = {};
  let n = 0;
  let raf = 0;
  let tid = 0;
  let disposed = false;
  let holder = null;
  let dispNodes = [];
  let blurNode = null;
  let filterNode = null;
  let ro = null;
  let io = null;
  let m = null;
  let firstRegen = true;
  const scales = () => [
    cur.strength * (1 + 0.2 * cur.chroma),
    cur.strength * (1 + 0.1 * cur.chroma),
    cur.strength
  ];
  const applyAttrs = () => {
    if (!dispNodes.length) return;
    const k = primitiveScale(core.target);
    const s = scales();
    dispNodes.forEach((d, i) => d.setAttribute("scale", String(s[i] * k)));
    blurNode?.setAttribute("stdDeviation", String(preBlurStd(cur.blur * k)));
  };
  const regen = async () => {
    if (disposed || !m) return;
    const map = core.buildMap(m, cur, cache);
    if (!map.url) return;
    const id = `${core.idPrefix}-${++n}`;
    const k = primitiveScale(core.target);
    const org = glassOriginOffset(core.target);
    const ox = (-map.margin + org.x) * k;
    const oy = (-map.margin + org.y) * k;
    const [s1, s2, s3] = scales().map((v) => v * k);
    const div = document.createElement("div");
    div.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    div.innerHTML = `<svg width="0" height="0" aria-hidden="true"><filter id="${id}" filterUnits="userSpaceOnUse" primitiveUnits="userSpaceOnUse" x="${ox}" y="${oy}" width="${map.cssW * k}" height="${map.cssH * k}" color-interpolation-filters="sRGB"><feFlood flood-color="rgb(128,128,128)" flood-opacity="1" result="mapBg"></feFlood><feImage href="${map.url}" xlink:href="${map.url}" x="${ox}" y="${oy}" width="${map.cssW * k}" height="${map.cssH * k}" preserveAspectRatio="none" result="rawMap"></feImage><feComposite in="rawMap" in2="mapBg" operator="over" result="map"></feComposite><feGaussianBlur in="SourceGraphic" stdDeviation="${preBlurStd(cur.blur * k)}" result="blurred"></feGaussianBlur><feDisplacementMap in="blurred" in2="map" scale="${s1}" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap><feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="dispR"></feColorMatrix><feDisplacementMap in="blurred" in2="map" scale="${s2}" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap><feColorMatrix type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="dispG"></feColorMatrix><feDisplacementMap in="blurred" in2="map" scale="${s3}" xChannelSelector="R" yChannelSelector="G"></feDisplacementMap><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="dispB"></feColorMatrix><feComposite in="dispR" in2="dispG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"></feComposite><feComposite in2="dispB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="refr"></feComposite><feColorMatrix in="map" type="matrix" values="${specMaskValues(glintRgb)}" result="specMask"></feColorMatrix><feComposite in="specMask" in2="refr" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="lit"></feComposite><feColorMatrix in="map" type="matrix" values="${darkMaskValues()}" result="darkMask"></feColorMatrix><feComposite in="darkMask" in2="lit" operator="arithmetic" k1="-1" k2="0" k3="1" k4="0" result="litDark"></feComposite><feComposite in="litDark" in2="SourceAlpha" operator="in"></feComposite></filter></svg>`;
    const gen = n;
    try {
      const img = new Image();
      img.src = map.url;
      await img.decode();
    } catch {
    }
    if (disposed || n !== gen) return;
    core.host.appendChild(div);
    applyGlassFilter(core.target, id);
    if (holder) holder.remove();
    holder = div;
    dispNodes = Array.from(div.querySelectorAll("feDisplacementMap"));
    blurNode = div.querySelector("feGaussianBlur");
    filterNode = div.querySelector("filter");
    if (firstRegen) {
      firstRegen = false;
      core.onReady?.();
    }
  };
  const scheduleRegen = () => {
    if (raf || disposed) return;
    const flush = () => {
      raf = 0;
      if (tid) {
        clearTimeout(tid);
        tid = 0;
      }
      void regen();
    };
    raf = requestAnimationFrame(flush);
    tid = window.setTimeout(() => {
      if (raf) {
        cancelAnimationFrame(raf);
        flush();
      }
    }, 150);
  };
  const init = async () => {
    if (core.ready) {
      try {
        await core.ready();
      } catch {
      }
    }
    if (disposed) return;
    m = core.measure();
    await regen();
    ro = new ResizeObserver(() => {
      if (disposed) return;
      const r = core.target.getBoundingClientRect();
      if (m && Math.abs(r.width - m.rectW) < 0.5 && Math.abs(r.height - m.rectH) < 0.5) return;
      m = core.measure();
      scheduleRegen();
    });
    ro.observe(core.target);
    const repoint = () => {
      if (disposed || !filterNode) return;
      refreshGlassFilter(core.target, filterNode, `${core.idPrefix}-${++n}`);
    };
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((es) => {
        if (es.some((e) => e.isIntersecting)) repoint();
      });
      io.observe(core.target);
    }
  };
  void init();
  return {
    reconfigure(patch) {
      Object.assign(cur, patch);
      if (MAP_KEYS.some((k) => patch[k] != null)) scheduleRegen();
      else applyAttrs();
    },
    getOptions() {
      return { ...cur };
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      if (tid) clearTimeout(tid);
      ro?.disconnect();
      io?.disconnect();
      holder?.remove();
      clearGlassFilter(core.target);
    }
  };
}

// originals/liquidglassjs/packages/core/src/glass-shape.ts
var GLASS_SHAPE_DEFAULTS = {
  strength: 8,
  chroma: 0.4,
  blur: 0.3,
  bevel: 2.5,
  dome: 4,
  edge: 0.9,
  glow: 0.35,
  shade: 0
};
var PARAM_KEYS = [
  "strength",
  "chroma",
  "blur",
  "bevel",
  "dome",
  "edge",
  "glow",
  "shade"
];
function mountGlassShape(o) {
  const explicit = {};
  PARAM_KEYS.forEach((k) => {
    if (o[k] != null) explicit[k] = o[k];
  });
  const params = { ...GLASS_SHAPE_DEFAULTS, ...explicit };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let bitmap = null;
  const decode = async () => {
    if (o.draw) return;
    const src = o.source;
    if (!src) return;
    if (typeof src === "string" || src instanceof HTMLImageElement) {
      const img = typeof src === "string" ? new Image() : src;
      if (typeof src === "string") {
        img.crossOrigin = "anonymous";
        img.src = src;
      }
      await img.decode();
      bitmap = img;
    } else if (src instanceof HTMLCanvasElement) {
      bitmap = src;
    } else if (typeof SVGSVGElement !== "undefined" && src instanceof SVGSVGElement) {
      const svg = new XMLSerializer().serializeToString(src);
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        bitmap = img;
      } finally {
        URL.revokeObjectURL(url);
      }
    }
  };
  const measure = () => {
    const r = o.target.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { rectW: r.width, rectH: r.height };
  };
  return mountAlphaGlass({
    target: o.target,
    host: o.host,
    idPrefix: "gshape-" + Math.random().toString(36).slice(2, 8),
    params,
    glint: o.glint,
    dpr,
    ready: decode,
    measure,
    buildMap: (mm, cur, cache) => {
      try {
        return buildAlphaDisplacementMap(
          {
            rectW: mm.rectW,
            rectH: mm.rectH,
            dpr,
            bevel: cur.bevel,
            dome: cur.dome,
            edge: cur.edge,
            glow: cur.glow,
            shade: cur.shade,
            marginBoost: 0,
            // shapes stretch to the rect; no ascent/descent bleed
            draw: (ctx, margin) => {
              if (o.draw) {
                ctx.save();
                ctx.translate(margin, margin);
                o.draw(ctx, mm.rectW, mm.rectH);
                ctx.restore();
              } else if (bitmap) {
                ctx.drawImage(bitmap, margin, margin, mm.rectW, mm.rectH);
              }
            }
          },
          cache
        );
      } catch {
        console.warn("mountGlassShape: source tainted the canvas (needs CORS); left unfiltered");
        return { url: "", margin: 0, cssW: 0, cssH: 0 };
      }
    }
  });
}
export {
  GLASS_SHAPE_DEFAULTS,
  mountGlassShape
};
