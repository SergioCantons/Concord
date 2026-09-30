/* Escritura segura de un plan de exportacion sobre una abstraccion de E/S (carpeta real o memoria):
 * confirmacion de sobrescrituras, copia de seguridad de todo lo que se va a pisar y reversion ante fallos. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'));
  else { root.OAT = root.OAT || {}; root.OAT.writer = factory(root.OAT.util); }
})(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  const norm = (t) => String(t).replace(/\r\n/g, '\n');
  function stamp(d) {
    const p = (n) => String(n).padStart(2, '0');
    d = d || new Date();
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  /** io: { exists(path), read(path), write(path, text), remove(path) } con rutas relativas a la carpeta del proyecto. */
  async function applyPlan(files, io, opts) {
    opts = opts || {};
    // Nada se escribe fuera de la carpeta elegida ni en la carpeta de copias de seguridad.
    const unsafe = [];
    for (const [path] of files) {
      const n = U.normalizePath(path);
      if (!n || n !== path || /^[a-z]:/i.test(path) || /(^|\/)\.oat-backup(\/|$)/i.test(path)) unsafe.push(path);
    }
    if (unsafe.length) return { ok: false, error: 'Ruta no permitida (fuera de la carpeta del proyecto o reservada): ' + unsafe.join(', ') + '. No se ha modificado nada.', written: [], backups: [] };
    const conflicts = [];
    const toWrite = [];
    for (const [path, text] of files) {
      if (await io.exists(path)) {
        const cur = await io.read(path);
        if (norm(cur) === norm(text)) continue;
        conflicts.push(path);
      }
      toWrite.push([path, text]);
    }
    if (!toWrite.length) return { ok: true, written: [], backups: [], unchanged: true };
    if (conflicts.length) {
      const confirmed = opts.confirmOverwrite ? await opts.confirmOverwrite(conflicts) : false;
      if (!confirmed) return { ok: false, cancelled: true, written: [], backups: [] };
    }
    const backupDir = opts.backup === false ? null : '.oat-backup/' + stamp(opts.now);
    const backups = [];
    try {
      if (backupDir) for (const p of conflicts) { await io.write(backupDir + '/' + p, await io.read(p)); backups.push(backupDir + '/' + p); }
    } catch (e) {
      return { ok: false, error: 'No se pudo crear la copia de seguridad; no se ha modificado nada: ' + e.message, written: [], backups };
    }
    const done = [];
    try {
      for (const [path, text] of toWrite) {
        const prev = (await io.exists(path)) ? await io.read(path) : null;
        await io.write(path, text);
        done.push({ path, prev });
      }
    } catch (e) {
      const restoreErrors = [];
      for (const d of done.reverse()) {
        try { if (d.prev === null) await io.remove(d.path); else await io.write(d.path, d.prev); } catch (e2) { restoreErrors.push(d.path); }
      }
      return { ok: false, error: e.message, rolledBack: restoreErrors.length === 0, restoreErrors, written: [], backups, backupDir };
    }
    return { ok: true, written: done.map((d) => d.path), backups, backupDir, overwritten: conflicts };
  }

  /** E/S en memoria (pruebas) sobre un Map ruta -> texto. */
  function memoryIo(map, hooks) {
    return {
      exists: async (p) => map.has(p),
      read: async (p) => { if (!map.has(p)) throw new Error('No existe ' + p); return map.get(p); },
      write: async (p, t) => { if (hooks && hooks.beforeWrite) hooks.beforeWrite(p); map.set(p, t); },
      remove: async (p) => { map.delete(p); }
    };
  }

  return { applyPlan, memoryIo, stamp };
});
