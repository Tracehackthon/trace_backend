// Trace-authored primitives reused from apps/desktop/src/home-icons.js;
// new worksite glyphs use the same 24px / 1.65px native SVG grammar.
const paths = {
  file:'<path d="M6 3h8l5 5v13H6zM14 3v6h5M9 13h6M9 17h6"/>',
  box:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10M7 5l10 5"/>',
  link:'<path d="m10 14 4-4M8 15l-1 1a4 4 0 0 1-5-6l4-4a4 4 0 0 1 6 0m0 3 1-1a4 4 0 0 1 5 6l-4 4a4 4 0 0 1-6 0" transform="translate(2 1)"/>',
  arrow:'<path d="M4 12h16m-7-7 7 7-7 7"/>',
  up:'<path d="M12 21V3M4 11l8-8 8 8"/>',
  back:'<path d="M20 12H4m7-7-7 7 7 7"/>',
  check:'<path d="m5 12 5 5L20 7"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',
  external:'<path d="M9 5H5v14h14v-4M13 3h8v8M10 14 21 3"/>',
  switch:'<path d="M4 7h16m-5-4 5 4-5 4M20 17H4m5-4-5 4 5 4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 10v7M12 6h.01"/>',
  bulb:'<path d="M8 16c0-3-3-4-3-8a7 7 0 0 1 14 0c0 4-3 5-3 8M8 17h8M9 20h6M11 23h2M12 5v7"/>',
  spark:'<path d="M12 2c0 7-3 10-10 10 7 0 10 3 10 10 0-7 3-10 10-10-7 0-10-3-10-10Z"/>',
  chart:'<path d="M5 20v-7M10 20V8M15 20V3M20 20v-10"/>',
  wave:'<path d="M2 13c4 0 1-8 5-8s-1 17 3 17 2-19 6-19-1 13 3 13 1-7 3-7"/>',
  quote:'<path d="M10 4C5 7 4 11 4 17h6v-7H6M21 4c-5 3-6 7-6 13h6v-7h-4"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  circle:'<circle cx="12" cy="12" r="9"/>',
};
export function icon(name, cls='') { return `<svg class="worksite-icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.file}</svg>`; }
export const mark='<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 11V7a3 3 0 1 0-3 3h16a3 3 0 1 0-3-3v18a3 3 0 1 0 3-3H8a3 3 0 1 0 3 3V11Z"/></svg>';
export const escapeHTML = value => String(value??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
