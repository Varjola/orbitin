/** The phone presentation's inline icons. Every icon
 *  is decorative (`aria-hidden`); its button takes its name from the message
 *  catalogue. Strokes use `currentColor`, so icons follow the button colour. */

export type MobileIcon =
  | 'play' | 'pause' | 'plus' | 'edit' | 'menu' | 'close' | 'layers' | 'fit' | 'map' | 'globe'
  | 'list' | 'previous' | 'next' | 'remove' | 'focus' | 'share' | 'help' | 'info' | 'language' | 'search' | 'expand' | 'minus'
  | 'swap' | 'camera' | 'planes' | 'route' | 'stop' | 'upright'

const PATHS: Readonly<Record<MobileIcon, string>> = {
  play: '<path class="is-filled" d="M8 5.2v13.6L19 12Z"/>',
  pause: '<rect class="is-filled" x="6.5" y="5" width="4" height="14" rx="1"/><rect class="is-filled" x="13.5" y="5" width="4" height="14" rx="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M5 19h4L19 9l-4-4L5 15Z"/><path d="m13.5 6.5 4 4"/>',
  menu: '<circle class="is-filled" cx="12" cy="5.5" r="1.7"/><circle class="is-filled" cx="12" cy="12" r="1.7"/><circle class="is-filled" cx="12" cy="18.5" r="1.7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  layers: '<path d="m12 4 8.5 4.5L12 13 3.5 8.5Z"/><path d="m3.5 12.5 8.5 4.5 8.5-4.5"/><path d="m3.5 16.5 8.5 4.5 8.5-4.5"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/><circle cx="12" cy="12" r="3"/>',
  map: '<path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2Z"/><path d="M9 4.5v13M15 6.5v13"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.2 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.2-3.8-8.5s1.2-6.1 3.8-8.5Z"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle class="is-filled" cx="4.8" cy="6.5" r="1.3"/><circle class="is-filled" cx="4.8" cy="12" r="1.3"/><circle class="is-filled" cx="4.8" cy="17.5" r="1.3"/>',
  previous: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  next: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  remove: '<path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12"/>',
  focus: '<circle cx="12" cy="12" r="6.5"/><circle class="is-filled" cx="12" cy="12" r="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3"/>',
  share: '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M6 11H5v9h14v-9h-1"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.6"/><circle class="is-filled" cx="12" cy="17" r="1.1"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v6"/><circle class="is-filled" cx="12" cy="7.8" r="1.1"/>',
  language: '<path d="M4 6h9M8.5 4v2M6 6c.5 3 2.5 5.5 5.5 7M11 6c-.7 3.3-2.8 6-6.5 7.5"/><path d="m12.5 20 3.5-8.5 3.5 8.5M13.8 17h4.4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  expand: '<path d="m6 14 6-6 6 6"/>',
  swap: '<path d="M8 19V5M4.5 8.5 8 5l3.5 3.5M16 5v14M12.5 15.5 16 19l3.5-3.5"/>',
  camera: '<path d="M3.5 8.5h3.5l1.6-2.5h6.8l1.6 2.5h3.5v10.5h-17Z"/><circle cx="12" cy="13.5" r="3.3"/>',
  planes: '<ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(-38 12 12)"/>',
  upright: '<rect x="8.5" y="3.5" width="9" height="15" rx="1.8"/><path d="M11.8 15.8h2.4"/><path d="M3.5 9.5a7 7 0 0 1 3-4.8"/><path d="m3 6.5 0.5 3 3-0.6"/>',
  stop: '<rect class="is-filled" x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  route: '<circle cx="5.5" cy="17.5" r="2"/><circle cx="18.5" cy="6.5" r="2"/><path d="M7.3 16.4C11 14 9 9.5 13 8.3l3.6-1.1"/>',
}

/** The icon's SVG markup, decorative. */
export function icon(name: MobileIcon): string {
  return `<svg class="m-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`
}
