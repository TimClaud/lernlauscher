// Kleine UI-Helfer
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function inline(s) {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>');
}
// Sehr kleiner Markdown-Renderer (sicher: alles wird zuerst escaped)
export function md(src) {
  const lines = esc(String(src || '').replace(/\r/g, '')).split('\n');
  let out = '', i = 0;
  const isTable = (l) => /^\s*\|.*\|\s*$/.test(l);
  while (i < lines.length) {
    let l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++; out += `<pre><code>${buf.join('\n')}</code></pre>`; continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { const n = Math.min(4, h[1].length + 1); out += `<h${n}>${inline(h[2])}</h${n}>`; i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out += '<hr>'; i++; continue; }
    if (isTable(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const row = (x) => x.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = row(l); i += 2;
      let t = '<table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
      while (i < lines.length && isTable(lines[i])) { t += '<tr>' + row(lines[i]).map(c => `<td>${inline(c)}</td>`).join('') + '</tr>'; i++; }
      out += t + '</tbody></table>'; continue;
    }
    if (/^\s*&gt;\s?/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
      out += `<blockquote>${inline(buf.join('<br>'))}</blockquote>`; continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d+[.)]\s+/.test(l);
      const items = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) {
        let it = lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, ''); i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) it += ' ' + lines[i++].trim();
        items.push(it);
      }
      out += (ordered ? '<ol>' : '<ul>') + items.map(x => `<li>${inline(x)}</li>`).join('') + (ordered ? '</ol>' : '</ul>');
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*([-*•]|\d+[.)])\s+|\s*&gt;)/.test(lines[i]) && !isTable(lines[i])) buf.push(lines[i++]);
    if (!buf.length) { buf.push(lines[i++]); }
    out += `<p>${inline(buf.join('<br>'))}</p>`;
  }
  return out;
}
export const plain = (src) => String(src || '').replace(/[#*_`>|]/g, '').replace(/\n{2,}/g, '\n');

export function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  document.getElementById('toastRoot').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function modal(html, { onMount, dismissable = true } = {}) {
  const root = document.getElementById('modalRoot');
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const close = () => { back.remove(); };
  if (dismissable) back.addEventListener('click', (e) => { if (e.target === back) close(); });
  back.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  root.appendChild(back);
  onMount && onMount(back.querySelector('.modal'), close);
  return close;
}

export function confirmBox(text, { ok = 'OK', danger = false, cancel = 'Abbrechen' } = {}) {
  return new Promise(res => {
    modal(`<p style="font-size:1.05rem;margin:4px 0 16px">${esc(text)}</p>
      <div class="btn-row"><button class="btn" data-a="no">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(ok)}</button></div>`,
    { onMount: (m, close) => m.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; close(); res(a.dataset.a === 'yes'); }) });
  });
}

export function promptBox(label, value = '', { ok = 'Speichern', multiline = false, placeholder = '' } = {}) {
  return new Promise(res => {
    modal(`<label class="field"><span>${esc(label)}</span>${multiline ? `<textarea id="pb" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input id="pb" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`}</label>
      <div class="btn-row"><button class="btn" data-a="no">Abbrechen</button><button class="btn primary" data-a="yes">${esc(ok)}</button></div>`,
    { onMount: (m, close) => {
      const inp = m.querySelector('#pb'); setTimeout(() => inp.focus(), 50);
      m.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; close(); res(a.dataset.a === 'yes' ? inp.value.trim() : null); });
    } });
  });
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}
export async function shareOrDownload(blob, filename, title) {
  try {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title }); return; }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  download(blob, filename);
}

export const fmtDate = (ts, opts = { day: '2-digit', month: '2-digit', year: 'numeric' }) => new Date(ts).toLocaleDateString('de-DE', opts);
export const fmtDateLong = (ts) => new Date(ts).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
export const isoDay = (d = new Date()) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
export function relTime(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} Sek.`;
  const m = Math.round(s / 60); if (m < 60) return `${m} Min.`;
  const h = Math.floor(m / 60); return `${h} Std. ${m % 60} Min.`;
}

// Vorlesen (kostenlos, eingebaut in iOS)
let speaking = false;
export function speak(text, onEnd) {
  if (!('speechSynthesis' in window)) { toast('Vorlesen wird hier nicht unterstützt.'); return; }
  speechSynthesis.cancel();
  if (speaking) { speaking = false; onEnd && onEnd(); return; }
  const chunks = String(text).match(/[^.!?\n]{1,220}[.!?\n]?/g) || [text];
  const voice = speechSynthesis.getVoices().find(v => /^de/i.test(v.lang));
  speaking = true;
  chunks.forEach((c, i) => {
    const u = new SpeechSynthesisUtterance(c.trim());
    u.lang = 'de-DE'; if (voice) u.voice = voice; u.rate = 1.0;
    if (i === chunks.length - 1) u.onend = () => { speaking = false; onEnd && onEnd(); };
    speechSynthesis.speak(u);
  });
}
export const isSpeaking = () => speaking;

export const busyHtml = (text) => `<div class="busy"><span class="spinner"></span><span>${esc(text)}</span></div>`;
