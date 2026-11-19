// Lernen: Karteikarten, Quiz, Klausurmodus · Kalender · Chat · Einstellungen
import { db, uid, exportAll, importAll, storageEstimate, requestPersistence, STORES, kvSet } from './db.js';
import { getSettings, saveSettings, LEVELS, makeCards, makeQuiz, makeExam, chatAnswer, listModels, quotaStatus, rankModels, listGroqModels, rankGroqChat } from './ai.js';
import { esc, md, toast, modal, confirmBox, promptBox, fmtDate, fmtDateLong, isoDay, busyHtml, download, speak, plain, relTime } from './ui.js';
import { setHeader, go, subjects, subjectMap, showAiError, aiErrorText, materialFor } from './core.js';
import { taskRow, bindTaskChecks } from './views-lesson.js';
import { PALETTES, FONTS, CORNERS, DEFAULT_THEME, applyTheme as applyThemeNow } from './theme.js';

// ---------------- Generatoren ----------------
export async function generateCards({ subjectId, recordingIds = [], scanIds = [], sheetIds = [], sourceId }) {
  const close = modal(`<h2>Karteikarten</h2>${busyHtml('Erstelle Karteikarten …')}`, { dismissable: false });
  try {
    const sub = await db.get('subjects', subjectId);
    const material = await materialFor({ recordingIds, scanIds, sheetIds });
    const res = await makeCards({ material, subject: sub?.name || '' });
    const now = Date.now();
    for (const c of res.cards || []) await db.put('cards', { id: uid(), subjectId, sourceId, front: c.front, back: c.back, box: 0, due: now, createdAt: now });
    close();
    toast(`${res.cards?.length || 0} Karteikarten erstellt`);
    go('#/karten/' + subjectId);
  } catch (e) { close(); showAiError(e); }
}

export async function generateQuiz({ subjectId, recordingIds = [], scanIds = [], sheetIds = [], sourceId, title }) {
  const close = modal(`<h2>Quiz</h2>${busyHtml('Denke mir Fragen aus …')}`, { dismissable: false });
  try {
    const sub = await db.get('subjects', subjectId);
    const material = await materialFor({ recordingIds, scanIds, sheetIds });
    const res = await makeQuiz({ material, subject: sub?.name || '' });
    const quiz = await db.put('quizzes', { id: uid(), subjectId, sourceId, title: title || 'Quiz', questions: (res.questions || []).filter(q => q.options?.length >= 2), createdAt: Date.now(), results: [] });
    close(); go('#/quiz/' + quiz.id);
  } catch (e) { close(); showAiError(e); }
}

export async function addTaskFromSuggestion(rec, h) {
  await db.put('tasks', { id: uid(), subjectId: rec.subjectId, title: h.title, details: h.details || '', due: h.due_date || '', kind: h.kind || 'Hausaufgabe', done: false, sourceId: rec.id, createdAt: Date.now() });
  toast('Im Kalender eingetragen');
}

