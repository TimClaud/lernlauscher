// Start, Fächer, Aufnahme, Stunden-Detail
import { db, uid, putBlob, getBlob, delBlob } from './db.js';
import { getSettings, saveSettings, quotaStatus, LEVELS, explain, fmtTime, transcriptToText } from './ai.js';
import { esc, md, toast, modal, confirmBox, promptBox, fmtDate, fmtDateLong, isoDay, speak, plain, busyHtml, download } from './ui.js';
import { setHeader, go, subjects, subjectMap, SUBJECT_COLORS, gearIcon, moreIcon, live, statusBadge, showAiError, aiErrorText, materialFor, dur } from './core.js';
import { LessonRecorder, recordingSupported } from './recorder.js';
import { processRecording, onPipeline, allSegments, recProgress, isRunning } from './pipeline.js';
import { autoCorners, processScan } from './scan.js';
import { openSheetCreator } from './views-sheets.js';
import { generateCards, generateQuiz, addTaskFromSuggestion } from './views-learn.js';

// ---------------- Start ----------------
export async function viewHome(el) {
  setHeader({ title: 'Lernlauscher', actions: `<button class="icon-btn" aria-label="Einstellungen" onclick="location.hash='#/einstellungen'">${gearIcon}</button>` });
  const [s, recs, tasks, cards, subs] = await Promise.all([getSettings(), db.all('recordings'), db.all('tasks'), db.all('cards'), subjectMap()]);
  const now = Date.now();
  const due = cards.filter(c => (c.due || 0) <= now).length;
  const open = tasks.filter(t => !t.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
  const waiting = recs.filter(r => r.status === 'waiting' || r.status === 'queued' || r.status === 'error');
  const recent = recs.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const h = new Date().getHours();
  const hello = h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend';
  el.innerHTML = `
    <div class="hero"><div class="hello">${hello}${s.name ? ', ' + esc(s.name) : ''}!</div><div class="muted small">${esc(fmtDateLong(now))}</div></div>
    ${!s.apiKey ? `<div class="card" style="border:2px dashed var(--accent)"><h3>KI einrichten (kostenlos)</h3><p class="muted small">Damit die App zusammenfassen, erklären und Lernblätter bauen kann, brauchst du einmal einen kostenlosen Google-Gemini-Schlüssel.</p><a class="btn primary block" href="#/einstellungen">Jetzt einrichten</a></div>` : ''}
    <div class="kpi" style="margin-top:12px">
      <div><b>${recs.length}</b><span>Aufnahmen</span></div>
      <div><b>${due}</b><span>Karten fällig</span></div>
      <div><b>${open.length}</b><span>Aufgaben offen</span></div>
    </div>
    ${waiting.length ? `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><b>${waiting.length} Aufnahme${waiting.length > 1 ? 'n' : ''} noch nicht fertig analysiert</b><div class="muted small">Gespeichert – geht weiter, sobald das Limit frei ist.</div></div><button class="btn sm primary" id="resumeAll">Weiter</button></div></div>` : ''}
    <div class="action-grid">
      <a class="action" href="#/aufnahme"><div class="ico"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></div><b>Aufnehmen</b><span>Unterricht mitschneiden</span></a>
      <a class="action" href="#/scan/neu"><div class="ico"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></div><b>Scannen</b><span>Blätter & Tafel</span></a>
      <a class="action" href="#/lernen"><div class="ico"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v10"/></svg></div><b>Lernen</b><span>${due ? due + ' Karten warten' : 'Karten & Quiz'}</span></a>
      <a class="action" href="#/klausur"><div class="ico"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg></div><b>Klausurmodus</b><span>Gezielt vorbereiten</span></a>
      <a class="action" href="#/chat"><div class="ico"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"/></svg></div><b>Fach-Chat</b><span>Frag deinen Stoff</span></a>
      <a class="action" href="#/vorlagen"><div class="ico"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor"/><circle cx="10.5" cy="7" r="1.1" fill="currentColor"/><circle cx="15" cy="7.5" r="1.1" fill="currentColor"/></svg></div><b>Vorlagen</b><span>Lernblatt-Designs</span></a>
    </div>
    <div class="section-title"><h2>Als Nächstes</h2><a href="#/kalender">Kalender</a></div>
    ${open.length ? `<div class="list">${open.slice(0, 5).map(t => taskRow(t, subs)).join('')}</div>` : `<div class="card flat muted small">Keine offenen Aufgaben. <svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg></div>`}
    <div class="section-title"><h2>Letzte Stunden</h2><a href="#/faecher">Alle</a></div>
    ${recent.length ? `<div class="list">${recent.map(r => recRow(r, subs)).join('')}</div>` : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg><p>Noch keine Aufnahmen.<br>Tipp auf den großen Knopf unten.</p></div>`}
  `;
  el.querySelector('#resumeAll')?.addEventListener('click', async () => {
    for (const r of waiting) { try { await processRecording(r.id); } catch (e) { showAiError(e); break; } }
    viewHome(el);
  });
  bindTaskChecks(el, () => viewHome(el));
}

export function recRow(r, subs) {
  const s = subs[r.subjectId];
  return `<a class="row" href="#/stunde/${r.id}"><span class="dot" style="background:${s?.color || '#999'}"></span>
    <div class="grow"><div class="title">${esc(r.title || 'Aufnahme')}</div><div class="sub">${esc(s?.name || '')} · ${fmtDate(r.createdAt)} · ${dur(r.durationSec || 0)}</div></div>${statusBadge(r)}</a>`;
}
export function taskRow(t, subs) {
  const s = subs[t.subjectId];
  const overdue = t.due && !t.done && t.due < isoDay();
  return `<div class="row ${t.done ? 'task-done' : ''}"><button class="check ${t.done ? 'on' : ''}" data-check="${t.id}" aria-label="Erledigt">${t.done ? '<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</button>
    <div class="grow"><div class="title">${esc(t.title)}</div><div class="sub">${s ? esc(s.name) + ' · ' : ''}${t.kind && t.kind !== 'Hausaufgabe' ? esc(t.kind) + ' · ' : ''}${t.due ? `<span style="${overdue ? 'color:var(--danger)' : ''}">${fmtDate(t.due + 'T12:00')}</span>` : 'ohne Datum'}</div></div></div>`;
}
export function bindTaskChecks(el, rerender) {
  el.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const t = await db.get('tasks', b.dataset.check); t.done = !t.done; await db.put('tasks', t); rerender();
  }));
}

// ---------------- Fächer ----------------
export async function viewSubjects(el) {
  setHeader({ title: 'Fächer', actions: `<button class="icon-btn" id="addSub" aria-label="Fach hinzufügen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>` });
  const [subs, recs, scans] = await Promise.all([subjects(), db.all('recordings'), db.all('scans')]);
  const cnt = (id) => recs.filter(r => r.subjectId === id).length + scans.filter(s => s.subjectId === id).length;
  el.innerHTML = `<div class="subject-grid">${subs.map(s => `<a class="subject-tile" style="--c:${s.color}" href="#/fach/${s.id}"><span class="name">${esc(s.name)}</span><span class="count">${cnt(s.id)} Einträge</span></a>`).join('')}</div>
    <button class="btn block" id="addSub2" style="margin-top:6px">+ Eigenes Fach anlegen</button>`;
  const add = () => editSubject(null, () => viewSubjects(el));
  document.getElementById('addSub').onclick = add; el.querySelector('#addSub2').onclick = add;
}

export function editSubject(sub, done) {
  let color = sub?.color || SUBJECT_COLORS[Math.floor(Math.random() * SUBJECT_COLORS.length)];
  modal(`<h2>${sub ? 'Fach bearbeiten' : 'Neues Fach'}</h2>
    <label class="field"><span>Name</span><input id="sn" type="text" value="${esc(sub?.name || '')}" placeholder="z. B. Informatik"></label>
    <label class="field"><span>Farbe</span><div class="color-pick">${SUBJECT_COLORS.map(c => `<button style="background:${c}" data-c="${c}" class="${c === color ? 'on' : ''}" aria-label="Farbe ${c}"></button>`).join('')}</div></label>
    <div class="btn-row">${sub ? '<button class="btn danger" data-a="del">Löschen</button>' : ''}<button class="btn" data-close>Abbrechen</button><button class="btn primary" data-a="save">Speichern</button></div>`,
  { onMount: (m, close) => {
    m.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { color = b.dataset.c; m.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); });
    m.querySelector('[data-a=save]').onclick = async () => {
      const name = m.querySelector('#sn').value.trim(); if (!name) return toast('Bitte einen Namen eingeben.');
      const all = await subjects();
      await db.put('subjects', { ...(sub || { id: uid(), createdAt: Date.now(), order: all.length }), name, color });
      close(); done && done();
    };
    m.querySelector('[data-a=del]')?.addEventListener('click', async () => {
      const recs = (await db.all('recordings')).filter(r => r.subjectId === sub.id).length;
      if (!(await confirmBox(recs ? `„${sub.name}“ löschen? Die ${recs} Aufnahmen bleiben erhalten, aber ohne Fach.` : `„${sub.name}“ löschen?`, { ok: 'Löschen', danger: true }))) return;
      await db.del('subjects', sub.id); close(); go('#/faecher');
    });
  } });
}

