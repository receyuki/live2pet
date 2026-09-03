const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const links = require('../runtime-help-links.json');
const { createRuntimeHelpWindowHandler } = require('../runtime-help.cjs');

test('runtime help opens only the two exact README sections outside the App', async () => {
  const opened = [];
  const handler = createRuntimeHelpWindowHandler(async (url) => opened.push(url));
  for (const url of [...Object.values(links), 'https://github.com/other/repo', `${links.en}?redirect=other`, 'https://github.com.evil.test/', 'file:///tmp/test', 'javascript:alert(1)']) {
    assert.deepEqual(handler({ url }), { action: 'deny' });
  }
  assert.deepEqual(opened, Object.values(links));
});

test('both help links resolve to maintained local README anchors and cross-language links', () => {
  for (const [locale, url] of Object.entries(links)) {
    const parsed = new URL(url);
    const file = path.basename(parsed.pathname);
    const readme = fs.readFileSync(path.resolve(__dirname, '../../..', file), 'utf8');
    assert.equal(parsed.hash, '#runtime-setup');
    assert.ok(readme.includes('<a id="runtime-setup"></a>'));
    assert.ok(readme.includes(locale === 'en' ? '(README.zh-CN.md)' : '(README.md)'));
  }
});
