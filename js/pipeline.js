// Analyse-Ablauf: Abschnitt für Abschnitt transkribieren, dann auswerten.
// Bei Limit wird pausiert und der Fortschritt gespeichert → später einfach weitermachen.
import { db, getBlob } from './db.js';
import { AIError, analyzeLesson, getSettings, imagePart, quotaStatus, transcribePart, transcriptToText, wavPartsFromBlob } from './ai.js';

const listeners = new Set();
export const onPipeline = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = (info) => listeners.forEach(fn => { try { fn(info); } catch {} });

let running = null; // aktuelle Aufnahme-ID
export const isRunning = (id) => id ? running === id : !!running;

export function recProgress(rec) {
  const total = rec.chunks?.length || 0;
  const done = (rec.chunks || []).filter(c => c.status === 'done').length;
  return { total, done, analyzed: !!rec.analysis };
}
export function allSegments(rec) {
  return (rec.chunks || []).flatMap(c => c.segments || []).sort((a, b) => a.t - b.t);
}

export async function processRecording(id) {
  if (running) { if (running === id) return; throw new Error('Es wird gerade schon eine andere Aufnahme analysiert.'); }
  running = id;
  try {
    let rec = await db.get('recordings', id);
    if (!rec) return;
    const subject = await db.get('subjects', rec.subjectId);
    rec.status = 'processing'; rec.error = ''; await db.put('recordings', rec);
    emit({ id, phase: 'start' });

    for (let i = 0; i < rec.chunks.length; i++) {
      const ch = rec.chunks[i];
      if (ch.status === 'done') continue;
      emit({ id, phase: 'transcribe', index: i, total: rec.chunks.length });
      const blob = await getBlob(ch.blobKey);
      if (!blob) { ch.status = 'done'; ch.segments = []; ch.error = 'Audio fehlt'; continue; }
      let wav;
      try { wav = await wavPartsFromBlob(blob); }
      catch (e) { ch.status = 'error'; ch.error = 'Audio konnte nicht gelesen werden'; await db.put('recordings', rec); continue; }
      const segs = [];
      const prev = allSegments(rec).slice(-4).map(s => `${s.speaker}: ${s.text}`).join('\n');
      for (const part of wav.parts) {
        const res = await transcribePart(part.blob, {
          subject: subject?.name, prevContext: segs.length ? segs.slice(-4).map(s => `${s.speaker}: ${s.text}`).join('\n') : prev,
          onWait: (s) => emit({ id, phase: 'wait', seconds: s }),
        });
        for (const s of (res.segments || [])) {
          segs.push({ t: (ch.startSec || 0) + part.offset + Math.max(0, Number(s.t) || 0), role: ['lehrkraft', 'schueler', 'stoerung'].includes(s.role) ? s.role : 'lehrkraft', speaker: s.speaker || '', text: String(s.text || '').trim() });
        }
      }
      ch.segments = segs; ch.status = 'done'; ch.error = '';
      rec = { ...rec, chunks: rec.chunks.slice() }; rec.chunks[i] = ch;
      await db.put('recordings', rec);
      emit({ id, phase: 'chunk-done', index: i, total: rec.chunks.length });
    }

    if (!rec.analysis) {
      emit({ id, phase: 'analyze' });
      const segs = allSegments(rec);
      if (!segs.length) throw new AIError('empty', 'In der Aufnahme wurde keine Sprache erkannt.');
      const images = [];
      for (const ph of (rec.photos || []).slice(0, 8)) {
        const b = await getBlob(ph.procKey || ph.blobKey); if (b) images.push(await imagePart(b, 1400));
      }
      const a = await analyzeLesson({
        transcript: transcriptToText(segs), subject: subject?.name || '', note: rec.note, markers: rec.markers, images,
        onWait: (s) => emit({ id, phase: 'wait', seconds: s }),
      });
      rec.analysis = a;
      if (!rec.titleEdited && a.title) rec.title = a.title;
      rec.homeworkPending = (a.homework || []).map((h, i) => ({ ...h, kind: 'Hausaufgabe', i })).concat((a.dates || []).map((d, i) => ({ title: d.title, details: d.kind, due_date: d.date, kind: d.kind || 'Termin', i: 100 + i })));
    }
    rec.status = 'done'; rec.error = '';
    await db.put('recordings', rec);
    emit({ id, phase: 'done' });
  } catch (e) {
    const rec = await db.get('recordings', id);
    if (rec) {
      rec.status = e instanceof AIError && (e.code === 'quota' || e.code === 'server' || e.code === 'network') ? 'waiting' : 'error';
      rec.error = e.message; rec.retryAt = e.retryAt || 0;
      await db.put('recordings', rec);
    }
    emit({ id, phase: 'error', error: e });
    throw e;
  } finally {
    running = null;
  }
}

// Wartende Aufnahmen automatisch fortsetzen, sobald das Limit wieder frei ist
let resumeTimer = null;
export async function autoResume() {
  clearTimeout(resumeTimer);
  const s = await getSettings();
  if (!s.apiKey || running || !navigator.onLine) return schedule(60000);
  const q = await quotaStatus();
  if (q.cooling) return schedule(Math.min(q.cooldownUntil - Date.now() + 2000, 30 * 60000));
  const recs = (await db.all('recordings')).filter(r => r.status === 'waiting' || r.status === 'queued').sort((a, b) => a.createdAt - b.createdAt);
  for (const r of recs) {
    try { await processRecording(r.id); } catch (e) { if (e instanceof AIError && e.code === 'quota') break; }
  }
  schedule(5 * 60000);
}
function schedule(ms) { clearTimeout(resumeTimer); resumeTimer = setTimeout(autoResume, Math.max(5000, ms)); }
