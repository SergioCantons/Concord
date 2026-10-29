(function (root) {
  'use strict';

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function span(kind, text) {
    return '<span class="yaml-' + kind + '">' + escapeHtml(text) + '</span>';
  }

  function findComment(line) {
    let quote = '';
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (quote === '"' && char === '\\') { i++; continue; }
      if (quote === "'" && char === "'" && line[i + 1] === "'") { i++; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === '#' && (i === 0 || /\s/.test(line[i - 1]))) return i;
    }
    return line.length;
  }

  function findKey(line, end) {
    let start = 0;
    while (start < end && /\s/.test(line[start])) start++;
    if (line[start] === '-' && /\s/.test(line[start + 1] || '')) {
      start++;
      while (start < end && /\s/.test(line[start])) start++;
    }
    let quote = '';
    for (let i = start; i < end; i++) {
      const char = line[i];
      if (quote === '"' && char === '\\') { i++; continue; }
      if (quote === "'" && char === "'" && line[i + 1] === "'") { i++; continue; }
      if (quote) { if (char === quote) quote = ''; continue; }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === ':' && (i + 1 === end || /\s|[,{[]/.test(line[i + 1]))) return { start, colon: i };
    }
    return null;
  }

  function scanValue(text) {
    let out = '';
    for (let i = 0; i < text.length;) {
      const char = text[i];
      if (/\s/.test(char)) { out += escapeHtml(char); i++; continue; }
      if (char === '#' && (i === 0 || /\s/.test(text[i - 1]))) { out += span('comment', text.slice(i)); break; }
      if (char === '"' || char === "'") {
        const quote = char;
        let j = i + 1;
        while (j < text.length) {
          if (quote === '"' && text[j] === '\\') { j += 2; continue; }
          if (text[j] === quote) {
            if (quote === "'" && text[j + 1] === "'") { j += 2; continue; }
            j++; break;
          }
          j++;
        }
        out += span('string', text.slice(i, j)); i = j; continue;
      }
      if ((char === '&' || char === '*') && /[^\s,[\]{}]/.test(text[i + 1] || '')) {
        let j = i + 2;
        while (j < text.length && /[^\s,[\]{}]/.test(text[j])) j++;
        out += span('anchor', text.slice(i, j)); i = j; continue;
      }
      if (char === '!' && /[^\s,[\]{}]/.test(text[i + 1] || '')) {
        let j = i + 2;
        while (j < text.length && /[^\s,[\]{}]/.test(text[j])) j++;
        out += span('tag', text.slice(i, j)); i = j; continue;
      }
      if ('[]{}:,?'.includes(char) || (char === '-' && (i + 1 === text.length || /\s/.test(text[i + 1])))) {
        out += span('punctuation', char); i++; continue;
      }
      let j = i + 1;
      while (j < text.length && !/\s|[\[\]{},?]/.test(text[j])) {
        if (text[j] === ':' && (j + 1 === text.length || /\s|[,{[]/.test(text[j + 1]))) break;
        j++;
      }
      const token = text.slice(i, j);
      const kind = /^(?:true|false)$/i.test(token) ? 'boolean'
        : /^(?:null|~)$/i.test(token) ? 'null'
          : /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(token) ? 'number' : '';
      out += kind ? span(kind, token) : escapeHtml(token);
      i = j;
    }
    return out;
  }

  function highlightLine(line) {
    const commentAt = findComment(line);
    const body = line.slice(0, commentAt);
    const key = findKey(body, body.length);
    let out;
    if (key) {
      out = escapeHtml(body.slice(0, key.start)) + span('key', body.slice(key.start, key.colon)) + span('punctuation', ':') + scanValue(body.slice(key.colon + 1));
    } else {
      const marker = /^\s*(---|\.\.\.)(?=\s|$)/.exec(body);
      out = marker ? escapeHtml(marker[0].slice(0, marker[0].indexOf(marker[1]))) + span('punctuation', marker[1]) + scanValue(body.slice(marker[0].length)) : scanValue(body);
    }
    return out + (commentAt < line.length ? span('comment', line.slice(commentAt)) : '');
  }

  function highlight(source) {
    return String(source).split('\n').map(highlightLine).join('\n');
  }

  function attach(textarea) {
    if (textarea.dataset.yamlHighlight) return;
    textarea.dataset.yamlHighlight = 'true';
    textarea.wrap = 'off';
    const parent = textarea.parentNode;
    const wrapper = document.createElement('div');
    wrapper.className = 'yaml-highlight-wrap';
    const layer = document.createElement('pre');
    layer.className = 'yaml-highlight';
    layer.setAttribute('aria-hidden', 'true');
    function syncStyle() {
      const current = getComputedStyle(textarea);
      ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'tabSize'].forEach((name) => { layer.style[name] = current[name]; });
      ['Top', 'Right', 'Bottom', 'Left'].forEach((side) => {
        layer.style['padding' + side] = (parseFloat(current['border' + side + 'Width']) || 0) + (parseFloat(current['padding' + side]) || 0) + 'px';
      });
    }
    if (parent) parent.insertBefore(wrapper, textarea);
    wrapper.append(layer, textarea);
    textarea.classList.add('yaml-highlight-input');
    const update = () => { layer.innerHTML = highlight(textarea.value); };
    const syncScroll = () => { layer.style.transform = 'translate(' + -textarea.scrollLeft + 'px, ' + -textarea.scrollTop + 'px)'; };
    textarea.addEventListener('input', update);
    textarea.addEventListener('scroll', syncScroll);
    textarea.yamlHighlightUpdate = update;
    textarea.yamlHighlightSyncStyle = syncStyle;
    requestAnimationFrame(syncStyle);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(syncStyle).observe(textarea);
    update();
    syncScroll();
    return wrapper;
  }

  function refresh(textarea) {
    if (textarea.yamlHighlightSyncStyle) textarea.yamlHighlightSyncStyle();
    if (textarea.yamlHighlightUpdate) textarea.yamlHighlightUpdate();
  }

  function render(element) {
    element.innerHTML = highlight(element.textContent);
    element.classList.add('yaml-highlighted');
  }

  const api = { highlight, attach, refresh, render };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.OAT = root.OAT || {}).yamlHighlight = api;
})(typeof window !== 'undefined' ? window : globalThis);