// ---------------- Lernen-Übersicht ----------------
export async function viewLearn(el) {
  setHeader({ title: 'Lernen' });
  const [subs, cards, quizzes, exams, sheets] = await Promise.all([subjects(), db.all('cards'), db.all('quizzes'), db.all('exams'), db.all('sheets')]);
  const now = Date.now();
  const bySub = subs.map(s => ({ s, all: cards.filter(c => c.subjectId === s.id), due: cards.filter(c => c.subjectId === s.id && (c.due || 0) <= now) })).filter(x => x.all.length);
  const totalDue = bySub.reduce((n, x) => n + x.due.length, 0);
  const sm = Object.fromEntries(subs.map(s => [s.id, s]));
  el.innerHTML = `
    <div class="card" style="background:var(--accent);color:var(--accent-ink)">
      <h3>${totalDue ? `${totalDue} Karten sind heute dran` : 'Alles wiederholt! <svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>'}</h3>
      <p class="small" style="opacity:.9">Karteikarten kommen nach dem Lernkartei-Prinzip wieder: Was du kannst, siehst du seltener.</p>
      ${totalDue ? `<a class="btn block" style="background:var(--accent-ink);color:var(--accent);margin-top:8px" href="#/karten/alle">Jetzt lernen</a>` : ''}
    </div>
    <div class="action-grid">
      <a class="action" href="#/klausur"><div class="ico"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg></div><b>Klausurmodus</b><span>Übersicht & Probeklausur</span></a>
      <a class="action" href="#/chat"><div class="ico"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"/></svg></div><b>Fach-Chat</b><span>Fragen zum Stoff</span></a>
    </div>
    <div class="section-title"><h2>Karteikarten</h2></div>
    ${bySub.length ? `<div class="list">${bySub.map(x => `<a class="row" href="#/karten/${x.s.id}"><span class="dot" style="background:${x.s.color}"></span><div class="grow"><div class="title">${esc(x.s.name)}</div><div class="sub">${x.all.length} Karten · ${x.all.filter(c => c.box >= 4).length} sicher</div></div>${x.due.length ? `<span class="badge warn">${x.due.length} fällig</span>` : '<span class="badge ok"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>'}</a>`).join('')}</div>`
      : `<div class="card flat muted small">Noch keine Karteikarten. Öffne eine analysierte Stunde und tippe auf „<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v10"/></svg> Karteikarten“.</div>`}
    <div class="section-title"><h2>Quizze</h2></div>
    ${quizzes.length ? `<div class="list">${quizzes.sort((a, b) => b.createdAt - a.createdAt).slice(0, 12).map(q => { const best = Math.max(-1, ...(q.results || []).map(r => r.score)); return `<a class="row" href="#/quiz/${q.id}"><span class="dot" style="background:${sm[q.subjectId]?.color || '#999'}"></span><div class="grow"><div class="title">${esc(q.title)}</div><div class="sub">${q.questions.length} Fragen${best >= 0 ? ` · bestes Ergebnis ${best}/${q.questions.length}` : ''}</div></div><span class="chev">›</span></a>`; }).join('')}</div>` : `<div class="card flat muted small">Noch keine Quizze.</div>`}
    <div class="section-title"><h2>Klausurvorbereitungen</h2></div>
    ${exams.length ? `<div class="list">${exams.sort((a, b) => b.createdAt - a.createdAt).map(x => `<a class="row" href="#/pruefung/${x.id}"><span class="dot" style="background:${sm[x.subjectId]?.color || '#999'}"></span><div class="grow"><div class="title">${esc(x.content?.title || 'Klausur')}</div><div class="sub">${fmtDate(x.createdAt)}</div></div><span class="chev">›</span></a>`).join('')}</div>` : `<div class="card flat muted small">Noch keine.</div>`}
    <div class="section-title"><h2>Lernblätter</h2></div>
    ${sheets.length ? `<div class="list">${sheets.sort((a, b) => b.createdAt - a.createdAt).slice(0, 12).map(s => `<a class="row" href="#/blatt/${s.id}"><span class="dot" style="background:${sm[s.subjectId]?.color || '#999'}"></span><div class="grow"><div class="title">${esc(s.content?.title || 'Lernblatt')}</div><div class="sub">${esc(sm[s.subjectId]?.name || '')} · ${fmtDate(s.createdAt)}</div></div><span class="chev">›</span></a>`).join('')}</div>` : `<div class="card flat muted small">Noch keine.</div>`}`;
}

// ---------------- Karteikarten lernen ----------------
const INTERVALS = [0, 1, 2, 4, 8, 16, 32]; // Tage je Fach der Lernkartei
export async function viewCards(el, { id }) {
  const sub = id === 'alle' ? null : await db.get('subjects', id);
  setHeader({ title: sub ? `Karten · ${sub.name}` : 'Karteikarten', back: true, actions: sub ? `<button class="icon-btn" id="cardList" aria-label="Alle Karten"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/></svg></button>` : '' });
  const all = await db.where('cards', c => !sub || c.subjectId === sub.id);
  let queue = all.filter(c => (c.due || 0) <= Date.now()).sort(() => Math.random() - 0.5);
  if (sub) document.getElementById('cardList').onclick = () => cardManager(sub, all, () => viewCards(el, { id }));
  const total = queue.length; let doneN = 0;
  const next = () => {
    if (!queue.length) {
      el.innerHTML = `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg><h2>Geschafft!</h2><p>${total ? `Du hast ${total} Karten wiederholt.` : 'Gerade ist keine Karte fällig.'}</p>
        ${all.length ? `<button class="btn" id="extra">Trotzdem alle ${all.length} üben</button>` : ''}</div>`;
      el.querySelector('#extra')?.addEventListener('click', () => { queue = all.slice().sort(() => Math.random() - 0.5); next(); });
      return;
    }
    const c = queue[0];
    el.innerHTML = `
      <div class="progress"><i style="width:${total ? doneN / total * 100 : 0}%"></i></div>
      <p class="muted small" style="text-align:center;margin-top:8px">${queue.length} übrig · Fach ${Math.min(c.box || 0, 6) + 1} der Lernkartei</p>
      <div class="flash" id="fc"><div class="flash-inner">
        <div class="flash-face"><span class="lbl">Frage</span><div class="txt">${esc(c.front)}</div><p class="muted small" style="position:absolute;bottom:14px">Tippen zum Umdrehen</p></div>
        <div class="flash-face back"><span class="lbl">Antwort</span><div class="md">${md(c.back)}</div></div>
      </div></div>
      <div class="grade-row" id="grades" style="visibility:hidden">
        <button class="btn danger" data-g="0">Nochmal</button>
        <button class="btn" data-g="1">Schwer</button>
        <button class="btn olive" data-g="2">Gewusst</button>
      </div>
      <div style="text-align:center;margin-top:8px"><button class="btn ghost sm" id="say"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg> Vorlesen</button></div>`;
    const fc = el.querySelector('#fc');
    fc.onclick = () => { fc.classList.toggle('flipped'); el.querySelector('#grades').style.visibility = 'visible'; };
    el.querySelector('#say').onclick = () => speak(fc.classList.contains('flipped') ? plain(c.back) : c.front);
    el.querySelectorAll('[data-g]').forEach(b => b.onclick = async () => {
      const g = +b.dataset.g; const day = 86400000;
      if (g === 0) { c.box = 0; c.due = Date.now() + 60000; queue.push(queue.shift()); }
      else {
        if (g === 2) c.box = Math.min(6, (c.box || 0) + 1);
        c.due = Date.now() + Math.max(0.5, INTERVALS[c.box || 0] * (g === 1 ? 0.5 : 1)) * day;
        queue.shift(); doneN++;
      }
      c.reviews = (c.reviews || 0) + 1; await db.put('cards', c); next();
    });
  };
  next();
}

function cardManager(sub, cards, rerender) {
  modal(`<h2>${esc(sub.name)}: ${cards.length} Karten</h2>
    <button class="btn block" id="addCard" style="margin:10px 0">+ Karte selbst anlegen</button>
    <div class="list">${cards.map(c => `<div class="row" style="align-items:flex-start"><div class="grow"><div class="title" style="white-space:normal">${esc(c.front)}</div><div class="sub" style="white-space:normal">${esc(c.back)}</div></div><button class="btn ghost sm" data-del="${c.id}"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/></svg></button></div>`).join('')}</div>
    <div class="btn-row"><button class="btn" data-close>Fertig</button></div>`,
  { onMount: (m, close) => {
    m.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await db.del('cards', b.dataset.del); b.closest('.row').remove(); });
    m.querySelector('#addCard').onclick = async () => {
      close();
      const front = await promptBox('Vorderseite (Frage/Begriff)'); if (!front) return rerender();
      const back = await promptBox('Rückseite (Antwort)', '', { multiline: true }); if (!back) return rerender();
      await db.put('cards', { id: uid(), subjectId: sub.id, front, back, box: 0, due: Date.now(), createdAt: Date.now() });
      rerender();
    };
    m.addEventListener('click', e => { if (e.target.closest('[data-close]')) rerender(); });
  } });
}

// ---------------- Quiz ----------------
export async function viewQuiz(el, { id }) {
  const quiz = await db.get('quizzes', id);
  if (!quiz) return go('#/lernen');
  setHeader({ title: quiz.title, back: true });
  let i = 0, score = 0;
  const wrong = [];
  const step = () => {
    if (i >= quiz.questions.length) {
      quiz.results = [...(quiz.results || []), { score, at: Date.now() }]; db.put('quizzes', quiz);
      const pct = Math.round(score / quiz.questions.length * 100);
      el.innerHTML = `<div class="empty"><div class="big">${pct >= 80 ? '<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z"/></svg>' : pct >= 50 ? '<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>'}</div><h2>${score} von ${quiz.questions.length} richtig</h2><p>${pct >= 80 ? 'Stark!' : pct >= 50 ? 'Gut – schau dir die Fehler nochmal an.' : 'Dranbleiben – wiederhole die Stunde und versuch es nochmal.'}</p></div>
        ${wrong.length ? `<div class="card"><h3>Das solltest du wiederholen</h3>${wrong.map(q => `<p><b>${esc(q.q)}</b><br><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg> ${esc(q.options[q.correct])}<br><span class="muted small">${esc(q.explanation)}</span></p>`).join('')}
          <button class="btn block" id="toCards">Fehler als Karteikarten speichern</button></div>` : ''}
        <div class="btn-row"><button class="btn primary" id="again">Nochmal</button><a class="btn" href="#/lernen">Fertig</a></div>`;
      el.querySelector('#again').onclick = () => { i = 0; score = 0; wrong.length = 0; step(); };
      el.querySelector('#toCards')?.addEventListener('click', async (e) => {
        for (const q of wrong) await db.put('cards', { id: uid(), subjectId: quiz.subjectId, sourceId: quiz.sourceId, front: q.q, back: `${q.options[q.correct]} – ${q.explanation}`, box: 0, due: Date.now(), createdAt: Date.now() });
        toast(`${wrong.length} Karten angelegt`); e.target.disabled = true;
      });
      return;
    }
    const q = quiz.questions[i];
    el.innerHTML = `<div class="progress"><i style="width:${i / quiz.questions.length * 100}%"></i></div>
      <p class="muted small" style="margin-top:10px">Frage ${i + 1} von ${quiz.questions.length}</p>
      <h2 style="margin:6px 0 12px">${esc(q.q)}</h2>
      ${q.options.map((o, k) => `<button class="q-opt" data-k="${k}">${esc(o)}</button>`).join('')}
      <div id="ex"></div>`;
    el.querySelectorAll('.q-opt').forEach(b => b.onclick = () => {
      const k = +b.dataset.k; const ok = k === q.correct;
      if (ok) score++; else wrong.push(q);
      el.querySelectorAll('.q-opt').forEach(x => { x.disabled = true; if (+x.dataset.k === q.correct) x.classList.add('right'); });
      if (!ok) b.classList.add('wrong');
      el.querySelector('#ex').innerHTML = `<div class="notice">${ok ? '<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg> Richtig! ' : ' Leider falsch. '}${esc(q.explanation || '')}</div><button class="btn primary block" id="nx">Weiter</button>`;
      el.querySelector('#nx').onclick = () => { i++; step(); };
    });
  };
  step();
}

// ---------------- Klausurmodus ----------------
export async function viewExamSetup(el, params) {
  setHeader({ title: 'Klausurmodus', back: true });
  const subs = await subjects();
  let sid = params.fach || sessionStorage.getItem('lastSubject') || subs[0]?.id;
  const render = async () => {
    const [recs, scans, sheets] = await Promise.all([db.where('recordings', r => r.subjectId === sid && (r.analysis || r.chunks?.some(c => c.status === 'done'))), db.where('scans', s => s.subjectId === sid && s.text), db.where('sheets', s => s.subjectId === sid)]);
    recs.sort((a, b) => b.createdAt - a.createdAt);
    el.innerHTML = `
      <p class="muted small">Wähle das Fach und die Stunden, die in der Klausur drankommen. Du bekommst eine komplette Übersicht und eine Probeklausur mit Musterlösung.</p>
      <div class="chips" id="subChips">${subs.map(x => `<button class="chip ${x.id === sid ? 'on' : ''}" data-id="${x.id}"><span class="dot" style="background:${x.color}"></span>${esc(x.name)}</button>`).join('')}</div>
      <div class="section-title"><h2>Material</h2><button class="btn ghost sm" id="allBtn">Alle</button></div>
      ${recs.length + scans.length + sheets.length ? `<div class="list" id="srcs">
        ${recs.map(r => `<label class="row"><input type="checkbox" data-type="rec" value="${r.id}" checked> <div class="grow"><div class="title"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg> ${esc(r.title)}</div><div class="sub">${fmtDate(r.createdAt)}</div></div></label>`).join('')}
        ${scans.map(s => `<label class="row"><input type="checkbox" data-type="scan" value="${s.id}" checked> <div class="grow"><div class="title"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg> ${esc(s.title)}</div><div class="sub">${fmtDate(s.createdAt)}</div></div></label>`).join('')}
        ${sheets.map(s => `<label class="row"><input type="checkbox" data-type="sheet" value="${s.id}"> <div class="grow"><div class="title"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/></svg> ${esc(s.content?.title || 'Lernblatt')}</div><div class="sub">${fmtDate(s.createdAt)}</div></div></label>`).join('')}
      </div>` : `<div class="card flat muted small">In diesem Fach gibt es noch kein analysiertes Material.</div>`}
      <label class="field"><span>Thema der Klausur (optional)</span><input id="focus" type="text" placeholder="z. B. Analysis: Ableitungen und Kurvendiskussion"></label>
      <label class="field"><span>Dauer der Klausur</span><div class="seg" id="mins">${[45, 90, 135, 180].map(n => `<button data-n="${n}" class="${n === 90 ? 'on' : ''}">${n} Min.</button>`).join('')}</div></label>
      <div id="out"></div>
      <button class="btn primary block" id="go" ${recs.length + scans.length + sheets.length ? '' : 'disabled'}><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg> Vorbereitung erstellen</button>`;
    let minutes = 90;
    el.querySelectorAll('#subChips .chip').forEach(b => b.onclick = () => { sid = b.dataset.id; render(); });
    el.querySelectorAll('#mins button').forEach(b => b.onclick = () => { minutes = +b.dataset.n; el.querySelectorAll('#mins button').forEach(x => x.classList.toggle('on', x === b)); });
    el.querySelector('#allBtn').onclick = () => { const boxes = el.querySelectorAll('#srcs input'); const all = [...boxes].every(x => x.checked); boxes.forEach(x => x.checked = !all); };
    el.querySelector('#go').onclick = async () => {
      const pick = (t) => [...el.querySelectorAll(`#srcs input[data-type=${t}]:checked`)].map(x => x.value);
      const ids = { recordingIds: pick('rec'), scanIds: pick('scan'), sheetIds: pick('sheet') };
      if (!ids.recordingIds.length && !ids.scanIds.length && !ids.sheetIds.length) return toast('Wähle mindestens ein Material aus.');
      const out = el.querySelector('#out'); const btn = el.querySelector('#go'); btn.disabled = true;
      out.innerHTML = `<div class="card">${busyHtml('Stelle alles für die Klausur zusammen … (kann eine Minute dauern)')}</div>`;
      try {
        const sub = subs.find(s => s.id === sid);
        const material = await materialFor(ids);
        const content = await makeExam({ material, subject: sub?.name || '', focus: el.querySelector('#focus').value.trim(), minutes });
        const ex = await db.put('exams', { id: uid(), subjectId: sid, sources: ids, content, createdAt: Date.now() });
        go('#/pruefung/' + ex.id);
      } catch (e) { out.innerHTML = `<div class="notice warn">${esc(aiErrorText(e))}</div>`; btn.disabled = false; }
    };
  };
  render();
}

