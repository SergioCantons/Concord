/* Utilidades comunes: punteros JSON, rutas POSIX, comparacion profunda. Sin dependencias. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.OAT = root.OAT || {}; root.OAT.util = factory(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

  function escPtr(s) { return String(s).replace(/~/g, '~0').replace(/\//g, '~1'); }
  function unescPtr(s) { return String(s).replace(/~1/g, '/').replace(/~0/g, '~'); }
  function toPtr(segs) { return segs.length ? '/' + segs.map(escPtr).join('/') : ''; }
  function fromPtr(ptr) {
    if (!ptr) return [];
    return ptr.replace(/^\//, '').split('/').map((s) => {
      let d = s;
      try { d = decodeURIComponent(s); } catch (e) { /* ya decodificado */ }
      return unescPtr(d);
    });
  }

  function normalizeSlashes(p) { return String(p).replace(/\\/g, '/'); }

  /** Normaliza una ruta relativa; devuelve null si escapa del directorio raiz. */
  function normalizePath(p) {
    const parts = normalizeSlashes(p).split('/');
    const out = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') { if (!out.length) return null; out.pop(); } else out.push(part);
    }
    return out.join('/');
  }
  function dirname(p) { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); }
  function basename(p) { const i = p.lastIndexOf('/'); return i < 0 ? p : p.slice(i + 1); }
  function joinPath(dir, rel) { return normalizePath((dir ? dir + '/' : '') + rel); }
  function relativePath(fromDir, to) {
    const a = fromDir ? fromDir.split('/') : [];
    const b = to.split('/');
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
    const up = a.slice(i).map(() => '..');
    const rel = up.concat(b.slice(i)).join('/');
    return up.length ? rel : './' + rel;
  }
  function encodeRefPath(p) { return p.replace(/[ %#?\[\]]/g, (c) => encodeURIComponent(c)); }
  function decodeRefPath(p) { try { return decodeURIComponent(p); } catch (e) { return p; } }

  function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  function stableStringify(v) {
    if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
    if (isObj(v)) return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  function deepEqual(a, b) { return stableStringify(a) === stableStringify(b); }

  function fmtPath(segs) {
    if (!segs.length) return '(raiz)';
    return segs.map((s, i) => {
      if (typeof s === 'number') return '[' + s + ']';
      if (/^[A-Za-z_$][\w$-]*$/.test(s)) return (i ? '.' : '') + s;
      return '[' + JSON.stringify(s) + ']';
    }).join('');
  }

  function slug(s) {
    return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\{([^}]+)\}/g, '$1').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'raiz';
  }

  function debounce(fn, ms) {
    let t = null;
    const d = function () { const args = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, args), ms); };
    d.flush = function () { clearTimeout(t); };
    return d;
  }

  return {
    HTTP_METHODS, escPtr, unescPtr, toPtr, fromPtr, normalizePath, dirname, basename, joinPath, relativePath,
    encodeRefPath, decodeRefPath, isObj, clone, stableStringify, deepEqual, fmtPath, slug, debounce
  };
});
