/* Editor YAML por fichero con numeración de líneas, errores con línea/columna y borrador pendiente. */
(function () {
  'use strict';
  const O = (window.OAT = window.OAT || {});
  const { h, icon, btn } = O.dom;

  function create(app) {
    const el = h('div', { class: 'yaml-editor' });
    const fileSel = h('select', { 'aria-label': 'Fichero YAML', class: 'file-select' });
    const status = h('span', { class: 'yaml-status' });
    const pos = h('span', { class: 'muted pos' }, 'Ln 1, Col 1');
    const locateBtn = btn('Localizar en formulario', () => locate(), 'small', 'crosshair');
    const discardBtn = btn('Descartar borrador', () => { app.project.discardDraft(file); load(file); }, 'small', 'x');
    const bar = h('div', { class: 'yaml-bar' }, fileSel, status, h('span', { class: 'spacer' }), pos, locateBtn, discardBtn);
    const gutter = h('pre', { class: 'gutter', 'aria-hidden': 'true' });
    const ta = h('textarea', { class: 'code', spellcheck: 'false', wrap: 'off', 'aria-label': 'Editor YAML', autocomplete: 'off', autocapitalize: 'off' });
    const errBox = h('div', { class: 'yaml-errors', role: 'alert' });
    el.append(bar, h('div', { class: 'code-wrap' }, gutter, ta), errBox);
    let file = null;
    let applying = false;
    let timer = null;

    const eolOf = () => { const f = app.project.file(file); return f ? f.eol : '\n'; };
    const display = (t) => String(t).replace(/\r\n/g, '\n');
    const toDisk = (t) => (eolOf() === '\r\n' ? t.replace(/\n/g, '\r\n') : t);

    function fillFiles() {
      const files = Array.from(app.project.files.keys()).sort((a, b) => (b === app.project.rootFile) - (a === app.project.rootFile) || a.localeCompare(b));
      fileSel.textContent = '';
      files.forEach((p) => fileSel.appendChild(h('option', { value: p }, p + (p === app.project.rootFile ? '  (raíz)' : ''))));
      if (file) fileSel.value = file;
    }
    function errorsNow() {
      const f = app.project.file(file);
      if (!f) return [];
      return f.draft ? f.draft.errors : f.errors;
    }
    function updateGutter() {
      const n = ta.value.split('\n').length;
      const errLines = new Set(errorsNow().map((e) => e.line));
      let html = '';
      for (let i = 1; i <= n; i++) html += errLines.has(i) ? '<span class="err">' + i + '</span>\n' : i + '\n';
      gutter.innerHTML = html;
      gutter.scrollTop = ta.scrollTop;
    }
    function renderStatus() {
      const f = app.project.file(file);
      const errs = errorsNow().filter((e) => e.severity !== 'warning');
      status.textContent = '';
      errBox.textContent = '';
      discardBtn.style.display = f && f.draft ? '' : 'none';
      if (f && f.draft) status.append(h('span', { class: 'badge warn' }, 'Borrador con errores: no aplicado'));
      else if (errs.length) status.append(h('span', { class: 'badge err' }, errs.length + ' error(es) de sintaxis'));
      else status.append(h('span', { class: 'badge ok' }, 'Sincronizado'));
      errorsNow().forEach((e) => errBox.appendChild(h('button', { type: 'button', class: 'yaml-err', onclick: () => goto(e.line, e.col) }, icon('alert-circle'), h('span', null, 'Línea ' + e.line + ', columna ' + e.col + ': ' + e.message))));
    }
    function load(name) {
      file = name;
      const f = app.project.file(name);
      if (!f) { ta.value = ''; updateGutter(); return; }
      app.yamlFile = name;
      ta.value = display(f.draft ? f.draft.text : f.text);
      fillFiles();
      updateGutter(); renderStatus();
    }
    function goto(line, col) {
      const lines = ta.value.split('\n');
      let off = 0;
      for (let i = 0; i < Math.min(line - 1, lines.length - 1); i++) off += lines[i].length + 1;
      off += Math.max(0, (col || 1) - 1);
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
      ta.focus();
      ta.setSelectionRange(off, Math.min(off + Math.max(1, (lines[line - 1] || '').length - (col || 1) + 1), ta.value.length));
      ta.scrollTop = Math.max(0, (line - 4) * lh);
      gutter.scrollTop = ta.scrollTop;
      updatePos();
    }
    function updatePos() {
      const before = ta.value.slice(0, ta.selectionStart);
      const line = before.split('\n').length;
      pos.textContent = 'Ln ' + line + ', Col ' + (before.length - before.lastIndexOf('\n'));
    }
    function locate() {
      const before = ta.value.slice(0, ta.selectionStart);
      const lineIdx = before.split('\n').length - 1;
      const docOffset = ta.selectionStart + (eolOf() === '\r\n' ? lineIdx : 0);
      const p = app.project;
      const f = p.file(file);
      if (f && f.draft) { app.toast('Corrige primero los errores del borrador', 'error'); return; }
      const path = p.pathAtOffset(file, docOffset);
      const logical = p.toLogical(file, path);
      if (!logical) { app.toast('Este nodo no está enlazado desde el contrato raíz', 'error'); return; }
      app.selectByLogical(logical, { keepYaml: true });
    }
    function commit() {
      applying = true;
      try { app.project.setFileText(file, toDisk(ta.value)); } finally { applying = false; }
      updateGutter(); renderStatus();
    }
    ta.addEventListener('input', () => { updateGutter(); clearTimeout(timer); timer = setTimeout(commit, 400); });
    ta.addEventListener('blur', () => { if (timer) { clearTimeout(timer); timer = null; commit(); } });
    ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
    ['keyup', 'click', 'select'].forEach((ev) => ta.addEventListener(ev, updatePos));
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      const s = ta.selectionStart; const en = ta.selectionEnd;
      if (e.shiftKey) {
        const ls = ta.value.lastIndexOf('\n', s - 1) + 1;
        const m = /^ {1,2}/.exec(ta.value.slice(ls));
        if (m) { ta.setRangeText('', ls, ls + m[0].length, 'preserve'); ta.setSelectionRange(Math.max(ls, s - m[0].length), Math.max(ls, en - m[0].length)); }
      } else ta.setRangeText('  ', s, en, 'end');
      ta.dispatchEvent(new Event('input'));
    });
    fileSel.addEventListener('change', () => { if (timer) { clearTimeout(timer); commit(); } load(fileSel.value); });

    return {
      el,
      show(name, line, col) {
        if (!app.project.file(name)) name = app.project.rootFile;
        if (file !== name) load(name); else sync(true);
        if (line) requestAnimationFrame(() => goto(line, col));
      },
      sync,
      current: () => file,
      focus: () => ta.focus(),
      flush() { if (timer) { clearTimeout(timer); timer = null; commit(); } }
    };

    function sync(force) {
      if (applying) return;
      if (!file || !app.project.file(file)) { load(app.project.rootFile); return; }
      const f = app.project.file(file);
      const wanted = display(f.draft ? f.draft.text : f.text);
      if (force || ta.value !== wanted) {
        if (document.activeElement === ta && !f.draft && timer) return;
        const st = ta.scrollTop; const s = ta.selectionStart;
        ta.value = wanted;
        ta.scrollTop = st; try { ta.setSelectionRange(Math.min(s, wanted.length), Math.min(s, wanted.length)); } catch (e) { /* ignore */ }
      }
      fillFiles(); updateGutter(); renderStatus();
    }
  }

  O.yamlEditor = { create };
})();
