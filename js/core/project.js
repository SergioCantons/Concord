/* Proyecto OpenAPI: conjunto de ficheros YAML (un Document por fichero), resolucion fisica de $ref,
 * edicion sobre el AST (conserva comentarios, claves x-* y desconocidas) e historial deshacer/rehacer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./vendor.js'));
  else { root.OAT = root.OAT || {}; root.OAT.project = factory(root.OAT.util, root.OAT.vendor); }
})(typeof self !== 'undefined' ? self : this, function (U, vendor) {
  'use strict';
  const YAML = vendor.YAML;
  const { isMap, isSeq, isScalar, isPair, isAlias } = YAML;

  const COMPONENT_TYPES = ['schemas', 'responses', 'parameters', 'examples', 'requestBodies', 'headers', 'securitySchemes', 'links', 'callbacks'];
  const NAME_MAPS = new Set(['properties', 'patternProperties', 'schemas', 'responses', 'parameters', 'requestBodies', 'headers', 'examples',
    'links', 'callbacks', 'securitySchemes', 'paths', 'content', 'encoding', 'mapping', 'variables', 'definitions', 'scopes', 'webhooks']);

  /** Contexto para distinguir claves de esquema OpenAPI de nombres definidos por el usuario. */
  function rootCtx() { return { names: false, parent: '', exObj: false }; }
  function childCtx(key, ctx) {
    if (ctx.names) return { names: false, parent: key, exObj: ctx.parent === 'examples' };
    return { names: NAME_MAPS.has(key), parent: key, exObj: false };
  }
  function skipKey(key, ctx) {
    if (ctx.names) return false;
    return key === 'example' || key === 'default' || key === 'enum' || key === 'const' || String(key).startsWith('x-') || (ctx.exObj && key === 'value');
  }

  function keyOf(pair) { const k = pair.key; return isScalar(k) ? k.value : k; }
  function findPair(map, key) {
    const s = String(key);
    for (const it of map.items) if (isPair(it) && String(keyOf(it)) === s) return it;
    return null;
  }
  function refOf(node) {
    if (!isMap(node)) return null;
    const p = findPair(node, '$ref');
    if (!p || !isScalar(p.value) || typeof p.value.value !== 'string') return null;
    return p.value.value;
  }

  function parseText(text) {
    const lc = new YAML.LineCounter();
    const doc = YAML.parseDocument(text, { lineCounter: lc, uniqueKeys: true, prettyErrors: true });
    const conv = (e, severity) => {
      const lp = e.linePos && e.linePos[0];
      return { severity, message: String(e.message).split('\n')[0].replace(/ at line \d+, column \d+:?$/, ''), code: e.code, line: lp ? lp.line : 1, col: lp ? lp.col : 1 };
    };
    return { doc, lc, errors: doc.errors.map((e) => conv(e, 'error')).concat(doc.warnings.map((e) => conv(e, 'warning'))) };
  }
  function stringifyDoc(doc, eol) {
    const s = doc.toString({ lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false });
    return eol === '\r\n' ? s.replace(/\r?\n/g, '\r\n') : s;
  }
  const CONFIG_DIR = '.concord/';
  const isExtraPath = (p) => typeof p === 'string' && p.startsWith(CONFIG_DIR);
  function detectEol(text) { return /\r\n/.test(text) ? '\r\n' : '\n'; }

  class Project {
    constructor() {
      this.files = new Map();
      this.rootFile = null;
      this.name = 'contrato';
      this.original = new Map();
      this.past = [];
      this.future = [];
      this.version = 0;
      this.listeners = new Set();
      this._cache = {};
      this.lowerIndex = new Map();
      // Ficheros de configuración de la herramienta (.concord/...): viajan con el contrato pero no forman parte de él.
      this.extras = new Map();
      this.extrasOriginal = new Map();
    }

    static fromFiles(files, rootFile, name) {
      const p = new Project();
      const entries = files instanceof Map ? Array.from(files.entries()) : Object.entries(files);
      for (const [path, text] of entries) { if (isExtraPath(path)) p.extras.set(path, text); else p._setFile(path, text); }
      p.rootFile = rootFile || (p.files.has('openapi.yaml') ? 'openapi.yaml' : p.files.size ? p.files.keys().next().value : null);
      p.name = name || (p.rootFile ? U.basename(p.rootFile).replace(/\.(ya?ml|json)$/i, '') : 'contrato');
      p.original = p._texts();
      p.extrasOriginal = new Map(p.extras);
      return p;
    }

    static newEmpty() {
      return Project.fromFiles({ 'openapi.yaml': Project.TEMPLATE }, 'openapi.yaml', 'contrato-nuevo');
    }

    onChange(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }
    _bump() { this.version++; this._cache = {}; this.listeners.forEach((cb) => cb()); }

    _setFile(path, text) {
      const parsed = parseText(text);
      this.files.set(path, { path, text, doc: parsed.doc, lc: parsed.lc, errors: parsed.errors, draft: null, eol: detectEol(text) });
      this.lowerIndex.set(path.toLowerCase(), path);
    }
    file(path) { return this.files.get(path); }
    _texts() { const m = new Map(); this.files.forEach((f, p) => m.set(p, f.text)); return m; }
    texts() { return this._texts(); }
    isDirty() {
      if (this.hasDraft() || this.extrasDirty()) return true;
      if (this.files.size !== this.original.size) return true;
      for (const [p, f] of this.files) if (this.original.get(p) !== f.text) return true;
      return false;
    }
    hasDraft() { for (const f of this.files.values()) if (f.draft) return true; return false; }
    markSaved() { this.original = this._texts(); this.extrasOriginal = new Map(this.extras); this._bump(); }
    /** Crea, modifica o (con null) elimina un fichero de configuración .concord/. */
    setExtra(path, text) {
      if (!isExtraPath(path)) throw new Error('Los ficheros de configuración deben estar en ' + CONFIG_DIR);
      if (text === null || text === undefined) { if (!this.extras.delete(path)) return; } else if (this.extras.get(path) === text) return; else this.extras.set(path, text);
      this._bump();
    }
    extrasDirty() {
      if (this.extras.size !== this.extrasOriginal.size) return true;
      for (const [p, x] of this.extras) if (this.extrasOriginal.get(p) !== x) return true;
      return false;
    }
    dirtyFiles() {
      const out = [];
      for (const [p, f] of this.files) { if (this.original.get(p) !== f.text) out.push(p); }
      return out;
    }

    /* ---------- Resolucion de referencias ---------- */
    resolveRef(fromFile, ref) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(ref) && !/^[a-z]:[\\/]/i.test(ref)) return { error: 'remote', message: 'Referencia remota (' + ref.split(':')[0] + ':) deshabilitada: no se realizan llamadas de red.' };
      if (/^[a-z]:[\\/]/i.test(ref) || ref.startsWith('/') && !ref.startsWith('#')) return { error: 'outside', message: 'Ruta absoluta fuera del directorio del proyecto.' };
      const i = ref.indexOf('#');
      const filePart = i < 0 ? ref : ref.slice(0, i);
      const frag = i < 0 ? '' : ref.slice(i + 1);
      let target = fromFile;
      if (filePart) {
        target = U.joinPath(U.dirname(fromFile), U.decodeRefPath(filePart));
        if (target === null) return { error: 'outside', message: 'La referencia sale del directorio del proyecto: ' + ref };
        if (!this.files.has(target)) {
          const alt = this.lowerIndex.get(target.toLowerCase());
          if (alt) target = alt;
          else return { error: 'missing-file', message: 'No existe el fichero referenciado: ' + target };
        }
      }
      if (frag && !frag.startsWith('/')) return { error: 'anchor', message: 'Solo se admiten punteros JSON (#/ruta): ' + ref };
      return { file: target, segs: U.fromPtr(frag), filePart };
    }

    getNodeAt(file, path) {
      const e = this.files.get(file);
      if (!e) return undefined;
      let node = e.doc.contents;
      for (const seg of path) {
        if (isMap(node)) { const p = findPair(node, seg); if (!p) return undefined; node = p.value; }
        else if (isSeq(node)) { node = node.items[Number(seg)]; if (node === undefined) return undefined; }
        else return undefined;
      }
      return node;
    }

    _followHere(file, path, depth) {
      let hops = 0;
      for (;;) {
        const node = this.getNodeAt(file, path);
        const ref = refOf(node);
        if (ref == null) return { file, path };
        if (++hops > 40 || depth > 40) return { error: 'loop', message: 'Cadena de $ref en bucle.' };
        const t = this.resolveRef(file, ref);
        if (t.error) return t;
        const w = this._walk(t.file, [], t.segs, false, depth + 1);
        if (w.error) return w;
        file = w.file; path = w.path;
      }
    }
    _walk(file, path, segs, followFinal, depth) {
      path = path.slice();
      for (const s of segs) {
        const r = this._followHere(file, path, depth);
        if (r.error) return r;
        file = r.file; path = r.path.slice(); path.push(s);
      }
      if (followFinal) { const r = this._followHere(file, path, depth); if (r.error) return r; return r; }
      return { file, path };
    }
    /** Ruta logica (desde el raiz) -> ubicacion fisica {file, path}. Sigue $ref intermedios. */
    phys(logical, followFinal) { return this._walk(this.rootFile, [], logical, !!followFinal, 0); }
    physNode(logical, followFinal) {
      const p = this.phys(logical, followFinal);
      if (p.error) return null;
      return { file: p.file, path: p.path, node: this.getNodeAt(p.file, p.path) };
    }

    nodeToJS(file, node) {
      if (node === undefined) return undefined;
      if (!YAML.isNode(node)) return node;
      const e = this.files.get(file);
      try { return node.toJS(e.doc, { maxAliasCount: 100 }); } catch (err) { return undefined; }
    }
    /** Lee el valor plano de una ruta logica. Con follow=true resuelve tambien el $ref final. */
    read(logical, follow) {
      const p = this.physNode(logical, follow);
      if (!p) return undefined;
      return this.nodeToJS(p.file, p.node);
    }
    fileOf(logical, follow) { const p = this.phys(logical, follow); return p.error ? null : p.file; }

    /* ---------- Indice de referencias ---------- */
    refIndex() {
      if (this._cache.refs) return this._cache.refs;
      const out = [];
      for (const [file, e] of this.files) {
        const visit = (node, path, ctx) => {
          if (isMap(node)) {
            for (const pair of node.items) {
              const k = keyOf(pair);
              if (typeof k !== 'string' && typeof k !== 'number') continue;
              const ks = String(k);
              if (!ctx.names && ks === '$ref' && isScalar(pair.value) && typeof pair.value.value === 'string') {
                path.push(ks); out.push(this._mkRef(file, path.slice(), pair.value.value, '$ref')); path.pop();
                continue;
              }
              if (ctx.names && ctx.parent === 'mapping' && isScalar(pair.value) && typeof pair.value.value === 'string' && pair.value.value.indexOf('#/') >= 0) {
                path.push(ks); out.push(this._mkRef(file, path.slice(), pair.value.value, 'mapping')); path.pop();
                continue;
              }
              if (skipKey(ks, ctx)) continue;
              if (pair.value && (isMap(pair.value) || isSeq(pair.value))) {
                path.push(ks); visit(pair.value, path, childCtx(ks, ctx)); path.pop();
              }
            }
          } else if (isSeq(node)) {
            node.items.forEach((it, i) => { if (isMap(it) || isSeq(it)) { path.push(i); visit(it, path, { names: false, parent: ctx.parent, exObj: false }); path.pop(); } });
          }
        };
        visit(e.doc.contents, [], rootCtx());
      }
      this._cache.refs = out;
      return out;
    }
    _mkRef(file, path, ref, kind) {
      const t = this.resolveRef(file, ref);
      const r = { file, path, ref, kind, filePart: t.filePart || '' };
      if (t.error) { r.error = t.error; r.message = t.message; return r; }
      const w = this._walk(t.file, [], t.segs, false, 0);
      if (w.error) {
        r.error = w.error === 'loop' ? 'loop' : 'missing-pointer'; r.message = w.message; r.target = { file: t.file, path: t.segs };
        return r;
      }
      const node = this.getNodeAt(w.file, w.path);
      if (node === undefined) { r.error = 'missing-pointer'; r.message = 'El destino no existe: ' + ref; r.target = { file: w.file, path: w.path }; return r; }
      r.target = { file: w.file, path: w.path, lit: t.segs, litFile: t.file };
      return r;
    }
    usagesOf(file, path) {
      const pfx = path.map(String);
      return this.refIndex().filter((r) => r.target && r.target.file === file && r.target.path.length >= pfx.length && pfx.every((s, i) => String(r.target.path[i]) === s));
    }
    /** Referencias a un elemento logico, incluyendo las que apuntan directamente al fichero al que este delega por $ref. */
    usagesOfLogical(logical) {
      const p = this.phys(logical, false);
      if (p.error) return [];
      const out = new Set(this.usagesOf(p.file, p.path));
      let cur = p;
      for (let i = 0; i < 20; i++) {
        const node = this.getNodeAt(cur.file, cur.path);
        const ref = refOf(node);
        if (ref == null) break;
        const t = this.resolveRef(cur.file, ref);
        if (t.error) break;
        const w = this._walk(t.file, [], t.segs, false, 0);
        if (w.error) break;
        this.usagesOf(w.file, w.path).forEach((u) => out.add(u));
        cur = w;
      }
      return Array.from(out).filter((u) => !(u.file === p.file && u.path.length >= p.path.length && p.path.every((s, i) => String(u.path[i]) === String(s))));
    }
    makeRef(fromFile, toFile, segs) {
      const frag = '#' + U.toPtr(segs.map(String)).replace(/[ %]/g, (c) => encodeURIComponent(c));
      if (fromFile === toFile) return frag;
      return U.encodeRefPath(U.relativePath(U.dirname(fromFile), toFile)) + (segs.length ? frag : '');
    }
    /** Reescribe los $ref internos de un nodo que se traslada de fromFile a toFile. */
    rebaseRefs(node, fromFile, toFile) {
      if (fromFile === toFile) return;
      const visit = (n, ctx) => {
        if (isMap(n)) {
          for (const pair of n.items) {
            const ks = String(keyOf(pair));
            if (!ctx.names && ks === '$ref' && isScalar(pair.value) && typeof pair.value.value === 'string') {
              const t = this.resolveRef(fromFile, pair.value.value);
              if (!t.error) pair.value.value = this.makeRef(toFile, t.file, t.segs);
              continue;
            }
            if (skipKey(ks, ctx)) continue;
            if (pair.value && (isMap(pair.value) || isSeq(pair.value))) visit(pair.value, childCtx(ks, ctx));
          }
        } else if (isSeq(n)) n.items.forEach((it) => { if (isMap(it) || isSeq(it)) visit(it, { names: false, parent: ctx.parent, exObj: false }); });
      };
      visit(node, rootCtx());
    }

    /* ---------- Ubicacion (linea/columna) ---------- */
    locate(file, path) {
      const e = this.files.get(file);
      if (!e || !e.doc.contents) return { line: 1, col: 1 };
      let node = e.doc.contents;
      let pos = node.range ? node.range[0] : 0;
      for (const seg of path) {
        if (isMap(node)) {
          const p = findPair(node, seg);
          if (!p) break;
          pos = (p.key && p.key.range) ? p.key.range[0] : pos;
          node = p.value;
        } else if (isSeq(node)) {
          const it = node.items[Number(seg)];
          if (it === undefined) break;
          if (it && it.range) pos = it.range[0];
          node = it;
        } else break;
      }
      const lp = e.lc.linePos(pos);
      return { line: lp.line, col: lp.col };
    }
    pathAtOffset(file, offset) {
      const e = this.files.get(file);
      const path = [];
      let node = e && e.doc.contents;
      while (node) {
        if (isMap(node)) {
          let hit = null;
          for (const pair of node.items) {
            const ks = pair.key && pair.key.range ? pair.key.range[0] : Infinity;
            const end = pair.value && pair.value.range ? pair.value.range[2] : (pair.key && pair.key.range ? pair.key.range[2] : -1);
            if (offset >= ks && offset <= end) { hit = pair; break; }
          }
          if (!hit) break;
          path.push(keyOf(hit)); node = hit.value;
        } else if (isSeq(node)) {
          let idx = -1;
          node.items.forEach((it, i) => { if (it && it.range && offset >= it.range[0] && offset <= it.range[2]) idx = i; });
          if (idx < 0) break;
          path.push(idx); node = node.items[idx];
        } else break;
      }
      return path;
    }
    /** Ruta fisica (file,path) -> ruta logica desde el raiz (siguiendo quien referencia el fichero). */
    toLogical(file, path, depth) {
      depth = depth || 0;
      if (file === this.rootFile) return path.slice();
      if (depth > 10) return null;
      const refs = this.refIndex();
      let best = null;
      for (const r of refs) {
        if (!r.target || r.target.file !== file || r.target.path.length > path.length) continue;
        if (!r.target.path.every((s, i) => String(s) === String(path[i]))) continue;
        if (!best || r.target.path.length > best.target.path.length) best = r;
      }
      if (!best) return null;
      const holder = best.path.slice(0, -1);
      const lg = this.toLogical(best.file, holder, depth + 1);
      if (!lg) return null;
      return lg.concat(path.slice(best.target.path.length));
    }

    /* ---------- Modelo resumido para el explorador ---------- */
    getModel() {
      if (this._cache.model) return this._cache.model;
      const m = { openapi: '', info: {}, servers: [], tags: [], paths: [], components: {}, files: [], rootFile: this.rootFile };
      const rf = this.files.get(this.rootFile);
      if (rf && isMap(rf.doc.contents)) {
        const g = (seg) => this.read([seg], true);
        m.openapi = String(g('openapi') || '');
        m.info = g('info') || {};
        m.servers = Array.isArray(g('servers')) ? g('servers') : [];
        m.tags = Array.isArray(g('tags')) ? g('tags') : [];
        const pathsP = this.physNode(['paths'], true);
        if (pathsP && isMap(pathsP.node)) {
          for (const pair of pathsP.node.items) {
            const key = String(keyOf(pair));
            if (key.startsWith('x-')) continue;
            const ip = this.physNode(['paths', key], true);
            const entry = { path: key, file: ip ? ip.file : pathsP.file, methods: [], summary: '', error: null };
            const refNode = ip ? null : true;
            if (refNode) entry.error = 'No se pudo resolver el path item';
            else if (ip && isMap(ip.node)) {
              entry.summary = String(this._scalar(ip.node, 'summary') || '');
              for (const it of ip.node.items) {
                const mk = String(keyOf(it)).toLowerCase();
                if (!U.HTTP_METHODS.includes(mk)) continue;
                const op = it.value;
                const opInfo = { method: mk, summary: '', operationId: '', tags: [], deprecated: false, file: ip.file };
                if (isMap(op)) {
                  opInfo.summary = String(this._scalar(op, 'summary') || '');
                  opInfo.operationId = String(this._scalar(op, 'operationId') || '');
                  opInfo.deprecated = this._scalar(op, 'deprecated') === true;
                  const tp = findPair(op, 'tags');
                  if (tp && isSeq(tp.value)) opInfo.tags = tp.value.items.map((x) => String(isScalar(x) ? x.value : x));
                  opInfo.description = String(this._scalar(op, 'description') || '').slice(0, 300);
                }
                entry.methods.push(opInfo);
              }
            }
            m.paths.push(entry);
          }
        }
        for (const type of COMPONENT_TYPES) {
          const cp = this.physNode(['components', type], true);
          m.components[type] = [];
          if (cp && isMap(cp.node)) {
            for (const pair of cp.node.items) {
              const name = String(keyOf(pair));
              if (name.startsWith('x-')) continue;
              const ip = this.physNode(['components', type, name], false);
              const ref = ip ? refOf(ip.node) : null;
              const entry = { name, file: ip ? ip.file : cp.file, ref };
              if (type === 'schemas') {
                const rn = this.physNode(['components', type, name], true);
                if (rn && isMap(rn.node)) { entry.type = String(this._scalar(rn.node, 'type') || (findPair(rn.node, 'properties') ? 'object' : findPair(rn.node, 'allOf') ? 'allOf' : findPair(rn.node, 'oneOf') ? 'oneOf' : findPair(rn.node, 'anyOf') ? 'anyOf' : '')); entry.description = String(this._scalar(rn.node, 'description') || '').slice(0, 200); }
              }
              m.components[type].push(entry);
            }
          }
        }
      }
      for (const [p, f] of this.files) m.files.push({ path: p, isRoot: p === this.rootFile, errors: f.errors.filter((x) => x.severity === 'error').length, draft: !!f.draft });
      m.files.sort((a, b) => (b.isRoot - a.isRoot) || a.path.localeCompare(b.path));
      this._cache.model = m;
      return m;
    }
    _scalar(map, key) { const p = findPair(map, key); return p && isScalar(p.value) ? p.value.value : undefined; }

    /* ---------- Historial ---------- */
    _restore(texts, rootFile) {
      for (const p of Array.from(this.files.keys())) if (!texts.has(p)) { this.files.delete(p); this.lowerIndex.delete(p.toLowerCase()); }
      for (const [p, t] of texts) { const f = this.files.get(p); if (!f || f.text !== t) this._setFile(p, t); }
      if (rootFile) this.rootFile = rootFile;
    }
    _pushHistory(label, before, coalesce) {
      const last = this.past[this.past.length - 1];
      if (coalesce && last && last.label === label && Date.now() - last.ts < 2500) { last.ts = Date.now(); }
      else { this.past.push({ label, texts: before, root: this.rootFile, ts: Date.now() }); if (this.past.length > 200) this.past.shift(); }
      this.future = [];
    }
    canUndo() { return this.past.length > 0; }
    canRedo() { return this.future.length > 0; }
    undo() {
      const s = this.past.pop();
      if (!s) return null;
      this.future.push({ label: s.label, texts: this._texts(), root: this.rootFile });
      this._restore(s.texts, s.root);
      this._bump();
      return s.label;
    }
    redo() {
      const s = this.future.pop();
      if (!s) return null;
      this.past.push({ label: s.label, texts: this._texts(), root: this.rootFile, ts: 0 });
      this._restore(s.texts, s.root);
      this._bump();
      return s.label;
    }

    /** Ejecuta una edicion atomica; si falla se revierte y no se toca el historial. */
    mutate(label, fn, opts) {
      opts = opts || {};
      const before = this._texts();
      const beforeRoot = this.rootFile;
      const tx = new Tx(this);
      let res;
      try {
        res = fn(tx);
        for (const p of tx.touched) {
          const f = this.files.get(p);
          if (!f) continue;
          this._setFile(p, stringifyDoc(f.doc, f.eol));
        }
      } catch (err) {
        this._restore(before, beforeRoot);
        throw err;
      }
      let changed = false;
      if (this.files.size !== before.size) changed = true;
      else for (const [p, f] of this.files) if (before.get(p) !== f.text) { changed = true; break; }
      if (!changed) return res;
      this._pushHistory(label, before, opts.coalesce);
      this._bump();
      return res;
    }

    /** Edicion directa del texto de un fichero. Si hay errores de sintaxis se guarda como borrador. */
    setFileText(path, text) {
      const f = this.files.get(path);
      if (!f) throw new Error('Fichero desconocido: ' + path);
      const parsed = parseText(text);
      const hard = parsed.errors.filter((e) => e.severity === 'error');
      if (hard.length) {
        f.draft = { text, errors: hard };
        this._bump();
        return { ok: false, errors: hard };
      }
      f.draft = null;
      if (f.text === text) { this._bump(); return { ok: true, errors: [] }; }
      const before = this._texts();
      this._setFile(path, text);
      this._pushHistory('Editar YAML ' + path, before, true);
      this._bump();
      return { ok: true, errors: parsed.errors };
    }
    discardDraft(path) { const f = this.files.get(path); if (f && f.draft) { f.draft = null; this._bump(); } }
  }

  /* ---------- Transaccion de edicion (rutas logicas) ---------- */
  class Tx {
    constructor(project) { this.p = project; this.touched = new Set(); }
    _touch(file) { this.touched.add(file); return this.p.files.get(file); }
    _need(logical, followFinal) {
      const r = this.p.phys(logical, followFinal);
      if (r.error) throw new Error(r.message || ('No se pudo resolver ' + U.fmtPath(logical)));
      return r;
    }
    _create(file, v) { return this.p.files.get(file).doc.createNode(v, { aliasDuplicateObjects: false }); }

    /** Devuelve el mapa/secuencia fisico que contiene el ultimo segmento (creando intermedios). */
    _container(file, path, doc) {
      let node = doc.contents;
      if (node == null || !(isMap(node) || isSeq(node))) { node = doc.createNode({}); doc.contents = node; }
      for (const seg of path) {
        let next;
        if (isMap(node)) {
          const pr = findPair(node, seg);
          if (!pr || pr.value == null || !(isMap(pr.value) || isSeq(pr.value))) {
            const nn = doc.createNode({});
            if (pr) pr.value = nn; else node.items.push(doc.createPair(seg, nn));
            next = nn;
          } else next = pr.value;
        } else if (isSeq(node)) next = node.items[Number(seg)];
        else throw new Error('Ruta invalida');
        node = next;
      }
      return node;
    }

    set(logical, value) {
      if (value === undefined) return this.del(logical);
      const leaf = logical[logical.length - 1];
      const parent = this._need(logical.slice(0, -1), leaf !== '$ref');
      const entry = this._touch(parent.file);
      const doc = entry.doc;
      const cont = this._container(parent.file, parent.path, doc);
      if (isMap(cont)) {
        const pr = findPair(cont, leaf);
        if (pr) {
          if (isScalar(pr.value) && (value === null || typeof value !== 'object')) { pr.value.value = value; if (pr.value.type && typeof value !== 'string') pr.value.type = undefined; }
          else {
            const old = pr.value;
            const nn = doc.createNode(value, { aliasDuplicateObjects: false });
            if (old && old.comment && nn && !nn.comment) nn.comment = old.comment;
            if (old && old.commentBefore && nn && !nn.commentBefore) nn.commentBefore = old.commentBefore;
            pr.value = nn;
          }
        } else cont.items.push(doc.createPair(leaf, doc.createNode(value, { aliasDuplicateObjects: false })));
      } else if (isSeq(cont)) {
        const idx = Number(leaf);
        const nn = doc.createNode(value, { aliasDuplicateObjects: false });
        if (idx >= cont.items.length) cont.items.push(nn); else cont.items[idx] = nn;
      }
    }
    /** Anade un elemento al final de una secuencia (la crea si no existe). */
    push(logical, value) {
      const cur = this.p.physNode(logical, true);
      if (!cur || !isSeq(cur.node)) { this.set(logical, [value]); return; }
      this._touch(cur.file);
      cur.node.items.push(this._create(cur.file, value));
    }
    del(logical) {
      const leaf = logical[logical.length - 1];
      const parent = this.p.phys(logical.slice(0, -1), leaf !== '$ref');
      if (parent.error) return;
      const cont = this.p.getNodeAt(parent.file, parent.path);
      if (isMap(cont)) {
        const idx = cont.items.findIndex((it) => isPair(it) && String(keyOf(it)) === String(leaf));
        if (idx >= 0) { this._touch(parent.file); cont.items.splice(idx, 1); }
      } else if (isSeq(cont)) {
        const idx = Number(leaf);
        if (idx >= 0 && idx < cont.items.length) { this._touch(parent.file); cont.items.splice(idx, 1); }
      }
    }
    /** Cambia la clave de un mapa conservando posicion y comentarios. */
    renameKey(parentLogical, oldKey, newKey) {
      const parent = this._need(parentLogical, true);
      const cont = this.p.getNodeAt(parent.file, parent.path);
      if (!isMap(cont)) throw new Error('El destino no es un objeto');
      const pr = findPair(cont, oldKey);
      if (!pr) throw new Error('No existe la clave ' + oldKey);
      if (String(oldKey) !== String(newKey) && findPair(cont, newKey)) throw new Error('Ya existe un elemento llamado "' + newKey + '"');
      this._touch(parent.file);
      if (isScalar(pr.key)) { pr.key.value = newKey; pr.key.type = undefined; } else pr.key = this._create(parent.file, newKey);
    }
    /** Mueve una clave (mapa) o un indice (secuencia) delta posiciones. */
    reorder(parentLogical, keyOrIndex, delta) {
      const parent = this._need(parentLogical, true);
      const cont = this.p.getNodeAt(parent.file, parent.path);
      let i;
      if (isMap(cont)) i = cont.items.findIndex((it) => String(keyOf(it)) === String(keyOrIndex));
      else if (isSeq(cont)) i = Number(keyOrIndex);
      else throw new Error('No se puede reordenar');
      const j = i + delta;
      if (i < 0 || j < 0 || j >= cont.items.length) return;
      this._touch(parent.file);
      const [it] = cont.items.splice(i, 1);
      cont.items.splice(j, 0, it);
    }
    /** Clona una entrada de un mapa justo detras de la original (conserva comentarios). */
    duplicate(parentLogical, key, newKey) {
      const parent = this._need(parentLogical, true);
      const cont = this.p.getNodeAt(parent.file, parent.path);
      if (isSeq(cont)) {
        const i = Number(key);
        this._touch(parent.file);
        cont.items.splice(i + 1, 0, cont.items[i].clone());
        return;
      }
      if (!isMap(cont)) throw new Error('El destino no es un objeto');
      const idx = cont.items.findIndex((it) => String(keyOf(it)) === String(key));
      if (idx < 0) throw new Error('No existe ' + key);
      if (findPair(cont, newKey)) throw new Error('Ya existe un elemento llamado "' + newKey + '"');
      this._touch(parent.file);
      const src = cont.items[idx];
      const pair = this.p.files.get(parent.file).doc.createPair(newKey, src.value ? src.value.clone() : null);
      cont.items.splice(idx + 1, 0, pair);
    }
    /** Inserta (o sustituye) un nodo AST bajo una clave del mapa logico indicado. */
    insertNode(parentLogical, key, node) {
      const parent = this._need(parentLogical, true);
      const entry = this._touch(parent.file);
      const cont = this._container(parent.file, parent.path, entry.doc);
      if (!isMap(cont)) throw new Error('El destino no es un objeto');
      const pr = findPair(cont, key);
      if (pr) pr.value = node; else cont.items.push(entry.doc.createPair(key, node));
    }
    /** Copia un nodo (con comentarios) a otra ubicacion logica reescribiendo sus $ref relativos. */
    copyNode(fromLogical, toLogical) {
      const src = this._need(fromLogical, false);
      const node = this.p.getNodeAt(src.file, src.path);
      if (node === undefined) throw new Error('El elemento origen no existe');
      const cl = node.clone();
      const dest = this._need(toLogical.slice(0, -1), true);
      this.p.rebaseRefs(cl, src.file, dest.file);
      this.insertNode(toLogical.slice(0, -1), toLogical[toLogical.length - 1], cl);
    }
    /** Sustituye un nodo por el resultado de parsear un texto YAML. */
    setYaml(logical, text) {
      const parsed = parseText(text);
      const hard = parsed.errors.filter((e) => e.severity === 'error');
      if (hard.length) throw new Error('YAML inválido (línea ' + hard[0].line + ', col ' + hard[0].col + '): ' + hard[0].message);
      const value = parsed.doc.toJS({ maxAliasCount: 100 });
      if (value === null || value === undefined) return this.del(logical);
      this.set(logical, value);
    }
    /** Renombra la clave y actualiza todos los $ref internos y externos que apuntan al elemento. */
    renameWithRefs(parentLogical, oldKey, newKey) {
      const target = this._need(parentLogical.concat([oldKey]), false);
      const usages = this.p.usagesOf(target.file, target.path);
      const idx = target.path.length - 1;
      for (const u of usages) {
        const written = this.p.resolveRef(u.file, u.ref);
        if (written.error || written.segs.length <= idx) continue;
        const ns = written.segs.slice();
        // Solo se reescribe si el puntero escrito coincide literalmente con la ubicacion fisica.
        if (String(ns[idx]) !== String(oldKey)) continue;
        ns[idx] = newKey;
        const fragment = '#' + U.toPtr(ns).replace(/[ %]/g, (c) => encodeURIComponent(c));
        const base = u.ref.slice(0, u.ref.indexOf('#'));
        this._touch(u.file);
        const node = this.p.getNodeAt(u.file, u.path);
        if (node && isScalar(node)) node.value = base + fragment; else this.set(u.path, base + fragment);
      }
      this.renameKey(parentLogical, oldKey, newKey);
      return usages.length;
    }
    addFile(path, text) {
      if (this.p.files.has(path)) throw new Error('El fichero ya existe: ' + path);
      const rf = this.p.files.get(this.p.rootFile);
      this.p._setFile(path, rf && rf.eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text);
      this.touched.add(path);
    }
    removeFile(path) {
      if (path === this.p.rootFile) throw new Error('No se puede eliminar el fichero raíz');
      this.p.files.delete(path);
      this.p.lowerIndex.delete(path.toLowerCase());
      this.touched.delete(path);
    }
    /** Convierte un nodo inline en componente reutilizable y deja un $ref en su lugar. */
    extractToComponent(logical, type, name) {
      const src = this._need(logical, false);
      const node = this.p.getNodeAt(src.file, src.path);
      if (node === undefined) throw new Error('El elemento no existe');
      if (refOf(node)) throw new Error('El elemento ya es una referencia');
      const existing = this.p.physNode(['components', type, name], false);
      if (existing && existing.node !== undefined) throw new Error('Ya existe components.' + type + '.' + name);
      const compMap = this.p.physNode(['components', type], true);
      if (!compMap || !isMap(compMap.node)) this.set(['components', type], {});
      const dest = this._need(['components', type], true);
      const destEntry = this._touch(dest.file);
      const destMap = this.p.getNodeAt(dest.file, dest.path);
      const cl = node.clone();
      this.p.rebaseRefs(cl, src.file, dest.file);
      destMap.items.push(destEntry.doc.createPair(name, cl));
      const ref = this.p.makeRef(src.file, dest.file, dest.path.concat([name]));
      this.set(logical, { $ref: ref });
      return ref;
    }
    /** Traslada un nodo inline a un fichero nuevo y deja un $ref relativo. */
    extractToFile(logical, filePath) {
      const src = this._need(logical, false);
      const node = this.p.getNodeAt(src.file, src.path);
      if (node === undefined) throw new Error('El elemento no existe');
      if (refOf(node)) throw new Error('El elemento ya es una referencia');
      const norm = U.normalizePath(filePath);
      if (!norm) throw new Error('Ruta de fichero invalida (fuera del directorio del proyecto)');
      if (this.p.files.has(norm)) throw new Error('El fichero ya existe: ' + norm);
      const cl = node.clone();
      this.p.rebaseRefs(cl, src.file, norm);
      const d = new YAML.Document();
      d.contents = cl;
      this.addFile(norm, stringifyDoc(d, '\n'));
      this.set(logical, { $ref: U.encodeRefPath(U.relativePath(U.dirname(src.file), norm)) });
      return norm;
    }
  }

  Project.TEMPLATE = 'openapi: 3.0.3\ninfo:\n  title: Nuevo contrato\n  version: 1.0.0\n  description: Describe aquí el contrato.\nservers:\n  - url: https://api.ejemplo.com/v1\ntags: []\npaths: {}\ncomponents:\n  schemas: {}\n';

  return { Project, Tx, COMPONENT_TYPES, NAME_MAPS, rootCtx, childCtx, skipKey, keyOf, findPair, refOf, parseText, stringifyDoc, detectEol, YAML, CONFIG_DIR, isExtraPath };
});
