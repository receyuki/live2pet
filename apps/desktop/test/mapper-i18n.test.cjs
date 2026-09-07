const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const mapperPath = path.resolve(__dirname, '../../mapper/index.html');

function readCatalog() {
  const html = fs.readFileSync(mapperPath, 'utf8');
  const match = html.match(/const messages = (\{[\s\S]*?\n      \});\n      let locale/);
  assert.ok(match, 'inline Mapper translation catalog should be readable');
  const context = {};
  vm.runInNewContext(`this.messages = ${match[1]}`, context);
  return context.messages;
}

function placeholders(value) {
  return [...value.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]).sort();
}

test('legacy Mapper keeps English and Simplified Chinese catalogs aligned', () => {
  const messages = readCatalog();
  assert.deepEqual(Object.keys(messages['zh-CN']).sort(), Object.keys(messages.en).sort());
  for (const key of Object.keys(messages.en)) {
    assert.deepEqual(placeholders(messages['zh-CN'][key]), placeholders(messages.en[key]), key);
  }
});

test('legacy Mapper Chinese copy contains no leftover implementation jargon', () => {
  const { ['zh-CN']: chinese } = readCatalog();
  const obsoleteTerms = /\b(?:App|runtime|Mapper|Agent|Juggling|samples\/s)\b/;
  for (const [key, value] of Object.entries(chinese)) {
    assert.doesNotMatch(value.replace(/\{[^}]+\}/g, ''), obsoleteTerms, key);
  }
});
