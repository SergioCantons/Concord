/* Entrada/salida local: File System Access (carpeta), respaldo con <input>, ZIP, recientes (IndexedDB) y recuperacion opcional. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const U = O.util;
  const YAML_RE = /\.(ya?ml|json)$/i;
  const SKIP_DIR = /^(node_modules|\.git|\.oat-backup|\.svn|\.idea|\.vscode)$/i;
  const MAX_BYTES = 8 * 1024 * 1024;
  const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

  const hasFsAccess = typeof window.showDirectoryPicker === 'function';

  /** Comprueba que una ruta relativa no escapa de la carpeta elegida y es valida en Windows. */
  function safePath(p) {
    const n = U.normalizePath(p);
    if (!n) throw new Error('Ruta no permitida (fuera de la carpeta del proyecto): ' + p);
    for (const seg of n.split('/')) {
      if (/[<>:"|?*\u0000-\u001f]/.test(seg) || RESERVED.test(seg) || /[. ]$/.test(seg)) throw new Error('Nombre de fichero no válido en Windows: ' + seg);
    }
    return n;
  }

  /* ---------- Lectura ---------- */
  async function readDirHandle(dirHandle, onProgress) {
    const files = new Map();
    const skipped = [];
    async function walk(dir, prefix) {
      for await (const [name, handle] of dir.entries()) {
        if (handle.kind === 'directory') { if (!SKIP_DIR.test(name)) await walk(handle, prefix + name + '/'); }
        else if (YAML_RE.test(name)) {
          const f = await handle.getFile();
          if (f.size > MAX_BYTES) { skipped.push(prefix + name + ' (más de 8 MB)'); continue; }
          files.set(prefix + name, await f.text());
          if (onProgress) onProgress(files.size);
        }
      }
    }
    await walk(dirHandle, '');
    return { files, skipped };
  }
  async function readFileList(fileList) {
    const files = new Map();
    const skipped = [];
    const arr = Array.from(fileList);
    const withRel = arr.some((f) => f.webkitRelativePath);
    for (const f of arr) {
      if (!YAML_RE.test(f.name)) continue;
      let p = withRel && f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name;
      if (!p) p = f.name;
      if (p.split('/').some((s) => SKIP_DIR.test(s))) continue;
      if (f.size > MAX_BYTES) { skipped.push(p + ' (más de 8 MB)'); continue; }
      files.set(p, await f.text());
    }
    return { files, skipped, folderName: withRel && arr[0] ? arr[0].webkitRelativePath.split('/')[0] : '' };
  }
  function pickViaInput(directory) {
    return new Promise((resolve) => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.multiple = true; inp.style.display = 'none';
      if (directory) inp.setAttribute('webkitdirectory', '');
      else inp.accept = '.yaml,.yml,.json';
      let done = false;
      inp.addEventListener('change', async () => { done = true; const r = inp.files.length ? await readFileList(inp.files) : null; inp.remove(); resolve(r); });
      window.addEventListener('focus', () => setTimeout(() => { if (!done) { inp.remove(); resolve(null); } }, 800), { once: true });
      document.body.appendChild(inp);
      inp.click();
    });
  }

  /** Abre una carpeta con permiso de escritura si el navegador lo permite. */
  async function openFolder(onProgress) {
    if (hasFsAccess) {
      let handle;
      try { handle = await window.showDirectoryPicker({ mode: 'readwrite', id: 'oat-project' }); } catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
      const r = await readDirHandle(handle, onProgress);
      return Object.assign(r, { handle, folderName: handle.name });
    }
    return pickViaInput(true);
  }
  function openLooseFiles() { return pickViaInput(false); }

  /** Detecta que ficheros parecen ser raices OpenAPI (contienen una clave openapi/swagger de primer nivel). */
  function detectRoots(files) {
    const out = [];
    for (const [p, t] of files) if (/^\s*(["']?)(openapi|swagger)\1\s*:/m.test(t.slice(0, 4000))) out.push(p);
    return out.sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  }

  /* ---------- Escritura ---------- */
  function dirIo(root) {
    async function dirOf(path, create) {
      const parts = safePath(path).split('/');
      const name = parts.pop();
      let dir = root;
      for (const seg of parts) dir = await dir.getDirectoryHandle(seg, { create });
      return { dir, name };
    }
    return {
      async exists(p) { try { const { dir, name } = await dirOf(p, false); await dir.getFileHandle(name); return true; } catch (e) { return false; } },
      async read(p) { const { dir, name } = await dirOf(p, false); return (await (await dir.getFileHandle(name)).getFile()).text(); },
      async write(p, text) {
        const { dir, name } = await dirOf(p, true);
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        try { await w.write(text); await w.close(); } catch (e) { try { await w.abort(); } catch (e2) { /* ignore */ } throw e; }
      },
      async remove(p) { const { dir, name } = await dirOf(p, false); await dir.removeEntry(name); }
    };
  }

  /* ---------- Descargas y ZIP ---------- */
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function downloadText(name, text, type) { download(name, new Blob([text], { type: type || 'text/plain;charset=utf-8' })); }
  function downloadZip(name, files) {
    const { fflate } = O.vendor;
    const obj = {};
    for (const [p, t] of files) obj[safePath(p)] = fflate.strToU8(t);
    const data = fflate.zipSync(obj, { level: 6 });
    download(name, new Blob([data], { type: 'application/zip' }));
  }

  /* ---------- Recientes (IndexedDB, guardan el identificador de carpeta, no el contenido) ---------- */
  function idb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB no disponible')); return; }
      const r = indexedDB.open('oat-recents', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('recents', { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function addRecent(handle, rootFile, name) {
    if (!handle) return;
    try {
      const db = await idb();
      const all = await listRecents();
      const same = all.find((x) => x.handle && x.rootFile === rootFile && x.name === name);
      const rec = { id: same ? same.id : 'r' + Date.now(), name, rootFile, handle, ts: Date.now() };
      await new Promise((res, rej) => { const tx = db.transaction('recents', 'readwrite'); tx.objectStore('recents').put(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      const rest = (await listRecents()).sort((a, b) => b.ts - a.ts).slice(8);
      for (const r of rest) await removeRecent(r.id);
    } catch (e) { /* los recientes son opcionales */ }
  }
  async function listRecents() {
    try {
      const db = await idb();
      return await new Promise((res, rej) => { const q = db.transaction('recents').objectStore('recents').getAll(); q.onsuccess = () => res((q.result || []).sort((a, b) => b.ts - a.ts)); q.onerror = () => rej(q.error); });
    } catch (e) { return []; }
  }
  async function removeRecent(id) {
    try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('recents', 'readwrite'); tx.objectStore('recents').delete(id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (e) { /* ignore */ }
  }
  /** Estado del permiso de una carpeta reciente: 'granted' | 'prompt' | 'denied'. */
  async function recentPermission(rec) {
    try { return await rec.handle.queryPermission({ mode: 'readwrite' }); } catch (e) { return 'denied'; }
  }
  async function openRecent(rec, onProgress) {
    let perm = await recentPermission(rec);
    if (perm !== 'granted') perm = await rec.handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('Permiso denegado para la carpeta "' + rec.name + '".');
    const r = await readDirHandle(rec.handle, onProgress);
    return Object.assign(r, { handle: rec.handle, folderName: rec.handle.name });
  }

  /* ---------- Recuperacion local opcional (solo si el usuario la activa) ---------- */
  const REC_KEY = 'oat.recovery.v1';
  function saveRecovery(project) {
    try {
      const files = {}; project.files.forEach((f, p) => { files[p] = f.text; });
      localStorage.setItem(REC_KEY, JSON.stringify({ name: project.name, root: project.rootFile, ts: Date.now(), files }));
      return true;
    } catch (e) { return false; }
  }
  function loadRecovery() { try { const v = localStorage.getItem(REC_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function clearRecovery() { try { localStorage.removeItem(REC_KEY); } catch (e) { /* ignore */ } }

  O.fileio = { hasFsAccess, safePath, openFolder, openLooseFiles, readFileList, detectRoots, dirIo, download, downloadText, downloadZip, addRecent, listRecents, removeRecent, recentPermission, openRecent, saveRecovery, loadRecovery, clearRecovery };
})();