export async function viewExam(el, { id }) {
  const ex = await db.get('exams', id);
  if (!ex) return go('#/lernen');
  const c = ex.content || {};
  setHeader({ title: c.title || 'Klausur', back: true });
  const total = (c.tasks || []).reduce((n, t) => n + (t.points || 0), 0);
  let tab = 'ov';
  const render = () => {
    el.innerHTML = `<div class="tabs">${[['ov', 'Übersicht'], ['probe', `Probeklausur (${total} P.)`], ['tips', 'Tipps']].map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div><div id="b"></div>`;
    el.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { tab = b.dataset.t; render(); });
    const b = el.querySelector('#b');
    if (tab === 'ov') b.innerHTML = `<div class="card md">${md(c.overview_md)}</div>${(c.topics || []).map(t => `<details class="card"><summary>${esc(t.name)}</summary><div class="md">${md(t.points_md)}</div></details>`).join('')}
      <div class="btn-row"><button class="btn" id="cards"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v10"/></svg> Karteikarten dazu</button><button class="btn" id="quiz"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.3 2.4c-.6.2-.9.7-.9 1.3v.6"/><circle cx="12" cy="16.8" r=".9" fill="currentColor"/></svg> Quiz dazu</button></div>`;
    if (tab === 'probe') b.innerHTML = `<p class="muted small">Bearbeite die Aufgaben erst auf Papier, dann deckst du die Lösung auf.</p>` + (c.tasks || []).map((t, i) => `<div class="card"><div style="display:flex;justify-content:space-between;gap:8px"><b>Aufgabe ${i + 1}</b><span class="badge">${t.points} P. · ${esc(t.difficulty || '')}</span></div><div class="md">${md(t.task_md)}</div>
      <details style="margin-top:8px"><summary class="btn sm">Lösung zeigen</summary><div class="md" style="margin-top:8px">${md(t.solution_md)}</div></details></div>`).join('');
    if (tab === 'tips') b.innerHTML = `<div class="card md">${md(c.tips_md)}</div>`;
    b.querySelector('#cards')?.addEventListener('click', () => generateCards({ subjectId: ex.subjectId, ...ex.sources, sourceId: ex.id }));
    b.querySelector('#quiz')?.addEventListener('click', () => generateQuiz({ subjectId: ex.subjectId, ...ex.sources, sourceId: ex.id, title: c.title }));
  };
  render();
}

