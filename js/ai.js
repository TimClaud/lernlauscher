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
  apiKey: '', model: 'auto', groqKey: '', stt: 'auto', grade: '11', school: 'Gymnasium', level: 'oberstufe',
  theme: 'auto', rpm: 10, rpd: 250, chunkMin: 5, consentAccepted: false, name: '',
};

let settingsCache = null;
export async function getSettings() {
  if (!settingsCache) {
    settingsCache = { ...DEFAULT_SETTINGS, ...(await kvGet('settings', {})) };
    // alte feste Modellnamen → automatische Auswahl
    if (['gemini-2.5-flash', 'gemini-flash-latest', ''].includes(settingsCache.model)) settingsCache.model = 'auto';
  }
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

// ---------- Kern-Aufruf: Gemini-Modelle nacheinander, dann Groq als Reserve ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const modelCool = {}; // Modell → gesperrt bis (Zeitpunkt), Limits gelten bei Google pro Modell

async function modelChain(s) {
  let cache = await kvGet('geminiModels', null);
  if (!cache || Date.now() - cache.at > 24 * 3600 * 1000) {
    try { const list = await listModels(s.apiKey); cache = { at: Date.now(), ids: list.map(m => m.id) }; await kvSet('geminiModels', cache); }
    catch { cache = cache || { at: 0, ids: [] }; }
  }
  const ranked = rankModels(cache.ids.map(id => ({ id })));
  const first = s.model && s.model !== 'auto' ? [s.model] : [];
  const all = [...new Set([...first, ...ranked])];
  if (!all.length) all.push('gemini-flash-latest');
  return all.filter(m => !(modelCool[m] > Date.now())).slice(0, 4);
}

export async function generate(opts) {
  const s = await getSettings();
  const hasMedia = (opts.parts || []).some(p => p.inlineData);
  if (!s.apiKey && !(s.groqKey && !hasMedia)) throw new AIError('key', 'Bitte zuerst in den Einstellungen deinen kostenlosen Gemini-Schlüssel eintragen.');
  let lastErr = null;
  if (s.apiKey) {
    await waitForSlot(opts.onWait);
    const chain = await modelChain(s);
    for (const model of chain) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try { return await geminiCall({ ...opts, model }); }
        catch (e) {
          lastErr = e;
          if ((e.code === 'server' || e.code === 'network') && attempt < (model === chain[0] ? 2 : 0)) {
            opts.onRetry && opts.onRetry(`Google ist überlastet – neuer Versuch in ${attempt ? 6 : 2} Sek. …`);
            await sleep(attempt ? 6000 : 2000); continue;
          }
          break;
        }
      }
      if (!['server', 'quota', 'model', 'network'].includes(lastErr?.code)) throw lastErr;
      opts.onRetry && opts.onRetry('Wechsle auf ein anderes KI-Modell …');
    }
    if (!chain.length) lastErr = new AIError('quota', 'Alle Gemini-Modelle haben gerade ihr Limit erreicht.', Math.min(...Object.values(modelCool), nextDailyReset()));
  }
  if (s.groqKey && !hasMedia) {
    try { opts.onRetry && opts.onRetry('Nutze die Reserve-KI (Groq) …'); return await groqChat(opts); }
    catch (e) { if (!lastErr) throw e; }
  }
  // Alle Modelle im Limit → App merkt sich, wann es weitergeht
  if (lastErr?.code === 'quota') {
    const until = Math.min(...Object.values(modelCool).filter(t => t > Date.now()), lastErr.retryAt || Infinity);
    if (isFinite(until)) { const u = await loadUsage(); u.cooldownUntil = until; u.cooldownReason = until - Date.now() > 3600000 ? 'day' : 'minute'; await saveUsage(); lastErr.retryAt = until; }
  }
  throw lastErr;
}

async function geminiCall({ parts, system, schema, temperature = 0.4, model }) {
  const s = await getSettings();
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
    res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
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
      modelCool[model] = until; // nur dieses Modell pausieren – die anderen haben eigene Limits
      throw new AIError('quota', perDay ? 'Das kostenlose Tageslimit von Google ist erreicht.' : 'Zu viele Anfragen auf einmal – kurze Pause.', until);
    }
    if ([400, 403, 404].includes(res.status)) { const uu = await loadUsage(); uu.count = Math.max(0, uu.count - 1); await saveUsage(); }
    if (res.status === 400 && /API key|API_KEY/i.test(err?.message || '')) throw new AIError('key', 'Der Gemini-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.');
    if (res.status === 403) throw new AIError('key', 'Zugriff verweigert – ist der Schlüssel richtig und die Gemini API aktiviert?');
    const modelGone = res.status === 404 || (res.status === 400 && /model/i.test(err?.message || '') && /not found|not supported|unsupported|deprecated|no longer/i.test(err?.message || ''));
    if (modelGone) {
      // Modell abgeschaltet → für heute überspringen; ist es das eingestellte, auf „automatisch“ stellen
      modelCool[model] = Date.now() + 24 * 3600 * 1000;
      if (s.model === model) await saveSettings({ model: 'auto' });
      throw new AIError('model', `Das KI-Modell „${model}“ ist nicht verfügbar.`);
    }
    if (res.status >= 500) throw new AIError('server', 'Google ist gerade überlastet. Die App versucht es gleich nochmal.', Date.now() + 60000);
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

