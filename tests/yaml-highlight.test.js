const test = require('node:test');
const assert = require('node:assert/strict');
const { highlight } = require('../js/ui/yaml-highlight');

test('highlights YAML keys, scalar values, comments, and quoted content safely', () => {
  const html = highlight('name: "<item>"\ncount: 12\nenabled: true\nnote: null # comment');

  assert.match(html, /class="yaml-key">name/);
  assert.match(html, /class="yaml-string">&quot;&lt;item&gt;&quot;/);
  assert.match(html, /class="yaml-number">12/);
  assert.match(html, /class="yaml-boolean">true/);
  assert.match(html, /class="yaml-null">null/);
  assert.match(html, /class="yaml-comment"># comment/);
  assert.doesNotMatch(html, /<item>/);
});