// Scanner, Lernblätter, Vorlagen
import { db, uid, putBlob, getBlob, delBlob } from './db.js';
import { getSettings, LEVELS, makeSheet, makeDiagram, imagePart, styleFromImages, detectCorners } from './ai.js';
import { icon } from './icons.js';
import { esc, toast, modal, confirmBox, promptBox, fmtDate, busyHtml, shareOrDownload, speak, plain } from './ui.js';
import { setHeader, go, subjects, moreIcon, showAiError, aiErrorText, materialFor } from './core.js';
import { autoCorners, processScan, pagesToPdf, defaultCorners } from './scan.js';
import { BUILTIN_TEMPLATES, sheetHtml, templatePreviewCss, templatePreviewInner } from './sheet.js';
import { generateCards } from './views-learn.js';

const objUrls = new Set();
const blobUrl = async (key) => { const b = await getBlob(key); if (!b) return ''; const u = URL.createObjectURL(b); objUrls.add(u); return u; };
export function revokeAll() { objUrls.forEach(u => URL.revokeObjectURL(u)); objUrls.clear(); }

// ---------------- Scanner ----------------
export async function viewScanNew(el, params) {
  const subs = await subjects();
  const subjectId = params.fach || sessionStorage.getItem('lastSubject') || subs[0]?.id;
  const scan = { id: uid(), subjectId, title: `Scan ${fmtDate(Date.now(), { day: '2-digit', month: '2-digit' })}`, pages: [], createdAt: Date.now() };
  await db.put('scans', scan);
  history.replaceState(null, '', '#/scan/' + scan.id);
  return viewScan(el, { id: scan.id, fresh: true });
}

