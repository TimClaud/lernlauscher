// Gemeinsame Bausteine für alle Ansichten
import { db, uid, kvGet, kvSet } from './db.js';
import { AIError, transcriptToText, fmtTime } from './ai.js';
import { esc, relTime, toast } from './ui.js';
import { allSegments } from './pipeline.js';

export const SUBJECT_COLORS = ['#5B7FA3', '#B8693A', '#8E6C9E', '#7D8B5A', '#C99A3E', '#4F8A8B', '#9C6B4E', '#A0845C', '#A35D6A', '#C47F5E', '#6F7FA8', '#6E9A6A', '#7A6C5D', '#B5473A'];
const DEFAULT_SUBJECTS = [
  ['Mathe', '#5B7FA3'], ['Deutsch', '#B8693A'], ['Englisch', '#8E6C9E'], ['Biologie', '#7D8B5A'],
  ['Chemie', '#C99A3E'], ['Physik', '#4F8A8B'], ['Geschichte', '#9C6B4E'], ['Erdkunde', '#A0845C'],
  ['Politik', '#A35D6A'], ['Kunst', '#C47F5E'], ['Musik', '#6F7FA8'], ['Sport', '#6E9A6A'],
];

export async function ensureSeed() {
  if (await kvGet('seeded')) return;
  let order = 0;
  for (const [name, color] of DEFAULT_SUBJECTS) await db.put('subjects', { id: uid(), name, color, order: order++, createdAt: Date.now() });
  await kvSet('seeded', true);
}
export async function subjects() {
  return (await db.all('subjects')).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}
export async function subjectMap() { return Object.fromEntries((await subjects()).map(s => [s.id, s])); }

// Kopfzeile
export function setHeader({ title = 'Lernlauscher', back = null, actions = '' } = {}) {
  document.getElementById('title').textContent = title;
  const b = document.getElementById('backBtn');
  b.hidden = !back;
  b.onclick = back ? () => { if (typeof back === 'string') location.hash = back; else history.back(); } : null;
  document.getElementById('topActions').innerHTML = actions;
  document.title = title === 'Lernlauscher' ? 'Lernlauscher' : `${title} – Lernlauscher`;
}
export const go = (hash) => { location.hash = hash; };
export const gearIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
export const moreIcon = `<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;

// Fehlermeldungen freundlich anzeigen
export function aiErrorText(e) {
  if (e instanceof AIError) {
    if (e.code === 'quota' && e.retryAt) return `${e.message} Wieder möglich in ca. ${relTime(e.retryAt - Date.now())}. Alles ist gespeichert – du kannst später einfach weitermachen.`;
    return e.message;
  }
  return e?.message || String(e);
}
export function showAiError(e) {
  toast(aiErrorText(e), 5000);
  if (e instanceof AIError && e.code === 'key') setTimeout(() => go('#/einstellungen'), 600);
}

// Laufende Aufnahme (bleibt beim Wechseln der Ansicht bestehen)
export const live = { recorder: null, recId: null, markers: [], photos: [], startedAt: 0, chunkCount: 0 };

// Lernmaterial für die KI zusammenstellen
const MAX_CHARS = 280000;
export async function materialFor({ recordingIds = [], scanIds = [], sheetIds = [] }, { transcripts = true } = {}) {
  const out = [];
  for (const id of recordingIds) {
    const r = await db.get('recordings', id); if (!r) continue;
    let t = `### Stunde: ${r.title || 'Ohne Titel'} (${new Date(r.createdAt).toLocaleDateString('de-DE')})\n`;
    if (r.note) t += `Notiz: ${r.note}\n`;
    if (r.analysis?.summary_md) t += `Zusammenfassung:\n${r.analysis.summary_md}\n`;
    if (r.analysis?.glossary?.length) t += `Begriffe: ${r.analysis.glossary.map(g => g.term + ' = ' + g.definition).join('; ')}\n`;
    const segs = allSegments(r);
    if (transcripts && segs.length) t += `Transkript:\n${transcriptToText(segs)}\n`;
    out.push(t);
  }
  for (const id of scanIds) {
    const s = await db.get('scans', id); if (!s) continue;
    out.push(`### Scan: ${s.title || 'Scan'} (${new Date(s.createdAt).toLocaleDateString('de-DE')})\n${s.text || '(noch kein Text erkannt – erst ein Lernblatt daraus erstellen)'}\n`);
  }
  for (const id of sheetIds) {
    const s = await db.get('sheets', id); if (!s) continue;
    out.push(`### Lernblatt: ${s.content?.title}\n${(s.content?.sections || []).map(x => `${x.heading}: ${x.body_md}`).join('\n')}\n`);
  }
  let text = out.join('\n\n');
  if (text.length > MAX_CHARS && transcripts) return materialFor({ recordingIds, scanIds, sheetIds }, { transcripts: false });
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n[… gekürzt]';
  return text;
}

export const statusBadge = (rec) => {
  const n = rec.chunks?.length || 0, d = (rec.chunks || []).filter(c => c.status === 'done').length;
  if (rec.status === 'done') return '<span class="badge ok">Fertig</span>';
  if (rec.status === 'processing') return `<span class="badge warn">Analysiert … ${d}/${n}</span>`;
  if (rec.status === 'waiting') return `<span class="badge warn">Wartet auf Limit · ${d}/${n}</span>`;
  if (rec.status === 'error') return '<span class="badge err">Fehler</span>';
  if (rec.status === 'recording') return '<span class="badge err">● Aufnahme</span>';
  return `<span class="badge">Nicht analysiert</span>`;
};

export const dur = (sec) => fmtTime(sec);
export { esc };
