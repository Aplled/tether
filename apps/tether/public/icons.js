const p = (d) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;

export const icons = {
  canvas: p("M4 5h16v14H4z M9 5v14 M4 10h5 M15 9l3 3-3 3"),
  people: p(
    "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M3 19v-2c0-2.2 2-4 5-4s5 1.8 5 4v2 M16 11a2.5 2.5 0 1 0 0-5 M15 14c3 0 5 1.4 5 3.5V19",
  ),
  incident: p("M12 3l10 18H2z M12 9v5 M12 17v1"),
  settings: p(
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 12H2 M22 12h-2 M12 4V2 M12 22v-2 M6.3 6.3 4.9 4.9 M19.1 19.1l-1.4-1.4 M17.7 6.3l1.4-1.4 M4.9 19.1l1.4-1.4",
  ),
  plus: p("M12 5v14 M5 12h14"),
  search: p("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M16 16l4 4"),
  close: p("M6 6l12 12 M18 6L6 18"),
  fit: p("M8 4H4v4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4"),
  copy: p("M9 8h10v12H9z M5 16H3V4h10v2"),
  link: p("M10 14l4-4 M8 16H6a4 4 0 0 1 0-8h4 M16 8h2a4 4 0 1 1 0 8h-4"),
  message: p("M4 5h16v11H9l-5 4z M8 9h8 M8 12h5"),
  check: p("M5 12l4 4L19 6"),
  menu: p("M4 7h16 M4 12h16 M4 17h16"),
  logout: p("M10 5H4v14h6 M14 8l4 4-4 4 M8 12h10"),
};

export function tetherLogo(label = true) {
  return `<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 42 42"><path class="mark-a" d="M8 9h19v7h-6v18h-7V16H8z"/><path class="mark-b" d="M27 9v11c0 7 2 10 8 14"/><circle cx="34" cy="33" r="4"/></svg></span>${label ? '<span class="brand-word">Tether</span>' : ""}`;
}

export function icon(name) {
  return `<span class="icon">${icons[name] || ""}</span>`;
}