export async function viewScan(el, { id, fresh }) {
  let scan = await db.get('scans', id);
  if (!scan) return go('#/');
  const subs = await subjects();
  const sub = subs.find(s => s.id === scan.subjectId);
  setHeader({ title: scan.title, back: sub ? '#/fach/' + sub.id : '#/', actions: `<button class="icon-btn" id="scMenu" aria-label="Mehr">${moreIcon}</button>` });
  document.getElementById('scMenu').onclick = () => scanMenu(scan, () => viewScan(el, { id }));

  el.innerHTML = `
    <div class="chips" id="subChips" style="margin:4px 0 10px">${subs.map(x => `<button class="chip ${x.id === scan.subjectId ? 'on' : ''}" data-id="${x.id}"><span class="dot" style="background:${x.color}"></span>${esc(x.name)}</button>`).join('')}</div>
    <div class="btn-row">
      <label class="btn primary"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8a2 2 0 0 1 2-2h2l1.5-2h5L16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg> Foto aufnehmen<input id="camIn" type="file" accept="image/*" capture="environment" hidden></label>
      <label class="btn"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-9 8.5"/></svg> Aus Fotos<input id="libIn" type="file" accept="image/*" multiple hidden></label>
    </div>
    <p class="muted small">Tipp: Blatt auf einen dunklen Tisch legen. Die App findet die Ecken, zieht schräge Fotos gerade und macht die Schrift scharf. Tippe auf eine Seite, um die Ecken anzupassen.</p>
    <div id="busy"></div>
    <div class="scan-pages" id="pages"></div>
    <div id="scanActions"></div>
    ${scan.sheetIds?.length ? `<div class="section-title"><h2>Lernblätter aus diesem Scan</h2></div><div class="list">${(await Promise.all(scan.sheetIds.map(x => db.get('sheets', x)))).filter(Boolean).map(s => `<a class="row" href="#/blatt/${s.id}"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/></svg> <span class="grow title">${esc(s.content?.title || 'Lernblatt')}</span><span class="chev">›</span></a>`).join('')}</div>` : ''}`;

  el.querySelectorAll('#subChips .chip').forEach(b => b.onclick = async () => {
    scan.subjectId = b.dataset.id; await db.put('scans', scan);
    el.querySelectorAll('#subChips .chip').forEach(x => x.classList.toggle('on', x === b));
  });

  const renderPages = async () => {
    const box = el.querySelector('#pages');
    box.innerHTML = scan.pages.map((p, i) => `<button class="pg" data-i="${i}"><img alt="Seite ${i + 1}" data-key="${p.procKey || p.origKey}"><span class="n">${i + 1}</span></button>`).join('');
    box.querySelectorAll('img').forEach(async img => { img.src = await blobUrl(img.dataset.key); });
    box.querySelectorAll('.pg').forEach(b => b.onclick = () => editPage(scan, +b.dataset.i, async () => { scan = await db.get('scans', id); renderPages(); }));
    const acts = el.querySelector('#scanActions');
    acts.innerHTML = scan.pages.length ? `
      <div class="btn-row">
        <button class="btn primary" id="toSheet"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5M8.5 12h7M8.5 15.5h7M8.5 8.5h3"/></svg> Lernblatt erstellen</button>
        <button class="btn" id="toPdf"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg> Als PDF</button>
      </div>
      <div class="btn-row">
        <button class="btn" id="toCards"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v10"/></svg> Karteikarten</button>
        <button class="btn" id="aiCorners"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg> KI-Ecken für alle</button>
      </div>` : `<div class="empty"><svg class="ic big" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg>Noch keine Seiten. Fotografiere ein Blatt oder wähle mehrere Fotos aus.</div>`;
    acts.querySelector('#toPdf')?.addEventListener('click', async () => {
      const b = acts.querySelector('#toPdf'); b.disabled = true; b.textContent = 'Erstelle PDF …';
      try {
        const blobs = []; for (const p of scan.pages) blobs.push(await getBlob(p.procKey || p.origKey));
        const pdf = await pagesToPdf(blobs, scan.title);
        await shareOrDownload(pdf, `${scan.title.replace(/[^\wäöüÄÖÜß -]/g, '') || 'Scan'}.pdf`, scan.title);
      } catch (e) { toast(e.message || 'PDF fehlgeschlagen'); }
      b.disabled = false; b.textContent = '<svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/></svg> Als PDF';
    });
    acts.querySelector('#toSheet')?.addEventListener('click', () => openSheetCreator({ subjectId: scan.subjectId, source: { type: 'scan', id: scan.id } }));
    acts.querySelector('#toCards')?.addEventListener('click', async () => {
      if (!scan.text) return toast('Erstelle zuerst ein Lernblatt – dabei wird der Text der Seiten erkannt.', 4000);
      generateCards({ subjectId: scan.subjectId, scanIds: [scan.id], sourceId: scan.id });
    });
    acts.querySelector('#aiCorners')?.addEventListener('click', async () => {
      const busy = el.querySelector('#busy'); busy.innerHTML = busyHtml('KI sucht die Ecken …');
      try {
        const imgs = []; for (const p of scan.pages) imgs.push(await imagePart(await getBlob(p.origKey), 900));
        const res = await detectCorners({ images: imgs });
        for (const r of res.pages || []) {
          const p = scan.pages[r.index]; if (!p || !Array.isArray(r.corners) || r.corners.length !== 4) continue;
          p.corners = r.corners.map(c => [Math.min(1, Math.max(0, +c[0])), Math.min(1, Math.max(0, +c[1]))]);
          const proc = await processScan(await getBlob(p.origKey), p.corners, p.mode || 'magic');
          if (p.procKey) await delBlob(p.procKey);
          p.procKey = await putBlob(proc);
        }
        await db.put('scans', scan); busy.innerHTML = ''; renderPages(); toast('Ecken angepasst');
      } catch (e) { busy.innerHTML = ''; showAiError(e); }
    });
  };

  const addFiles = async (files) => {
    const busy = el.querySelector('#busy');
    let n = 0;
    for (const f of files) {
      n++; busy.innerHTML = busyHtml(`Seite ${n} von ${files.length} wird verbessert …`);
      try {
        const origKey = await putBlob(f);
        const corners = await autoCorners(f);
        const proc = await processScan(f, corners, 'magic');
        const procKey = await putBlob(proc);
        scan.pages.push({ origKey, procKey, corners, mode: 'magic' });
        await db.put('scans', scan);
      } catch (e) { toast('Ein Foto konnte nicht verarbeitet werden.'); }
    }
    busy.innerHTML = '';
    renderPages();
  };
  el.querySelector('#camIn').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  el.querySelector('#libIn').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  renderPages();
  if (fresh && !scan.pages.length) setTimeout(() => el.querySelector('#camIn')?.closest('label')?.focus(), 100);
}