export async function viewSubject(el, { id }) {
  const sub = await db.get('subjects', id);
  if (!sub) return go('#/faecher');
  setHeader({ title: sub.name, back: '#/faecher', actions: `<button class="icon-btn" id="editS" aria-label="Bearbeiten">${moreIcon}</button>` });
  document.getElementById('editS').onclick = () => editSubject(sub, () => viewSubject(el, { id }));
  const [recs, scans, sheets, cards, exams] = await Promise.all([
    db.where('recordings', r => r.subjectId === id), db.where('scans', s => s.subjectId === id && s.pages?.length),
    db.where('sheets', s => s.subjectId === id), db.where('cards', c => c.subjectId === id), db.where('exams', e => e.subjectId === id)]);
  const tab = sessionStorage.getItem('subTab') || 'rec';
  const dueN = cards.filter(c => (c.due || 0) <= Date.now()).length;
  const subs = { [id]: sub };
  el.innerHTML = `
    <div class="card subj-head" style="--c:${sub.color}">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn sm" href="#/aufnahme?fach=${id}"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg> Aufnehmen</a>
        <a class="btn sm" href="#/scan/neu?fach=${id}"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg> Scannen</a>
        <a class="btn sm" href="#/chat/${id}"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"/></svg> Chat</a>
        <a class="btn sm" href="#/klausur?fach=${id}"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg> Klausur</a>
        ${cards.length ? `<a class="btn sm primary" href="#/karten/${id}"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v10"/></svg> ${dueN ? dueN + ' fällig' : 'Karten'}</a>` : ''}
      </div>
    </div>
    <div class="tabs">
      ${[['rec', `Stunden (${recs.length})`], ['scan', `Scans (${scans.length})`], ['sheet', `Lernblätter (${sheets.length})`], ['exam', `Klausuren (${exams.length})`]].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}
    </div>
    <div id="tabBody"></div>`;
  const body = el.querySelector('#tabBody');
  const show = (k) => {
    sessionStorage.setItem('subTab', k);
    el.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    if (k === 'rec') body.innerHTML = recs.length ? `<div class="list">${recs.sort((a, b) => b.createdAt - a.createdAt).map(r => recRow(r, subs)).join('')}</div>` : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>Noch keine Stunden in ${esc(sub.name)}.</div>`;
    if (k === 'scan') body.innerHTML = scans.length ? `<div class="list">${scans.sort((a, b) => b.createdAt - a.createdAt).map(s => `<a class="row" href="#/scan/${s.id}"><span style="font-size:1.3rem"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg></span><div class="grow"><div class="title">${esc(s.title || 'Scan')}</div><div class="sub">${fmtDate(s.createdAt)} · ${s.pages?.length || 0} Seiten</div></div><span class="chev">›</span></a>`).join('')}</div>` : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>Noch keine Scans.</div>`;
    if (k === 'sheet') body.innerHTML = sheets.length ? `<div class="list">${sheets.sort((a, b) => b.createdAt - a.createdAt).map(s => `<a class="row" href="#/blatt/${s.id}"><span style="font-size:1.3rem"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/></svg></span><div class="grow"><div class="title">${esc(s.content?.title || 'Lernblatt')}</div><div class="sub">${fmtDate(s.createdAt)}</div></div><span class="chev">›</span></a>`).join('')}</div>` : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/></svg>Noch keine Lernblätter. Öffne eine Stunde oder einen Scan und tippe auf „Lernblatt“.</div>`;
    if (k === 'exam') body.innerHTML = exams.length ? `<div class="list">${exams.sort((a, b) => b.createdAt - a.createdAt).map(x => `<a class="row" href="#/pruefung/${x.id}"><span style="font-size:1.3rem"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg></span><div class="grow"><div class="title">${esc(x.content?.title || 'Klausurvorbereitung')}</div><div class="sub">${fmtDate(x.createdAt)}</div></div><span class="chev">›</span></a>`).join('')}</div>` : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>Noch keine Klausurvorbereitung.</div>`;
  };
  el.querySelectorAll('.tabs button').forEach(b => b.onclick = () => show(b.dataset.tab));
  show(tab);
}

// ---------------- Aufnahme ----------------
export async function viewRecord(el, params) {
  setHeader({ title: 'Aufnahme' });
  if (live.recorder) return renderLive(el);
  const [subs, s] = await Promise.all([subjects(), getSettings()]);
  const pre = params.fach || sessionStorage.getItem('lastSubject') || subs[0]?.id;
  let chosen = pre;
  el.innerHTML = `
    ${!recordingSupported() ? `<div class="notice warn">Dieser Browser kann nicht aufnehmen. Öffne die App in Safari auf dem iPhone.</div>` : ''}
    <div class="card">
      <h3 style="margin-bottom:10px">Welches Fach?</h3>
      <div class="chips" id="subChips">${subs.map(x => `<button class="chip ${x.id === chosen ? 'on' : ''}" data-id="${x.id}"><span class="dot" style="background:${x.color}"></span>${esc(x.name)}</button>`).join('')}</div>
      <label class="field"><span>Titel (optional – sonst macht die KI einen)</span><input id="rt" type="text" placeholder="z. B. Lineare Funktionen"></label>
      <label class="field"><span>Notiz (optional)</span><input id="rn" type="text" placeholder="z. B. Vertretungsstunde, Thema für die Klausur"></label>
    </div>
    <div class="recorder">
      <button class="rec-big" id="startRec" aria-label="Aufnahme starten"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>
      <p class="muted small">Lass die App während der Aufnahme geöffnet. Der Bildschirm bleibt automatisch an. Leg das Handy am besten mit dem Display nach oben in die Nähe der Lehrkraft.</p>
    </div>`;
  el.querySelectorAll('#subChips .chip').forEach(b => b.onclick = () => { chosen = b.dataset.id; el.querySelectorAll('#subChips .chip').forEach(x => x.classList.toggle('on', x === b)); });
  el.querySelector('#startRec').onclick = async () => {
    if (!s.consentAccepted) {
      const ok = await confirmBox('Wichtig: Unterricht darf nur mit Erlaubnis der Lehrkraft aufgenommen werden (§ 201 StGB). Heimliche Aufnahmen sind strafbar. Hast du die Erlaubnis?', { ok: 'Ja, ich habe die Erlaubnis', cancel: 'Nein' });
      if (!ok) return;
      await saveSettings({ consentAccepted: true });
    }
    sessionStorage.setItem('lastSubject', chosen);
    await startRecording({ subjectId: chosen, title: el.querySelector('#rt').value.trim(), note: el.querySelector('#rn').value.trim() }, el);
  };
}

async function startRecording({ subjectId, title, note }, el) {
  const s = await getSettings();
  const sub = await db.get('subjects', subjectId);
  const rec = { id: uid(), subjectId, title: title || `${sub?.name || 'Stunde'} – ${fmtDate(Date.now(), { day: '2-digit', month: '2-digit' })}`, titleEdited: !!title, note, createdAt: Date.now(), status: 'recording', chunks: [], markers: [], photos: [], durationSec: 0 };
  await db.put('recordings', rec);
  const r = new LessonRecorder({
    chunkMin: s.chunkMin || 5,
    onChunk: async ({ blob, startSec, durationSec }) => {
      const key = await putBlob(blob);
      const cur = await db.get('recordings', rec.id);
      cur.chunks.push({ id: uid(), blobKey: key, startSec, durationSec, status: 'pending', mime: blob.type, size: blob.size });
      cur.durationSec = startSec + durationSec;
      await db.put('recordings', cur);
      live.chunkCount = cur.chunks.length;
    },
    onTick: (t) => { const x = document.getElementById('recTime'); if (x) x.textContent = fmtTime(t); },
    onLevel: (v, levels) => {
      const bars = document.querySelectorAll('#level i'); if (!bars.length) return;
      bars.forEach((b, i) => { const x = levels ? levels[i] || 0 : v; b.style.transform = `scaleY(${Math.max(0.08, x).toFixed(3)})`; });
    },
    onState: (st) => { if (st === 'resumed-after-gap') toast('Aufnahme wurde nach einer Unterbrechung fortgesetzt.'); updateRecTab(); const p = document.getElementById('pauseBtn'); if (p) p.textContent = st === 'paused' ? ' Weiter' : ' Pause'; },
  });
  try { await r.start(); }
  catch (e) {
    await db.del('recordings', rec.id);
    return toast(e && e.name === 'NotAllowedError' ? 'Kein Mikrofon-Zugriff. Bitte in den iPhone-Einstellungen für Safari erlauben.' : 'Aufnahme konnte nicht starten: ' + (e?.message || e), 5000);
  }
  Object.assign(live, { recorder: r, recId: rec.id, markers: [], photos: [], startedAt: Date.now(), chunkCount: 0 });
  updateRecTab();
  renderLive(el);
}

export function updateRecTab() {
  document.querySelector('#tabbar .rec-tab')?.classList.toggle('recording', !!live.recorder);
}

async function renderLive(el) {
  const rec = await db.get('recordings', live.recId);
  const sub = rec && await db.get('subjects', rec.subjectId);
  setHeader({ title: 'Aufnahme läuft' });
  el.innerHTML = `
    <div class="recorder">
      <div class="muted"><span class="dot" style="display:inline-block;background:${sub?.color || '#999'}"></span> ${esc(sub?.name || '')} · ${esc(rec?.title || '')}</div>
      <div class="rec-time" id="recTime">${fmtTime(live.recorder.elapsed)}</div>
      <div class="level" id="level">${'<i></i>'.repeat(28)}</div>
      <button class="rec-big on" id="stopRec" aria-label="Aufnahme beenden"><svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg></button>
      <div class="rec-tools">
        <button class="btn" id="pauseBtn">${live.recorder.state === 'paused' ? '<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg> Weiter' : '<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="5" width="3.5" height="14" rx="1"/><rect x="13.5" y="5" width="3.5" height="14" rx="1"/></svg> Pause'}</button>
        <button class="btn" id="markBtn"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg> Wichtig!</button>
        <label class="btn" style="cursor:pointer"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg> Tafelbild<input id="photoIn" type="file" accept="image/*" capture="environment" hidden></label>
      </div>
      <p class="muted small" id="liveInfo" style="margin-top:14px">${live.markers.length} Markierungen · ${live.photos.length} Fotos</p>
      <p class="muted small">Die Aufnahme wird alle paar Minuten sicher gespeichert.</p>
    </div>`;
  const info = () => { const x = el.querySelector('#liveInfo'); if (x) x.textContent = `${live.markers.length} Markierungen · ${live.photos.length} Fotos`; };
  el.querySelector('#pauseBtn').onclick = () => { live.recorder.state === 'paused' ? live.recorder.resume() : live.recorder.pause(); };
  el.querySelector('#markBtn').onclick = () => { live.markers.push(live.recorder.elapsed); toast(' Stelle markiert'); info(); if (navigator.vibrate) navigator.vibrate(30); };
  el.querySelector('#photoIn').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const sec = live.recorder.elapsed;
    toast('Tafelbild wird verbessert …');
    try {
      const blobKey = await putBlob(f);
      const corners = await autoCorners(f);
      const proc = await processScan(f, corners, 'board');
      const procKey = await putBlob(proc);
      live.photos.push({ blobKey, procKey, sec, corners });
      const cur = await db.get('recordings', live.recId); cur.photos = live.photos.slice(); await db.put('recordings', cur);
      toast(' Tafelbild gespeichert'); info();
    } catch (err) { toast('Foto konnte nicht verarbeitet werden.'); }
    e.target.value = '';
  };
  el.querySelector('#stopRec').onclick = async () => {
    const btn = el.querySelector('#stopRec'); btn.disabled = true;
    el.querySelector('.recorder').insertAdjacentHTML('beforeend', busyHtml('Wird gespeichert …'));
    const r = live.recorder;
    await r.stop();
    const cur = await db.get('recordings', live.recId);
    cur.markers = live.markers.slice(); cur.photos = live.photos.slice(); cur.gaps = r.gaps;
    cur.durationSec = r.elapsed; cur.status = 'queued';
    await db.put('recordings', cur);
    const id = live.recId;
    Object.assign(live, { recorder: null, recId: null, markers: [], photos: [] });
    updateRecTab();
    go('#/stunde/' + id);
    const s = await getSettings();
    if (s.apiKey) processRecording(id).catch(e => showAiError(e));
  };
}

// ---------------- Stunde (Detail) ----------------
export async function viewLesson(el, { id }) {
  let rec = await db.get('recordings', id);
  if (!rec) return go('#/');
  const sub = await db.get('subjects', rec.subjectId);
  setHeader({ title: rec.title || 'Stunde', back: sub ? '#/fach/' + sub.id : '#/', actions: `<button class="icon-btn" id="recMenu" aria-label="Mehr">${moreIcon}</button>` });
  document.getElementById('recMenu').onclick = () => lessonMenu(rec, () => viewLesson(el, { id }));

  const a = rec.analysis;
  const segs = allSegments(rec);
  const prog = recProgress(rec);
  const tab = sessionStorage.getItem('lessonTab') || (a ? 'sum' : 'tr');
  const urls = [];

  el.innerHTML = `
    <div class="muted small" style="margin:2px 2px 8px"><span class="dot" style="display:inline-block;background:${sub?.color || '#999'}"></span> ${esc(sub?.name || 'Ohne Fach')} · ${fmtDateLong(rec.createdAt)} · ${dur(rec.durationSec || 0)}</div>
    ${rec.note ? `<div class="notice"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/></svg> ${esc(rec.note)}</div>` : ''}
    <div id="statusBox"></div>
    <div class="card" style="padding:12px">
      <audio id="player" controls preload="none" style="width:100%"></audio>
      ${rec.chunks.length > 1 ? `<div class="chips" style="margin-top:8px" id="partChips">${rec.chunks.map((c, i) => `<button class="chip ${i === 0 ? 'on' : ''}" data-i="${i}">Teil ${i + 1} · ${fmtTime(c.startSec)}</button>`).join('')}</div>` : ''}
    </div>
    ${a ? `<div class="btn-row">
      <button class="btn primary" id="mkSheet"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/></svg> Lernblatt</button>
      <button class="btn" id="mkCards"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v10"/></svg> Karteikarten</button>
      <button class="btn" id="mkQuiz"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.6"/><circle cx="12" cy="16.8" r=".9" fill="currentColor"/></svg> Quiz</button>
    </div>` : ''}
    <div class="tabs">
      ${[['sum', 'Zusammenfassung'], ['tr', 'Mitschrift'], ['exp', 'Erklär’s mir'], ['gl', 'Begriffe'], ['hw', 'Aufgaben & Termine'], ['ph', `Fotos (${rec.photos?.length || 0})`]].map(([k, l]) => `<button data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}
    </div>
    <div id="tabBody"></div>`;

  // Audio
  const player = el.querySelector('#player');
  let curPart = -1;
  const loadPart = async (i, t = 0) => {
    if (i !== curPart) {
      const b = await getBlob(rec.chunks[i]?.blobKey); if (!b) return;
      const u = URL.createObjectURL(b); urls.push(u); player.src = u; curPart = i;
      el.querySelectorAll('#partChips .chip').forEach(c => c.classList.toggle('on', +c.dataset.i === i));
    }
    if (t) { player.addEventListener('loadedmetadata', () => { player.currentTime = t; }, { once: true }); try { player.currentTime = t; } catch {} }
  };
  if (rec.chunks.length) loadPart(0);
  player.onended = () => { if (curPart < rec.chunks.length - 1) { loadPart(curPart + 1).then(() => player.play()); } };
  el.querySelectorAll('#partChips .chip').forEach(c => c.onclick = () => loadPart(+c.dataset.i));
  const seek = (t) => {
    let idx = 0; rec.chunks.forEach((c, i) => { if (c.startSec <= t + 0.5) idx = i; });
    loadPart(idx, Math.max(0, t - rec.chunks[idx].startSec - 1)).then(() => player.play().catch(() => {}));
  };

  // Status
  const statusBox = el.querySelector('#statusBox');
  const renderStatus = async (info) => {
    rec = await db.get('recordings', id);
    const p = recProgress(rec);
    if (rec.status === 'done') { statusBox.innerHTML = ''; return; }
    const running = isRunning(id);
    let txt = '';
    if (running) {
      txt = info?.phase === 'analyze' ? 'Fasse die Stunde zusammen …' : info?.phase === 'wait' ? `Kurze Pause wegen Minutenlimit (${info.seconds}s) …` : info?.phase === 'retry' ? info.msg : `Schreibe mit … Teil ${Math.min(p.done + 1, p.total)} von ${p.total}`;
      statusBox.innerHTML = `<div class="card">${busyHtml(txt)}<div class="progress"><i style="width:${p.total ? Math.round((p.done + (p.done === p.total ? .5 : 0)) / (p.total + 1) * 100) : 5}%"></i></div></div>`;
    } else {
      const q = await quotaStatus();
      const reason = rec.error ? `<p class="small" style="color:${rec.status === 'error' ? 'var(--danger)' : 'inherit'}">${esc(rec.error)}</p>` : '';
      statusBox.innerHTML = `<div class="card"><b>${p.total ? `${p.done} von ${p.total} Teilen mitgeschrieben` : 'Noch nichts analysiert'}${p.done === p.total && p.total && !rec.analysis ? ' – Zusammenfassung fehlt noch' : ''}</b>
        ${reason}${q.cooling ? `<p class="small muted">Limit wieder frei in ca. ${Math.max(1, Math.round((q.cooldownUntil - Date.now()) / 60000))} Min. Die App macht dann automatisch weiter.</p>` : ''}
        <button class="btn primary block" id="runBtn" style="margin-top:8px" ${!p.total ? 'disabled' : ''}>${p.done ? 'Weiter analysieren' : 'Jetzt analysieren'}</button></div>`;
      statusBox.querySelector('#runBtn').onclick = async () => {
        try { await processRecording(id); } catch (e) { showAiError(e); }
      };
    }
  };
  const off = onPipeline((info) => { if (info.id !== id) return; if (info.phase === 'done' || info.phase === 'chunk-done' && sessionStorage.getItem('lessonTab') === 'tr') { off(); viewLesson(el, { id }); } else if (!document.body.contains(statusBox)) off(); else renderStatus(info); });
  renderStatus();

  // Tabs
  const body = el.querySelector('#tabBody');
  const show = (k) => {
    sessionStorage.setItem('lessonTab', k);
    el.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === k));
    if (k === 'sum') {
      body.innerHTML = a ? `
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>Das Wichtigste</h3><button class="btn ghost sm" id="readBtn"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg> Vorlesen</button></div>
          <ul class="md">${(a.key_points || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div class="card md">${md(a.summary_md)}</div>
        ${a.student_contributions_md ? `<details class="card"><summary>Fragen & Beiträge aus der Klasse</summary><div class="md">${md(a.student_contributions_md)}</div></details>` : ''}
        ${a.open_questions?.length ? `<div class="card"><h3>Noch unklar</h3><ul class="md">${a.open_questions.map(x => `<li>${esc(x)}</li>`).join('')}</ul><button class="btn sm" id="explainOpen">Erklär mir das</button></div>` : ''}`
        : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z"/></svg>Die Zusammenfassung erscheint hier, sobald die Stunde analysiert ist.</div>`;
      body.querySelector('#readBtn')?.addEventListener('click', () => speak(plain((a.key_points || []).join('. ') + '\n' + a.summary_md)));
      body.querySelector('#explainOpen')?.addEventListener('click', () => { sessionStorage.setItem('explainQ', a.open_questions.join('; ')); show('exp'); });
    }
    if (k === 'tr') {
      const mode = sessionStorage.getItem('trMode') || 'clean';
      const list = segs.filter(s => mode === 'all' || (mode === 'clean' ? s.role !== 'stoerung' : s.role === 'lehrkraft'));
      const markers = rec.markers || [];
      body.innerHTML = segs.length ? `
        <div class="seg" id="trMode">${[['clean', 'Ohne Störungen'], ['teacher', 'Nur Lehrkraft'], ['all', 'Alles']].map(([m, l]) => `<button data-m="${m}" class="${mode === m ? 'on' : ''}">${l}</button>`).join('')}</div>
        <div class="card">${list.map(s => {
          const star = markers.some(m => Math.abs(m - s.t) < 20) ? ' <svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>' : '';
          return `<div class="tr-line ${esc(s.role)}"><div class="tr-time" data-t="${s.t}">${fmtTime(s.t)}${star}</div><div class="tr-body"><div class="tr-who">${esc(s.speaker || s.role)}</div>${esc(s.text)}</div></div>`;
        }).join('')}</div>
        <div class="btn-row"><button class="btn sm" id="dlTr">Mitschrift als Text speichern</button></div>`
        : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l1.5-5.5L15 5l4 4-9.5 9.5z"/><path d="M13 7l4 4"/></svg>${prog.total ? 'Die Mitschrift erscheint hier nach der Analyse.' : 'Keine Audio-Teile vorhanden.'}</div>`;
      body.querySelectorAll('#trMode button').forEach(b => b.onclick = () => { sessionStorage.setItem('trMode', b.dataset.m); show('tr'); });
      body.querySelectorAll('.tr-time').forEach(t => t.onclick = () => seek(+t.dataset.t));
      body.querySelector('#dlTr')?.addEventListener('click', () => download(new Blob([`${rec.title}\n${fmtDateLong(rec.createdAt)}\n\n` + transcriptToText(segs, { withNoise: mode === 'all' })], { type: 'text/plain' }), `${(rec.title || 'Mitschrift').replace(/[^\wäöüÄÖÜß -]/g, '')}.txt`));
    }
    if (k === 'gl') {
      const gl = a?.glossary || [];
      body.innerHTML = gl.length ? `<div class="list">${gl.map(g => `<div class="row" style="display:block"><div class="title" style="white-space:normal">${esc(g.term)}</div><div class="md small">${md(g.definition)}</div></div>`).join('')}</div>
        <button class="btn block" id="glCards">Begriffe als Karteikarten speichern</button>` : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/></svg>Noch keine Begriffe.</div>`;
      body.querySelector('#glCards')?.addEventListener('click', async () => {
        for (const g of gl) await db.put('cards', { id: uid(), subjectId: rec.subjectId, sourceId: rec.id, front: g.term, back: g.definition, box: 0, due: Date.now(), createdAt: Date.now() });
        toast(`${gl.length} Karteikarten angelegt`);
      });
    }
    if (k === 'hw') {
      const sug = rec.homeworkPending || [];
      body.innerHTML = sug.length ? `<div class="list">${sug.map(h => `<div class="row"><div class="grow"><div class="title" style="white-space:normal">${esc(h.title)}</div><div class="sub" style="white-space:normal">${esc(h.kind)}${h.due_date ? ' · ' + fmtDate(h.due_date + 'T12:00') : ' · ohne Datum'}${h.details && h.details !== h.kind ? ' · ' + esc(h.details) : ''}</div></div>
        ${h.added ? '<span class="badge ok">Im Kalender</span>' : `<button class="btn sm primary" data-add="${h.i}">+ Kalender</button>`}</div>`).join('')}</div>`
        : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/></svg>${a ? 'In dieser Stunde wurden keine Hausaufgaben oder Termine erkannt.' : 'Erscheint nach der Analyse.'}</div>`;
      body.querySelectorAll('[data-add]').forEach(b => b.onclick = async () => {
        const h = sug.find(x => String(x.i) === b.dataset.add);
        await addTaskFromSuggestion(rec, h);
        h.added = true; await db.put('recordings', rec); show('hw');
      });
    }
    if (k === 'exp') renderExplain(body, rec, sub);
    if (k === 'ph') {
      const ph = rec.photos || [];
      body.innerHTML = ph.length ? `<div class="scan-pages">${ph.map((p, i) => `<button class="pg" data-i="${i}"><img data-key="${p.procKey || p.blobKey}" alt="Tafelbild ${i + 1}"><span class="n">${fmtTime(p.sec)}</span></button>`).join('')}</div>` : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>Keine Tafelbilder. Während der Aufnahme kannst du mit „<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg> Tafelbild“ Fotos machen.</div>`;
      body.querySelectorAll('img[data-key]').forEach(async img => { const b = await getBlob(img.dataset.key); if (b) { const u = URL.createObjectURL(b); urls.push(u); img.src = u; } });
      body.querySelectorAll('.pg').forEach(b => b.onclick = () => { const src = b.querySelector('img').src; modal(`<img src="${src}" style="width:100%;border-radius:12px"><div class="btn-row"><button class="btn" data-close>Schließen</button></div>`); });
    }
  };
  el.querySelectorAll('.tabs button').forEach(b => b.onclick = () => show(b.dataset.tab));
  show(tab);

  el.querySelector('#mkSheet')?.addEventListener('click', () => openSheetCreator({ subjectId: rec.subjectId, source: { type: 'recording', id: rec.id } }));
  el.querySelector('#mkCards')?.addEventListener('click', () => generateCards({ subjectId: rec.subjectId, recordingIds: [rec.id], sourceId: rec.id }));
  el.querySelector('#mkQuiz')?.addEventListener('click', () => generateQuiz({ subjectId: rec.subjectId, recordingIds: [rec.id], sourceId: rec.id, title: rec.title }));
}

function renderExplain(body, rec, sub) {
  getSettings().then(s => {
    let level = s.level;
    const q = sessionStorage.getItem('explainQ') || ''; sessionStorage.removeItem('explainQ');
    const prev = rec.explanations || [];
    body.innerHTML = `
      <div class="card">
        <label class="field" style="margin-top:0"><span>Wie soll erklärt werden?</span>
        <div class="seg" id="lvl">${Object.entries(LEVELS).map(([k, v]) => `<button data-l="${k}" class="${k === level ? 'on' : ''}">${v.label}</button>`).join('')}</div></label>
        <label class="field"><span>Was verstehst du nicht? (leer = alles nochmal erklären)</span><textarea id="eq" placeholder="z. B. Warum ist die Steigung negativ?">${esc(q)}</textarea></label>
        <button class="btn primary block" id="goExp" ${rec.analysis || allSegments(rec).length ? '' : 'disabled'}>Erklären</button>
      </div>
      <div id="expOut"></div>
      ${prev.slice().reverse().map(x => `<details class="card"><summary>${esc(x.question || 'Ganze Stunde')} · ${esc(LEVELS[x.level]?.label || '')}</summary><div class="md">${md(x.text)}</div></details>`).join('')}`;
    body.querySelectorAll('#lvl button').forEach(b => b.onclick = () => { level = b.dataset.l; body.querySelectorAll('#lvl button').forEach(x => x.classList.toggle('on', x === b)); });
    body.querySelector('#goExp').onclick = async () => {
      const out = body.querySelector('#expOut'); const question = body.querySelector('#eq').value.trim();
      out.innerHTML = `<div class="card">${busyHtml('Ich denke nach …')}</div>`;
      try {
        const material = await materialFor({ recordingIds: [rec.id] });
        const text = await explain({ material, question, level, subject: sub?.name || '' });
        rec.explanations = [...(rec.explanations || []), { question, level, text, at: Date.now() }];
        await db.put('recordings', rec);
        out.innerHTML = `<div class="card"><div style="display:flex;justify-content:flex-end"><button class="btn ghost sm" id="rd"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg> Vorlesen</button></div><div class="md">${md(text)}</div></div>`;
        out.querySelector('#rd').onclick = () => speak(plain(text));
      } catch (e) { out.innerHTML = `<div class="notice warn">${esc(aiErrorText(e))}</div>`; }
    };
  });
}

function lessonMenu(rec, rerender) {
  modal(`<h2 style="margin-bottom:10px">${esc(rec.title)}</h2>
    <div class="list">
      <button class="row" data-a="title"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg> <span class="grow">Titel ändern</span></button>
      <button class="row" data-a="note"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/></svg> <span class="grow">Notiz bearbeiten</span></button>
      <button class="row" data-a="move"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> <span class="grow">In anderes Fach verschieben</span></button>
      <button class="row" data-a="redo"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.5M4 4v4h4M4 13a8 8 0 0 0 14.5 4.5M20 20v-4h-4"/></svg> <span class="grow">Zusammenfassung neu erstellen</span></button>
      <button class="row" data-a="audio"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19h14"/></svg> <span class="grow">Audio speichern</span></button>
      <button class="row" data-a="del" style="color:var(--danger)"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/></svg> <span class="grow">Aufnahme löschen</span></button>
    </div><div class="btn-row"><button class="btn" data-close>Schließen</button></div>`,
  { onMount: (m, close) => m.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    close();
    if (a === 'title') { const t = await promptBox('Titel', rec.title); if (t) { rec.title = t; rec.titleEdited = true; await db.put('recordings', rec); rerender(); } }
    if (a === 'note') { const t = await promptBox('Notiz', rec.note || '', { multiline: true }); if (t !== null) { rec.note = t; await db.put('recordings', rec); rerender(); } }
    if (a === 'move') {
      const subs = await subjects();
      modal(`<h2>Fach wählen</h2><div class="list">${subs.map(s => `<button class="row" data-s="${s.id}"><span class="dot" style="background:${s.color}"></span><span class="grow">${esc(s.name)}</span>${s.id === rec.subjectId ? '<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : ''}</button>`).join('')}</div>`,
        { onMount: (m2, close2) => m2.addEventListener('click', async ev => { const b = ev.target.closest('[data-s]'); if (!b) return; rec.subjectId = b.dataset.s; await db.put('recordings', rec); close2(); rerender(); }) });
    }
    if (a === 'redo') { rec.analysis = null; rec.status = 'queued'; await db.put('recordings', rec); rerender(); processRecording(rec.id).catch(showAiError); }
    if (a === 'audio') {
      for (let i = 0; i < rec.chunks.length; i++) { const b = await getBlob(rec.chunks[i].blobKey); if (b) download(b, `${rec.title} – Teil ${i + 1}.${b.type.includes('mp4') ? 'm4a' : b.type.includes('ogg') ? 'ogg' : 'webm'}`); }
    }
    if (a === 'del') {
      if (!(await confirmBox('Aufnahme mit Mitschrift und Zusammenfassung endgültig löschen? Das lässt sich nicht rückgängig machen.', { ok: 'Endgültig löschen', danger: true }))) return;
      for (const c of rec.chunks) await delBlob(c.blobKey);
      for (const p of rec.photos || []) { await delBlob(p.blobKey); if (p.procKey) await delBlob(p.procKey); }
      await db.del('recordings', rec.id); toast('Gelöscht'); go('#/fach/' + rec.subjectId);
    }
  }) });
}
