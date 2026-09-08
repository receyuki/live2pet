const assert = require('node:assert/strict');
const test = require('node:test');

const { RELEASES_API, compareVersions, createUpdateService } = require('../update-service.cjs');

function response(body, { status = 200 } = {}) {
  const text = JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, headers: { get: () => String(Buffer.byteLength(text)) }, text: async () => text };
}

test('compares stable product versions numerically', () => {
  assert.equal(compareVersions('1.0.1', '1.0.0'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.9.9', '1.0.0'), -1);
});

test('checks only the latest formal GitHub Release and returns a derived URL', async () => {
  const requests = [];
  const service = createUpdateService({
    currentVersion: '1.0.0',
    fetchImpl: async (url, options) => { requests.push({ url, options }); return response({ tag_name: 'v1.0.1', draft: false, prerelease: false }); },
    openExternal: async () => undefined,
  });
  assert.deepEqual(await service.check(), {
    schemaVersion: 1,
    state: 'available',
    currentVersion: '1.0.0',
    latestVersion: '1.0.1',
    releaseUrl: 'https://github.com/receyuki/live2pet/releases/tag/v1.0.1',
  });
  assert.equal(requests[0].url, RELEASES_API);
  assert.equal(requests[0].options.headers['User-Agent'], 'Live2Pet/1.0.0');
});

test('reports no first release and opens only a validated release version', async () => {
  const opened = [];
  const service = createUpdateService({
    currentVersion: '0.1.0',
    fetchImpl: async () => response({}, { status: 404 }),
    openExternal: async (url) => opened.push(url),
  });
  assert.deepEqual(await service.check(), { schemaVersion: 1, state: 'no-release', currentVersion: '0.1.0' });
  assert.deepEqual(await service.open('0.1.1'), { opened: true });
  assert.deepEqual(opened, ['https://github.com/receyuki/live2pet/releases/tag/v0.1.1']);
  await assert.rejects(() => service.open('../latest'), /Unsupported release version/);
});
