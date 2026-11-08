const paths = {
  canvas: '<path d="M4 5h16v14H4z"/><path d="M8 9h3v3H8zM14 8h3v3h-3zM12 14h4v2h-4z"/>',
  people: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2"/><path d="M4 19c0-4 2-6 5-6s5 2 5 6M15 14c3 0 5 2 5 5"/>',
  activity: '<path d="M5 4v16h15"/><path d="m8 15 3-4 3 2 4-6"/>',
  service: '<rect x="4" y="5" width="16" height="5" rx="2"/><rect x="4" y="14" width="16" height="5" rx="2"/><path d="M8 8h.01M8 17h.01"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M5 21c0-5 2.5-8 7-8s7 3 7 8"/>',
  task: '<rect x="5" y="4" width="14" height="17" rx="3"/><path d="m8 10 2 2 5-5M9 16h6"/>',
  procedure: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h4M9 12h6M9 16h6"/>',
  resource: '<path d="m12 3 8 4-8 4-8-4zM4 12l8 4 8-4M4 17l8 4 8-4"/>',
  incident: '<path d="M12 3 2.8 20h18.4z"/><path d="M12 9v5M12 17h.01"/>',
  agent: '<rect x="4" y="6" width="16" height="13" rx="4"/><path d="M9 12h.01M15 12h.01M9 16h6M12 3v3"/>',
  zoomIn: '<circle cx="10" cy="10" r="6"/><path d="M10 7v6M7 10h6M15 15l5 5"/>',
  zoomOut: '<circle cx="10" cy="10" r="6"/><path d="M7 10h6M15 15l5 5"/>',
  fit: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  link: '<path d="M10 13a4 4 0 0 0 5.7 0l2.3-2.3A4 4 0 0 0 12.3 5L11 6.3M14 11a4 4 0 0 0-5.7 0L6 13.3A4 4 0 0 0 11.7 19l1.3-1.3"/>',
  spark: '<path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z"/>',
  send: '<path d="m3 11 18-8-7 18-3-7zM11 14 21 3"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3 8 8 10 5-2 8-5 8-10V6z"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  fallback: '<path d="M18 8a7 7 0 1 0 1 8"/><path d="M18 3v5h-5"/><path d="M12 8v5l3 2"/>',
  reset: '<path d="M4 9a8 8 0 1 1 1 8"/><path d="M4 4v5h5"/>',
  warning: '<path d="M12 3 3 20h18z"/><path d="M12 9v5M12 17h.01"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
};

export function icon(name, size = 20, className = '') {
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.canvas}</svg>`;
}

export function nodeIcon(kind) {
  return icon(paths[kind] ? kind : 'resource', 20);
}
