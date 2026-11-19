// Lernblatt-Darstellung mit Vorlagen (eingebaut + eigene aus Beispielbildern)
import { md, esc } from './ui.js';

export const BUILTIN_TEMPLATES = [
  { id: 'tpl-savanne', builtin: true, name: 'Savanne', description: 'Warme Sandtöne, Terrakotta-Akzente, ruhig und edel.',
    style: { accent: '#B8693A', accent2: '#7D8B5A', background: '#FBF6EE', ink: '#2E2620', paper: 'plain', headingFont: 'serif', boxStyle: 'filled', headerStyle: 'band', columns: 1, radius: 12, icons: true } },
  { id: 'tpl-klar', builtin: true, name: 'Klar & minimal', description: 'Weiß, viel Luft, feine Linien.',
    style: { accent: '#2F5D8A', accent2: '#8A9BAE', background: '#FFFFFF', ink: '#1E2328', paper: 'plain', headingFont: 'sans', boxStyle: 'leftbar', headerStyle: 'underline', columns: 1, radius: 4, icons: false } },
  { id: 'tpl-heft', builtin: true, name: 'Karo-Heft', description: 'Wie ein Matheheft mit Karos, Merkkästen wie Klebezettel.',
    style: { accent: '#C0453A', accent2: '#3D6FB0', background: '#FFFFFF', ink: '#1F2A44', paper: 'grid', headingFont: 'hand', boxStyle: 'sticky', headerStyle: 'center', columns: 1, radius: 6, icons: true } },
  { id: 'tpl-oase', builtin: true, name: 'Oase', description: 'Salbeigrün und Ocker, zweispaltig, kompakt.',
    style: { accent: '#5E7A52', accent2: '#C99A3E', background: '#F7F5EE', ink: '#28301F', paper: 'dots', headingFont: 'rounded', boxStyle: 'outlined', headerStyle: 'box', columns: 2, radius: 14, icons: true } },
];

const ICONS = { definition: '📖', merke: '💡', beispiel: '🔎', schritte: '🪜', formel: '🧮', tabelle: '📊', achtung: '⚠️', text: '📝', zusammenfassung: '🧭', aufgaben: '✏️' };
const LABELS = { definition: 'Definition', merke: 'Merke', beispiel: 'Beispiel', schritte: 'Schritt für Schritt', formel: 'Formel', tabelle: 'Übersicht', achtung: 'Achtung', text: '', zusammenfassung: 'Zusammenfassung', aufgaben: 'Übungsaufgaben' };