// Bestes verfügbares Flash-Modell finden (schnell, im Gratis-Zugang, kann Audio & Bilder)
export function rankModels(models, exclude = '') {
  const bad = /(tts|image|live|audio|embedding|aqa|vision|computer|robotics|native|nano|gemma|learnlm|veo|imagen)/i;
  const cands = models.map(m => m.id).filter(id => id !== exclude && /flash/i.test(id) && !bad.test(id));
  const ver = (id) => parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
  // stabile Versionen zuerst (weniger überlastet), „latest“-Aliase als Ausweichmöglichkeit
  const score = (id) =>
    (/latest/.test(id) ? 18 : 0) +
    ver(id) * 10 -
    (/lite/i.test(id) ? 5 : 0) -
    (/preview|exp/i.test(id) ? 3 : 0) -
    (/-\d{2,}$|-\d{3}$/.test(id) ? 1 : 0);
  return cands.sort((a, b) => score(b) - score(a));
}
export async function pickBestModel(apiKey, exclude = '') {
  return rankModels(await listModels(apiKey), exclude)[0] || null;
}

// ---------- Groq (Reserve, kostenlos): Whisper-Spracherkennung + Text-KI ----------
const GROQ = 'https://api.groq.com/openai/v1';
async function groqFetch(path, init) {
  const s = await getSettings();
  let res;
  try { res = await fetch(GROQ + path, { ...init, headers: { Authorization: `Bearer ${s.groqKey}`, ...(init?.headers || {}) } }); }
  catch { throw new AIError('network', 'Keine Verbindung zu Groq. Bist du online?'); }
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || `Fehler ${res.status}`;
    if (res.status === 401) throw new AIError('key', 'Der Groq-Schlüssel ist ungültig. Bitte in den Einstellungen prüfen.');
    if (res.status === 429) {
      const ra = parseFloat(res.headers.get('retry-after')) || 60;
      throw new AIError('quota', 'Das Gratis-Limit von Groq ist gerade erreicht.', Date.now() + ra * 1000);
    }
    if (res.status === 413 || /too large|context_length|reduce/i.test(msg)) throw new AIError('toolarge', 'Für die Reserve-KI (Groq) ist das Material zu lang.');
    if (res.status >= 500) throw new AIError('server', 'Groq ist gerade überlastet.', Date.now() + 60000);
    throw new AIError('other', 'Groq: ' + msg);
  }
  return json;
}
export async function listGroqModels(key) {
  const res = await fetch(GROQ + '/models', { headers: { Authorization: `Bearer ${key}` } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new AIError('key', res.status === 401 ? 'Dieser Groq-Schlüssel ist ungültig.' : (json?.error?.message || `Fehler ${res.status}`));
  return (json.data || []).filter(m => m.active !== false).map(m => m.id);
}
export function rankGroqChat(ids) {
  const bad = /(whisper|guard|tts|playai|orpheus|compound|distil|vision|allam)/i;
  const pref = ['openai/gpt-oss-120b', 'llama-3.3-70b', 'moonshotai/kimi-k2', 'qwen/qwen3', 'meta-llama/llama-4-maverick', 'meta-llama/llama-4-scout', 'openai/gpt-oss-20b', 'llama-3.1-8b'];
  const rank = (id) => { const i = pref.findIndex(p => id.includes(p)); return i < 0 ? 99 : i; };
  return ids.filter(id => !bad.test(id)).sort((a, b) => rank(a) - rank(b));
}
async function groqChatModel() {
  const s = await getSettings();
  let cache = await kvGet('groqModels', null);
  if (!cache || Date.now() - cache.at > 24 * 3600 * 1000) {
    try { cache = { at: Date.now(), ids: await listGroqModels(s.groqKey) }; await kvSet('groqModels', cache); } catch { cache = cache || { ids: [] }; }
  }
  return rankGroqChat(cache.ids)[0] || 'llama-3.3-70b-versatile';
}
async function groqChat({ parts, system, schema, temperature = 0.4 }) {
  const text = (parts || []).filter(p => p.text).map(p => p.text).join('\n');
  let sys = system || '';
  if (schema) sys += `\n\nAntworte AUSSCHLIESSLICH mit einem gültigen JSON-Objekt (kein Text drumherum) nach diesem Schema (OpenAPI-Notation, alle Felder ausfüllen):\n${JSON.stringify(schema)}`;
  const body = { model: await groqChatModel(), temperature, messages: [{ role: 'system', content: sys }, { role: 'user', content: text }] };
  if (schema) body.response_format = { type: 'json_object' };
  const json = await groqFetch('/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = json?.choices?.[0]?.message?.content || '';
  if (!schema) return out;
  try { return JSON.parse(out); } catch { const m = out.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new AIError('other', 'Die Antwort der Reserve-KI konnte nicht gelesen werden.'); }
}
async function groqTranscribe(wavBlob) {
  const fd = new FormData();
  fd.append('file', wavBlob, 'teil.wav');
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('language', 'de');
  fd.append('response_format', 'verbose_json');
  fd.append('temperature', '0');
  const json = await groqFetch('/audio/transcriptions', { method: 'POST', body: fd });
  return (json.segments || []).filter(x => (x.no_speech_prob ?? 0) < 0.8 && String(x.text || '').trim())
    .map(x => ({ t: x.start, text: String(x.text).trim() }));
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
      type: S('STRING', { enum: ['text', 'definition', 'merke', 'beispiel', 'schritte', 'formel', 'tabelle', 'achtung', 'zusammenfassung', 'aufgaben', 'diagramm'] }),
      heading: STR,
      body_md: STR,
      svg: S('STRING', { description: 'Nur bei type "diagramm": vollständiger SVG-Code, sonst leerer String' }),
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

export async function transcribePart(wavBlob, { subject, prevContext, onWait, onRetry }) {
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
  const s = await getSettings();
  const viaGroq = async () => {
    onRetry && onRetry('Schreibe mit der Reserve-KI (Groq) mit …');
    const segs = await groqTranscribe(wavBlob);
    return { segments: await labelRoles(segs, { subject, onWait }), via: 'groq' };
  };
  if (s.groqKey && (s.stt === 'groq' || !s.apiKey)) return viaGroq();
  try { return await generate({ parts, system, schema: SCHEMAS.transcript, temperature: 0.1, onWait, onRetry }); }
  catch (e) {
    if (s.groqKey && e.code !== 'key') return viaGroq();
    throw e;
  }
}

// Whisper liefert nur Text → Sprecherrollen nachträglich per Text-KI zuordnen
async function labelRoles(segs, { subject, onWait }) {
  if (!segs.length) return [];
  const fallback = segs.map(x => ({ ...x, role: 'lehrkraft', speaker: '' }));
  try {
    const res = await generate({
      system: `Du bekommst nummerierte Zeilen aus einer Schulstunde (Fach: ${subject || 'unbekannt'}), ohne Sprecherangaben. Ordne jeder Zeile eine Rolle zu:
"lehrkraft" = erklärt den Stoff, stellt Aufgaben; "schueler" = Fragen/Antworten von Schülern zum Stoff; "stoerung" = Zwischenrufe, Nebengespräche, nichts mit dem Stoff zu tun.
speaker: kurze Bezeichnung ("Lehrkraft", "Schüler/in", "Zwischenruf"). Im Zweifel "lehrkraft".`,
      parts: [{ text: segs.map((x, i) => `${i}: ${x.text}`).join('\n') }],
      schema: { type: 'OBJECT', properties: { labels: { type: 'ARRAY', items: { type: 'OBJECT', properties: { i: { type: 'INTEGER' }, role: { type: 'STRING', enum: ['lehrkraft', 'schueler', 'stoerung'] }, speaker: { type: 'STRING' } }, required: ['i', 'role', 'speaker'] } } }, required: ['labels'] },
      temperature: 0, onWait,
    });
    for (const l of res.labels || []) if (fallback[l.i]) { fallback[l.i].role = l.role; fallback[l.i].speaker = l.speaker; }
  } catch {}
  return fallback;
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

export async function analyzeLesson({ transcript, subject, note, markers, images = [], onWait, onRetry }) {
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
  return generate({ parts, system, schema: SCHEMAS.analysis, temperature: 0.3, onWait, onRetry });
}

export async function explain({ material, question, level, subject, onWait }) {
  const { who } = await ctx();
  const system = `Du bist eine geduldige, motivierende Nachhilfelehrkraft. ${who} Erkläre ${levelText(level)}.
Nutze Markdown: kurze Absätze, Beispiele, Vergleiche, ggf. Schritt-für-Schritt. Am Ende 2–3 Kontrollfragen zum Selbsttest (mit Lösungen in einem eigenen Abschnitt "Lösungen").`;
  const parts = [{ text: `Fach: ${subject}\n${question ? 'Frage/Fokus: ' + question + '\n' : 'Erkläre den gesamten Stoff noch einmal besser und verständlicher.\n'}\nMATERIAL:\n${material}` }];
  return generate({ parts, system, temperature: 0.6, onWait });
}

export async function makeSheet({ material, images = [], subject, level, styleHint, focus, fromScan = false, colors, onWait }) {
  const { who } = await ctx();
  const system = `Du gestaltest hervorragende Lernblätter für die Schule. ${who} Niveau: ${levelText(level)}.
Erstelle ein übersichtliches, vollständiges Lernblatt aus dem Material. Nutze verschiedene Abschnittstypen sinnvoll:
"definition" (Begriff: Erklärung), "merke" (Merksatz), "beispiel", "schritte" (nummerierte Vorgehensweise), "formel" (Formeln mit Erklärung der Größen),
"tabelle" (Markdown-Tabelle), "achtung" (typische Fehler), "text" (Erklärung), "zusammenfassung", "aufgaben" (2–4 Übungsaufgaben mit Lösungen am Ende),
"diagramm" (ein gezeichnetes Schaubild: Ablauf, Kreislauf, Aufbau, Zeitstrahl, Vergleich, Mindmap, Koordinatensystem …).
Baue 1–3 "diagramm"-Abschnitte ein, wo ein Bild beim Verstehen hilft. Für diese Abschnitte: body_md = kurze Bildunterschrift, svg = Zeichnung nach diesen Regeln:
${DIAGRAM_RULES}
Farben für Schaubilder: Hauptfarbe ${colors?.accent || '#1F6F5C'}, Zweitfarbe ${colors?.accent2 || '#C99A3E'}, Schrift ${colors?.ink || '#1E2328'}.
Bei allen anderen Abschnitten svg = "".
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

// ---------- Schaubilder (gezeichnet, keine KI-Fotos) ----------
export const DIAGRAM_RULES = `- Nur gültiges SVG: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 400"> … </svg>, KEINE width/height-Attribute.
- Erlaubt: g, rect, circle, ellipse, line, polyline, polygon, path, text, tspan, defs, marker (für Pfeilspitzen). Kein script, kein foreignObject, keine Bilder, keine Links, keine externen Schriften.
- Schrift: font-family="sans-serif", font-size 22–28 (gut lesbar auch auf dem Handy), höchstens ca. 3–4 Wörter pro Beschriftung, deutsche Beschriftungen, kurz und fachlich korrekt. Text darf nicht über den Rand oder über andere Elemente laufen; lange Texte mit tspan umbrechen.
- Klar und aufgeräumt wie ein gutes Tafelbild/Schulbuch-Schaubild: Kästen mit abgerundeten Ecken (rx 8), Pfeile mit Pfeilspitzen, viel Weißraum, max. ca. 8–10 Elemente.
- Flächen hell (Farbe mit fill-opacity 0.15), Linien und Überschriften in der Hauptfarbe, Text in der Schriftfarbe. Kein Hintergrund-Rechteck.`;

export async function makeDiagram({ material, topic, subject, colors, onWait }) {
  const { who, s } = await ctx();
  const system = `Du zeichnest Schaubilder für Lernblätter. ${who} Niveau: ${levelText(s.level)}.
Zeichne EIN Schaubild zum gewünschten Thema als SVG. Regeln:
${DIAGRAM_RULES}
Farben: Hauptfarbe ${colors?.accent || '#1F6F5C'}, Zweitfarbe ${colors?.accent2 || '#C99A3E'}, Schrift ${colors?.ink || '#1E2328'}.
heading = kurzer Titel, body_md = 1–2 Sätze Bildunterschrift.`;
  const schema = { type: 'OBJECT', properties: { heading: STR, body_md: STR, svg: STR }, required: ['heading', 'body_md', 'svg'] };
  const text = `Fach: ${subject}\nThema des Schaubilds: ${topic}` + (material ? `\n\nKONTEXT:\n${material}` : '');
  return generate({ parts: [{ text }], system, schema, temperature: 0.4, onWait });
}
