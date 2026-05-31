// Minimal promise wrapper over IndexedDB — the local store for saved documents.
//
// Two object stores:
//   documents  (keyPath 'id')   — { id, name, design, updatedAt }
//   kv         (out-of-line)    — small misc state: 'currentDocId', 'userPresets',
//                                  and the one-time 'lsMigrated' flag.
//
// Designs can carry base64 image data-URLs, which quickly blow localStorage's
// ~5 MB; IndexedDB gives us multi-MB headroom and async, non-blocking writes.

const DB_NAME = 'hazardLabelStudio';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // Let a failed open be retried on the next call instead of caching the rejection.
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

// Run `fn(store)` inside a transaction and resolve with the request's result
// once the transaction commits (so reads are settled and writes are durable).
function run(storeName, mode, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const req = fn(t.objectStore(storeName));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
  }));
}

export const idb = {
  getDoc: (id) => run('documents', 'readonly', s => s.get(id)),
  getAllDocs: () => run('documents', 'readonly', s => s.getAll()),
  putDoc: (doc) => run('documents', 'readwrite', s => s.put(doc)),
  delDoc: (id) => run('documents', 'readwrite', s => s.delete(id)),
  kvGet: (key) => run('kv', 'readonly', s => s.get(key)),
  kvSet: (key, value) => run('kv', 'readwrite', s => s.put(value, key)),
};
