/* Exportacion: documento unico o raiz + fragments. Trabaja sobre el AST empaquetado (conserva comentarios y x-*),
 * reescribe los $ref como rutas relativas portables y siempre recarga y valida el resultado propuesto. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./util.js'), require('./project.js'), require('./bundle.js'), require('./validate.js'), require('./compare.js'), require('./vendor.js'));
  else { const O = root.OAT = root.OAT || {}; O.exporter = factory(O.util, O.project, O.bundle, O.validate, O.compare, O.vendor); }
})(typeof self !== 'undefined' ? self : this, function (U, P, B, V, C, vendor) {
  'use strict';
  const YAML = vendor.YAML;
  const { isMap, isSeq, isScalar } = YAML;
  const { keyOf, findPair, childCtx, skipKey, rootCtx, Project } = P;

  const DEFAULTS = { mode: 'fragments', rootName: '', outDir: '', strategy: 'tags', target: 4, naming: 'kebab', customRules: '', groupNames: {} };

  function glob(p) { return new RegExp('^' + p.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 'i'); }
  function parseRules(text) {
    return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
      const m = /^(.+?)\s*=>\s*(.+)$/.exec(l);
      if (!m) return null;
      const sel = m[1].trim(); const i = sel.indexOf(':');
      return { kind: i < 0 ? '*' : sel.slice(0, i).trim(), re: glob(i < 0 ? sel : sel.slice(i + 1).trim()), target: m[2].trim().replace(/\.ya?ml$/i, '') };
    }).filter(Boolean);
  }
  function fileStem(name, naming, fallback) {
    let s = String(name).replace(/[{}]/g, '').replace(/^\/+/, '');
    if (naming === 'original') s = s.replace(/[\\/:*?"<>|]+/g, '_').replace(/\s+$/g, '');
    else { s = U.slug(s.replace(/([a-z0-9])([A-Z])/g, '$1-$2')); if (naming === 'snake') s = s.replace(/-/g, '_'); }
    return s || fallback || 'raiz';
  }

  /** Extrae las unidades movibles (path items y componentes) del documento empaquetado. */
  function collectUnits(rootMap) {
    const units = [];
    const paths = findPair(rootMap, 'paths');
    if (paths && isMap(paths.value)) {
      for (const pr of paths.value.items) {
        const route = String(keyOf(pr));
        if (!route.startsWith('/') || !pr.value) continue;
        let tags = [];
        if (isMap(pr.value)) for (const m of U.HTTP_METHODS) { const op = findPair(pr.value, m); if (op && isMap(op.value)) { const t = findPair(op.value, 'tags'); if (t && isSeq(t.value) && t.value.items.length) { tags = t.value.items.map((x) => String(isScalar(x) ? x.value : x)); break; } } }
        units.push({ id: 'paths:' + route, kind: 'path', name: route, pair: pr, tags });
      }
    }
    const comps = findPair(rootMap, 'components');
    if (comps && isMap(comps.value)) {
      for (const tp of comps.value.items) {
        const type = String(keyOf(tp));
        if (!isMap(tp.value) || type.startsWith('x-')) continue;
        for (const pr of tp.value.items) {
          const name = String(keyOf(pr));
          if (name.startsWith('x-') || !pr.value) continue;
          units.push({ id: type + ':' + name, kind: 'component', type, name, pair: pr, tags: [] });
        }
      }
    }
    return units;
  }

  function assignGroups(units, o) {
    const rules = o.strategy === 'custom' ? parseRules(o.customRules) : [];
    const groups = new Map();
    const put = (key, kind, unit) => {
      if (!groups.has(key)) groups.set(key, { key, kind, units: [] });
      groups.get(key).units.push(unit);
      unit.group = key;
    };
    for (const u of units) {
      const isSchema = u.kind === 'component' && u.type === 'schemas';
      let key = null;
      let kind = u.kind === 'path' ? 'paths' : 'components:' + u.type;
      for (const r of rules) {
        const subject = r.kind === 'paths' ? (u.kind === 'path' ? u.name : null) : r.kind === 'tag' ? (u.tags[0] || null) : r.kind === '*' ? u.name : (u.kind === 'component' && u.type === r.kind ? u.name : null);
        if (subject !== null && r.re.test(subject)) { key = r.target; break; }
      }
      if (!key) {
        if (u.kind === 'path') {
          if (o.strategy === 'schemas') { u.inline = true; continue; }
          key = o.strategy === 'paths' ? 'paths/' + fileStem(u.name, o.naming) : o.strategy === 'tags' ? 'paths/' + fileStem(u.tags[0] || 'general', o.naming) : 'paths/paths';
        } else key = o.strategy === 'schemas' && isSchema ? 'schemas/' + fileStem(u.name, o.naming === 'kebab' ? 'original' : o.naming) : 'components/' + fileStem(u.type, o.naming);
      }
      put(key, kind, u);
    }
    let list = Array.from(groups.values());
    const natural = list.length;
    // ajuste al numero objetivo (solo se fusionan/dividen grupos del mismo tipo)
    const target = Math.max(0, parseInt(o.target, 10) || 0);
    if (target && o.strategy !== 'custom') {
      while (list.length > target) {
        const byKind = {};
        list.forEach((g) => { (byKind[g.kind] = byKind[g.kind] || []).push(g); });
        const pool = Object.values(byKind).filter((l) => l.length > 1).sort((a, b) => b.length - a.length)[0];
        if (!pool) break;
        pool.sort((a, b) => a.units.length - b.units.length);
        const small = pool[0]; const other = pool[1];
        other.units.push(...small.units); small.units.forEach((u) => { u.group = other.key; });
        list = list.filter((g) => g !== small);
      }
      while (list.length < target) {
        const big = list.filter((g) => g.units.length > 1).sort((a, b) => b.units.length - a.units.length)[0];
        if (!big) break;
        const half = Math.ceil(big.units.length / 2);
        const moved = big.units.splice(half);
        let key = big.key + '-2'; let i = 2;
        while (list.some((g) => g.key === key)) key = big.key + '-' + (++i);
        const ng = { key, kind: big.kind, units: moved };
        moved.forEach((u) => { u.group = key; });
        list.push(ng);
      }
    }
    return { groups: list, natural };
  }

  function planExport(project, options) {
    const o = Object.assign({}, DEFAULTS, options || {});
    o.groupNames = o.groupNames || {};
    const eol = (project.file(project.rootFile) || {}).eol || '\n';
    const dir = o.outDir ? (U.normalizePath(o.outDir) || '') : '';
    const rootName = U.normalizePath(o.rootName || U.basename(project.rootFile)) || 'openapi.yaml';
    const rootPath = (dir ? dir + '/' : '') + rootName;
    const bundle = B.bundleProject(project);
    const notes = [];
    const files = new Map();
    let groups = [];
    let natural = 0;

    if (!bundle.doc.contents || !isMap(bundle.doc.contents)) throw new Error('El fichero raíz no contiene un documento OpenAPI válido; corrigelo antes de guardar.');

    if (o.mode === 'single') {
      files.set(rootPath, P.stringifyDoc(bundle.doc, eol));
      if (bundle.notes.length) notes.push('Se ignoraron propiedades junto a $ref en ' + bundle.notes.length + ' sitio(s).');
    } else {
      const rootMap = bundle.doc.contents;
      const units = collectUnits(rootMap);
      const asg = assignGroups(units, o);
      groups = asg.groups; natural = asg.natural;
      const used = new Set([rootPath]);
      const stemToPath = (stem) => {
        let s = o.groupNames[stem] !== undefined && o.groupNames[stem] !== '' ? o.groupNames[stem] : stem;
        s = String(s).replace(/\\/g, '/');
        if (!/\.ya?ml$/i.test(s)) s += '.yaml';
        let p = U.normalizePath((dir ? dir + '/' : '') + s);
        if (!p) p = (dir ? dir + '/' : '') + 'fragmento.yaml';
        let cand = p; let i = 2;
        while (used.has(cand.toLowerCase())) cand = p.replace(/\.(ya?ml)$/i, '-' + (i++) + '.$1');
        used.add(cand.toLowerCase());
        return cand;
      };
      const groupByKey = new Map();
      for (const g of groups) { g.file = stemToPath(g.key); g.single = g.units.length === 1 && (g.kind === 'paths' || g.key.startsWith('schemas/') || o.strategy === 'paths'); groupByKey.set(g.key, g); }
      const unitById = new Map(units.map((u) => [u.id, u]));
      const unitFor = (segs) => {
        if (segs[0] === 'paths' && segs.length >= 2) { const u = unitById.get('paths:' + segs[1]); if (u && !u.inline) return { u, rest: segs.slice(2) }; }
        if (segs[0] === 'components' && segs.length >= 3) { const u = unitById.get(segs[1] + ':' + segs[2]); if (u) return { u, rest: segs.slice(3) }; }
        return null;
      };
      const locationOf = (u) => { const g = groupByKey.get(u.group); return { file: g.file, single: g.single }; };
      const mkRef = (fromFile, segs) => {
        const hit = unitFor(segs);
        let toFile; let frag;
        if (hit) { const loc = locationOf(hit.u); toFile = loc.file; frag = loc.single ? hit.rest : [hit.u.name].concat(hit.rest); }
        else { toFile = rootPath; frag = segs; }
        if (toFile === fromFile) return '#' + (frag.length ? U.toPtr(frag) : '') || '#';
        return U.encodeRefPath(U.relativePath(U.dirname(fromFile), toFile)) + (frag.length ? '#' + U.toPtr(frag) : '');
      };
      const rewrite = (node, fromFile, ctx) => {
        if (isMap(node)) {
          for (const pr of node.items) {
            const ks = String(keyOf(pr));
            if (!ctx.names && ks === '$ref' && isScalar(pr.value) && typeof pr.value.value === 'string') {
              const v = pr.value.value;
              if (v.startsWith('#/')) pr.value.value = mkRef(fromFile, U.fromPtr(v.slice(1)));
              continue;
            }
            if (skipKey(ks, ctx)) continue;
            if (pr.value && (isMap(pr.value) || isSeq(pr.value))) rewrite(pr.value, fromFile, childCtx(ks, ctx));
          }
        } else if (isSeq(node)) node.items.forEach((it) => { if (it && (isMap(it) || isSeq(it))) rewrite(it, fromFile, { names: false, parent: ctx.parent, exObj: false }); });
      };
      // 1) reescribir los $ref dentro de cada unidad segun su fichero definitivo, y en el raiz
      for (const u of units) { if (u.inline) continue; rewrite(u.pair.value, locationOf(u).file, u.kind === 'path' ? childCtx(u.name, { names: true, parent: 'paths', exObj: false }) : childCtx(u.name, { names: true, parent: u.type, exObj: false })); }
      for (const u of units) if (u.inline) rewrite(u.pair.value, rootPath, childCtx(u.name, { names: true, parent: 'paths', exObj: false }));
      // el resto del raiz (info, servers, security...) puede tener refs propios
      rewriteRootRest(rootMap, rewrite, rootPath);
      // 2) construir los ficheros de cada grupo
      for (const g of groups) {
        const d = new YAML.Document();
        if (g.single) d.contents = g.units[0].pair.value;
        else {
          const m = new YAML.YAMLMap();
          for (const u of g.units) m.items.push(new YAML.Pair(new YAML.Scalar(u.name), u.pair.value));
          d.contents = m;
        }
        files.set(g.file, P.stringifyDoc(d, eol));
      }
      // 3) sustituir cada unidad del raiz por un $ref
      for (const u of units) {
        if (u.inline) continue;
        const loc = locationOf(u);
        const ref = mkRefForRoot(rootPath, loc, u);
        const m = new YAML.YAMLMap();
        m.items.push(new YAML.Pair(new YAML.Scalar('$ref'), new YAML.Scalar(ref)));
        u.pair.value = m;
      }
      files.set(rootPath, P.stringifyDoc(bundle.doc, eol));
      if (target(o) && groups.length !== target(o)) notes.push('Se pidieron ' + target(o) + ' fragments y la distribución resultante usa ' + groups.length + ': el número es un objetivo y se ajusta a las dependencias y a la estrategia (grupos naturales: ' + natural + ').');
    }

    function target(x) { return parseInt(x.target, 10) || 0; }
    function mkRefForRoot(rp, loc, u) {
      return U.encodeRefPath(U.relativePath(U.dirname(rp), loc.file)) + (loc.single ? '' : '#' + U.toPtr([u.name]));
    }

    return finishPlan(project, files, rootPath, groups, notes, natural, o);
  }

  function rewriteRootRest(rootMap, rewrite, rootPath) {
    for (const pr of rootMap.items) {
      const k = String(keyOf(pr));
      if (k === 'paths' || k === 'components') continue;
      if (pr.value && (isMap(pr.value) || isSeq(pr.value))) rewrite(pr.value, rootPath, childCtx(k, rootCtx()));
    }
    const comps = findPair(rootMap, 'components');
    if (comps && isMap(comps.value)) for (const tp of comps.value.items) {
      const t = String(keyOf(tp));
      if (t.startsWith('x-') && tp.value && (isMap(tp.value) || isSeq(tp.value))) rewrite(tp.value, rootPath, rootCtx());
    }
  }

  /** Recarga el resultado propuesto, lo valida y lo compara con el original. */
  function finishPlan(project, files, rootPath, groups, notes, natural, o) {
    const existing = project.texts();
    const preview = { created: [], modified: [], unchanged: [], unused: [] };
    const norm = (t) => String(t).replace(/\r\n/g, '\n');
    for (const [p, t] of files) {
      if (!existing.has(p)) preview.created.push(p);
      else if (norm(existing.get(p)) === norm(t)) preview.unchanged.push(p);
      else preview.modified.push(p);
    }
    for (const p of existing.keys()) if (!files.has(p)) preview.unused.push(p);
    preview.created.sort(); preview.modified.sort(); preview.unchanged.sort(); preview.unused.sort();

    const verification = { ok: false, errors: [], changes: 0, fileCount: files.size };
    try {
      const check = Project.fromFiles(files, rootPath);
      const val = V.validateProject(check);
      const src = V.validateProject(project);
      const outErr = val.diagnostics.filter((d) => d.severity === 'error');
      const srcErr = src.diagnostics.filter((d) => d.severity === 'error');
      const cmp = C.compareProjects(project, check);
      const semantic = cmp.changes.filter((c) => c.kind !== 'error');
      verification.changes = semantic.length;
      verification.errors = outErr.map((d) => (d.file ? d.file + ': ' : '') + d.message).slice(0, 20);
      verification.sourceErrors = srcErr.length;
      verification.outputErrors = outErr.length;
      verification.ok = semantic.length === 0 && outErr.length <= srcErr.length && check.refIndex().filter((r) => r.error).length <= project.refIndex().filter((r) => r.error).length;
      if (semantic.length) verification.errors.unshift('El resultado difiere semánticamente del original (' + semantic.length + ' cambios).');
    } catch (e) {
      verification.errors = ['No se pudo recargar el resultado: ' + e.message];
    }
    return {
      files, rootPath, options: o, notes, preview, verification, natural,
      groups: groups.map((g) => ({ key: g.key, kind: g.kind, file: g.file, count: g.units.length, units: g.units.map((u) => u.name) }))
    };
  }

  return { planExport, DEFAULTS, parseRules };
});