// ---------------- Kalender ----------------
export async function viewCalendar(el) {
  setHeader({ title: 'Kalender', actions: `<button class="icon-btn" id="addTask" aria-label="Aufgabe hinzufügen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>` });
  const subs = await subjectMap();
  let view = new Date(); view.setDate(1);
  let sel = isoDay();
  const render = async () => {
    const tasks = await db.all('tasks');
    const byDay = {};
    tasks.forEach(t => { if (t.due) (byDay[t.due] = byDay[t.due] || []).push(t); });
    const y = view.getFullYear(), mo = view.getMonth();
    const first = new Date(y, mo, 1); const offset = (first.getDay() + 6) % 7;
    const days = [];
    for (let k = 0; k < 42; k++) days.push(new Date(y, mo, 1 - offset + k));
    const today = isoDay();
    const dayTasks = (byDay[sel] || []).sort((a, b) => a.done - b.done);
    const upcoming = tasks.filter(t => !t.done && (!t.due || t.due >= today)).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
    const overdue = tasks.filter(t => !t.done && t.due && t.due < today);
    el.innerHTML = `
      <div class="card">
        <div class="cal-head"><button class="icon-btn" id="prev" aria-label="Voriger Monat">‹</button><h3>${first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</h3><button class="icon-btn" id="next" aria-label="Nächster Monat">›</button></div>
        <div class="cal">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(d => `<div class="dow">${d}</div>`).join('')}
          ${days.map(d => { const k = isoDay(d); const ts = byDay[k] || []; return `<button class="day ${d.getMonth() !== mo ? 'other' : ''} ${k === today ? 'today' : ''} ${k === sel ? 'sel' : ''}" data-d="${k}">${d.getDate()}<span class="marks">${ts.slice(0, 3).map(t => `<i style="background:${t.done ? 'var(--muted)' : (subs[t.subjectId]?.color || 'var(--accent)')}"></i>`).join('')}</span></button>`; }).join('')}
        </div>
      </div>
      <div class="section-title"><h2>${fmtDateLong(sel + 'T12:00')}</h2><button class="btn ghost sm" id="addHere">+ Eintrag</button></div>
      ${dayTasks.length ? `<div class="list">${dayTasks.map(t => taskItem(t, subs)).join('')}</div>` : `<div class="card flat muted small">Nichts eingetragen.</div>`}
      ${overdue.length ? `<div class="section-title"><h2 style="color:var(--danger)">Überfällig</h2></div><div class="list">${overdue.map(t => taskItem(t, subs)).join('')}</div>` : ''}
      <div class="section-title"><h2>Demnächst</h2></div>
      ${upcoming.length ? `<div class="list">${upcoming.slice(0, 20).map(t => taskItem(t, subs)).join('')}</div>` : `<div class="card flat muted small">Keine offenen Aufgaben.</div>`}`;
    el.querySelector('#prev').onclick = () => { view.setMonth(view.getMonth() - 1); render(); };
    el.querySelector('#next').onclick = () => { view.setMonth(view.getMonth() + 1); render(); };
    el.querySelectorAll('.day').forEach(b => b.onclick = () => { sel = b.dataset.d; render(); });
    el.querySelector('#addHere').onclick = () => editTask(null, sel, render);
    bindTaskChecks(el, render);
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => editTask(await db.get('tasks', b.dataset.edit), null, render));
  };
  document.getElementById('addTask').onclick = () => editTask(null, sel, render);
  render();
}
function taskItem(t, subs) {
  return taskRow(t, subs).replace('</div></div>', `</div></div>`).replace(/<\/div>$/, `<button class="btn ghost sm" data-edit="${t.id}" aria-label="Bearbeiten"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg></button></div>`);
}

