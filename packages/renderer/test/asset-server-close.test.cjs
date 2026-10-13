const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRendererAssetServer } = require('../src/asset-server.cjs');

test('closing a renderer server releases speculative connections with no HTTP request', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-server-close-'));
  const runtimePath = path.join(root, 'runtime.js');
  fs.writeFileSync(runtimePath, '// synthetic test input');
  const server = await createRendererAssetServer({ sourceRoot: root, runtimePath });
  let socket, closing;
  try {
    socket = net.connect({ host: server.host, port: server.port });
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    closing = server.close();
    const settled = await Promise.race([closing.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 200))]);
    assert.equal(settled, true, 'Unused Chromium preconnect sockets must not hold renderer cleanup open.');
  } finally {
    socket?.destroy();
    await (closing || server.close());
    fs.rmSync(root, { recursive: true, force: true });
  }
});
