/* Empaquetado de un proyecto multi-fichero en un unico documento (sobre el AST, conserva comentarios).
 * Los $ref a otros ficheros se sustituyen por el contenido en su primera aparicion; las siguientes apariciones
 * y los ciclos se convierten en $ref internos. Devuelve ademas el mapa de origen de cada nodo. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./project.js'), require('./vendor.js'));
  else { root.OAT = root.OAT || {}; root.OAT.bundle = factory(root.OAT.util, root.OAT.project, root.OAT.vendor); }
})(typeof self !== 'undefined' ? self : this, function (U, P, vendor) {
  'use strict';
  const YAML = vendor.YAML;
  const { isMap, isSeq, isScalar, isAlias } = YAML;
  const { keyOf, refOf, childCtx, skipKey, rootCtx } = P;

  function bundleProject(project) {
    const rootFile = project.rootFile;
    const rf = project.file(rootFile);
    const placed = new Map();
    const origins = new Map();
    const notes = [];
    let cycles = 0;
    const k2 = (file, segs) => file + '\u0000' + U.toPtr(segs.map(String));

    function copyMeta(from, to) {
      if (from.commentBefore !== undefined) to.commentBefore = from.commentBefore;
      if (from.comment !== undefined) to.comment = from.comment;
      if (from.spaceBefore !== undefined) to.spaceBefore = from.spaceBefore;
      if (from.flow !== undefined) to.flow = from.flow;
    }
    function rawCopy(node, file) {
      if (isAlias(node)) {
        const t = node.resolve(project.file(file).doc);
        return t ? rawCopy(t, file) : node.clone();
      }
      if (isMap(node)) {
        const m = new YAML.YAMLMap(); copyMeta(node, m);
        for (const pr of node.items) m.items.push(new YAML.Pair(pr.key && pr.key.clone ? pr.key.clone() : pr.key, pr.value ? rawCopy(pr.value, file) : pr.value));
        return m;
      }
      if (isSeq(node)) {
        const s = new YAML.YAMLSeq(); copyMeta(node, s);
        for (const it of node.items) s.items.push(it ? rawCopy(it, file) : it);
        return s;
      }
      return node && node.clone ? node.clone() : node;
    }
    function copyRefNode(node, file, newRef) {
      const c = rawCopy(node, file);
      if (newRef != null) for (const pr of c.items) if (String(keyOf(pr)) === '$ref') pr.value.value = newRef;
      return c;
    }

    function handleRef(node, ref, file, segs, out, ctx) {
      const t = project.resolveRef(file, ref);
      if (t.error) return copyRefNode(node, file);
      const w = project._walk(t.file, [], t.segs, false, 0);
      if (w.error) return copyRefNode(node, file);
      const tnode = project.getNodeAt(w.file, w.path);
      if (tnode === undefined) return copyRefNode(node, file);
      if (w.file === rootFile) return copyRefNode(node, file, '#' + U.toPtr(w.path.map(String)));
      const key = k2(w.file, w.path);
      if (placed.has(key)) { cycles++; return copyRefNode(node, file, '#' + U.toPtr(placed.get(key))); }
      if (node.items.length > 1) notes.push({ code: 'ref-siblings', file, path: segs.slice(), message: 'Las propiedades junto a $ref se ignoran en OpenAPI 3.0 y no se incluyen al empaquetar.' });
      const inl = walk(tnode, w.file, w.path, out, ctx);
      if (node.commentBefore !== undefined && inl && inl.commentBefore === undefined) inl.commentBefore = node.commentBefore;
      return inl;
    }

    function walk(node, file, segs, out, ctx) {
      if (isAlias(node)) {
        const t = node.resolve(project.file(file).doc);
        return t ? walk(t, file, segs, out, ctx) : node.clone();
      }
      if (isMap(node)) {
        const key = k2(file, segs);
        if (!placed.has(key)) placed.set(key, out);
        origins.set(U.toPtr(out), { file, path: segs });
        if (!ctx.names) { const r = refOf(node); if (r != null) return handleRef(node, r, file, segs, out, ctx); }
        const m = new YAML.YAMLMap(); copyMeta(node, m);
        const items = node.items;
        const order = (segs.length === 0 && file === rootFile)
          ? items.map((_, i) => i).sort((a, b) => (String(keyOf(items[a])) === 'components' ? -1 : 0) - (String(keyOf(items[b])) === 'components' ? -1 : 0) || a - b)
          : items.map((_, i) => i);
        const res = new Array(items.length);
        for (const i of order) {
          const pr = items[i];
          const ks = String(keyOf(pr));
          let v;
          if (!pr.value) v = pr.value;
          else if (skipKey(ks, ctx)) v = rawCopy(pr.value, file);
          else v = walk(pr.value, file, segs.concat([ks]), out.concat([ks]), childCtx(ks, ctx));
          res[i] = new YAML.Pair(pr.key && pr.key.clone ? pr.key.clone() : pr.key, v);
        }
        m.items = res;
        return m;
      }
      if (isSeq(node)) {
        const key = k2(file, segs);
        if (!placed.has(key)) placed.set(key, out);
        origins.set(U.toPtr(out), { file, path: segs });
        const s = new YAML.YAMLSeq(); copyMeta(node, s);
        const sub = { names: false, parent: ctx.parent, exObj: false };
        node.items.forEach((it, i) => {
          s.items.push(it == null ? it : walk(it, file, segs.concat([String(i)]), out.concat([String(i)]), sub));
        });
        return s;
      }
      return node && node.clone ? node.clone() : node;
    }

    let outDoc = new YAML.Document();
    if (rf && rf.doc.contents) {
      outDoc.contents = walk(rf.doc.contents, rootFile, [], [], rootCtx());
      if (rf.doc.commentBefore !== undefined) outDoc.commentBefore = rf.doc.commentBefore;
      if (rf.doc.comment !== undefined) outDoc.comment = rf.doc.comment;
    }
    let js;
    try { js = outDoc.toJS({ maxAliasCount: -1 }); } catch (e) { js = null; }

    /** Ubicacion de origen (file + ruta en el fichero) de una ruta del documento empaquetado. */
    function originOf(segs) {
      segs = segs.map(String);
      for (let i = segs.length; i >= 0; i--) {
        const o = origins.get(U.toPtr(segs.slice(0, i)));
        if (o) return { file: o.file, path: o.path.concat(segs.slice(i)) };
      }
      return { file: rootFile, path: segs };
    }
    return { doc: outDoc, js, origins, originOf, notes, cycles };
  }

  return { bundleProject };
});
