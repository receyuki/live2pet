const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  RendererContractError,
  createRendererAssetServer,
  safeBufferPath,
} = require('../src/asset-server.cjs');

function runtimeFixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-buffer-assets-'));
  const runtimePath = path.join(directory, 'live2dcubismcore.min.js');
  fs.writeFileSync(runtimePath, 'runtime');
  return runtimePath;
}

test('renderer asset server serves an allowlisted virtual Source Package', async () => {
  const runtimePath = runtimeFixture();
  const mutableTexture = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
  const sourceBuffers = new Map([
    ['model.json', Buffer.from('{"model":"model.moc"}')],
    ['model.moc', Buffer.from([0x6d, 0x6f, 0x63])],
    ['textures/face.png', mutableTexture],
  ]);
  const server = await createRendererAssetServer({ sourceBuffers, runtimePath });
  mutableTexture.fill(0);
  sourceBuffers.set('late.json', Buffer.from('{}'));
  try {
    const model = await fetch(server.modelUrl('model.json'));
    assert.equal(model.status, 200);
    assert.equal(model.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(await model.text(), '{"model":"model.moc"}');

    const texture = await fetch(server.modelUrl('textures/face.png'));
    assert.equal(texture.status, 200);
    assert.equal(texture.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await texture.arrayBuffer()), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

    const head = await fetch(server.modelUrl('model.moc'), { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '3');
    assert.equal(await head.text(), '');

    assert.equal((await fetch(server.modelUrl('late.json'))).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/model/${encodeURIComponent('../secret.json')}`)).status, 404);
    assert.equal((await fetch(`${server.baseUrl}/model/${encodeURIComponent('/etc/passwd')}`)).status, 404);
  } finally {
    await server.close();
  }
});

test('renderer asset server validates virtual Source Package boundaries', async () => {
  const runtimePath = runtimeFixture();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-source-root-'));
  assert.equal(safeBufferPath('textures/face.png'), 'textures/face.png');
  assert.equal(safeBufferPath('./textures/face.png'), 'textures/face.png');
  assert.equal(safeBufferPath('../secret'), null);
  assert.equal(safeBufferPath('/absolute'), null);
  assert.equal(safeBufferPath('C:/absolute'), null);

  const invalidSources = [
    {},
    { sourceRoot: root, sourceBuffers: new Map([['model.json', Buffer.from('{}')]]) },
    { sourceBuffers: new Map() },
    { sourceBuffers: new Map([['../secret', Buffer.from('secret')]]) },
    { sourceBuffers: new Map([['model.json', '{}']]) },
    { sourceBuffers: new Map([['model.json', Buffer.from('a')], ['./model.json', Buffer.from('b')]]) },
  ];
  for (const source of invalidSources) {
    await assert.rejects(
      () => createRendererAssetServer({ ...source, runtimePath }),
      (error) => error instanceof RendererContractError && error.code === 'INVALID_ASSET_SERVER',
    );
  }
});

test('renderer asset server accepts a plain object of ArrayBuffer resources', async () => {
  const runtimePath = runtimeFixture();
  const bytes = new TextEncoder().encode('{}');
  const server = await createRendererAssetServer({
    sourceBuffers: { 'model.json': bytes.buffer },
    runtimePath,
  });
  try {
    assert.equal(await (await fetch(server.modelUrl('model.json'))).text(), '{}');
  } finally {
    await server.close();
  }
});
