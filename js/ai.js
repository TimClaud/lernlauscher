// Google Gemini (kostenloser Zugang) + Limit-Verwaltung
import { kvGet, kvSet } from './db.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';

export const LEVELS = {
  einfach: { label: 'Ganz einfach', desc: 'sehr einfach, wie für ein 12-jähriges Kind: kurze Sätze, Alltagsbeispiele, keine unerklärten Fachwörter' },
  mittel: { label: 'Mittelstufe', desc: 'für die Mittelstufe (Klasse 8–9): verständlich, Fachbegriffe werden kurz erklärt' },
  oberstufe: { label: 'Oberstufe', desc: 'für die Oberstufe am Gymnasium (Klasse 11): fachlich korrekt, mit Fachbegriffen, gut strukturiert' },
  abitur: { label: 'Abitur / LK', desc: 'auf Abitur- bzw. Leistungskurs-Niveau: präzise, vertieft, mit Zusammenhängen und Transfer' },
};

export const DEFAULT_SETTINGS = {
  apiKey: '', model: 'gemini-2.5-flash', grade: '11', school: 'Gymnasium', level: 'oberstufe',
  theme: 'auto', rpm: 10, rpd: 250, chunkMin: 5, consentAccepted: false, name: '',
};

let settingsCache = null;
export async function getSettings() {
  if (!settingsCache) settingsCache = { ...DEFAULT_SETTINGS, ...(await kvGet('settings', {})) };
  return settingsCache;
}
export async function saveSettings(patch) {
  settingsCache = { ...(await getSettings()), ...patch };
  await kvSet('settings', settingsCache);
  window.dispatchEvent(new CustomEvent('settings'));
  return settingsCache;
}

// ---------- Limits ----------
// Google setzt das Tageslimit um Mitternacht pazifischer Zeit zurück (in Deutschland ca. 9 Uhr).
function pacificParts(d = new Date()) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  const p = Object.fromEntries(f.formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: +p.hour % 24, m: +p.minute, s: +p.second };
}
export function nextDailyReset() {
  const p = pacificParts();
  const msLeft = ((24 - p.h) * 3600 - p.m * 60 - p.s) * 1000;
  return Date.now() + msLeft;
}

let usage = null;
async function loadUsage() {
  if (!usage) usage = await kvGet('usage', { day: '', count: 0, recent: [], cooldownUntil: 0, cooldownReason: '' });
  const today = pacificParts().date;
  if (usage.day !== today) { usage.day = today; usage.count = 0; if (usage.cooldownReason === 'day') { usage.cooldownUntil = 0; usage.cooldownReason = ''; } }
  usage.recent = usage.recent.filter(t => Date.now() - t < 60000);
  return usage;
}
async function saveUsage() { await kvSet('usage', usage); emitQuota(); }

export async function quotaStatus() {
  const u = await loadUsage();
  const s = await getSettings();
  const now = Date.now();
  const cooling = u.cooldownUntil > now;
  return {
    used: u.count, limit: s.rpd, perMin: u.recent.length, rpm: s.rpm,
    ratio: s.rpd ? u.count / s.rpd : 0,
    cooling, cooldownUntil: u.cooldownUntil, cooldownReason: u.cooldownReason,
    resetAt: nextDailyReset(),
  };
}
function emitQuota() { window.dispatchEvent(new CustomEvent('quota')); }

async function waitForSlot(onWait) {
  for (;;) {
    const u = await loadUsage();
    const s = await getSettings();
    if (u.cooldownUntil > Date.now()) throw new AIError('quota', u.cooldownReason === 'day' ? 'Tageslimit erreicht.' : 'Kurze Pause wegen Limit.', u.cooldownUntil);
    if (s.rpd && u.count >= s.rpd) throw new AIError('quota', 'Dein Tageslimit ist laut App-Zähler erreicht.', nextDailyReset());
    if (u.recent.length < s.rpm) return;
    const wait = 60000 - (Date.now() - u.recent[0]) + 300;
    onWait && onWait(Math.ceil(wait / 1000));
    await new Promise(r => setTimeout(r, Math.min(wait, 5000)));
  }
}

export class AIError extends Error {
  constructor(code, message, retryAt = 0) { super(message); this.code = code; this.retryAt = retryAt; }
}

