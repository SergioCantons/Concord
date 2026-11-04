/* Vista de comparación semántica de dos contratos locales (base y comparado). */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, iconBtn, btn, showMenu } = O.dom;
  const F = O.forms;
  const KIND = { added: ['+', 'Añadido'], removed: ['\u2212', 'Eliminado'], modified: ['~', 'Modificado'], renamed: ['\u21C4', 'Renombrado'], moved: ['\u2192', 'Movido'], error: ['!', 'Error'], unchanged: ['=', 'Sin cambios'] };
  const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
  // Mismas vistas que el editor: Formulario = cambios semánticos, YAML = diff textual, Dividida = ambas a la vez.
  const VIEWS = [['form', 'Formulario', 'panel-left', 'Cambios semánticos'], ['yaml', 'YAML', 'file-code', 'Diff textual por fichero'], ['split', 'Dividida', 'layers', 'Cambios semánticos y diff textual']];
  const isNarrow = () => window.innerWidth < 900;

  function create(app) {
    const el = h('div', { class: 'compare-view' });
    const head = h('div', { class: 'seg view-seg', role: 'tablist', 'aria-label': 'Vista de la comparación' });
    const S = app.cmp = app.cmp || { base: null, next: null, result: null, running: false, filters: { kinds: new Set(['added', 'removed', 'modified', 'renamed', 'moved', 'error']), breaking: 'all', q: '', tag: '', method: '', area: '' }, selId: null, view: 'form', xMode: 'informative', textPair: {}, picked: new Set() };
    let content = null;
    // Un fichero soltado fuera de las tarjetas no debe hacer que el navegador lo abra y abandone la aplicación.
    document.addEventListener('dragover', (e) => { if (app.mode === 'compare' && !e.defaultPrevented && hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'none'; } });
    document.addEventListener('drop', (e) => { if (app.mode === 'compare' && hasFiles(e)) e.preventDefault(); });

    function currentView() {
      if (!VIEWS.some((v) => v[0] === S.view) || (S.view === 'split' && isNarrow())) S.view = 'form';
      return S.view;
    }
    function renderTabs() {
      const cur = currentView();
      head.textContent = '';
      VIEWS.filter(([id]) => id !== 'split' || !isNarrow()).forEach(([id, label, ic, title]) => head.appendChild(h('button', { type: 'button', role: 'tab', title, class: cur === id ? 'on' : '', 'aria-selected': cur === id ? 'true' : 'false', onclick: () => setView(id) }, icon(ic), h('span', null, label))));
    }
    function setView(id) {
      S.view = id;
      renderTabs();
      renderContent();
    }

    function sourceCard(which, title) {
      const side = S[which];
      const card = h('div', { class: 'cmp-side' });
      card.appendChild(h('h3', null, title));
      const info = side
        ? h('div', { class: 'cmp-info' }, h('strong', null, side.label), h('span', { class: 'muted' }, side.project.files.size + ' fichero(s) · raíz ' + side.project.rootFile), h('div', { class: 'row wrap' }, side.errors ? h('span', { class: 'badge err' }, side.errors + ' error(es)') : h('span', { class: 'badge ok' }, 'Referencias resueltas'), merges(side) ? h('span', { class: 'badge warn', title: 'Tiene cambios trasladados desde el otro contrato que aún no se han guardado' }, 'Modificado por la fusión') : null))
        : h('div', { class: 'muted' }, 'Sin contrato seleccionado');
      card.appendChild(info);
      const actions = h('div', { class: 'row wrap' },
        btn('Carpeta...', () => load(which, O.fileio.openFolder), 'small', 'folder-open'),
        btn('Archivos...', () => load(which, O.fileio.openLooseFiles), 'small', 'file-up'),
        btn('Contrato abierto', () => useCurrent(which), 'small', 'file-code', { disabled: !app.project, title: app.project ? null : 'No hay ningún contrato abierto' }));
      if (O.fileio.hasFsAccess) actions.appendChild(btn('Recientes', async (e) => { const anchor = e.currentTarget; showMenu(anchor, await app.recentMenuItems((rec) => load(which, () => O.fileio.openRecent(rec)), { empty: true })); }, 'small', 'history'));
      if (app.settings.showExamples) actions.appendChild(btn('Ejemplo', (e) => showMenu(e.currentTarget, Object.keys(O.EXAMPLES).map((k) => ({ label: O.EXAMPLES[k].title, onClick: () => useExample(which, k) }))), 'small', 'archive'));
      card.appendChild(actions);
      card.append(h('p', { class: 'cmp-drop-hint muted' }, icon('upload'), h('span', null, 'O arrastra aquí ficheros YAML/JSON o su carpeta')),
        h('div', { class: 'cmp-drop', 'aria-hidden': 'true' }, icon('upload'), h('span', null, 'Suelta para usar como ' + title.toLowerCase())));
      dropTarget(card, which);
      return card;
    }
    function dropTarget(card, which) {
      let depth = 0;
      const over = (on) => card.classList.toggle('drop-over', on);
      card.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; over(true); });
      card.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; over(true); });
      card.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) over(false); });
      card.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault(); depth = 0; over(false);
        // Las entradas deben obtenerse durante el evento: después el DataTransfer deja de ser accesible.
        const drop = O.fileio.captureDrop(e.dataTransfer);
        load(which, () => O.fileio.readDropped(drop));
      });
    }
    const countErrors = (project) => project.refIndex().filter((r) => r.error).length + Array.from(project.files.values()).reduce((n, f) => n + f.errors.filter((e) => e.severity === 'error').length, 0);
    /** extra: target (dónde guardarlo al abrirlo en el editor), fromCurrent (proyecto del editor del que es copia), example. */
    function describe(project, label, extra) {
      return Object.assign({ project, label, errors: countErrors(project) }, extra || {});
    }
    const MERGE_RE = /^(Incorporar|Revertir) \d+ cambio/;
    /** Fusiones pendientes de guardar en un lado (las del historial de deshacer, si tiene cambios sin guardar). */
    function merges(side) { return side && side.project.isDirty() ? side.project.past.filter((p) => MERGE_RE.test(p.label)).length : 0; }
    /** Vuelca el borrador del editor si alguno de los lados es el contrato abierto en él. */
    function flushEditor() { if (app.yaml && ((S.base && S.base.project === app.project) || (S.next && S.next.project === app.project))) app.yaml.flush(); }
    function confirmDiscardMerges(which) {
      const side = S[which];
      // Si ya está abierto en el editor, sus cambios siguen allí al sustituirlo en la comparación.
      if (!merges(side) || side.project === app.project) return Promise.resolve(true);
      return app.confirm({ title: 'Descartar la fusión', message: 'El ' + (which === 'base' ? 'contrato base' : 'contrato comparado') + ' tiene cambios trasladados sin guardar. Si lo sustituyes se perderán.', confirmLabel: 'Descartar', danger: true });
    }
    async function load(which, read) {
      if (!(await confirmDiscardMerges(which))) return;
      try {
        const r = await read();
        if (!r) return;
        if (r.skipped && r.skipped.length) app.toast('Se omitieron ' + r.skipped.length + ' fichero(s) de más de 8 MB', 'info');
        if (!r.files.size) { app.toast('No se encontraron ficheros .yaml, .yml o .json. Usa ficheros de contrato o una carpeta que los contenga; la selección actual no ha cambiado.', 'error'); return; }
        const root = await app.chooseRoot(r.files);
        if (!root) return;
        const p = O.project.Project.fromFiles(r.files, root, r.folderName || O.util.basename(root));
        S[which] = describe(p, (r.folderName ? r.folderName + '/' : '') + root, { target: O.saveUI.targetFromResult(r) });
        const recent = app.recentEntry(r);
        if (recent) O.fileio.addRecent(Object.assign({ rootFile: root, name: r.folderName || O.util.basename(root).replace(/\.(ya?ml|json)$/i, '') }, recent));
        S.result = null; render();
      } catch (e) { app.toast('No se pudo abrir: ' + e.message, 'error'); }
    }
    async function useCurrent(which) {
      if (!(await confirmDiscardMerges(which))) return;
      if (app.yaml) app.yaml.flush();
      const cur = app.project;
      const p = O.project.Project.fromFiles(cur.texts(), cur.rootFile, cur.name);
      // La copia conserva la referencia de "guardado" y la configuración del original para poder sustituirlo después.
      p.original = new Map(cur.original); p.extras = new Map(cur.extras); p.extrasOriginal = new Map(cur.extrasOriginal);
      p.past = cur.past.slice();
      if (cur.hasDraft()) app.toast('El contrato abierto tiene un borrador YAML con errores: la comparación usa su último estado válido.', 'info', 5000);
      S[which] = describe(p, cur.name + ' (contrato abierto)', { target: app.target, fromCurrent: cur, srcVersion: cur.version, example: !!cur.isExample });
      S.result = null; render();
    }
    async function useExample(which, key) {
      if (!(await confirmDiscardMerges(which))) return;
      const ex = O.EXAMPLES[key];
      S[which] = describe(O.project.Project.fromFiles(ex.files, ex.root, ex.title), ex.title, { example: true });
      S.result = null; render();
    }

    /* ---------- Fusión: trasladar cambios de un contrato a otro ---------- */
    const SIDE_NAME = { base: 'base', next: 'comparado' };
    const mergeable = (c) => O.merge.MERGEABLE.has(c.kind);
    /** fromNext=true: el base adopta la versión del comparado; false: el comparado vuelve a la versión del base. */
    function applyMerge(ids, fromNext) {
      const changes = S.result.changes.filter((c) => ids.includes(c.id) && mergeable(c));
      if (!changes.length) return;
      const which = fromNext ? 'base' : 'next';
      const target = S[which]; const source = S[fromNext ? 'next' : 'base'];
      flushEditor();
      let res;
      try {
        res = O.merge.applyChanges(target.project, source.project, changes, { fromNext, label: (fromNext ? 'Incorporar ' : 'Revertir ') + changes.length + ' cambio(s) de la comparación' });
      } catch (e) { app.toast('No se pudo fusionar: ' + e.message, 'error'); return; }
      target.errors = countErrors(target.project);
      S.picked.clear();
      const parts = [(fromNext ? 'Incorporado(s) al base: ' : 'Revertido(s) en el comparado: ') + res.applied.length + ' cambio(s)'];
      if (res.deps.length) parts.push('también se copiaron ' + res.deps.join(', '));
      if (res.skipped.length) parts.push(res.skipped.length + ' omitido(s): ' + res.skipped[0].reason);
      if (res.brokenRefs) parts.push('quedan ' + res.brokenRefs + ' referencia(s) sin resolver; revisa los elementos que aún las usan');
      app.toast(parts.join('. ') + '.', res.brokenRefs || !res.applied.length ? 'error' : 'ok', 6000);
      run();
    }
    function undoMerge(which) {
      const side = S[which];
      if (!side) return;
      flushEditor();
      const last = side.project.past[side.project.past.length - 1];
      if (!last || !MERGE_RE.test(last.label)) { app.toast('La última edición del ' + SIDE_NAME[which] + ' no es una fusión' + (last ? ' («' + last.label + '»); deshazla desde el editor.' : '.'), 'error', 5000); return; }
      const l = side.project.undo();
      if (!l) return;
      side.errors = countErrors(side.project);
      app.toast('Deshecho en el ' + SIDE_NAME[which] + ': ' + l, 'info', 2500);
      if (S.result) run(); else render();
    }
    /** Abre el contrato fusionado en el editor para revisarlo y guardarlo. */
    function openInEditor(which) {
      const side = S[which];
      if (!side) return;
      const open = () => {
        app.loadProject(side.project, { target: side.target || null, example: !!side.example });
        side.fromCurrent = side.project; side.srcVersion = side.project.version;
        app.toast('Contrato ' + SIDE_NAME[which] + ' abierto en el editor: revisa los cambios y guárdalo.', 'ok', 4000);
      };
      if (side.project === app.project) { app.setMode('edit'); return; }
      // Si es copia del contrato abierto y este no ha cambiado, la copia lo sustituye sin perder nada.
      if (side.fromCurrent && side.fromCurrent === app.project && app.project.version === side.srcVersion && !app.project.hasDraft()) { open(); return; }
      if (side.fromCurrent && side.fromCurrent === app.project) {
        app.confirm({ title: 'El contrato abierto ha cambiado', message: 'Has editado el contrato abierto después de usarlo en la comparación. La versión fusionada no incluye esas ediciones: si la abres, se descartarán.', confirmLabel: 'Continuar', danger: true }).then((ok) => { if (ok) app.guarded(open); });
        return;
      }
      app.guarded(open);
    }
    function downloadSide(which) {
      const side = S[which];
      flushEditor();
      const files = new Map(side.project.texts());
      side.project.extras.forEach((t, p) => files.set(p, t));
      if (files.size === 1) O.fileio.downloadText(side.project.rootFile.split('/').pop(), files.get(side.project.rootFile), 'application/yaml;charset=utf-8');
      else O.fileio.downloadZip((side.project.name || 'contrato') + '.zip', files);
    }
    function mergeBanner() {
      const sides = ['base', 'next'].filter((w) => merges(S[w]));
      if (!sides.length) return null;
      return h('div', { class: 'merge-banner' }, sides.map((w) => h('div', { class: 'merge-banner-row' },
        icon('git-compare'),
        h('span', { class: 'grow' }, h('strong', null, 'Contrato ' + SIDE_NAME[w] + ': '), merges(S[w]) + ' fusión(es) aplicada(s) sin guardar. ', h('span', { class: 'muted' }, S[w].project === app.project ? 'Está abierto en el editor: guárdalo desde allí.' : 'Ábrelo en el editor para revisarlo y guardarlo, o descárgalo.')),
        btn('Deshacer', () => undoMerge(w), 'small', 'undo-2', { title: 'Deshace la última fusión aplicada al ' + SIDE_NAME[w] }),
        btn('Abrir en el editor', () => openInEditor(w), 'small primary', 'external-link'),
        btn('Descargar', () => downloadSide(w), 'small', 'download'))));
    }
    /** Barra de selección múltiple sobre la lista de cambios. */
    function mergeBar() {
      const visible = () => filtered().filter(mergeable);
      const all = h('input', { type: 'checkbox', 'aria-label': 'Seleccionar todos los cambios visibles' });
      const count = h('span', { class: 'muted', 'aria-live': 'polite' });
      const toBase = btn('\u2190 Incorporar al base', () => applyMerge(Array.from(S.picked), true), 'small primary', null, { title: 'Copia en el contrato base la versión del comparado de los cambios seleccionados' });
      const toNext = btn('Revertir en el comparado \u2192', () => applyMerge(Array.from(S.picked), false), 'small', null, { title: 'Deshace en el contrato comparado los cambios seleccionados, restaurando la versión del base' });
      const update = () => {
        const vis = visible();
        const n = vis.filter((c) => S.picked.has(c.id)).length;
        all.checked = vis.length > 0 && n === vis.length; all.indeterminate = n > 0 && n < vis.length; all.disabled = !vis.length;
        const hidden = S.picked.size - n;
        count.textContent = S.picked.size ? S.picked.size + ' seleccionado(s)' + (hidden ? ' (' + hidden + ' ocultos por los filtros)' : '') : 'Selecciona cambios para trasladarlos de un contrato a otro';
        toBase.disabled = toNext.disabled = !S.picked.size;
      };
      all.addEventListener('change', () => { const vis = visible(); if (all.checked) vis.forEach((c) => S.picked.add(c.id)); else vis.forEach((c) => S.picked.delete(c.id)); fillBody(); });
      S._updateMergeBar = update;
      update();
      return h('div', { class: 'row wrap merge-bar' }, h('label', { class: 'check' }, all, h('span', null, 'Todos los visibles')), count, h('span', { class: 'spacer' }), toBase, toNext);
    }

    async function run() {
      if (!S.base || !S.next) { app.toast('Selecciona los dos contratos', 'error'); return; }
      S.running = true; render();
      await new Promise((r) => setTimeout(r, 40));
      try {
        flushEditor();
        S.result = O.compare.compareProjects(S.base.project, S.next.project, { xMode: S.xMode });
        S.resultVersions = [S.base.project.version, S.next.project.version];
        S.selId = null;
        // Los id de los cambios son posicionales: una selección anterior apuntaría a otros cambios.
        S.picked.clear();
        S.planCache = new Map();
      } catch (e) { app.toast('Error al comparar: ' + e.message, 'error'); S.result = null; }
      S.running = false; render();
    }

    function filtered() {
      const r = S.result; const f = S.filters; const q = f.q.toLowerCase();
      let list = r.changes.slice();
      if (f.kinds.has('unchanged')) list = list.concat(r.unchanged.map((u, i) => Object.assign({ id: 'U' + i, pathText: u.title, path: [], tags: [], breaking: false }, u)));
      return list.filter((c) => f.kinds.has(c.kind) && (f.breaking === 'all' || (f.breaking === 'yes' ? c.breaking : !c.breaking && c.kind !== 'error'))
        && (!f.tag || (c.tags || []).includes(f.tag)) && (!f.method || c.method === f.method) && (!f.area || c.area === f.area)
        && (!q || (c.title + ' ' + c.pathText + ' ' + (c.route || '') + ' ' + (c.schema || '') + ' ' + (c.tags || []).join(' ')).toLowerCase().includes(q)));
    }

    /** El resultado se queda obsoleto si un lado se edita (p. ej. en el editor) después de comparar. */
    function stale() { return !!(S.result && S.resultVersions && S.base && S.next && (S.base.project.version !== S.resultVersions[0] || S.next.project.version !== S.resultVersions[1])); }
    function render() {
      if (stale() && !S.running) { S.result = null; setTimeout(run, 0); }
      el.textContent = '';
      el.appendChild(h('div', { class: 'cmp-top' },
        sourceCard('base', 'Contrato base'),
        h('div', { class: 'cmp-mid' }, iconBtn('arrow-left-right', 'Intercambiar base y comparado', () => { const t = S.base; S.base = S.next; S.next = t; S.result = null; render(); }), btn('Comparar', run, 'primary', 'git-compare', { disabled: !S.base || !S.next || S.running })),
        sourceCard('next', 'Contrato comparado')));
      const banner = mergeBanner();
      if (banner) el.appendChild(banner);
      const opts = h('div', { class: 'row wrap cmp-opts' }, F.field('Extensiones x-*', (() => { const s = h('select', { 'aria-label': 'Tratamiento de extensiones x-*' }, h('option', { value: 'informative' }, 'Informativas'), h('option', { value: 'blocking' }, 'Bloqueantes (incompatibles)'), h('option', { value: 'ignore' }, 'Ignorar')); s.value = S.xMode; s.addEventListener('change', () => { S.xMode = s.value; if (S.result) run(); }); return s; })()));
      el.appendChild(opts);
      content = h('div', { class: 'cmp-content' });
      el.appendChild(content);
      renderTabs();
      renderContent();
    }

    function emptyState(msg) { return h('div', { class: 'empty-state' }, h('img', { src: 'assets/contract-map.svg', alt: '' }), h('p', { class: 'muted' }, msg)); }
    function renderContent() {
      content.textContent = '';
      const view = currentView();
      content.className = 'cmp-content view-' + view;
      if (S.running) { content.appendChild(h('div', { class: 'activity' }, icon('loader'), h('span', null, 'Comparando contratos...'))); return; }
      const both = !!(S.base && S.next);
      if (view === 'yaml') { content.appendChild(both ? textDiff() : emptyState('Elige el contrato base y el comparado para ver el diff textual por fichero.')); return; }
      if (view === 'form') { content.appendChild(S.result ? semantic() : emptyState(both ? 'Pulsa «Comparar» para ver las diferencias semánticas.' : 'Elige el contrato base y el comparado para ver las diferencias semánticas.')); return; }
      if (!both) { content.appendChild(emptyState('Elige el contrato base y el comparado para ver las diferencias semánticas y el diff textual.')); return; }
      const split = h('div', { class: 'cmp-split' });
      const left = h('section', { class: 'cmp-pane', 'aria-label': 'Cambios semánticos' }, S.result ? semantic() : h('p', { class: 'muted pad' }, 'Pulsa «Comparar» para ver los cambios semánticos.'));
      split.append(left,
        O.dom.splitter({ axis: 'x', varName: '--cmp-split', def: 50, min: 25, max: 75, container: () => split, measure: () => (left.offsetWidth / (split.clientWidth || 1)) * 100, label: 'Redimensionar cambios semánticos y diff textual' }),
        h('section', { class: 'cmp-pane', 'aria-label': 'Diff textual por fichero' }, textDiff()));
      content.appendChild(split);
    }

    function semantic() {
      const r = S.result; const sum = r.summary;
      const wrap = h('div', { class: 'cmp-result' });
      if (r.incomplete) {
        wrap.appendChild(h('div', { class: 'callout error' }, icon('alert-triangle'), h('div', null, h('strong', null, 'Comparación incompleta: '), 'hay referencias sin resolver o errores de sintaxis; esos elementos no se consideran iguales.', h('ul', { class: 'detail-list' }, r.sideErrors.slice(0, 8).map((e) => h('li', null, '[' + e.side + '] ' + e.file + ' ' + e.path + ': ' + e.message)), r.sideErrors.length > 8 ? h('li', null, '... y ' + (r.sideErrors.length - 8) + ' más') : null))));
      }
      const chipDefs = [['added', sum.added], ['removed', sum.removed], ['modified', sum.modified], ['renamed', (sum.renamed || 0) + (sum.moved || 0)], ['error', sum.error], ['unchanged', sum.unchanged]];
      const chips = h('div', { class: 'chips-bar' }, chipDefs.map(([k, n]) => h('button', { type: 'button', class: 'sev-chip kind-' + k + (S.filters.kinds.has(k) ? ' on' : ''), 'aria-pressed': S.filters.kinds.has(k) ? 'true' : 'false', onclick: () => { const ks = S.filters.kinds; if (k === 'renamed') { ['renamed', 'moved'].forEach((x) => (ks.has(x) ? ks.delete(x) : ks.add(x))); } else if (ks.has(k)) ks.delete(k); else ks.add(k); refreshSemantic(); } }, h('span', { class: 'kglyph' }, KIND[k][0]), h('span', null, n + ' ' + KIND[k][1].toLowerCase() + (k === 'renamed' ? '/movidos' : '')))),
        h('span', { class: 'badge ' + (sum.breaking ? 'err' : 'ok'), title: 'Clasificación orientativa; no garantiza compatibilidad' }, sum.breaking + ' potencialmente incompatibles'));
      wrap.appendChild(chips);
      const tags = Array.from(new Set(r.changes.flatMap((c) => c.tags || []))).sort();
      const areas = Array.from(new Set(r.changes.map((c) => c.area))).sort();
      const sel = (label, key, opts) => { const s = h('select', { 'aria-label': label }, h('option', { value: '' }, label), opts.map((o) => h('option', { value: o }, o))); s.value = S.filters[key]; s.addEventListener('change', () => { S.filters[key] = s.value; refreshSemantic(); }); return s; };
      const q = h('input', { type: 'search', class: 'mini-search', placeholder: 'Buscar cambios...', value: S.filters.q, 'aria-label': 'Buscar cambios' });
      q.addEventListener('input', () => { S.filters.q = q.value; clearTimeout(q._t); q._t = setTimeout(fillBody, 150); });
      const brk = h('div', { class: 'seg', role: 'group', 'aria-label': 'Compatibilidad' }, [['all', 'Todos'], ['yes', 'Incompatibles'], ['no', 'Compatibles']].map(([k, l]) => h('button', { type: 'button', class: S.filters.breaking === k ? 'on' : '', onclick: () => { S.filters.breaking = k; refreshSemantic(); } }, l)));
      const exp = btn('Exportar', (e) => showMenu(e.currentTarget, [
        { label: 'Markdown (.md)', icon: 'file-text', onClick: () => exportAs('md') }, { label: 'HTML (.html)', icon: 'file-code', onClick: () => exportAs('html') }, { label: 'JSON (.json)', icon: 'braces', onClick: () => exportAs('json') }]), '', 'download');
      wrap.appendChild(h('div', { class: 'row wrap cmp-filters' }, q, brk, sel('Todos los tags', 'tag', tags), sel('Todos los métodos', 'method', O.util.HTTP_METHODS), sel('Todas las áreas', 'area', areas), h('span', { class: 'spacer' }), exp));
      wrap.appendChild(mergeBar());
      const body = h('div', { class: 'cmp-body' });
      wrap.appendChild(body);
      S._body = body;
      fillBody();
      return wrap;
    }
    /** Repinta solo los cambios semánticos (filtros) sin rehacer el diff textual de la vista dividida. */
    function refreshSemantic() {
      const old = content && content.querySelector('.cmp-result');
      if (old) old.replaceWith(semantic());
    }

    function fillBody() {
      const body = S._body;
      body.textContent = '';
      const list = filtered();
      if (S._updateMergeBar) S._updateMergeBar();
      const groups = new Map();
      const add = (g, c) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); };
      list.forEach((c) => { if (c.route) add('Endpoints \u203A ' + c.route + (c.method ? ' ' + c.method.toUpperCase() : ''), c); else if (c.schema) add('Schemas \u203A ' + c.schema, c); else if (c.kind === 'error') add('Errores', c); else if (c.section === 'components') add('Otros componentes', c); else add('Contrato (info, servidores, tags, seguridad)', c); });
      const tree = h('div', { class: 'cmp-tree', role: 'tree' });
      if (!list.length) tree.appendChild(h('p', { class: 'muted pad' }, S.result.changes.length ? 'Ningún cambio con estos filtros.' : 'No hay diferencias semánticas entre los dos contratos.'));
      let shown = 0;
      for (const [g, items] of groups) {
        if (shown > 600) { tree.appendChild(h('p', { class: 'muted pad' }, 'Hay más resultados: acota con filtros o búsqueda.')); break; }
        tree.appendChild(h('div', { class: 'group-head static' }, h('span', { class: 'group-name' }, g), h('span', { class: 'count' }, String(items.length))));
        items.forEach((c) => {
          shown++;
          let chk = null;
          if (mergeable(c)) {
            chk = h('input', { type: 'checkbox', class: 'merge-check', 'aria-label': 'Seleccionar para fusionar: ' + c.title });
            chk.checked = S.picked.has(c.id);
            chk.addEventListener('click', (e) => e.stopPropagation());
            chk.addEventListener('keydown', (e) => e.stopPropagation());
            chk.addEventListener('change', () => { if (chk.checked) S.picked.add(c.id); else S.picked.delete(c.id); if (S._updateMergeBar) S._updateMergeBar(); });
          }
          const row = h('div', { class: 'tree-item change ' + c.kind + (S.selId === c.id ? ' selected' : ''), role: 'treeitem', tabindex: 0 }, chk, h('span', { class: 'kglyph k-' + c.kind, title: KIND[c.kind][1] }, KIND[c.kind][0]), h('span', { class: 'ti-main' }, h('span', { class: 'ti-route' }, c.title), h('span', { class: 'ti-sub' }, c.pathText)), c.breaking ? h('span', { class: 'badge err', title: c.reason }, 'incompat.') : null);
          const pick = () => { S.selId = c.id; fillBody(); };
          row.addEventListener('click', pick);
          row.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
          tree.appendChild(row);
        });
      }
      body.append(tree,
        O.dom.splitter({ axis: 'x', varName: '--cmp-tree', def: 43, min: 20, max: 75, container: () => body, measure: () => (tree.offsetWidth / (body.clientWidth || 1)) * 100, label: 'Redimensionar lista de cambios' }),
        O.dom.splitter({ axis: 'y', varName: '--cmp-tree-h', def: 300, min: 120, max: () => window.innerHeight * 0.8, measure: () => tree.offsetHeight, label: 'Redimensionar altura de la lista de cambios' }),
        detail(list));
    }
    function yamlOf(v) { if (v === undefined) return '(sin valor)'; try { return O.vendor.YAML.stringify(v, { lineWidth: 0 }).trimEnd(); } catch (e) { return String(v); } }
    function detail(list) {
      const c = list.find((x) => x.id === S.selId) || S.result.changes.find((x) => x.id === S.selId);
      const box = h('div', { class: 'cmp-detail' });
      if (!c) { box.appendChild(h('p', { class: 'muted pad' }, 'Selecciona un cambio para ver el valor anterior y el nuevo.')); return box; }
      box.appendChild(h('div', { class: 'detail-head' }, h('span', { class: 'kglyph k-' + c.kind }, KIND[c.kind][0]), h('h3', null, c.title)));
      box.appendChild(h('div', { class: 'row wrap' }, h('span', { class: 'badge kind' }, KIND[c.kind][1]), h('span', { class: 'badge kind' }, c.area), c.breaking ? h('span', { class: 'badge err' }, 'Potencialmente incompatible') : h('span', { class: 'badge ok' }, 'No incompatible'), c.route ? h('code', null, (c.method ? c.method.toUpperCase() + ' ' : '') + c.route) : null, c.schema ? h('code', null, 'schema ' + c.schema) : null));
      if (c.reason) box.appendChild(h('p', null, c.reason));
      if (mergeable(c) && S.base && S.next) box.appendChild(mergeDetail(c));
      if (c.breaking) box.appendChild(h('p', { class: 'muted' }, 'Clasificación orientativa según el contexto de uso; no es una garantía de compatibilidad.'));
      box.appendChild(h('div', { class: 'row wrap' }, h('code', { class: 'path-code' }, c.pathText), btn('Copiar ruta', () => copy(c.pathText), 'small', 'copy'), btn('Copiar id', () => copy(c.id), 'small', 'copy')));
      box.appendChild(h('div', { class: 'old-new' }, h('div', null, h('h4', null, 'Antes (base)'), highlightedBlock(yamlOf(c.old))), h('div', null, h('h4', null, 'Ahora (comparado)'), highlightedBlock(yamlOf(c.new)))));
      return box;
    }
    /** Qué haría la fusión de un cambio en cada sentido (se calcula una vez por comparación). */
    function planFor(c) {
      if (!S.planCache) S.planCache = new Map();
      if (!S.planCache.has(c.id)) {
        let p;
        try { p = { toBase: O.merge.planChanges(S.base.project, S.next.project, [c], { fromNext: true })[0], toNext: O.merge.planChanges(S.next.project, S.base.project, [c], { fromNext: false })[0] }; }
        catch (e) { p = { toBase: { skip: e.message }, toNext: { skip: e.message } }; }
        S.planCache.set(c.id, p);
      }
      return S.planCache.get(c.id);
    }
    function mergeDetail(c) {
      const plan = planFor(c);
      const what = (p, sideName) => {
        if (p.skip) return h('span', { class: 'muted' }, p.skip);
        if (p.action === 'rename') return ['Renombra en el ' + sideName + ' ', h('code', null, p.scope), ' y actualiza sus referencias.'];
        if (p.action === 'move') return ['Mueve en el ' + sideName + ' la operación ', h('code', null, p.scope), '.'];
        return ['Copia al ' + sideName + ' ', h('code', null, p.scope), ' completo y, si hace falta, los componentes y tags que use.'];
      };
      const line = (button, p, sideName) => h('div', { class: 'merge-option' }, button, h('span', { class: 'merge-what' }, what(p, sideName)));
      const toBase = btn('\u2190 Incorporar al base', () => applyMerge([c.id], true), 'small primary', null, { disabled: !!plan.toBase.skip });
      const toNext = btn('Revertir en el comparado \u2192', () => applyMerge([c.id], false), 'small', null, { disabled: !!plan.toNext.skip });
      return h('div', { class: 'merge-detail' }, h('h4', null, 'Fusionar'),
        line(toBase, plan.toBase, 'base'),
        line(toNext, plan.toNext, 'comparado'),
        h('p', { class: 'muted small' }, 'Cada fusión se puede deshacer desde el aviso superior.'));
    }
    function highlightedBlock(text) {
      const pre = h('pre', { class: 'code-block' }, text);
      O.yamlHighlight.render(pre);
      return pre;
    }
    function copy(text) {
      const done = () => app.toast('Copiado: ' + text, 'ok', 1800);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
      else fallback();
      function fallback() { const t = h('textarea', { style: { position: 'fixed', opacity: 0 } }); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); done(); } catch (e) { app.toast('No se pudo copiar', 'error'); } t.remove(); }
    }
    function exportAs(fmt) {
      const meta = { base: S.base.label, compared: S.next.label };
      const C = O.compare;
      if (fmt === 'md') O.fileio.downloadText('comparacion-openapi.md', C.toMarkdown(S.result, meta), 'text/markdown;charset=utf-8');
      else if (fmt === 'html') O.fileio.downloadText('comparacion-openapi.html', C.toHtml(S.result, meta), 'text/html;charset=utf-8');
      else O.fileio.downloadText('comparacion-openapi.json', C.toJson(S.result), 'application/json;charset=utf-8');
    }

    function textDiff() {
      const a = S.base.project; const b = S.next.project;
      const wrap = h('div', { class: 'text-diff' });
      const fa = Array.from(a.files.keys()); const fb = Array.from(b.files.keys());
      const selA = h('select', { 'aria-label': 'Fichero base' }, fa.map((p) => h('option', { value: p }, p)));
      const selB = h('select', { 'aria-label': 'Fichero comparado' }, fb.map((p) => h('option', { value: p }, p)));
      selA.value = S.textPair.a && fa.includes(S.textPair.a) ? S.textPair.a : a.rootFile;
      selB.value = S.textPair.b && fb.includes(S.textPair.b) ? S.textPair.b : (fb.includes(selA.value) ? selA.value : b.rootFile);
      const out = h('div', { class: 'diff-lines' });
      const draw = () => {
        S.textPair = { a: selA.value, b: selB.value };
        out.textContent = '';
        const d = O.compare.lineDiff(a.file(selA.value).text, b.file(selB.value).text);
        if (d.tooLarge) { out.appendChild(h('p', { class: 'muted pad' }, 'Los ficheros son demasiado grandes para el diff textual.')); return; }
        if (!d.lines.some((l) => l.t !== '=')) out.appendChild(h('p', { class: 'muted pad' }, 'Los ficheros son idénticos en texto.'));
        let ln = 0;
        const frag = document.createDocumentFragment();
        d.lines.forEach((l) => {
          if (l.t !== '+') ln++;
          const text = h('span', { class: 't' });
          text.innerHTML = O.yamlHighlight.highlight(l.text);
          frag.appendChild(h('div', { class: 'dl ' + l.t }, h('span', { class: 'n' }, l.t === '+' ? '' : String(ln)), h('span', { class: 'sg' }, l.t === '=' ? ' ' : l.t), text));
        });
        out.appendChild(frag);
      };
      selA.addEventListener('change', draw); selB.addEventListener('change', draw);
      wrap.append(h('div', { class: 'row wrap' }, F.field('Base', selA), F.field('Comparado', selB)), out);
      draw();
      return wrap;
    }

    render();
    /** La vista dividida no cabe en pantallas estrechas: igual que en el editor, se vuelve a Formulario. */
    function onResize() {
      const was = S.view;
      renderTabs();
      if (S.view !== was) renderContent();
    }
    return { el, head, refresh: render, onResize };
  }

  O.compareView = { create };
})();
