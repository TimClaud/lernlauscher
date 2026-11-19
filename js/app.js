// Lernlauscher – Start & Navigation
import { db } from './db.js';
import { getSettings, quotaStatus } from './ai.js';
import { relTime } from './ui.js';
import { ensureSeed, live } from './core.js';
import { autoResume, onPipeline } from './pipeline.js';
import { viewHome, viewSubjects, viewSubject, viewRecord, viewLesson, updateRecTab } from './views-lesson.js';
import { viewScanNew, viewScan, viewSheet, viewTemplates, revokeAll } from './views-sheets.js';
import { viewLearn, viewCards, viewQuiz, viewExamSetup, viewExam, viewCalendar, viewChatPick, viewChat, viewSettings } from './views-learn.js';

const routes = [
  ['', viewHome, 'home'],
  ['faecher', viewSubjects, 'faecher'],
  ['fach/:id', viewSubject, 'faecher'],
  ['aufnahme', viewRecord, 'aufnahme'],
  ['stunde/:id', viewLesson, 'faecher'],
  ['scan/neu', viewScanNew, 'home'],
  ['scan/:id', viewScan, 'faecher'],
  ['blatt/:id', viewSheet, 'lernen'],
  ['vorlagen', viewTemplates, 'home'],
  ['lernen', viewLearn, 'lernen'],
  ['karten/:id', viewCards, 'lernen'],
  ['quiz/:id', viewQuiz, 'lernen'],
  ['klausur', viewExamSetup, 'lernen'],
  ['pruefung/:id', viewExam, 'lernen'],
  ['kalender', viewCalendar, 'kalender'],
  ['chat', viewChatPick, 'lernen'],
  ['chat/:id', viewChat, 'lernen'],
  ['einstellungen', viewSettings, 'home'],
];

function match(path) {
  const parts = path.split('/').filter(Boolean);
  for (const [pat, fn, tab] of routes) {
    const pp = pat.split('/').filter(Boolean);
    if (pp.length !== parts.length) continue;
    const params = {};
    if (pp.every((p, i) => p.startsWith(':') ? (params[p.slice(1)] = decodeURIComponent(parts[i]), true) : p === parts[i])) return { fn, tab, params };
  }
  return null;
}

let renderId = 0;
async function router() {
  const id = ++renderId;
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const m = match(path) || match('');
  const params = { ...m.params, ...Object.fromEntries(new URLSearchParams(query || '')) };
  document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('active', a.dataset.tab === m.tab));
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const el = document.getElementById('view');
  document.getElementById('modalRoot').innerHTML = '';
  revokeAll();
  el.innerHTML = '';
  window.scrollTo(0, 0);
  try { await m.fn(el, params); }
  catch (e) {
    console.error(e);
    if (id === renderId) el.innerHTML = `<div class="notice warn">Hoppla, da ist etwas schiefgelaufen: ${String(e.message || e).replace(/</g, '&lt;')}</div><a class="btn" href="#/">Zur Startseite</a>`;
  }
  updateRecTab();
}

// Theme
async function applyTheme() {
  const s = await getSettings();
  if (s.theme === 'light' || s.theme === 'dark') document.documentElement.dataset.theme = s.theme;
  else delete document.documentElement.dataset.theme;
}

// Limit-Leiste
let quotaTimer = null;
async function renderQuota() {
  clearTimeout(quotaTimer);
  const bar = document.getElementById('quotaBar');
  const s = await getSettings();
  if (!s.apiKey) { bar.hidden = true; return; }
  const q = await quotaStatus();
  if (q.cooling) {
    bar.hidden = false; bar.className = 'stop';
    bar.textContent = q.cooldownReason === 'day'
      ? `⏸ Gratis-Tageslimit erreicht. Wieder frei in ca. ${relTime(q.cooldownUntil - Date.now())} – deine Aufnahmen sind gespeichert und werden dann weiter analysiert.`
      : `⏳ Kurze Pause (Minutenlimit) – geht in ${relTime(q.cooldownUntil - Date.now())} automatisch weiter.`;
    quotaTimer = setTimeout(renderQuota, 15000);
  } else if (q.ratio >= 0.8) {
    bar.hidden = false; bar.className = 'warn';
    bar.textContent = `⚠️ Gleich ist dein Gratis-Limit für heute aufgebraucht: ${q.used} von ca. ${q.limit} Anfragen genutzt.`;
  } else bar.hidden = true;
}

// Vor dem Schließen warnen, wenn eine Aufnahme läuft
window.addEventListener('beforeunload', (e) => { if (live.recorder) { e.preventDefault(); e.returnValue = ''; } });

async function start() {
  await ensureSeed();
  await applyTheme();
  // Aufnahmen, die beim letzten Mal nicht sauber beendet wurden, retten
  for (const r of await db.all('recordings')) {
    if (r.status === 'recording' || r.status === 'processing') {
      r.status = r.chunks?.length ? 'queued' : 'error';
      if (!r.chunks?.length) r.error = 'Die Aufnahme wurde unterbrochen, bevor etwas gespeichert war.';
      r.durationSec = r.chunks?.reduce((m, c) => Math.max(m, c.startSec + c.durationSec), 0) || 0;
      await db.put('recordings', r);
    }
  }
  // leere Scans (Scanner geöffnet, aber nichts fotografiert) aufräumen
  for (const s of await db.all('scans')) if (!s.pages?.length) await db.del('scans', s.id);
  window.addEventListener('hashchange', router);
  window.addEventListener('settings', () => { applyTheme(); renderQuota(); });
  window.addEventListener('quota', renderQuota);
  window.addEventListener('online', () => autoResume());
  onPipeline(renderQuota);
  await router();
  renderQuota();
  setTimeout(autoResume, 3000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
start();
