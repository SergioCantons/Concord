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
  const hasFilePicker = typeof window.showOpenFilePicker === 'function';

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
  /**
   * Lee lo soltado con arrastrar y soltar. Con entradas del sistema de ficheros (webkitGetAsEntry) se recorren
   * también carpetas conservando las rutas relativas; si no hay entradas, se usan los ficheros tal cual.
   */
  async function readDropped(entries, fileList) {
    if (!entries || !entries.length) return readFileList(fileList || []);
    const files = new Map();
    const skipped = [];
    const fileOf = (entry) => new Promise((res, rej) => entry.file(res, rej));
    const readBatch = (reader) => new Promise((res, rej) => reader.readEntries(res, rej));
    async function walk(entry, prefix) {
      if (entry.isDirectory) {
        if (SKIP_DIR.test(entry.name)) return;
        const reader = entry.createReader();
        for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
          for (const child of batch) await walk(child, prefix + entry.name + '/');
        }
        return;
      }
      if (!YAML_RE.test(entry.name)) return;
      const f = await fileOf(entry);
      if (f.size > MAX_BYTES) { skipped.push(prefix + entry.name + ' (más de 8 MB)'); return; }
      files.set(prefix + entry.name, await f.text());
    }
    // Una única carpeta soltada es el proyecto: sus rutas empiezan dentro de ella, como al abrir una carpeta.
    const single = entries.length === 1 && entries[0].isDirectory ? entries[0] : null;
    if (single) {
      const reader = single.createReader();
      for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
        for (const child of batch) await walk(child, '');
      }
    } else {
      for (const entry of entries) await walk(entry, '');
    }
    return { files, skipped, folderName: single ? single.name : '' };
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
  /** Lee ficheros a partir de sus identificadores (File System Access); se conservan para poder reabrirlos desde recientes. */
  async function readFileHandles(handles) {
    const files = new Map();
    const skipped = [];
    for (const fh of handles) {
      if (!YAML_RE.test(fh.name)) continue;
      const f = await fh.getFile();
      if (f.size > MAX_BYTES) { skipped.push(fh.name + ' (más de 8 MB)'); continue; }
      files.set(fh.name, await f.text());
    }
    return { files, skipped, fileHandles: handles, folderName: '' };
  }
  async function openLooseFiles() {
    if (!hasFilePicker) return pickViaInput(false);
    let handles;
    try {
      handles = await window.showOpenFilePicker({ multiple: true, id: 'oat-files', types: [{ description: 'Contratos OpenAPI (YAML/JSON)', accept: { 'text/yaml': ['.yaml', '.yml'], 'application/json': ['.json'] } }] });
    } catch (e) { if (e && e.name === 'AbortError') return null; throw e; }
    return readFileHandles(handles);
  }

  /** Detecta que ficheros parecen ser raices OpenAPI (contienen una clave openapi/swagger de primer nivel). */
  function detectRoots(files) {
    const out = [];
    for (const [p, t] of files) if (!p.startsWith('.concord/') && /^\s*(["']?)(openapi|swagger)\1\s*:/m.test(t.slice(0, 4000))) out.push(p);
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

  /* ---------- Recientes (IndexedDB, guardan identificadores de carpeta o de ficheros, no el contenido) ---------- */
  const MAX_RECENTS = 8;
  function idb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('IndexedDB no disponible')); return; }
      const r = indexedDB.open('oat-recents', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('recents', { keyPath: 'id' });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  /** Los registros antiguos no tienen `kind`: siempre eran carpetas. */
  const recentKind = (rec) => rec.kind || 'folder';
  const recentHandles = (rec) => (recentKind(rec) === 'files' ? rec.handles || [] : [rec.handle]);
  async function sameEntry(a, b) { try { return !!a && !!b && await a.isSameEntry(b); } catch (e) { return false; } }
  async function sameRecent(rec, entry) {
    if (recentKind(rec) !== recentKind(entry) || rec.rootFile !== entry.rootFile) return false;
    const a = recentHandles(rec); const b = recentHandles(entry);
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!(await sameEntry(a[i], b[i]))) return false;
    return true;
  }
  /**
   * Registra un contrato reciente: `{ kind: 'folder', handle }` o `{ kind: 'files', handles }`, más `rootFile` y `name`.
   * Si ya existía se actualiza su fecha; se conservan los MAX_RECENTS más recientes.
   */
  async function addRecent(entry) {
    const handles = entry && recentHandles(entry);
    if (!handles || !handles.length || handles.some((x) => !x)) return;
    try {
      const db = await idb();
      let same = null;
      for (const r of await listRecents()) if (await sameRecent(r, entry)) { same = r; break; }
      const rec = { id: same ? same.id : 'r' + Date.now(), kind: recentKind(entry), name: entry.name, rootFile: entry.rootFile, ts: Date.now() };
      if (rec.kind === 'files') rec.handles = entry.handles; else rec.handle = entry.handle;
      await new Promise((res, rej) => { const tx = db.transaction('recents', 'readwrite'); tx.objectStore('recents').put(rec); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
      for (const r of (await listRecents()).slice(MAX_RECENTS)) await removeRecent(r.id);
    } catch (e) { /* los recientes son opcionales */ }
  }
  async function listRecents() {
    try {
      const db = await idb();
      return await new Promise((res, rej) => { const q = db.transaction('recents').objectStore('recents').getAll(); q.onsuccess = () => res((q.result || []).sort((a, b) => b.ts - a.ts)); q.onerror = () => rej(q.error); });
    } catch (e) { return []; }
  }
  function storeOp(fn) {
    return idb().then((db) => new Promise((res, rej) => { const tx = db.transaction('recents', 'readwrite'); fn(tx.objectStore('recents')); tx.oncomplete = res; tx.onerror = () => rej(tx.error); })).catch(() => { /* los recientes son opcionales */ });
  }
  function removeRecent(id) { return storeOp((s) => s.delete(id)); }
  function clearRecents() { return storeOp((s) => s.clear()); }
  /** Las carpetas se abren con escritura (para guardar en ellas); los ficheros sueltos solo se leen. */
  const permMode = (rec) => (recentKind(rec) === 'files' ? 'read' : 'readwrite');
  /** Estado del permiso de un reciente: 'granted' | 'prompt' | 'denied'. */
  async function recentPermission(rec) {
    try {
      const states = [];
      for (const hd of recentHandles(rec)) states.push(await hd.queryPermission({ mode: permMode(rec) }));
      return states.includes('denied') ? 'denied' : states.every((s) => s === 'granted') ? 'granted' : 'prompt';
    } catch (e) { return 'denied'; }
  }
  async function openRecent(rec, onProgress) {
    const mode = permMode(rec);
    for (const hd of recentHandles(rec)) {
      let perm = await hd.queryPermission({ mode });
      if (perm !== 'granted') perm = await hd.requestPermission({ mode });
      if (perm !== 'granted') throw new Error('Permiso denegado para "' + hd.name + '".');
    }
    try {
      if (recentKind(rec) === 'files') return await readFileHandles(rec.handles);
      const r = await readDirHandle(rec.handle, onProgress);
      return Object.assign(r, { handle: rec.handle, folderName: rec.handle.name });
    } catch (e) {
      if (e && e.name === 'NotFoundError') { await removeRecent(rec.id); throw new Error('"' + rec.name + '" ya no existe o se ha movido; se ha quitado de recientes.'); }
      throw e;
    }
  }

  /* ---------- Recuperacion local opcional (solo si el usuario la activa) ---------- */
  const REC_KEY = 'oat.recovery.v1';
  function saveRecovery(project) {
    try {
      const files = {}; project.files.forEach((f, p) => { files[p] = f.text; }); project.extras.forEach((t, p) => { files[p] = t; });
      localStorage.setItem(REC_KEY, JSON.stringify({ name: project.name, root: project.rootFile, ts: Date.now(), files }));
      return true;
    } catch (e) { return false; }
  }
  function loadRecovery() { try { const v = localStorage.getItem(REC_KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function clearRecovery() { try { localStorage.removeItem(REC_KEY); } catch (e) { /* ignore */ } }

  O.fileio = { hasFsAccess, hasFilePicker, safePath, openFolder, openLooseFiles, readFileList, readDropped, detectRoots, dirIo, download, downloadText, downloadZip, addRecent, listRecents, removeRecent, recentPermission, openRecent, clearRecents, recentKind, saveRecovery, loadRecovery, clearRecovery };
})();
