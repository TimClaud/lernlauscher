// IndexedDB – alles bleibt auf dem Gerät
const DB_NAME = 'lernlauscher';
const DB_VERSION = 1;
export const STORES = ['subjects', 'recordings', 'blobs', 'scans', 'sheets', 'templates', 'cards', 'tasks', 'chats', 'exams', 'quizzes', 'kv'];

let dbp = null;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: s === 'kv' ? 'key' : 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Speichern abgebrochen (Speicher voll?)'));
  }));
}

export const db = {
  get: (store, id) => tx(store, 'readonly', s => s.get(id)),
  all: (store) => tx(store, 'readonly', s => s.getAll()).then(r => r || []),
  put: (store, obj) => tx(store, 'readwrite', s => s.put(obj)).then(() => obj),
  del: (store, id) => tx(store, 'readwrite', s => s.delete(id)),
  clear: (store) => tx(store, 'readwrite', s => s.clear()),
  async where(store, pred) { return (await this.all(store)).filter(pred); },
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export async function putBlob(blob, key = uid()) {
  await db.put('blobs', { id: key, blob, type: blob.type, size: blob.size });
  return key;
}
export async function getBlob(key) {
  const r = await db.get('blobs', key);
  return r ? r.blob : null;
}
export const delBlob = (key) => db.del('blobs', key);

export async function kvGet(key, fallback = null) {
  const r = await db.get('kv', key);
  return r ? r.value : fallback;
}
export const kvSet = (key, value) => db.put('kv', { key, value });

export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch {}
  return false;
}
export async function storageEstimate() {
  try { if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate(); } catch {}
  return null;
}

// Backup: alles in eine Datei (Audio optional)
const toB64 = (blob) => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
export async function exportAll({ withAudio }) {
  const out = { app: 'lernlauscher', version: 1, exportedAt: new Date().toISOString(), data: {} };
  for (const s of STORES) {
    if (s === 'blobs') continue;
    out.data[s] = await db.all(s);
  }
  const blobs = await db.all('blobs');
  out.data.blobs = [];
  for (const b of blobs) {
    if (!withAudio && (b.type || '').startsWith('audio')) continue;
    out.data.blobs.push({ id: b.id, type: b.type, data: await toB64(b.blob) });
  }
  return new Blob([JSON.stringify(out)], { type: 'application/json' });
}
export async function importAll(file) {
  const json = JSON.parse(await file.text());
  if (json.app !== 'lernlauscher') throw new Error('Das ist keine Lernlauscher-Sicherung.');
  for (const s of STORES) {
    const rows = json.data[s];
    if (!rows) continue;
    for (const r of rows) {
      if (s === 'blobs') {
        const blob = await (await fetch(r.data)).blob();
        await db.put('blobs', { id: r.id, blob, type: r.type, size: blob.size });
      } else await db.put(s, r);
    }
  }
}
