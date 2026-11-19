// Farbthemen: Palette + Modus (hell/dunkel/auto) + eigene Akzentfarbe + Schrift + Ecken
export const PALETTES = {
  kreide: { name: 'Kreide', light: ['#F4F5F2', '#FFFFFF', '#ECEEEA', '#E1E4DE', '#15191A', '#646B69', '#DDE1DB', '#1F6F5C'], dark: ['#0F1312', '#171C1B', '#202726', '#2A3230', '#E9EEEC', '#9AA5A1', '#283030', '#4FB89A'] },
  tinte: { name: 'Tinte', light: ['#F3F5F9', '#FFFFFF', '#E9EDF4', '#DDE3EE', '#12172A', '#5E6680', '#DCE1EC', '#2F55D4'], dark: ['#0D111D', '#151A2A', '#1D2336', '#272E44', '#E8ECF8', '#98A0BC', '#252C40', '#7C9BFF'] },
  mohn: { name: 'Mohn', light: ['#F7F5F3', '#FFFFFF', '#EFEBE7', '#E5DFD9', '#1C1614', '#6E625C', '#E4DDD7', '#D2452F'], dark: ['#141010', '#1D1817', '#262020', '#312927', '#F2E9E6', '#AC9E99', '#2E2725', '#FF7A5F'] },
  lavendel: { name: 'Lavendel', light: ['#F5F4FA', '#FFFFFF', '#ECEAF5', '#E1DEEF', '#18162A', '#67637E', '#E1DEEE', '#6A4FD8'], dark: ['#110F1C', '#191626', '#221E33', '#2C2741', '#ECE9F8', '#A39DBE', '#2A2540', '#A794FF'] },
  graphit: { name: 'Graphit', light: ['#F2F2F1', '#FFFFFF', '#E8E8E6', '#DCDCDA', '#111111', '#666664', '#DEDEDC', '#111111'], dark: ['#0E0E0E', '#171717', '#202020', '#2A2A2A', '#F0F0EE', '#9E9E9B', '#2A2A2A', '#F0F0EE'] },
  savanne: { name: 'Savanne', light: ['#F3ECE0', '#FBF7F1', '#EFE5D5', '#E6D9C4', '#2E2620', '#7A6C5D', '#E2D6C3', '#B8693A'], dark: ['#1C1814', '#26211B', '#2F2921', '#3A3229', '#F1E8DA', '#A8998A', '#3A3229', '#D98A57'] },
};
export const FONTS = {
  modern: { name: 'Modern', css: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif', weight: 700 },
  rund: { name: 'Rund', css: 'ui-rounded, "SF Pro Rounded", -apple-system, "Segoe UI", sans-serif', weight: 700 },
  klassisch: { name: 'Klassisch', css: 'ui-serif, "New York", "Iowan Old Style", Georgia, serif', weight: 600 },
};
export const CORNERS = { eckig: { name: 'Eckig', r: 6 }, normal: { name: 'Normal', r: 12 }, rund: { name: 'Rund', r: 20 } };
export const DEFAULT_THEME = { palette: 'kreide', mode: 'auto', accent: '', font: 'modern', corners: 'normal' };

const hexRgb = (h) => { h = (h || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (r) => '#' + r.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
const mix = (a, b, t) => rgbHex(hexRgb(a).map((v, i) => v + (hexRgb(b)[i] - v) * t));
const lum = (h) => { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

export function resolveDark(mode) {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function themeVars(t) {
  t = { ...DEFAULT_THEME, ...(t || {}) };
  const pal = PALETTES[t.palette] || PALETTES.kreide;
  const dark = resolveDark(t.mode);
  const [bg, surface, s2, s3, text, muted, line, palAccent] = dark ? pal.dark : pal.light;
  let accent = palAccent;
  if (/^#[0-9a-f]{6}$/i.test(t.accent || '')) {
    accent = t.accent;
    // in dunkel/hell genug Kontrast zum Hintergrund sicherstellen
    let k = 0; while (contrast(accent, bg) < 3 && k < 8) { accent = mix(accent, dark ? '#ffffff' : '#000000', 0.15); k++; }
  }
  const ink = contrast(accent, '#ffffff') >= contrast(accent, '#111111') ? '#ffffff' : '#111111';
  const font = FONTS[t.font] || FONTS.modern;
  const r = (CORNERS[t.corners] || CORNERS.normal).r;
  return {
    dark,
    vars: {
      '--bg': bg, '--surface': surface, '--surface-2': s2, '--surface-3': s3, '--text': text, '--muted': muted, '--line': line,
      '--accent': accent, '--accent-ink': ink, '--accent-soft': mix(surface, accent, dark ? 0.22 : 0.12),
      '--olive': dark ? '#8FB27A' : '#4E7A3E', '--ochre': dark ? '#E0B85C' : '#B8862B',
      '--danger': dark ? '#F07A6A' : '#C2402F', '--ok': dark ? '#7CC49A' : '#2F7D55',
      '--font-head': font.css, '--head-weight': String(font.weight),
      '--radius': r + 'px', '--radius-sm': Math.max(4, r - 4) + 'px', '--radius-btn': Math.max(6, r - 2) + 'px',
      '--shadow': dark ? '0 0 0 1px var(--line)' : '0 0 0 1px var(--line), 0 1px 2px rgba(0,0,0,.03)',
    },
  };
}

export function applyTheme(t) {
  const { dark, vars } = themeVars(t);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.querySelectorAll('meta[name=theme-color]').forEach(m => m.setAttribute('content', vars['--bg']));
  try { localStorage.setItem('ll-theme', JSON.stringify(t || DEFAULT_THEME)); localStorage.setItem('ll-vars', JSON.stringify({ dark, vars })); } catch {}
}

let mq = null;
export function watchSystemTheme(getTheme) {
  if (!window.matchMedia || mq) return;
  mq = matchMedia('(prefers-color-scheme: dark)');
  const h = async () => { const t = await getTheme(); if ((t?.mode || 'auto') === 'auto') applyTheme(t); };
  mq.addEventListener ? mq.addEventListener('change', h) : mq.addListener(h);
}