function parseRetry(err) {
  const det = (err && err.details) || [];
  let secs = 0, perDay = false;
  for (const d of det) {
    const t = d['@type'] || '';
    if (t.endsWith('RetryInfo') && d.retryDelay) secs = parseFloat(d.retryDelay) || 0;
    if (t.endsWith('QuotaFailure')) for (const v of (d.violations || [])) if (/PerDay|per_day|daily/i.test((v.quotaId || '') + (v.quotaMetric || ''))) perDay = true;
  }
  if (/per day|daily/i.test(err?.message || '')) perDay = true;
  return { secs, perDay };
}

// ---------- Kern-Aufruf ----------
export async function generate({ parts, system, schema, temperature = 0.4, onWait, model }) {
  const s = await getSettings();
  if (!s.apiKey) throw new AIError('key', 'Bitte zuerst in den Einstellungen deinen kostenlosen Gemini-Schlüssel eintragen.');
  await waitForSlot(onWait);
  const u = await loadUsage();
  u.recent.push(Date.now()); u.count++; await saveUsage();

  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { temperature },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (schema) { body.generationConfig.responseMimeType = 'application/json'; body.generationConfig.responseSchema = schema; }

  let res;
  try {
    res = await fetch(`${API}/models/${encodeURIComponent(model || s.model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': s.apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new AIError('network', 'Keine Verbindung zur KI. Bist du online?');
  }
  let json = null;
  try { json = await res.json(); } catch {}
  if (!res.ok) {
    const err = json && json.error;
    if (res.status === 429) {
      const { secs, perDay } = parseRetry(err);
      const until = perDay ? nextDailyReset() : Date.now() + Math.max(secs, 20) * 1000;
      const uu = await loadUsage(); uu.cooldownUntil = until; uu.cooldownReason = perDay ? 'day' : 'minute'; await saveUsage();
      throw new AIError('quota', perDay ? 'Das kostenlose Tageslimit von Google ist erreicht.' : 'Zu viele Anfragen auf einmal – kurze Pause.', until);
    }
    if ([400, 403, 404].includes(res.status)) { const uu = await loadUsage(); uu.count = Math.max(0, uu.count - 1); await saveUsage(); }
    if (res.status === 400 && /API key|API_KEY/i.test(err?.message || '')) throw new AIError('key', 'Der Gemini-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.');
    if (res.status === 403) throw new AIError('key', 'Zugriff verweigert – ist der Schlüssel richtig und die Gemini API aktiviert?');
    if (res.status === 404) throw new AIError('model', `Das Modell „${model || s.model}“ gibt es nicht (mehr). Bitte in den Einstellungen ein anderes wählen.`);
    if (res.status >= 500) throw new AIError('server', 'Google ist gerade überlastet. Bitte gleich nochmal versuchen.', Date.now() + 15000);
    throw new AIError('other', err?.message || `Fehler ${res.status}`);
  }
  const cand = json?.candidates?.[0];
  if (!cand) {
    const br = json?.promptFeedback?.blockReason;
    throw new AIError('blocked', br ? `Die KI hat die Anfrage abgelehnt (${br}).` : 'Leere Antwort der KI.');
  }
  const text = (cand.content?.parts || []).filter(p => !p.thought && typeof p.text === 'string').map(p => p.text).join('');
  if (cand.finishReason === 'MAX_TOKENS' && schema) {
    try { return JSON.parse(text); } catch { throw new AIError('other', 'Die Antwort war zu lang und wurde abgeschnitten. Versuch es mit weniger Material.'); }
  }
  if (!text) throw new AIError('blocked', `Keine Antwort (${cand.finishReason || 'unbekannt'}).`);
  if (schema) {
    try { return JSON.parse(text); }
    catch { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new AIError('other', 'Die KI-Antwort konnte nicht gelesen werden.'); }
  }
  return text;
}

export async function listModels(apiKey) {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': apiKey } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new AIError('key', /API key/i.test(json?.error?.message || '') ? 'Dieser Schlüssel ist ungültig. Bitte nochmal genau kopieren.' : (json?.error?.message || `Fehler ${res.status}`));
  return (json.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name))
    .map(m => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name }));
}

// ---------- Helfer ----------
export const blobToB64 = (blob) => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1]);
  fr.onerror = rej; fr.readAsDataURL(blob);
});
export async function imagePart(blob, maxSide = 1600) {
  const small = await downscale(blob, maxSide);
  return { inlineData: { mimeType: 'image/jpeg', data: await blobToB64(small) } };
}
export async function downscale(blob, maxSide = 1600, quality = 0.82) {
  const bmp = await loadImage(blob);
  const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(r, 'image/jpeg', quality));
}
export function loadImage(blob) {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Bild konnte nicht geladen werden')); };
    img.src = url;
  });
}

// Audio → 16 kHz Mono-WAV-Stücke (max. 6 Minuten pro Anfrage, damit die Anfrage unter 20 MB bleibt)
export async function wavPartsFromBlob(blob, maxSec = 360) {
  const ab = await blob.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  let decoded;
  try {
    decoded = await new Promise((res, rej) => {
      const p = ac.decodeAudioData(ab, res, rej);
      if (p && typeof p.then === 'function') p.then(res, rej);
    });
  } finally { try { ac.close(); } catch {} }
  const rate = 16000;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const len = Math.max(1, Math.ceil(decoded.duration * rate));
  const off = new OAC(1, len, rate);
  const src = off.createBufferSource();
  src.buffer = decoded; src.connect(off.destination); src.start();
  const rendered = await off.startRendering();
  const data = rendered.getChannelData(0);
  const per = maxSec * rate;
  const parts = [];
  for (let i = 0; i < data.length; i += per) {
    const slice = data.subarray(i, Math.min(data.length, i + per));
    parts.push({ offset: i / rate, duration: slice.length / rate, blob: encodeWav(slice, rate) });
  }
  return { duration: decoded.duration, parts };
}
function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- Schemas ----------
const S = (type, extra = {}) => ({ type, ...extra });
const OBJ = (properties, required = Object.keys(properties)) => ({ type: 'OBJECT', properties, required });
const ARR = (items) => ({ type: 'ARRAY', items });
const STR = S('STRING');

export const SCHEMAS = {
  transcript: OBJ({
    segments: ARR(OBJ({
      t: S('NUMBER', { description: 'Sekunden ab Beginn dieses Audio-Stücks' }),
      role: S('STRING', { enum: ['lehrkraft', 'schueler', 'stoerung'] }),
      speaker: STR,
      text: STR,
    })),
  }),
  analysis: OBJ({
    title: STR,
    topic: STR,
    summary_md: STR,
    key_points: ARR(STR),
    glossary: ARR(OBJ({ term: STR, definition: STR })),
    homework: ARR(OBJ({ title: STR, details: STR, due_date: S('STRING', { description: 'YYYY-MM-DD oder leer' }) })),
    dates: ARR(OBJ({ title: STR, kind: STR, date: S('STRING', { description: 'YYYY-MM-DD oder leer' }) })),
    student_contributions_md: STR,
    open_questions: ARR(STR),
  }),
  sheet: OBJ({
    title: STR,
    subtitle: STR,
    sections: ARR(OBJ({
      type: S('STRING', { enum: ['text', 'definition', 'merke', 'beispiel', 'schritte', 'formel', 'tabelle', 'achtung', 'zusammenfassung', 'aufgaben'] }),
      heading: STR,
      body_md: STR,
    })),
    source_text: S('STRING', { description: 'Nur bei Scans: der erkannte Originaltext, sonst leer' }),
  }),
  cards: OBJ({ cards: ARR(OBJ({ front: STR, back: STR })) }),
  quiz: OBJ({ questions: ARR(OBJ({ q: STR, options: ARR(STR), correct: S('INTEGER'), explanation: STR })) }),
  exam: OBJ({
    title: STR,
    overview_md: STR,
    topics: ARR(OBJ({ name: STR, points_md: STR })),
    tasks: ARR(OBJ({ task_md: STR, points: S('INTEGER'), difficulty: S('STRING', { enum: ['leicht', 'mittel', 'schwer'] }), solution_md: STR })),
    tips_md: STR,
  }),
  style: OBJ({
    name: STR, description: STR,
    accent: S('STRING', { description: 'Hex-Farbe' }), accent2: S('STRING', { description: 'Hex-Farbe' }),
    background: S('STRING', { description: 'Hex-Farbe des Papiers' }), ink: S('STRING', { description: 'Hex-Farbe der Schrift' }),
    paper: S('STRING', { enum: ['plain', 'grid', 'lines', 'dots'] }),
    headingFont: S('STRING', { enum: ['serif', 'sans', 'rounded', 'hand', 'mono'] }),
    boxStyle: S('STRING', { enum: ['filled', 'outlined', 'leftbar', 'shadow', 'sticky'] }),
    headerStyle: S('STRING', { enum: ['band', 'underline', 'center', 'box'] }),
    columns: S('INTEGER'), radius: S('INTEGER'), icons: S('BOOLEAN'),
  }),
  corners: OBJ({ pages: ARR(OBJ({ index: S('INTEGER'), corners: ARR(ARR(S('NUMBER'))) })) }),
};

// ---------- Aufgaben ----------
async function ctx() {
  const s = await getSettings();
  return { s, who: `Die Nutzerin/der Nutzer ist in Klasse ${s.grade} (${s.school}) in Deutschland.` };
}
export function levelText(level) { return (LEVELS[level] || LEVELS.oberstufe).desc; }
const todayStr = () => new Date().toLocaleDateString('de-DE', { weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }) + ` (ISO ${new Date().toISOString().slice(0, 10)})`;

export async function transcribePart(wavBlob, { subject, prevContext, onWait }) {
  const { who } = await ctx();
  const system = `Du bist ein sehr genauer Protokollant für Schulunterricht. ${who}
Transkribiere die Aufnahme vollständig und wortgetreu auf Deutsch (fremdsprachige Passagen in der Originalsprache).
Unterscheide die Sprecher:
- role "lehrkraft": die Lehrkraft, die den Unterricht hält (meist die lauteste, längste, erklärende Stimme).
- role "schueler": Wortmeldungen, Fragen und Antworten von Schülerinnen und Schülern, die zum Unterricht gehören.
- role "stoerung": Zwischenrufe, Nebengespräche, Gemurmel, Witze, Störungen, die nichts mit dem Stoff zu tun haben.
Gib bei "speaker" eine kurze Bezeichnung an (z. B. "Lehrkraft", "Schüler A", "Schülerin B", "Zwischenruf").
Bleibe über die Stücke hinweg konsistent bei den Bezeichnungen. Erfinde nichts. Unverständliches als "[unverständlich]".
Fasse sehr kurze Füllgeräusche nicht als eigene Zeilen. Lange Monologe der Lehrkraft in sinnvolle Absätze (je ca. 1–4 Sätze) aufteilen, jeweils mit Zeitstempel.`;
  const parts = [
    { text: `Fach: ${subject || 'unbekannt'}.${prevContext ? `\nZur Orientierung – so endete das vorige Stück:\n${prevContext}` : ''}\nTranskribiere jetzt dieses Audio-Stück.` },
    { inlineData: { mimeType: 'audio/wav', data: await blobToB64(wavBlob) } },
  ];
  return generate({ parts, system, schema: SCHEMAS.transcript, temperature: 0.1, onWait });
}

export function transcriptToText(segments, { withNoise = false } = {}) {
  return segments.filter(s => withNoise || s.role !== 'stoerung')
    .map(s => `[${fmtTime(s.t)}] ${s.speaker || s.role}: ${s.text}`).join('\n');
}
export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
}

export async function analyzeLesson({ transcript, subject, note, markers, images = [], onWait }) {
  const { who, s } = await ctx();
  const system = `Du bist eine hervorragende Nachhilfelehrkraft. ${who} Heute ist ${todayStr()}.
Du bekommst das Transkript einer Unterrichtsstunde. Zeilen mit "Zwischenruf"/Störungen sind bereits entfernt.
Aufgaben:
1. summary_md: Eine AUSFÜHRLICHE, vollständige Zusammenfassung in Markdown. Lass KEINE inhaltlichen Details weg: jede Erklärung, Definition, Formel, jedes Beispiel, jede Jahreszahl, jeder Name und jeder Tafelanschrieb muss vorkommen. Gliedere mit Überschriften (##) in der Reihenfolge der Stunde. Schreib ${levelText(s.level)}.
2. key_points: die 5–10 wichtigsten Kernaussagen.
3. glossary: alle Fachbegriffe mit kurzer, korrekter Erklärung.
4. homework: alle Hausaufgaben/Arbeitsaufträge. Rechne Angaben wie "bis Freitag" oder "nächste Woche" ausgehend vom heutigen Datum in due_date (YYYY-MM-DD) um; wenn unklar, leer lassen.
5. dates: angekündigte Termine (Klausur, Test, Referat, Abgabe …).
6. student_contributions_md: wichtige Fragen/Beiträge von Schülern und die Antworten der Lehrkraft.
7. open_questions: Stellen, die unklar oder unverständlich geblieben sind.
title: kurzer Titel der Stunde, topic: Thema in wenigen Wörtern.`;
  const parts = [{ text: `Fach: ${subject}\n${note ? 'Notiz des Schülers: ' + note + '\n' : ''}${markers?.length ? 'Vom Schüler als WICHTIG markierte Zeitpunkte: ' + markers.map(fmtTime).join(', ') + ' – diese Stellen besonders hervorheben.\n' : ''}${images.length ? 'Es folgen Fotos vom Tafelbild – beziehe ihren Inhalt ein.\n' : ''}\nTRANSKRIPT:\n${transcript}` }, ...images];
  return generate({ parts, system, schema: SCHEMAS.analysis, temperature: 0.3, onWait });
}

export async function explain({ material, question, level, subject, onWait }) {
  const { who } = await ctx();
  const system = `Du bist eine geduldige, motivierende Nachhilfelehrkraft. ${who} Erkläre ${levelText(level)}.
Nutze Markdown: kurze Absätze, Beispiele, Vergleiche, ggf. Schritt-für-Schritt. Am Ende 2–3 Kontrollfragen zum Selbsttest (mit Lösungen in einem eigenen Abschnitt "Lösungen").`;
  const parts = [{ text: `Fach: ${subject}\n${question ? 'Frage/Fokus: ' + question + '\n' : 'Erkläre den gesamten Stoff noch einmal besser und verständlicher.\n'}\nMATERIAL:\n${material}` }];
  return generate({ parts, system, temperature: 0.6, onWait });
}

export async function makeSheet({ material, images = [], subject, level, styleHint, focus, fromScan = false, onWait }) {
  const { who } = await ctx();
  const system = `Du gestaltest hervorragende Lernblätter für die Schule. ${who} Niveau: ${levelText(level)}.
Erstelle ein übersichtliches, vollständiges Lernblatt aus dem Material. Nutze verschiedene Abschnittstypen sinnvoll:
"definition" (Begriff: Erklärung), "merke" (Merksatz), "beispiel", "schritte" (nummerierte Vorgehensweise), "formel" (Formeln mit Erklärung der Größen),
"tabelle" (Markdown-Tabelle), "achtung" (typische Fehler), "text" (Erklärung), "zusammenfassung", "aufgaben" (2–4 Übungsaufgaben mit Lösungen am Ende).
body_md ist Markdown (Listen, **fett**, Tabellen). Inhalte fachlich korrekt, nichts Wichtiges weglassen, aber knapp und lernfreundlich formuliert.
${fromScan ? 'Das Material sind eingescannte Seiten (Fotos). Lies alle Seiten genau. Schreibe in source_text den vollständigen erkannten Originaltext aller Seiten (mit "--- Seite N ---" getrennt).' : 'source_text leer lassen.'}`;
  const parts = [{ text: `Fach: ${subject}\n${focus ? 'Schwerpunkt: ' + focus + '\n' : ''}${styleHint ? 'Gewünschter Stil: ' + styleHint + '\n' : ''}${material ? '\nMATERIAL:\n' + material : ''}` }, ...images];
  return generate({ parts, system, schema: SCHEMAS.sheet, temperature: 0.4, onWait });
}

export async function makeCards({ material, subject, count = 15, onWait }) {
  const { who, s } = await ctx();
  const system = `Erstelle Karteikarten zum Lernen. ${who} Niveau: ${levelText(s.level)}.
Vorderseite: kurze, klare Frage oder Begriff. Rückseite: präzise Antwort (max. 3 Sätze). Decke den gesamten wichtigen Stoff ab, keine Dopplungen.`;
  return generate({ parts: [{ text: `Fach: ${subject}\nErstelle ca. ${count} Karteikarten.\n\nMATERIAL:\n${material}` }], system, schema: SCHEMAS.cards, temperature: 0.4, onWait });
}

export async function makeQuiz({ material, subject, count = 10, onWait }) {
  const { who, s } = await ctx();
  const system = `Erstelle ein Multiple-Choice-Quiz. ${who} Niveau: ${levelText(s.level)}.
Jede Frage hat genau 4 Antwortmöglichkeiten, genau eine ist richtig ("correct" = Index 0–3). Falsche Antworten plausibel. Mische die Position der richtigen Antwort. explanation: warum richtig.`;
  return generate({ parts: [{ text: `Fach: ${subject}\nErstelle ${count} Fragen.\n\nMATERIAL:\n${material}` }], system, schema: SCHEMAS.quiz, temperature: 0.5, onWait });
}

export async function makeExam({ material, subject, focus, minutes = 90, onWait }) {
  const { who, s } = await ctx();
  const system = `Du bereitest auf eine Klausur vor. ${who} Niveau: ${levelText(s.level)}.
overview_md: kompakte, aber vollständige Übersicht über ALLES Klausurrelevante. topics: Themenblöcke mit den wichtigsten Punkten.
tasks: eine realistische Probeklausur (ca. ${minutes} Minuten) mit Aufgaben unterschiedlicher Anforderungsbereiche (Reproduktion, Anwendung, Transfer), Punkten und ausführlichen Musterlösungen.
tips_md: konkrete Lerntipps und typische Fehler.`;
  return generate({ parts: [{ text: `Fach: ${subject}\n${focus ? 'Thema/Schwerpunkt der Klausur: ' + focus + '\n' : ''}\nMATERIAL:\n${material}` }], system, schema: SCHEMAS.exam, temperature: 0.4, onWait });
}

export async function chatAnswer({ history, material, subject, onWait }) {
  const { who, s } = await ctx();
  const system = `Du bist ein Lern-Assistent für das Fach ${subject}. ${who} Antworte ${levelText(s.level)}.
Beantworte Fragen vorrangig anhand der Unterrichtsmaterialien unten (Mitschriften, Scans, Lernblätter) und nenne, aus welcher Stunde (Datum/Titel) etwas stammt.
Wenn etwas nicht im Material steht, sag das ehrlich und erkläre es dann mit Allgemeinwissen (kennzeichne das). Markdown verwenden.

MATERIALIEN:
${material}`;
  const conv = history.map(m => `${m.role === 'user' ? 'Schüler' : 'Assistent'}: ${m.text}`).join('\n\n');
  return generate({ parts: [{ text: conv + '\n\nAssistent:' }], system, temperature: 0.5, onWait });
}

export async function styleFromImages({ images, description, onWait }) {
  const system = `Du analysierst Beispielbilder von Lernblättern/Heftseiten und leitest daraus einen Gestaltungsstil ab.
Bestimme Farben (Hex), Papierart, Schriftcharakter, Kasten-Stil, Kopfzeilen-Stil, Spaltenzahl (1 oder 2), Eckenradius (0–20) und ob Icons/Emojis passen.
description: 1–2 Sätze, die den Stil beschreiben. name: kurzer Name für die Vorlage.`;
  const parts = [{ text: `Wünsche des Nutzers: ${description || '(keine)'}` }, ...images];
  return generate({ parts, system, schema: SCHEMAS.style, temperature: 0.3, onWait });
}

export async function detectCorners({ images, onWait }) {
  const system = `Finde auf jedem Foto die vier Ecken des Blattes, der Buchseite oder der Tafel. Gib sie als normierte Koordinaten [x, y] zwischen 0 und 1 an, in der Reihenfolge oben-links, oben-rechts, unten-rechts, unten-links. index = Nummer des Fotos ab 0.`;
  return generate({ parts: [{ text: `Anzahl Fotos: ${images.length}` }, ...images], system, schema: SCHEMAS.corners, temperature: 0, onWait });
}
