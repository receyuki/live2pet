const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { createRendererAssetServer, legacyDecoderDocument } = require('../src/asset-server.cjs');

function files(line) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-legacy-assets-'));
  const result = { adapter: 'legacy', runtimeLine: line };
  for (const key of ['script', 'pixi', 'unsafeEval', line === '2.1' ? 'decoder' : 'base']) {
    result[key] = path.join(root, `${key}.js`);
    fs.writeFileSync(result[key], `// ${key}`);
  }
  return { root, assets: result };
}

for (const line of ['2.1', '3.5', '3.6', '3.7', '3.8']) test(`strict legacy Spine ${line} routes and self-only CSP`, async () => {
  const fixture = files(line);
  const server = await createRendererAssetServer({ sourceBuffers: { 'model.json': Buffer.from('{}'), 'evil.js': Buffer.from('alert(1)'), 'image.png': Buffer.from([1]) }, spineAssets: fixture.assets });
  try {
    const html = await (await fetch(server.previewUrl)).text();
    assert.match(html, /worker-src 'self'/);
    assert.doesNotMatch(html, /'unsafe-eval'|https:/); // trusted shim is a path, not an eval CSP grant
    assert.ok(html.indexOf('pixi.js') < html.indexOf('spine-player.js'));
    assert.equal((await fetch(`${server.baseUrl}/vendor/pixi.js`)).status, 200);
    assert.equal((await fetch(`${server.baseUrl}/vendor/unknown.js`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/model/evil.js`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/model/model.json`)).status, 200);
    assert.equal((await fetch(`${server.baseUrl}/model/%2e%2e%2fpackage.json`)).status, 404);
    if (line === '2.1') {
      const decoder = await (await fetch(server.legacyDecoderUrl)).text();
      assert.match(decoder, /byteLength>8388608/);
      assert.match(decoder, /importScripts\('\.\/spine-player.js'\)/);
    } else {
      assert.equal(server.legacyDecoderUrl, null);
      const bridge = await (await fetch(`${server.baseUrl}/vendor/spine-runtime-bridge.js`)).text();
      assert.match(bridge, new RegExp(line === '3.8' ? 'spine38' : 'spine37'));
    }
  } finally { await server.close(); fs.rmSync(fixture.root, { recursive: true }); }
});

test('legacy runtime cannot be supplied as a model-selected external URL', async () => {
  await assert.rejects(createRendererAssetServer({ sourceBuffers: { 'model.json': Buffer.from('{}') }, spineAssets: { adapter: 'legacy', runtimeLine: '3.6', script: 'https://model.invalid/script.js' } }), { code: 'INVALID_ASSET_SERVER' });
});

test('2.1 worker bounds decoded controls before structured cloning', () => {
  const messages = [];
  const context = { ArrayBuffer, self: { postMessage(message) { messages.push(message); } }, importScripts(url) {
    assert.equal(url, './spine-player.js');
    context.self.onmessage = () => context.self.postMessage({ json: { bones: [], slots: [], skins: {}, animations: {} } });
  } };
  vm.runInNewContext(legacyDecoderDocument().toString(), context);
  context.self.onmessage({ data: new ArrayBuffer(8) });
  assert.equal(messages.pop().json.bones.length, 0);
  context.self.postMessage({ json: { bones: [], slots: [], timeline: new Array(110000).fill(0) } });
  assert.equal(messages.pop().json.timeline.length, 110000);
  context.self.postMessage({ json: { bones: [], slots: [], timeline: new Array(262144).fill(0) } });
  assert.equal(messages.pop().error, 'spine_controls_too_large');
  context.self.postMessage({ json: { bones: new Array(2001), slots: [] } });
  assert.equal(messages.pop().error, 'spine_controls_too_large');
  context.self.postMessage({ json: { bones: [], slots: [], animations: Object.fromEntries(new Array(201).fill(0).map((_, index) => [index, {}])) } });
  assert.equal(messages.pop().error, 'spine_controls_too_large');
  context.self.onmessage({ data: new ArrayBuffer(8388609) });
  assert.equal(messages.pop().error, 'spine_binary_too_large');
});
