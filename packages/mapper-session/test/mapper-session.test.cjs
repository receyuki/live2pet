const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createProject } = require('../../project/src/index.cjs');
const { MAX_MAPPER_HTML_BYTES, MapperSessionError, createMapperSessionClient, startMapperSession, startMapperSessionHost } = require('../src/index.cjs');

function project() {
  return createProject({
    projectId: 'session-fixture',
    name: 'Session fixture',
    source: { kind: 'synthetic', name: 'fixture', fingerprint: 'a'.repeat(64) },
  });
}

async function request(session, pathname, options = {}) {
  const headers = { Origin: session.origin, Authorization: `Bearer ${session.token}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  const response = await fetch(`${session.origin}${pathname}`, { ...options, headers });
  const text = await response.text();
  return { response, body: text ? JSON.parse(text) : null };
}

test('binds only to loopback and exposes a token-authenticated project allowlist', async () => {
  const session = await startMapperSession({ project: project(), idleTimeoutMs: 1000 });
  try {
    assert.equal(session.origin.startsWith('http://127.0.0.1:'), true);
    assert.equal(session.token.length >= 40, true);
    const metadata = await request(session, '/session');
    assert.equal(metadata.response.status, 200);
    assert.equal(metadata.body.sessionId, session.sessionId);
    assert.equal(JSON.stringify(metadata.body).includes(session.token), false);
    const initial = await request(session, '/project');
    assert.equal(initial.body.project.projectId, 'session-fixture');

    const next = { ...initial.body.project, name: 'Updated fixture' };
    const updated = await request(session, '/project', { method: 'PUT', body: JSON.stringify(next) });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.project.name, 'Updated fixture');

    const rejected = await request(session, '/project', { method: 'PUT', body: JSON.stringify({ ...next, projectId: 'other' }) });
    assert.equal(rejected.response.status, 400);
    assert.equal(rejected.body.error.code, 'PROJECT_NOT_ALLOWLISTED');
  } finally {
    await session.close();
  }
});

test('rejects missing or wrong credentials, origins, paths, and oversized bodies', async () => {
  const session = await startMapperSession({ project: project(), idleTimeoutMs: 1000 });
  try {
    const missing = await fetch(`${session.origin}/session`, { headers: { Origin: session.origin } });
    assert.equal(missing.status, 401);
    const wrongToken = await fetch(`${session.origin}/session`, { headers: { Origin: session.origin, Authorization: 'Bearer wrong-token' } });
    assert.equal(wrongToken.status, 401);
    const wrongOrigin = await fetch(`${session.origin}/session`, { headers: { Origin: 'http://evil.invalid', Authorization: `Bearer ${session.token}` } });
    assert.equal(wrongOrigin.status, 403);
    const unknown = await request(session, '/../../etc/passwd');
    assert.equal(unknown.response.status, 404);
    const oversized = await request(session, '/project', { method: 'PUT', body: JSON.stringify({ projectId: 'session-fixture', name: 'x'.repeat(2 * 1024 * 1024) }) });
    assert.equal(oversized.response.status, 413);
  } finally {
    await session.close();
  }
});

test('supports CORS preflight and expires after idle timeout', async () => {
  const session = await startMapperSession({ project: project(), idleTimeoutMs: 1000 });
  const preflight = await fetch(`${session.origin}/project`, { method: 'OPTIONS', headers: { Origin: session.origin, 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), session.origin);
  await session.close();

  await assert.rejects(
    () => startMapperSession({ project: project(), host: '0.0.0.0' }),
    (error) => error instanceof MapperSessionError && error.code === 'NON_LOOPBACK_BINDING',
  );
});

test('provides a token-authenticated client without exposing the bearer token', async () => {
  const session = await startMapperSession({ project: project(), idleTimeoutMs: 1000 });
  try {
    const client = createMapperSessionClient({ origin: session.origin, token: session.token });
    assert.equal(Object.hasOwn(client, 'token'), false);
    assert.equal((await client.getSession()).sessionId, session.sessionId);
    assert.equal((await client.getProject()).project.projectId, 'session-fixture');
    const next = { ...(await client.getProject()).project, name: 'Client update' };
    assert.equal((await client.updateProject(next)).project.name, 'Client update');
    assert.equal((await client.close()).ok, true);
    assert.equal(session.closed, true);
  } finally {
    await session.close();
  }
});

test('rejects non-loopback client origins before making a request', () => {
  assert.throws(() => createMapperSessionClient({ origin: 'http://localhost:1234', token: 'x'.repeat(40) }), (error) => error instanceof MapperSessionError && error.code === 'SESSION_ORIGIN_INVALID');
});

test('serves an optional mapper document and performs a one-time browser bootstrap without putting the bearer token in the URL', async () => {
  const mapperHtml = '<!doctype html><html><head><title>Mapper</title></head><body>fixture</body></html>';
  const session = await startMapperSession({ project: project(), mapperHtml, idleTimeoutMs: 1000 });
  try {
    const mapperUrl = session.getMapperUrl();
    assert.match(mapperUrl, new RegExp(`^${session.origin}/mapper#live2pet=http(?:%3A|:)`));
    assert.equal(mapperUrl.includes(session.token), false);
    const page = await fetch(mapperUrl);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), mapperHtml);
    assert.match(page.headers.get('content-security-policy'), /object-src 'none'/);
    assert.match(page.headers.get('content-security-policy'), /connect-src 'self' blob:/);

    const payload = new URL(mapperUrl).hash.slice('#live2pet='.length);
    const code = payload.slice(payload.lastIndexOf('.') + 1);
    const bootstrapped = await fetch(`${session.origin}/bootstrap`, {
      method: 'POST',
      headers: { Origin: session.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const body = await bootstrapped.json();
    assert.equal(bootstrapped.status, 200);
    assert.equal(body.token, session.token);
    const replay = await fetch(`${session.origin}/bootstrap`, {
      method: 'POST',
      headers: { Origin: session.origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    assert.equal(replay.status, 401);
    assert.equal((await replay.json()).error.code, 'BOOTSTRAP_INVALID');
    assert.equal(session.getMapperUrl(), null);
  } finally {
    await session.close();
  }
});

test('serves only explicitly allowlisted Mapper assets with typed content and Origin checks', async () => {
  const session = await startMapperSession({
    project: project(),
    mapperHtml: '<!doctype html><html><body><script src="vendor/test.js"></script></body></html>',
    mapperAssets: { 'vendor/test.js': 'window.__live2petFixture = true;' },
    idleTimeoutMs: 1000,
  });
  try {
    const asset = await fetch(`${session.origin}/vendor/test.js`, { headers: { Origin: session.origin } });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(asset.headers.get('access-control-allow-origin'), session.origin);
    assert.equal(await asset.text(), 'window.__live2petFixture = true;');

    const missing = await fetch(`${session.origin}/vendor/missing.js`, { headers: { Origin: session.origin, Authorization: `Bearer ${session.token}` } });
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).error.code, 'NOT_FOUND');

    const wrongOrigin = await fetch(`${session.origin}/vendor/test.js`, { headers: { Origin: 'http://evil.invalid' } });
    assert.equal(wrongOrigin.status, 403);
    assert.equal((await wrongOrigin.json()).error.code, 'ORIGIN_NOT_ALLOWED');
  } finally {
    await session.close();
  }
});

test('rejects unsafe or empty Mapper asset declarations before opening a session', async () => {
  for (const mapperAssets of [{ '../escape.js': 'x' }, { 'empty.js': '' }, { '/absolute.js': 'x' }]) {
    await assert.rejects(
      () => startMapperSession({ project: project(), mapperAssets }),
      (error) => error instanceof MapperSessionError && error.code === 'INVALID_MAPPER_ASSET',
    );
  }
});

test('rejects oversized mapper documents before opening a session', async () => {
  await assert.rejects(
    () => startMapperSession({ project: project(), mapperHtml: 'x'.repeat(MAX_MAPPER_HTML_BYTES + 1) }),
    (error) => error instanceof MapperSessionError && error.code === 'INVALID_MAPPER_HTML',
  );
});

test('creates a token-free launch descriptor for a file-based Mapper host and keeps the session client behind a closure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-mapper-host-'));
  const mapperPath = path.join(root, 'index.html');
  fs.writeFileSync(mapperPath, '<!doctype html><html><body>host</body></html>');
  const host = await startMapperSessionHost({ project: project(), mapperPath, mapperUrl: `file://${mapperPath}`, idleTimeoutMs: 1000 });
  try {
    const descriptor = host.getLaunchDescriptor();
    assert.equal(descriptor.origin, host.origin);
    assert.equal(descriptor.mapperUrl.startsWith(`file://${mapperPath}#live2pet=${encodeURIComponent(host.origin)}.`), true);
    assert.equal(Object.hasOwn(descriptor, 'token'), false);
    const client = host.getClient();
    assert.equal((await client.getProject()).project.projectId, 'session-fixture');
  } finally {
    await host.close();
  }
});

