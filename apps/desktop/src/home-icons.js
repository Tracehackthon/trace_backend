const paths = {
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  file: '<path d="M6 3h8l5 5v13H6zM14 3v6h5M9 13h6M9 17h6"/>',
  box: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm-9 5 9 5 9-5M12 12v10M7 5l10 5"/>',
  message: '<path d="M4 4h16v13H9l-5 4V4Z"/><path d="M8 10h.01M12 10h.01M16 10h.01"/>',
  link: '<path d="m10 14 4-4M8 15l-1 1a4 4 0 0 1-5-6l4-4a4 4 0 0 1 6 0m0 3 1-1a4 4 0 0 1 5 6l-4 4a4 4 0 0 1-6 0" transform="translate(2 1)"/>',
  arrow: '<path d="M12 21V3M4 11l8-8 8 8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>',
  sprout: '<path d="M12 21v-9M12 14C5 15 3 11 3 6c6-1 10 1 9 8Zm0-4c0-6 4-8 9-8 0 6-3 10-9 8Z"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 11V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v7M3 12h18"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  back: '<path d="M20 12H4m7-7-7 7 7 7"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2Z"/>',
  more: '<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
}
export function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>` }
export const mark = '<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M11 11V7a3 3 0 1 0-3 3h16a3 3 0 1 0-3-3v18a3 3 0 1 0 3-3H8a3 3 0 1 0 3 3V11Z"/></svg>'
