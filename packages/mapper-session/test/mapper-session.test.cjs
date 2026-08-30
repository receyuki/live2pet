const assert = require('node:assert/strict');
const test = require('node:test');

const { createProject } = require('../../project/src/index.cjs');
const { MapperSessionError, startMapperSession } = require('../src/index.cjs');

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
