// Trace scene adapter, authored locally. No Codrops source is included.
// Optional vendor: ../vendor/shape-only.mjs (MIT, bundled separately).
const NS = 'http://www.w3.org/2000/svg';
const DEFAULT_PATH = 'M 50 44 C 153 -3 352 30 498 20 C 673 8 865 4 952 61 C 1015 104 1008 209 927 256 C 832 309 660 267 508 273 C 334 279 129 312 54 247 C -12 191 -21 95 50 44 Z';
let nextId = 0;
let vendorPromise;

const svgElement = (tag, attributes = {}) => {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
};

/** Pure geometry; all rectangles are unrotated viewport coordinates. */
export function calculateCoverSample(sceneRect, hostRect, imageWidth, imageHeight) {
  if (![sceneRect.width, sceneRect.height, hostRect.width, hostRect.height, imageWidth, imageHeight].every(n => Number.isFinite(n) && n > 0)) return null;
  const scale = Math.max(sceneRect.width / imageWidth, sceneRect.height / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: ((sceneRect.left + (sceneRect.width - width) / 2 - hostRect.left) / hostRect.width) * 1000,
    y: ((sceneRect.top + (sceneRect.height - height) / 2 - hostRect.top) / hostRect.height) * 300,
    width: (width / hostRect.width) * 1000,
    height: (height / hostRect.height) * 300,
  };
}

/**
 * host: empty, absolutely positioned decorative container; text is a sibling.
 * scene: element whose background is cover / center, without rotation or skew.
 * path: SVG path string in 0 0 1000 300, or () => string for changing state.
 * width/height: design-size fallback only; the adapter does not resize host.
 * tone: 'warm'/'gold', otherwise cool white.
 * Opt out: host.dataset.glassRefraction = 'off'. Large surfaces stay simple.
 */
