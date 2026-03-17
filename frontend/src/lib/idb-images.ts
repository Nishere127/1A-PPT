/**
 * 出图结果存本机 IndexedDB（体积大，localStorage 易爆）
 */

const IDB_NAME = "1a-agent-images-v1";
const IDB_STORE = "kv";
const KEY_LIST = "imageList";

export interface StoredImageItem {
  id: string;
  prompt: string;
  imageBase64: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(IDB_NAME, 1);
    r.onerror = () => reject(r.error);
    r.onsuccess = () => resolve(r.result);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(IDB_STORE)) {
        r.result.createObjectStore(IDB_STORE);
      }
    };
  });
}

export async function loadImageListFromIdb(): Promise<StoredImageItem[]> {
  if (typeof indexedDB === "undefined") return [];
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(KEY_LIST);
      req.onsuccess = () => {
        const v = req.result;
        if (typeof v !== "string") {
          resolve([]);
          return;
        }
        try {
          const arr = JSON.parse(v) as unknown;
          if (!Array.isArray(arr)) {
            resolve([]);
            return;
          }
          resolve(
            arr.filter(
              (x): x is StoredImageItem =>
                !!x &&
                typeof x === "object" &&
                typeof (x as StoredImageItem).id === "string" &&
                typeof (x as StoredImageItem).prompt === "string" &&
                typeof (x as StoredImageItem).imageBase64 === "string"
            )
          );
        } catch {
          resolve([]);
        }
      };
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function saveImageListToIdb(
  items: StoredImageItem[]
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(JSON.stringify(items), KEY_LIST);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearImageListIdb(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(KEY_LIST);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}