async function editTask(task, day, done) {
  const subs = await subjects();
  modal(`<h2>${task ? 'Eintrag bearbeiten' : 'Neuer Eintrag'}</h2>
    <label class="field"><span>Was?</span><input id="tt" type="text" value="${esc(task?.title || '')}" placeholder="z. B. Buch S. 42 Nr. 3"></label>
    <label class="field"><span>Art</span><select id="tk">${['Hausaufgabe', 'Klausur', 'Test', 'Referat', 'Abgabe', 'Sonstiges'].map(k => `<option ${task?.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
    <label class="field"><span>Fach</span><select id="ts"><option value="">–</option>${subs.map(s => `<option value="${s.id}" ${task?.subjectId === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label class="field"><span>Bis wann?</span><input id="td" type="date" value="${esc(task?.due || day || '')}"></label>
    <label class="field"><span>Details</span><textarea id="tx">${esc(task?.details || '')}</textarea></label>
    <div class="btn-row">${task ? '<button class="btn danger" data-a="del">Löschen</button><button class="btn" data-a="ics"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/></svg> In iPhone-Kalender</button>' : ''}<button class="btn primary" data-a="save">Speichern</button></div>`,
  { onMount: (m, close) => m.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'del') { await db.del('tasks', task.id); close(); return done(); }
    if (a === 'ics') { download(icsFor(task, subs.find(s => s.id === task.subjectId)), `${task.title.slice(0, 40).replace(/[^\wäöüÄÖÜß -]/g, '') || 'Termin'}.ics`); return; }
    const title = m.querySelector('#tt').value.trim(); if (!title) return toast('Bitte einen Titel eingeben.');
    await db.put('tasks', { ...(task || { id: uid(), done: false, createdAt: Date.now() }), title, kind: m.querySelector('#tk').value, subjectId: m.querySelector('#ts').value, due: m.querySelector('#td').value, details: m.querySelector('#tx').value.trim() });
    close(); done();
  }) });
}
function icsFor(t, sub) {
  const d = (t.due || isoDay()).replace(/-/g, '');
  const next = new Date((t.due || isoDay()) + 'T12:00'); next.setDate(next.getDate() + 1);
  const d2 = isoDay(next).replace(/-/g, '');
  const escI = (s) => String(s || '').replace(/[\\;,]/g, m => '\\' + m).replace(/\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lernlauscher//DE', 'BEGIN:VEVENT', `UID:${t.id}@lernlauscher`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`,
    `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${d2}`, `SUMMARY:${escI((sub ? sub.name + ': ' : '') + t.title)}`, `DESCRIPTION:${escI((t.kind || '') + (t.details ? ' – ' + t.details : ''))}`,
    'BEGIN:VALARM', 'TRIGGER:-PT15H', 'ACTION:DISPLAY', `DESCRIPTION:${escI(t.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return new Blob([ics], { type: 'text/calendar' });
}

// ---------------- Chat ----------------
export async function viewChatPick(el) {
  setHeader({ title: 'Fach-Chat', back: true });
  const subs = await subjects();
  el.innerHTML = `<p class="muted small">Frag alles zu deinem Unterricht – die KI antwortet anhand deiner Aufnahmen, Scans und Lernblätter.</p>
    <div class="subject-grid">${subs.map(s => `<a class="subject-tile" style="--c:${s.color}" href="#/chat/${s.id}"><span class="name">${esc(s.name)}</span><span class="count"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"/></svg> Chat öffnen</span></a>`).join('')}</div>`;
}
export async function viewChat(el, { id }) {
  const sub = await db.get('subjects', id);
  if (!sub) return go('#/chat');
  setHeader({ title: `Chat · ${sub.name}`, back: true, actions: `<button class="icon-btn" id="clr" aria-label="Chat leeren"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/></svg></button>` });
  const chat = (await db.get('chats', id)) || { id, messages: [] };
  const [recs, scans, sheets] = await Promise.all([db.where('recordings', r => r.subjectId === id && r.analysis), db.where('scans', s => s.subjectId === id && s.text), db.where('sheets', s => s.subjectId === id)]);
  const n = recs.length + scans.length + sheets.length;
  const render = () => {
    el.innerHTML = `<div class="notice"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h13v15H6a2 2 0 0 0-2 2z"/><path d="M4 20a2 2 0 0 0 2 2h13v-4"/></svg> Ich kenne ${recs.length} Stunden, ${scans.length} Scans und ${sheets.length} Lernblätter aus ${esc(sub.name)}.</div>
      <div class="chat" id="msgs">${chat.messages.length ? '' : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4z"/></svg>Zum Beispiel: „Was war nochmal der Unterschied zwischen … ?“ oder „Was kommt wahrscheinlich in der Klausur dran?“</div>`}
      ${chat.messages.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}">${m.role === 'user' ? esc(m.text) : `<div class="md">${md(m.text)}</div>`}</div>`).join('')}</div>
      <div class="chat-input"><textarea id="q" rows="1" placeholder="Deine Frage …"></textarea><button class="btn primary" id="send" aria-label="Senden"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg></button></div>`;
    window.scrollTo(0, document.body.scrollHeight);
    const q = el.querySelector('#q');
    q.oninput = () => { q.style.height = 'auto'; q.style.height = Math.min(140, q.scrollHeight) + 'px'; };
    el.querySelector('#send').onclick = send;
  };
  const send = async () => {
    const q = el.querySelector('#q'); const text = q.value.trim(); if (!text) return;
    if (!n) toast('Noch kein Material in diesem Fach – ich antworte mit Allgemeinwissen.');
    chat.messages.push({ role: 'user', text, at: Date.now() }); render();
    const box = el.querySelector('#msgs'); box.insertAdjacentHTML('beforeend', `<div class="msg ai" id="typing">${busyHtml('Denke nach …')}</div>`);
    window.scrollTo(0, document.body.scrollHeight);
    try {
      const material = await materialFor({ recordingIds: recs.map(r => r.id), scanIds: scans.map(s => s.id), sheetIds: sheets.map(s => s.id) });
      const answer = await chatAnswer({ history: chat.messages.slice(-12), material: material || '(noch kein Material vorhanden)', subject: sub.name });
      chat.messages.push({ role: 'ai', text: answer, at: Date.now() });
      await db.put('chats', chat);
    } catch (e) { chat.messages.pop(); toast(aiErrorText(e), 5000); el.querySelector('#q') && (el.querySelector('#q').value = text); }
    render();
  };
  document.getElementById('clr').onclick = async () => { if (await confirmBox('Chatverlauf löschen?', { ok: 'Löschen', danger: true })) { chat.messages = []; await db.put('chats', chat); render(); } };
  render();
}

// ---------------- Einstellungen ----------------
export async function viewSettings(el) {
  setHeader({ title: 'Einstellungen', back: '#/' });
  const s = await getSettings();
  const look = { ...DEFAULT_THEME, mode: ['light', 'dark'].includes(s.theme) ? s.theme : 'auto', ...(s.look || {}) };
  const est = await storageEstimate();
  const q = await quotaStatus();
  el.innerHTML = `
    <div class="card">
      <h3>KI (Google Gemini, kostenlos)</h3>
      ${!s.apiKey ? `<ol class="small" style="padding-left:1.2em;margin:8px 0">
        <li>Öffne <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> und melde dich mit deinem Google-Konto an.</li>
        <li>Tippe auf <b>„API-Schlüssel erstellen“</b> (Create API key).</li>
        <li>Kopiere den Schlüssel und füge ihn hier ein.</li></ol>
        <p class="notice small">Gratis-Hinweis: Im kostenlosen Zugang darf Google Anfragen zum Verbessern seiner KI nutzen. Nimm darum nichts Privates auf, was nicht in den Unterricht gehört.</p>` : ''}
      <label class="field"><span>Gemini-API-Schlüssel</span><input id="key" type="password" autocomplete="off" value="${esc(s.apiKey)}" placeholder="AIza…"></label>
      <div class="btn-row"><button class="btn primary" id="saveKey">Speichern & testen</button></div>
      <div id="keyOut"></div>
      <label class="field"><span>KI-Modell</span><input id="model" type="text" list="models" value="${esc(s.model)}"><datalist id="models"><option value="auto"><option value="gemini-flash-latest"><option value="gemini-flash-lite-latest"></datalist></label>
      <p class="muted small">„auto“ (empfohlen): Die App nimmt das beste verfügbare Gratis-Modell. Ist eins überlastet oder im Limit, probiert sie es kurz nochmal und weicht dann auf ein anderes aus.</p>
    </div>
    <div class="card">
      <h3>Reserve-KI: Groq (kostenlos)</h3>
      <p class="muted small">Springt ein, wenn Google überlastet ist. Groq schreibt Aufnahmen sehr schnell mit (bis ca. 8 Std. Audio pro Tag gratis) und hilft bei Texten. Fotos/Scans kann nur Gemini lesen.</p>
      ${!s.groqKey ? `<ol class="small" style="padding-left:1.2em;margin:8px 0"><li>Öffne <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> und melde dich an (z. B. mit Google).</li><li>Tippe auf <b>„Create API Key“</b>, gib einen Namen ein und kopiere den Schlüssel.</li><li>Hier einfügen.</li></ol>` : ''}
      <label class="field"><span>Groq-API-Schlüssel</span><input id="gkey" type="password" autocomplete="off" value="${esc(s.groqKey)}" placeholder="gsk_…"></label>
      <div class="btn-row"><button class="btn primary" id="saveGroq">Speichern & testen</button></div>
      <div id="gOut"></div>
      <label class="field"><span>Aufnahmen mitschreiben mit</span><div class="seg" id="stt">${[['auto', 'Gemini, Groq als Reserve'], ['groq', 'Immer Groq (schneller)']].map(([k, l]) => `<button data-v="${k}" class="${s.stt === k ? 'on' : ''}">${l}</button>`).join('')}</div></label>
      <p class="muted small">Gemini erkennt Lehrkraft und Zwischenrufe direkt an den Stimmen. Bei Groq wird das danach anhand des Textes zugeordnet – etwas ungenauer, dafür schnell und zuverlässig.</p>
    </div>
    <div class="card">
      <h3>Limit</h3>
      <p class="small">Heute: <b>${q.used}</b> von ca. <b>${q.limit}</b> Anfragen · setzt sich um ca. ${new Date(q.resetAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr zurück.</p>
      <div class="progress"><i style="width:${Math.min(100, q.ratio * 100)}%"></i></div>
      <p class="muted small">Google zeigt die genauen Gratis-Limits in AI Studio unter „Rate limits“. Trag sie hier ein, damit die Warnungen stimmen.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <label class="field"><span>Anfragen pro Tag</span><input id="rpd" type="number" min="1" value="${s.rpd}"></label>
        <label class="field"><span>Anfragen pro Minute</span><input id="rpm" type="number" min="1" value="${s.rpm}"></label>
      </div>
      <label class="field"><span>Länge eines Aufnahme-Abschnitts</span><div class="seg" id="chunk">${[3, 5, 6].map(n => `<button data-n="${n}" class="${s.chunkMin === n ? 'on' : ''}">${n} Min.</button>`).join('')}</div></label>
      <p class="muted small">Eine 90-Minuten-Stunde mit 5-Minuten-Abschnitten braucht ca. 19 Anfragen.</p>
    </div>
    <div class="card">
      <h3>Über dich</h3>
      <label class="field"><span>Vorname (optional)</span><input id="name" type="text" value="${esc(s.name)}"></label>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
        <label class="field"><span>Klasse</span><select id="grade">${['5', '6', '7', '8', '9', '10', '11', '12', '13', 'Uni'].map(g => `<option ${s.grade === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
        <label class="field"><span>Schulform</span><select id="school">${['Gymnasium', 'Gesamtschule', 'Realschule', 'Berufsschule', 'Hochschule'].map(g => `<option ${s.school === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Standard-Erklärstufe</span><div class="seg" id="lvl">${Object.entries(LEVELS).map(([k, v]) => `<button data-l="${k}" class="${k === s.level ? 'on' : ''}">${v.label}</button>`).join('')}</div></label>
    </div>
    <div class="card">
      <h3>Aussehen</h3>
      <label class="field"><span>Farbthema</span>
        <div class="pal-grid" id="pals">${Object.entries(PALETTES).map(([k, p]) => `<button class="pal ${look.palette === k ? 'on' : ''}" data-p="${k}"><div class="sw">${[p.light[0], p.light[1], p.dark[1], p.light[7]].map(c => `<i style="background:${c}"></i>`).join('')}</div>${esc(p.name)}</button>`).join('')}</div></label>
      <div class="accent-row"><input type="color" id="accent" value="${/^#[0-9a-f]{6}$/i.test(look.accent) ? look.accent : PALETTES[look.palette]?.light[7] || '#1F6F5C'}" aria-label="Eigene Akzentfarbe"><div class="grow"><b class="small">Eigene Akzentfarbe</b><div class="muted small">${look.accent ? 'aktiv' : 'Farbe des Themas'}</div></div>${look.accent ? '<button class="btn sm" id="accReset">Zurücksetzen</button>' : ''}</div>
      <label class="field"><span>Hell / Dunkel</span><div class="seg" id="mode">${[['auto', 'Wie iPhone'], ['light', 'Hell'], ['dark', 'Dunkel']].map(([k, l]) => `<button data-v="${k}" class="${look.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div></label>
      <label class="field"><span>Schrift der Überschriften</span><div class="seg" id="font">${Object.entries(FONTS).map(([k, f]) => `<button data-v="${k}" class="${look.font === k ? 'on' : ''}" style="font-family:${f.css.replace(/"/g, "'")}">${f.name}</button>`).join('')}</div></label>
      <label class="field"><span>Ecken</span><div class="seg" id="corners">${Object.entries(CORNERS).map(([k, c]) => `<button data-v="${k}" class="${look.corners === k ? 'on' : ''}">${c.name}</button>`).join('')}</div></label>
      <a class="btn block" href="#/vorlagen" style="margin-top:10px"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.6-1-2.6 0-.9.7-1.6 1.7-1.6H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.1" fill="currentColor"/><circle cx="10.5" cy="7" r="1.1" fill="currentColor"/><circle cx="15" cy="7.5" r="1.1" fill="currentColor"/></svg> Lernblatt-Vorlagen</a>
    </div>
    <div class="card">
      <h3>Daten</h3>
      <p class="muted small">Alles liegt nur auf diesem Gerät${est ? ` (belegt: ${(est.usage / 1e6).toFixed(0)} MB)` : ''}. Mach ab und zu eine Sicherung.</p>
      <div class="btn-row"><button class="btn" id="exp">Sicherung (ohne Audio)</button><button class="btn" id="expA">Sicherung mit Audio</button></div>
      <label class="btn block">Sicherung laden<input id="imp" type="file" accept="application/json,.json" hidden></label>
      <button class="btn danger block" id="wipe" style="margin-top:10px">Alles löschen</button>
    </div>
    <p class="muted small" style="text-align:center">Lernlauscher · Aufnahmen nur mit Erlaubnis der Lehrkraft.</p>`;

  const num = (id, key) => el.querySelector(id).onchange = (e) => saveSettings({ [key]: Math.max(1, parseInt(e.target.value) || 1) });
  num('#rpd', 'rpd'); num('#rpm', 'rpm');
  el.querySelector('#model').onchange = (e) => saveSettings({ model: e.target.value.trim() || 'auto' });
  el.querySelectorAll('#stt button').forEach(b => b.onclick = () => { saveSettings({ stt: b.dataset.v }); el.querySelectorAll('#stt button').forEach(x => x.classList.toggle('on', x === b)); });
  el.querySelector('#saveGroq').onclick = async () => {
    const key = el.querySelector('#gkey').value.trim(); const out = el.querySelector('#gOut');
    if (!key) { await saveSettings({ groqKey: '' }); out.innerHTML = ''; return; }
    out.innerHTML = busyHtml('Teste den Groq-Schlüssel …');
    try {
      const ids = await listGroqModels(key);
      await saveSettings({ groqKey: key });
      const chat = rankGroqChat(ids)[0];
      out.innerHTML = `<div class="notice">Funktioniert. Spracherkennung: ${ids.some(i => /whisper/.test(i)) ? 'Whisper' : 'nicht verfügbar'} · Text: ${esc(chat || '–')}</div>`;
    } catch (e) { out.innerHTML = `<div class="notice warn">${esc(e.message)}</div>`; }
  };
  el.querySelector('#name').onchange = (e) => saveSettings({ name: e.target.value.trim() });
  el.querySelector('#grade').onchange = (e) => saveSettings({ grade: e.target.value });
  el.querySelector('#school').onchange = (e) => saveSettings({ school: e.target.value });
  el.querySelectorAll('#lvl button').forEach(b => b.onclick = () => { saveSettings({ level: b.dataset.l }); el.querySelectorAll('#lvl button').forEach(x => x.classList.toggle('on', x === b)); });
  el.querySelectorAll('#chunk button').forEach(b => b.onclick = () => { saveSettings({ chunkMin: +b.dataset.n }); el.querySelectorAll('#chunk button').forEach(x => x.classList.toggle('on', x === b)); });
  const setLook = async (patch, rerender = false) => {
    Object.assign(look, patch);
    await saveSettings({ look: { ...look } });
    if (rerender) { const y = window.scrollY; await viewSettings(el); window.scrollTo(0, y); }
  };
  el.querySelectorAll('#pals .pal').forEach(b => b.onclick = () => setLook({ palette: b.dataset.p, accent: '' }, true));
  const acc = el.querySelector('#accent');
  acc.oninput = () => { Object.assign(look, { accent: acc.value }); applyThemeNow(look); };
  acc.onchange = () => setLook({ accent: acc.value }, true);
  el.querySelector('#accReset')?.addEventListener('click', () => setLook({ accent: '' }, true));
  for (const key of ['mode', 'font', 'corners']) el.querySelectorAll(`#${key} button`).forEach(b => b.onclick = () => { setLook({ [key]: b.dataset.v }); el.querySelectorAll(`#${key} button`).forEach(x => x.classList.toggle('on', x === b)); });
  el.querySelector('#saveKey').onclick = async () => {
    const key = el.querySelector('#key').value.trim(); const out = el.querySelector('#keyOut');
    if (!key) { await saveSettings({ apiKey: '' }); out.innerHTML = ''; return; }
    out.innerHTML = busyHtml('Teste den Schlüssel …');
    try {
      const models = await listModels(key);
      await saveSettings({ apiKey: key });
      const dl = el.querySelector('#models'); dl.innerHTML = models.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
      let cur = (await getSettings()).model;
      let note = '';
      await kvSet('geminiModels', { at: Date.now(), ids: models.map(m => m.id) });
      if (cur === 'auto') { note = ` Automatische Auswahl, zuerst: „${esc(rankModels(models)[0] || '–')}“.`; }
      else if (!models.some(m => m.id === cur)) {
        const best = rankModels(models)[0];
        if (best) { await saveSettings({ model: best }); el.querySelector('#model').value = best; note = ` Modell automatisch auf „${esc(best)}“ gestellt.`; cur = best; }
      }
      out.innerHTML = `<div class="notice">Funktioniert. Verwendetes Modell: <b>${esc(cur)}</b>.${note}</div>`;
      requestPersistence();
    } catch (e) { out.innerHTML = `<div class="notice warn"> ${esc(e.message)}</div>`; }
  };
  const doExp = async (withAudio) => { toast('Sicherung wird erstellt …'); download(await exportAll({ withAudio }), `lernlauscher-sicherung-${isoDay()}.json`); };
  el.querySelector('#exp').onclick = () => doExp(false);
  el.querySelector('#expA').onclick = () => doExp(true);
  el.querySelector('#imp').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { await importAll(f); toast('Sicherung geladen'); } catch (err) { toast(err.message, 5000); }
  };
  el.querySelector('#wipe').onclick = async () => {
    if (!(await confirmBox('Wirklich ALLE Aufnahmen, Scans, Lernblätter, Karten und Einstellungen löschen? Das lässt sich nicht rückgängig machen.', { ok: 'Alles löschen', danger: true }))) return;
    for (const st of STORES) await db.clear(st);
    sessionStorage.clear(); location.hash = '#/'; location.reload();
  };
}