export function mountSceneGlass({ host, backgroundUrl, scene, path = DEFAULT_PATH, width = 420, height = 140, tone = 'cool' }) {
  if (!host || !scene || typeof host.appendChild !== 'function') throw new TypeError('mountSceneGlass requires host and scene elements');
  const id = `trace-glass-${++nextId}`;
  const warm = tone === 'warm' || tone === 'gold';
  let disposed = false;
  let timer = 0;
  let revision = 0;
  let material = null;
  let imageReady = false;
  let currentPath = DEFAULT_PATH;
  let coverage = null;
  const image = new Image();
  const wrap = document.createElement('div');
  wrap.dataset.sceneGlass = 'surface';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible;isolation:isolate;';
  const sample = svgElement('svg', { viewBox: '0 0 1000 300', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  sample.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;overflow:hidden;pointer-events:none;opacity:.72;';
  const defs = svgElement('defs');
  const clip = svgElement('clipPath', { id: `${id}-clip`, clipPathUnits: 'userSpaceOnUse' });
  const clipPath = svgElement('path', { d: DEFAULT_PATH });
  clip.appendChild(clipPath);
  defs.appendChild(clip);
  sample.appendChild(defs);
  const samplingImage = svgElement('image', { preserveAspectRatio: 'none', 'clip-path': `url(#${id}-clip)`, opacity: '.8' });
  samplingImage.style.filter = 'blur(10px)';
  if (backgroundUrl) samplingImage.setAttribute('href', String(backgroundUrl));
  sample.appendChild(samplingImage);
  wrap.appendChild(sample);

  // This cheap layer survives missing images, missing vendor, or disabled refraction.
  const surface = svgElement('svg', { viewBox: '0 0 1000 300', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  surface.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none;';
  const skinDefs = svgElement('defs');
  const fill = svgElement('linearGradient', { id: `${id}-fill`, x1: '0%', y1: '0%', x2: '35%', y2: '100%' });
  for (const [offset, color, opacity] of warm
    ? [['0%', '#fffdf2', '.90'], ['55%', '#fffbed', '.73'], ['100%', '#fffefa', '.86']]
    : [['0%', '#ffffff', '.86'], ['55%', '#edf9f7', '.69'], ['100%', '#ffffff', '.80']]) {
    fill.appendChild(svgElement('stop', { offset, 'stop-color': color, 'stop-opacity': opacity }));
  }
  skinDefs.appendChild(fill);
  surface.appendChild(skinDefs);
  const skin = svgElement('path', { d: DEFAULT_PATH, fill: `url(#${id}-fill)`, stroke: warm ? '#fff9d9' : '#ffffff', 'stroke-width': '1.3', 'stroke-opacity': '.94', 'vector-effect': 'non-scaling-stroke' });
  surface.appendChild(skin);
  wrap.appendChild(surface);
  host.appendChild(wrap);

  function clearMaterial() {
    revision += 1;
    if (material) {
      try { material.dispose(); } catch { /* Preserve the lightweight surface. */ }
      material = null;
    }
    sample.style.filter = '';
    sample.style.width = '100%';
    sample.style.height = '100%';
    wrap.dataset.refraction = 'fallback';
  }

  function updateSample() {
    try {
      const candidate = typeof path === 'function' ? path() : path;
      currentPath = typeof candidate === 'string' && candidate.trim() ? candidate : DEFAULT_PATH;
      coverage = typeof Path2D === 'function' ? new Path2D(currentPath) : null;
    } catch {
      currentPath = DEFAULT_PATH;
      coverage = typeof Path2D === 'function' ? new Path2D(DEFAULT_PATH) : null;
    }
    clipPath.setAttribute('d', currentPath);
    skin.setAttribute('d', currentPath);
    const hostRect = host.getBoundingClientRect();
    const sceneRect = scene.getBoundingClientRect();
    if (imageReady) {
      const placement = calculateCoverSample(sceneRect, hostRect, image.naturalWidth, image.naturalHeight);
      if (placement) for (const [name, value] of Object.entries(placement)) samplingImage.setAttribute(name, String(value));
    }
    return hostRect;
  }

  async function settle() {
    if (disposed) return;
    const rect = updateSample();
    // Budget intentionally limits the expensive path; large detail panels keep skin.
    if (!imageReady || !coverage || typeof ResizeObserver !== 'function' || rect.width <= 0 || rect.height <= 0 || rect.width * rect.height > 260000 || host.dataset.glassRefraction === 'off') return;
    const token = revision;
    try {
      vendorPromise ??= import('../vendor/shape-only.mjs').catch(() => null);
      const vendor = await vendorPromise;
      if (disposed || token !== revision || !vendor?.mountGlassShape) return;
      // Freeze the observed target size. A host resize first destroys this filter;
      // only its cheap skin is resized while the 160 ms settle timer is pending.
      sample.style.width = `${host.clientWidth || width}px`;
      sample.style.height = `${host.clientHeight || height}px`;
      const fixedCoverage = coverage;
      material = vendor.mountGlassShape({
        target: sample, host: wrap,
        draw(ctx, w, h) { ctx.save(); ctx.scale(w / 1000, h / 300); ctx.fillStyle = '#fff'; ctx.fill(fixedCoverage); ctx.restore(); },
        strength: 1.8, chroma: 0, blur: 0, bevel: 2.2,
        dome: 0.8, edge: 0.3, glow: 0.12, shade: 0,
        glint: warm ? '#fff7d9' : '#ffffff',
      });
      // 'requested' is deliberately not a claim that a browser painted the filter.
      wrap.dataset.refraction = 'requested';
    } catch {
      clearMaterial();
    }
  }

  function refresh() {
    if (disposed) return;
    clearTimeout(timer);
    clearMaterial();
    updateSample();
    timer = window.setTimeout(() => { timer = 0; void settle(); }, 160);
  }

  image.onload = () => { if (!disposed) { imageReady = true; refresh(); } };
  image.onerror = () => { if (!disposed) { imageReady = false; clearMaterial(); } };
  if (backgroundUrl) image.src = String(backgroundUrl);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(refresh) : null;
  observer?.observe(host);
  observer?.observe(scene);
  window.addEventListener('resize', refresh, { passive: true });
  refresh();

  return {
    refresh,
    destroy() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      observer?.disconnect();
      window.removeEventListener('resize', refresh);
      image.onload = image.onerror = null;
      clearMaterial();
      wrap.remove();
    },
  };
}