const FONTS = {
  serif: 'ui-serif, "New York", "Iowan Old Style", Georgia, serif',
  sans: '-apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif',
  rounded: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Nunito", sans-serif',
  hand: '"Bradley Hand", "Segoe Print", "Comic Sans MS", "Chalkboard SE", cursive',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

function paperCss(paper, ink) {
  const line = hexA(ink, 0.08);
  if (paper === 'grid') return `background-image: linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px); background-size: 5mm 5mm;`;
  if (paper === 'lines') return `background-image: linear-gradient(${line} 1px, transparent 1px); background-size: 100% 8mm;`;
  if (paper === 'dots') return `background-image: radial-gradient(${hexA(ink, 0.16)} 1px, transparent 1.2px); background-size: 5mm 5mm;`;
  return '';
}
function hexA(hex, a) {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function sheetHtml(sheet, template, { subject = '', date = '' } = {}) {
  const st = { ...BUILTIN_TEMPLATES[0].style, ...(template?.style || {}) };
  const font = FONTS[st.headingFont] || FONTS.serif;
  const r = Math.max(0, Math.min(24, st.radius ?? 10));
  const box = {
    filled: `background:${hexA(st.accent, 0.09)};`,
    outlined: `border:1.5px solid ${hexA(st.accent, 0.55)};`,
    leftbar: `border-left:4px solid ${st.accent}; background:${hexA(st.accent, 0.04)};`,
    shadow: `background:#fff; box-shadow:0 2px 10px ${hexA(st.ink, 0.12)};`,
    sticky: `background:#FFF6C9; box-shadow:2px 3px 0 ${hexA(st.ink, 0.12)}; transform:rotate(-.3deg);`,
  }[st.boxStyle] || '';
  const header = {
    band: `<header class="hd band"><div class="meta">${esc(subject)}${date ? ' · ' + esc(date) : ''}</div><h1>${esc(sheet.title || 'Lernblatt')}</h1>${sheet.subtitle ? `<p class="sub">${esc(sheet.subtitle)}</p>` : ''}</header>`,
    underline: `<header class="hd underline"><div class="meta">${esc(subject)}${date ? ' · ' + esc(date) : ''}</div><h1>${esc(sheet.title || 'Lernblatt')}</h1>${sheet.subtitle ? `<p class="sub">${esc(sheet.subtitle)}</p>` : ''}</header>`,
    center: `<header class="hd center"><div class="meta">${esc(subject)}${date ? ' · ' + esc(date) : ''}</div><h1>${esc(sheet.title || 'Lernblatt')}</h1>${sheet.subtitle ? `<p class="sub">${esc(sheet.subtitle)}</p>` : ''}</header>`,
    box: `<header class="hd boxed"><div class="meta">${esc(subject)}${date ? ' · ' + esc(date) : ''}</div><h1>${esc(sheet.title || 'Lernblatt')}</h1>${sheet.subtitle ? `<p class="sub">${esc(sheet.subtitle)}</p>` : ''}</header>`,
  }[st.headerStyle] || '';

  const sections = (sheet.sections || []).map(s => {
    const type = s.type || 'text';
    const boxed = type !== 'text';
    const label = LABELS[type];
    const icon = st.icons ? (ICONS[type] || '') + ' ' : '';
    const head = s.heading || label;
    return `<section class="sec ${esc(type)} ${boxed ? 'boxed' : ''}">
      ${head ? `<h2>${icon}${esc(head)}${label && s.heading && label !== s.heading && boxed ? ` <small>${esc(label)}</small>` : ''}</h2>` : ''}
      <div class="body">${md(s.body_md || '')}</div></section>`;
  }).join('\n');

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(sheet.title || 'Lernblatt')}</title>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
html, body { margin: 0; background: ${st.background}; color: ${st.ink}; }
body { font: 15px/1.5 -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif; padding: 18px; ${paperCss(st.paper, st.ink)} -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1, h2, h3 { font-family: ${font}; margin: 0; line-height: 1.2; }
.hd { margin-bottom: 16px; }
.hd .meta { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; opacity: .7; margin-bottom: 4px; }
.hd h1 { font-size: 27px; }
.hd .sub { margin: 6px 0 0; opacity: .8; }
.hd.band { background: ${st.accent}; color: #fff; padding: 18px 20px; border-radius: ${r}px; }
.hd.band .meta { opacity: .85; }
.hd.underline { border-bottom: 3px solid ${st.accent}; padding-bottom: 10px; }
.hd.underline h1 { color: ${st.accent}; }
.hd.center { text-align: center; }
.hd.center h1 { color: ${st.accent}; font-size: 30px; }
.hd.center::after { content: ""; display: block; width: 70px; height: 3px; background: ${st.accent2}; margin: 10px auto 0; border-radius: 3px; }
.hd.boxed { border: 2px solid ${st.accent}; border-radius: ${r}px; padding: 14px 18px; background: ${hexA(st.accent, .06)}; }
.grid { ${st.columns === 2 ? 'column-count: 2; column-gap: 16px;' : ''} }
.sec { break-inside: avoid; margin: 0 0 14px; }
.sec.boxed { ${box} border-radius: ${r}px; padding: 12px 14px; }
.sec h2 { font-size: 17px; color: ${st.accent}; margin-bottom: 6px; }
.sec h2 small { font-family: -apple-system, sans-serif; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: ${st.accent2}; margin-left: 6px; font-weight: 700; }
.sec.merke { ${st.boxStyle === 'sticky' ? '' : `border: 2px solid ${st.accent2}; background: ${hexA(st.accent2, .1)};`} }
.sec.merke h2 { color: ${st.accent2}; }
.sec.achtung { background: ${hexA('#C0453A', .08)}; border-left: 4px solid #C0453A; }
.sec.achtung h2 { color: #B03A30; }
.sec.formel .body { font-family: ${FONTS.serif}; font-size: 16px; }
.body p { margin: .35em 0; }
.body ul, .body ol { margin: .3em 0; padding-left: 1.3em; }
.body li { margin: .15em 0; }
.body table { border-collapse: collapse; width: 100%; font-size: 13.5px; margin: 6px 0; }
.body th, .body td { border: 1px solid ${hexA(st.ink, .2)}; padding: 5px 7px; text-align: left; vertical-align: top; }
.body th { background: ${hexA(st.accent, .12)}; }
.body code { background: ${hexA(st.ink, .07)}; padding: 1px 4px; border-radius: 4px; }
.body blockquote { margin: 6px 0; padding: 6px 10px; border-left: 3px solid ${st.accent2}; background: ${hexA(st.accent2, .08)}; }
.body strong { color: ${st.ink}; }
footer { margin-top: 18px; font-size: 11px; opacity: .55; text-align: center; }
@media print { body { padding: 0; } }
</style></head><body>
${header}
<div class="grid">${sections}</div>
<footer>Erstellt mit Lernlauscher</footer>
</body></html>`;
}

export function templatePreviewCss(tpl) {
  const st = tpl.style || {};
  return `background:${st.background};${paperCss(st.paper, st.ink)}border:1px solid ${hexA(st.ink || '#000', .12)};`;
}
export function templatePreviewInner(tpl) {
  const st = tpl.style || {};
  return `<div style="padding:10px;font-family:${FONTS[st.headingFont] || FONTS.serif}">
    <div style="height:14px;width:60%;border-radius:4px;background:${st.accent}"></div>
    <div style="margin-top:8px;height:28px;border-radius:${Math.min(10, st.radius || 6)}px;background:${hexA(st.accent || '#000', .14)};border-left:3px solid ${st.accent2}"></div>
    <div style="margin-top:6px;height:6px;width:80%;background:${hexA(st.ink || '#000', .25)};border-radius:3px"></div></div>`;
}