function editPage(scan, i, done) {
  const p = scan.pages[i];
  let corners = (p.corners || defaultCorners()).map(c => c.slice());
  let mode = p.mode || 'magic';
  modal(`<h2>Seite ${i + 1}</h2>
    <p class="muted small">Ziehe die Punkte auf die Ecken des Blattes.</p>
    <div class="crop-wrap" id="cw"><canvas id="cv"></canvas><svg id="ov"></svg></div>
    <div class="seg" id="modes">${[['magic', 'Farbe'], ['bw', 'S/W'], ['board', 'Tafel'], ['original', 'Original']].map(([k, l]) => `<button data-m="${k}" class="${k === mode ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="btn-row" style="margin-top:12px">
      <button class="btn" data-a="full">Ganzes Bild</button>
      <button class="btn" data-a="auto">Auto</button>
    </div>
    <div class="btn-row">
      <button class="btn danger" data-a="del">Löschen</button>
      ${i > 0 ? '<button class="btn" data-a="left"> Nach vorn</button>' : ''}
      <button class="btn primary" data-a="ok">Übernehmen</button>
    </div>`,
  { onMount: async (m, close) => {
    const blob = await getBlob(p.origKey);
    const img = new Image(); const u = URL.createObjectURL(blob); img.src = u; await img.decode().catch(() => {});
    const cv = m.querySelector('#cv'); const sc = Math.min(1, 1200 / Math.max(img.width, img.height));
    cv.width = Math.round(img.width * sc); cv.height = Math.round(img.height * sc);
    cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
    URL.revokeObjectURL(u);
    const ov = m.querySelector('#ov'); ov.setAttribute('viewBox', `0 0 ${cv.width} ${cv.height}`);
    const draw = () => {
      const pts = corners.map(([x, y]) => [x * cv.width, y * cv.height]);
      const r = Math.max(14, cv.width / 34);
      ov.innerHTML = `<polygon points="${pts.map(q => q.join(',')).join(' ')}" fill="rgba(184,105,58,.18)" stroke="#B8693A" stroke-width="${r / 4}"/>` + pts.map((q, k) => `<circle class="handle" data-k="${k}" cx="${q[0]}" cy="${q[1]}" r="${r}"/>`).join('');
    };
    draw();
    let drag = -1;
    const pos = (e) => { const rc = ov.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return [Math.min(1, Math.max(0, (t.clientX - rc.left) / rc.width)), Math.min(1, Math.max(0, (t.clientY - rc.top) / rc.height))]; };
    const down = (e) => {
      const [x, y] = pos(e); let best = -1, bd = 1e9;
      corners.forEach(([cx, cy], k) => { const d = Math.hypot(cx - x, cy - y); if (d < bd) { bd = d; best = k; } });
      if (bd < 0.2) { drag = best; e.preventDefault(); }
    };
    const move = (e) => { if (drag < 0) return; corners[drag] = pos(e); draw(); e.preventDefault(); };
    const up = () => { drag = -1; };
    ov.addEventListener('pointerdown', down); window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', up);
    ov.addEventListener('touchstart', down, { passive: false }); ov.addEventListener('touchmove', move, { passive: false }); ov.addEventListener('touchend', up);
    m.querySelectorAll('#modes button').forEach(b => b.onclick = () => { mode = b.dataset.m; m.querySelectorAll('#modes button').forEach(x => x.classList.toggle('on', x === b)); });
    m.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
      if (a === 'full') { corners = [[0, 0], [1, 0], [1, 1], [0, 1]]; draw(); return; }
      if (a === 'auto') { corners = await autoCorners(blob); draw(); return; }
      if (a === 'del') {
        await delBlob(p.origKey); if (p.procKey) await delBlob(p.procKey);
        scan.pages.splice(i, 1); await db.put('scans', scan);
      }
      if (a === 'left') { [scan.pages[i - 1], scan.pages[i]] = [scan.pages[i], scan.pages[i - 1]]; await db.put('scans', scan); }
      if (a === 'ok') {
        e.target.closest('button').textContent = 'Wird verbessert …';
        const proc = await processScan(blob, corners, mode);
        if (p.procKey) await delBlob(p.procKey);
        p.procKey = await putBlob(proc); p.corners = corners; p.mode = mode;
        await db.put('scans', scan);
      }
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      close(); done();
    });
  } });
}

function scanMenu(scan, rerender) {
  modal(`<h2 style="margin-bottom:10px">${esc(scan.title)}</h2><div class="list">
    <button class="row" data-a="title"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg> <span class="grow">Titel ändern</span></button>
    <button class="row" data-a="del" style="color:var(--danger)"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/></svg> <span class="grow">Scan löschen</span></button></div>
    <div class="btn-row"><button class="btn" data-close>Schließen</button></div>`,
  { onMount: (m, close) => m.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; close();
    if (a === 'title') { const t = await promptBox('Titel', scan.title); if (t) { scan.title = t; await db.put('scans', scan); rerender(); } }
    if (a === 'del') {
      if (!(await confirmBox('Scan mit allen Seiten endgültig löschen?', { ok: 'Löschen', danger: true }))) return;
      for (const p of scan.pages) { await delBlob(p.origKey); if (p.procKey) await delBlob(p.procKey); }
      await db.del('scans', scan.id); go('#/fach/' + scan.subjectId);
    }
  }) });
}

// ---------------- Lernblatt erstellen ----------------
export async function allTemplates() {
  const custom = await db.all('templates');
  return [...BUILTIN_TEMPLATES, ...custom.sort((a, b) => b.createdAt - a.createdAt)];
}

export async function openSheetCreator({ subjectId, source }) {
  const [s, tpls] = await Promise.all([getSettings(), allTemplates()]);
  let level = s.level, tplId = sessionStorage.getItem('lastTpl') || tpls[0].id;
  if (!tpls.find(t => t.id === tplId)) tplId = tpls[0].id;
  modal(`<h2>Lernblatt erstellen</h2>
    <label class="field"><span>Vorlage</span><div class="chips" id="tpls">${tpls.map(t => `<button class="chip ${t.id === tplId ? 'on' : ''}" data-t="${t.id}">${esc(t.name)}</button>`).join('')}<a class="chip" href="#/vorlagen" data-close>+ Eigene</a></div></label>
    <label class="field"><span>Niveau</span><div class="seg" id="lvl">${Object.entries(LEVELS).map(([k, v]) => `<button data-l="${k}" class="${k === level ? 'on' : ''}">${v.label}</button>`).join('')}</div></label>
    <label class="field"><span>Schwerpunkt (optional)</span><input id="focus" type="text" placeholder="z. B. nur die Formeln, oder: für die Klausur am Freitag"></label>
    <div id="out"></div>
    <div class="btn-row"><button class="btn" data-close>Abbrechen</button><button class="btn primary" id="go">Erstellen</button></div>`,
  { onMount: (m, close) => {
    m.querySelectorAll('#tpls [data-t]').forEach(b => b.onclick = () => { tplId = b.dataset.t; m.querySelectorAll('#tpls [data-t]').forEach(x => x.classList.toggle('on', x === b)); });
    m.querySelectorAll('#lvl button').forEach(b => b.onclick = () => { level = b.dataset.l; m.querySelectorAll('#lvl button').forEach(x => x.classList.toggle('on', x === b)); });
    m.querySelector('#go').onclick = async () => {
      const btn = m.querySelector('#go'); btn.disabled = true;
      const out = m.querySelector('#out');
      out.innerHTML = busyHtml(source.type === 'scan' ? 'Lese die Seiten und gestalte das Lernblatt …' : 'Gestalte das Lernblatt …');
      sessionStorage.setItem('lastTpl', tplId);
      try {
        const sub = await db.get('subjects', subjectId);
        const tpl = tpls.find(t => t.id === tplId);
        let content;
        if (source.type === 'scan') {
          const scan = await db.get('scans', source.id);
          const imgs = []; for (const p of scan.pages.slice(0, 16)) imgs.push(await imagePart(await getBlob(p.procKey || p.origKey), 1600));
          content = await makeSheet({ images: imgs, subject: sub?.name || '', level, styleHint: tpl?.description, focus: m.querySelector('#focus').value.trim(), fromScan: true, colors: tplColors(tpl) });
          if (content.source_text) scan.text = content.source_text;
          scan.sheetIds = [...(scan.sheetIds || []), null];
          const sheet = await saveSheet(content, { subjectId, tplId, source, level });
          scan.sheetIds[scan.sheetIds.length - 1] = sheet.id; await db.put('scans', scan);
          close(); go('#/blatt/' + sheet.id);
        } else {
          const ids = source.type === 'recording' ? { recordingIds: [source.id] } : source.ids;
          const material = await materialFor(ids);
          content = await makeSheet({ material, subject: sub?.name || '', level, styleHint: tpl?.description, focus: m.querySelector('#focus').value.trim(), colors: tplColors(tpl) });
          const sheet = await saveSheet(content, { subjectId, tplId, source, level });
          close(); go('#/blatt/' + sheet.id);
        }
      } catch (e) { out.innerHTML = `<div class="notice warn">${esc(aiErrorText(e))}</div>`; btn.disabled = false; }
    };
  } });
}
const tplColors = (tpl) => ({ accent: tpl?.style?.accent, accent2: tpl?.style?.accent2, ink: tpl?.style?.ink });
async function saveSheet(content, { subjectId, tplId, source, level }) {
  delete content.source_text;
  return db.put('sheets', { id: uid(), subjectId, templateId: tplId, source, level, content, createdAt: Date.now() });
}

// ---------------- Lernblatt ansehen ----------------
export async function viewSheet(el, { id }) {
  const sheet = await db.get('sheets', id);
  if (!sheet) return go('#/');
  const [sub, tpls] = await Promise.all([db.get('subjects', sheet.subjectId), allTemplates()]);
  setHeader({ title: sheet.content?.title || 'Lernblatt', back: true, actions: `<button class="icon-btn" id="shMenu" aria-label="Mehr">${moreIcon}</button>` });
  const tpl = () => tpls.find(t => t.id === sheet.templateId) || tpls[0];
  const html = () => sheetHtml(sheet.content, tpl(), { subject: sub?.name || '', date: fmtDate(sheet.createdAt) });
  el.innerHTML = `
    <div class="chips" id="tpls" style="margin:4px 0">${tpls.map(t => `<button class="chip ${t.id === sheet.templateId ? 'on' : ''}" data-t="${t.id}">${esc(t.name)}</button>`).join('')}</div>
    <div class="sheet-frame"><iframe id="sf" title="Lernblatt" sandbox="allow-same-origin allow-modals"></iframe></div>
    <div class="btn-row">
      <button class="btn primary" id="print"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9V3h10v6"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v7H7z"/></svg> Drucken / PDF</button>
      <button class="btn" id="share"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7.5 7.5L12 3l4.5 4.5"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg> Teilen</button>
    </div>
    <div class="btn-row">
      <button class="btn" id="read"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg> Vorlesen</button>
      <button class="btn" id="cards"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7" width="14" height="12" rx="2"/><path d="M7 4h12a2 2 0 0 1 2 2v10"/></svg> Karteikarten</button>
    </div>
    <div class="btn-row">
      <button class="btn" id="addDia">${icon('image')} Schaubild zeichnen lassen</button>
    </div>`;
  const frame = el.querySelector('#sf');
  const render = () => {
    frame.srcdoc = html();
    frame.onload = () => { try { frame.style.height = (frame.contentDocument.documentElement.scrollHeight + 4) + 'px'; } catch {} };
  };
  render();
  el.querySelectorAll('#tpls [data-t]').forEach(b => b.onclick = async () => {
    sheet.templateId = b.dataset.t; await db.put('sheets', sheet);
    el.querySelectorAll('#tpls [data-t]').forEach(x => x.classList.toggle('on', x === b)); render();
  });
  el.querySelector('#print').onclick = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch { const w = window.open('', '_blank'); w.document.write(html()); w.document.close(); setTimeout(() => w.print(), 400); }
  };
  el.querySelector('#share').onclick = () => shareOrDownload(new Blob([html()], { type: 'text/html' }), `${(sheet.content?.title || 'Lernblatt').replace(/[^\wäöüÄÖÜß -]/g, '')}.html`, sheet.content?.title);
  el.querySelector('#read').onclick = () => speak(plain([sheet.content?.title, ...(sheet.content?.sections || []).map(s => `${s.heading}. ${s.body_md}`)].join('\n')));
  el.querySelector('#cards').onclick = () => generateCards({ subjectId: sheet.subjectId, sheetIds: [sheet.id], sourceId: sheet.id });
  el.querySelector('#addDia').onclick = async () => {
    const topic = await promptBox('Was soll das Schaubild zeigen?', '', { ok: 'Zeichnen', placeholder: 'z. B. Ablauf der Photosynthese als Kreislauf' });
    if (!topic) return;
    const close = modal(`<h2>Schaubild</h2>${busyHtml('Zeichne das Schaubild …')}`, { dismissable: false });
    try {
      const material = (sheet.content?.sections || []).filter(x => x.type !== 'diagramm').map(x => `${x.heading}: ${x.body_md}`).join('\n');
      const d = await makeDiagram({ material, topic, subject: sub?.name || '', colors: tplColors(tpl()) });
      sheet.content.sections.push({ type: 'diagramm', heading: d.heading || topic, body_md: d.body_md || '', svg: d.svg || '' });
      await db.put('sheets', sheet); close(); render();
      setTimeout(() => frame.scrollIntoView({ block: 'end', behavior: 'smooth' }), 400);
    } catch (e) { close(); showAiError(e); }
  };
  document.getElementById('shMenu').onclick = () => modal(`<h2 style="margin-bottom:10px">Lernblatt</h2><div class="list">
      <button class="row" data-a="title"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg> <span class="grow">Titel ändern</span></button>
      <button class="row" data-a="del" style="color:var(--danger)"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6.5 7l1 13h9l1-13"/></svg> <span class="grow">Lernblatt löschen</span></button></div>
      <div class="btn-row"><button class="btn" data-close>Schließen</button></div>`,
    { onMount: (m, close) => m.addEventListener('click', async (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return; close();
      if (a === 'title') { const t = await promptBox('Titel', sheet.content.title); if (t) { sheet.content.title = t; await db.put('sheets', sheet); viewSheet(el, { id }); } }
      if (a === 'del') { if (await confirmBox('Lernblatt löschen?', { ok: 'Löschen', danger: true })) { await db.del('sheets', id); history.back(); } }
    }) });
}

// ---------------- Vorlagen ----------------
export async function viewTemplates(el) {
  setHeader({ title: 'Vorlagen', back: true });
  const tpls = await allTemplates();
  el.innerHTML = `
    <p class="muted small">So sehen deine Lernblätter aus. Eigene Vorlagen: Lade Fotos von Blättern hoch, die dir gefallen – die KI übernimmt Farben, Schrift und Aufbau.</p>
    <button class="btn primary block" id="newTpl">+ Eigene Vorlage aus Bildern</button>
    <div class="subject-grid" style="margin-top:12px">${tpls.map(t => `<button class="action" data-t="${t.id}" style="padding:10px"><div class="tpl-preview" style="${templatePreviewCss(t)}">${templatePreviewInner(t)}</div><b>${esc(t.name)}</b><span>${esc(t.description || '')}</span></button>`).join('')}</div>`;
  el.querySelector('#newTpl').onclick = () => templateEditor(null, () => viewTemplates(el));
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { const t = tpls.find(x => x.id === b.dataset.t); templateEditor(t, () => viewTemplates(el)); });
}

function templateEditor(tpl, done) {
  const isNew = !tpl;
  const builtin = tpl?.builtin;
  let st = { ...(tpl?.style || BUILTIN_TEMPLATES[0].style) };
  let files = [];
  const sample = { title: 'Beispiel-Lernblatt', subtitle: 'So sieht deine Vorlage aus', sections: [
    { type: 'definition', heading: 'Photosynthese', body_md: 'Prozess, bei dem Pflanzen aus **Licht**, Wasser und CO₂ Glukose und Sauerstoff herstellen.' },
    { type: 'formel', heading: 'Gesamtgleichung', body_md: '6 CO₂ + 6 H₂O → C₆H₁₂O₆ + 6 O₂' },
    { type: 'merke', heading: 'Merke', body_md: 'Ohne Licht keine Photosynthese!' },
    { type: 'schritte', heading: 'Ablauf', body_md: '1. Lichtreaktion\n2. Calvin-Zyklus' }] };
  modal(`<h2>${isNew ? 'Neue Vorlage' : esc(tpl.name)}</h2>
    ${isNew ? `<label class="field"><span>1. Beispielbilder (Fotos von Lernblättern, Heftseiten, Designs, die dir gefallen)</span><label class="btn block"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 16l-5-5-9 8.5"/></svg> Bilder auswählen<input id="imgs" type="file" accept="image/*" multiple hidden></label><div id="thumbs" class="scan-pages"></div></label>
    <label class="field"><span>2. Beschreibe kurz, wie es aussehen soll</span><textarea id="desc" placeholder="z. B. Pastellfarben, Merksätze in gelben Kästen, zweispaltig, wenig Text"></textarea></label>
    <button class="btn olive block" id="analyze"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg> Stil von der KI übernehmen</button>` : ''}
    <div id="out"></div>
    <label class="field"><span>Name</span><input id="tn" type="text" value="${esc(tpl?.name || 'Meine Vorlage')}" ${builtin ? 'disabled' : ''}></label>
    <div class="action-grid" style="grid-template-columns:repeat(2,1fr)">
      <label class="field" style="margin:0"><span>Akzentfarbe</span><input type="color" id="c1" value="${st.accent}" style="width:100%;height:42px;border:0;background:none" ${builtin ? 'disabled' : ''}></label>
      <label class="field" style="margin:0"><span>Zweitfarbe</span><input type="color" id="c2" value="${st.accent2}" style="width:100%;height:42px;border:0;background:none" ${builtin ? 'disabled' : ''}></label>
      <label class="field" style="margin:0"><span>Papier</span><select id="paper" ${builtin ? 'disabled' : ''}>${[['plain', 'Glatt'], ['grid', 'Kariert'], ['lines', 'Liniert'], ['dots', 'Punkte']].map(([k, l]) => `<option value="${k}" ${st.paper === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" style="margin:0"><span>Schrift</span><select id="font" ${builtin ? 'disabled' : ''}>${[['serif', 'Klassisch'], ['sans', 'Modern'], ['rounded', 'Rund'], ['hand', 'Handschrift'], ['mono', 'Technisch']].map(([k, l]) => `<option value="${k}" ${st.headingFont === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" style="margin:0"><span>Kästen</span><select id="box" ${builtin ? 'disabled' : ''}>${[['filled', 'Gefüllt'], ['outlined', 'Umrandet'], ['leftbar', 'Seitenstrich'], ['shadow', 'Schatten'], ['sticky', 'Klebezettel']].map(([k, l]) => `<option value="${k}" ${st.boxStyle === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" style="margin:0"><span>Spalten</span><select id="cols" ${builtin ? 'disabled' : ''}><option value="1" ${st.columns !== 2 ? 'selected' : ''}>1</option><option value="2" ${st.columns === 2 ? 'selected' : ''}>2</option></select></label>
    </div>
    <div class="sheet-frame" style="margin-top:12px"><iframe id="pv" title="Vorschau" sandbox="allow-same-origin" style="min-height:420px"></iframe></div>
    <div class="btn-row">${!isNew && !builtin ? '<button class="btn danger" data-a="del">Löschen</button>' : ''}<button class="btn" data-close>${builtin ? 'Schließen' : 'Abbrechen'}</button>${builtin ? '' : '<button class="btn primary" data-a="save">Speichern</button>'}</div>`,
  { onMount: (m, close) => {
    const pv = m.querySelector('#pv');
    const preview = () => { pv.srcdoc = sheetHtml(sample, { style: st }, { subject: 'Biologie', date: fmtDate(Date.now()) }); };
    const bind = (sel, key, conv = (v) => v) => { const x = m.querySelector(sel); if (x) x.oninput = () => { st[key] = conv(x.value); preview(); }; };
    bind('#c1', 'accent'); bind('#c2', 'accent2'); bind('#paper', 'paper'); bind('#font', 'headingFont'); bind('#box', 'boxStyle'); bind('#cols', 'columns', Number);
    preview();
    m.querySelector('#imgs')?.addEventListener('change', async (e) => {
      files = [...e.target.files].slice(0, 6);
      const th = m.querySelector('#thumbs'); th.innerHTML = '';
      for (const f of files) { const u = URL.createObjectURL(f); objUrls.add(u); th.insertAdjacentHTML('beforeend', `<div class="pg"><img src="${u}" alt=""></div>`); }
    });
    m.querySelector('#analyze')?.addEventListener('click', async () => {
      const out = m.querySelector('#out');
      if (!files.length && !m.querySelector('#desc').value.trim()) return toast('Wähle Bilder aus oder beschreibe den Stil.');
      out.innerHTML = busyHtml('Die KI schaut sich deine Beispiele an …');
      try {
        const imgs = []; for (const f of files) imgs.push(await imagePart(f, 1200));
        const res = await styleFromImages({ images: imgs, description: m.querySelector('#desc').value.trim() });
        st = { ...st, ...res };
        if (![1, 2].includes(st.columns)) st.columns = 1;
        m.querySelector('#c1').value = /^#[0-9a-f]{6}$/i.test(st.accent) ? st.accent : '#B8693A';
        m.querySelector('#c2').value = /^#[0-9a-f]{6}$/i.test(st.accent2) ? st.accent2 : '#7D8B5A';
        m.querySelector('#paper').value = st.paper; m.querySelector('#font').value = st.headingFont; m.querySelector('#box').value = st.boxStyle; m.querySelector('#cols').value = String(st.columns);
        if (res.name) m.querySelector('#tn').value = res.name;
        m.dataset.desc = res.description || '';
        out.innerHTML = `<div class="notice"><svg class="ic " viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg> ${esc(res.description || 'Stil übernommen.')} Du kannst unten noch nachjustieren.</div>`;
        preview();
      } catch (e) { out.innerHTML = `<div class="notice warn">${esc(aiErrorText(e))}</div>`; }
    });
    m.querySelector('[data-a=save]')?.addEventListener('click', async () => {
      const exampleKeys = []; for (const f of files) exampleKeys.push(await putBlob(f));
      const desc = m.dataset.desc || m.querySelector('#desc')?.value.trim() || tpl?.description || '';
      await db.put('templates', { ...(tpl || { id: uid(), createdAt: Date.now(), exampleKeys }), name: m.querySelector('#tn').value.trim() || 'Meine Vorlage', description: desc, style: st });
      toast('Vorlage gespeichert'); close(); done();
    });
    m.querySelector('[data-a=del]')?.addEventListener('click', async () => {
      if (!(await confirmBox('Vorlage löschen?', { ok: 'Löschen', danger: true }))) return;
      for (const k of tpl.exampleKeys || []) await delBlob(k);
      await db.del('templates', tpl.id); close(); done();
    });
  } });
}
