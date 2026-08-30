const assert = require('node:assert/strict');
const test = require('node:test');

const {
  SkillProtocolError,
  assertCompatibleVersion,
  createSkillClient,
} = require('../src/index.cjs');

function envelope(operation, fields = {}) {
  return JSON.stringify({ protocolVersion: 1, cliVersion: '0.1.0', operation, operationId: 'test-operation', ok: true, progress: [], warnings: [], ...fields });
}

test('performs one protocol handshake and invokes a node CLI without a shell', async () => {
  const calls = [];
  const client = createSkillClient({
    cliPath: '/Applications/Live2Pet.app/Contents/Resources/live2pet.cjs',
    nodePath: '/usr/bin/node',
    runProcess: async (file, args, options) => {
      calls.push({ file, args, options });
      const operation = args[1];
      if (operation === 'version') return { stdout: envelope('version', { result: { protocolVersion: 1, cliVersion: '0.1.0', operations: ['version', 'inspect'] } }) };
      return { stdout: envelope(operation, { result: { inspected: true } }) };
    },
  });

  const result = await client.inspect('/tmp/model with spaces');
  assert.equal(result.result.inspected, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ['/Applications/Live2Pet.app/Contents/Resources/live2pet.cjs', 'version']);
  assert.deepEqual(calls[1].args, ['/Applications/Live2Pet.app/Contents/Resources/live2pet.cjs', 'inspect', '--input', '/tmp/model with spaces']);
  assert.equal(calls[1].options.shell, undefined);
});

test('rejects a protocol version mismatch and missing advertised capability', async () => {
  assert.throws(() => assertCompatibleVersion({ protocolVersion: 2, operation: 'version', ok: true }), (error) => error instanceof SkillProtocolError && error.code === 'UNSUPPORTED_PROTOCOL_VERSION');
  const client = createSkillClient({
    cliPath: 'live2pet',
    runProcess: async () => ({ stdout: envelope('version', { result: { protocolVersion: 1, cliVersion: '0.1.0', operations: ['version'] } }) }),
  });
  await assert.rejects(() => client.inspect('/tmp/model'), (error) => error instanceof SkillProtocolError && error.code === 'MISSING_CLI_CAPABILITY');
});

test('turns a typed CLI failure into a protocol error without copying stderr', async () => {
  const client = createSkillClient({
    cliPath: 'live2pet',
    runProcess: async (_file, args) => {
      if (args[0] === 'version') return { stdout: envelope('version', { result: { protocolVersion: 1, cliVersion: '0.1.0', operations: ['version', 'package-validate'] } }) };
      const error = new Error('exit');
      error.code = 1;
      error.stdout = envelope('package-validate', { ok: false, error: { code: 'PACKAGE_NOT_FOUND', message: 'Package is missing.', details: { path: '/private/secret.zip' } } });
      error.stderr = 'private secret path /private/secret.zip';
      throw error;
    },
  });
  await assert.rejects(() => client.packageValidate('/private/secret.zip'), (error) => {
    assert.equal(error.code, 'PACKAGE_NOT_FOUND');
    assert.equal(error.message, 'Package is missing.');
    assert.equal(error.details.path, '<redacted-path>');
    assert.equal(String(error).includes('private secret'), false);
    return true;
  });
});

test('reports an unavailable CLI without exposing process output', async () => {
  const client = createSkillClient({ cliPath: 'live2pet', runProcess: async () => { const error = new Error('spawn failed'); error.code = 'ENOENT'; error.stderr = 'spawn failed at /private/secret'; throw error; } });
  await assert.rejects(() => client.version(), (error) => {
    assert.equal(error.code, 'CLI_EXEC_FAILED');
    assert.equal(error.details.exitCode, undefined);
    assert.equal(String(error).includes('/private/secret'), false);
    return true;
  });
});

test('requires explicit authorization before exposing install to the CLI', async () => {
  let invoked = false;
  const client = createSkillClient({ cliPath: 'live2pet', runProcess: async () => { invoked = true; return { stdout: envelope('version', { result: { protocolVersion: 1, cliVersion: '0.1.0', operations: ['version', 'install'] } }) }; } });
  assert.throws(() => client.installPackage('/tmp/pet.zip', { target: 'codex-pet', targetRoot: '/tmp/pets' }), (error) => error instanceof SkillProtocolError && error.code === 'INSTALL_AUTHORIZATION_REQUIRED');
  assert.equal(invoked, false);
});

test('validates cache filter shape and forwards safe install flags', async () => {
  const calls = [];
  const client = createSkillClient({
    cliPath: 'live2pet',
    runProcess: async (_file, args) => {
      calls.push(args);
      const operation = args[0];
      return { stdout: envelope(operation, { result: operation === 'version' ? { protocolVersion: 1, cliVersion: '0.1.0', operations: ['version', 'install'] } : {} }) };
    },
  });
  await client.installPackage('/tmp/pet.zip', { target: 'codex-pet', targetRoot: '/tmp/pets', confirmInstall: true, conflict: 'side-by-side' });
  assert.deepEqual(calls[1], ['install', '--input', '/tmp/pet.zip', '--target', 'codex-pet', '--target-root', '/tmp/pets', '--conflict', 'side-by-side', '--confirm-install']);
  assert.throws(() => client.cacheClear('/tmp/cache', { all: true, projectId: 'x' }), (error) => error instanceof SkillProtocolError && error.code === 'INVALID_SKILL_ARGUMENT');
});