test('loads a bounded asset bundle for a Mapper host without exposing the source directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-mapper-assets-'));
  const mapperPath = path.join(root, 'index.html');
  const vendorPath = path.join(root, 'vendor');
  fs.mkdirSync(vendorPath);
  fs.writeFileSync(mapperPath, '<!doctype html><html><body>host</body></html>');
  fs.writeFileSync(path.join(vendorPath, 'test.js'), 'window.__hostFixture = true;');
  const host = await startMapperSessionHost({ project: project(), mapperPath, mapperUrl: `file://${mapperPath}`, mapperAssetRoot: root, idleTimeoutMs: 1000 });
  try {
    const asset = await fetch(`${host.origin}/vendor/test.js`, { headers: { Origin: host.origin } });
    assert.equal(asset.status, 200);
    assert.equal(await asset.text(), 'window.__hostFixture = true;');
    const source = await fetch(`${host.origin}/package.json`, { headers: { Origin: host.origin } });
    assert.equal(source.status, 401);
  } finally {
    await host.close();
  }
});

test('rejects non-loopback Mapper launch URLs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-mapper-host-'));
  const mapperPath = path.join(root, 'index.html');
  fs.writeFileSync(mapperPath, '<!doctype html><html><body>host</body></html>');
  await assert.rejects(
    () => startMapperSessionHost({ project: project(), mapperPath, mapperUrl: 'https://example.invalid/mapper' }),
    (error) => error instanceof MapperSessionError && error.code === 'INVALID_MAPPER_URL',
  );
});
