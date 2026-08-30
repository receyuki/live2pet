const { execFile } = require('node:child_process');
const path = require('node:path');

const PROTOCOL_VERSION = 1;
const DEFAULT_MAX_BUFFER = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const OPERATIONS = Object.freeze([
  'version',
  'inspect',
  'runtime-diagnose',
  'project-validate',
  'project-recover',
  'package-build',
  'package-validate',
  'export',
  'install',
  'skill-status',
  'skill-install',
  'cache-status',
  'cache-clear',
]);

class SkillProtocolError extends Error {
  constructor(code, message, details = {}, response = null) {
    super(message);
    this.name = 'SkillProtocolError';
    this.code = code;
    this.details = details;
    this.response = response;
  }
}

function fail(code, message, details = {}, response = null) {
  throw new SkillProtocolError(code, message, details, response);
}

function defaultRunProcess(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { ...options, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function parseResponse(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return null;
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function isAbsolutePath(value) {
  return path.isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\');
}

function redactAbsolutePaths(value) {
  if (typeof value === 'string') return isAbsolutePath(value) ? '<redacted-path>' : value;
  if (Array.isArray(value)) return value.map(redactAbsolutePaths);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactAbsolutePaths(item)]));
  return value;
}

function assertEnvelope(response, operation) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    fail('INVALID_CLI_RESPONSE', 'Live2Pet CLI returned a non-object response.');
  }
  if (response.protocolVersion !== PROTOCOL_VERSION) {
    fail('UNSUPPORTED_PROTOCOL_VERSION', 'The installed Live2Pet CLI protocol is not supported.', {
      expected: PROTOCOL_VERSION,
      received: response.protocolVersion,
    }, response);
  }
  if (response.operation !== operation) {
    fail('CLI_OPERATION_MISMATCH', 'Live2Pet CLI returned a response for a different operation.', {
      expected: operation,
      received: response.operation,
    }, response);
  }
  if (typeof response.ok !== 'boolean') {
    fail('INVALID_CLI_RESPONSE', 'Live2Pet CLI response is missing its boolean ok field.', {}, response);
  }
  return response;
}

function assertCompatibleVersion(response, requiredOperations = []) {
  assertEnvelope(response, 'version');
  const operations = response.result && Array.isArray(response.result.operations) ? response.result.operations : null;
  if (!operations) fail('INVALID_VERSION_RESPONSE', 'Live2Pet CLI version response is missing its operation list.', {}, response);
  const missing = [...new Set(requiredOperations)].filter((operation) => !operations.includes(operation));
  if (missing.length) {
    fail('MISSING_CLI_CAPABILITY', 'The installed Live2Pet CLI does not support the required operation.', { missing, operations }, response);
  }
  if (typeof response.cliVersion !== 'string' || !response.cliVersion) {
    fail('INVALID_VERSION_RESPONSE', 'Live2Pet CLI version response is missing cliVersion.', {}, response);
  }
  return {
    protocolVersion: response.protocolVersion,
    cliVersion: response.cliVersion,
    operations: [...operations],
  };
}

function appendValue(args, flag, value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_SKILL_ARGUMENT', `${flag} requires a non-empty string value.`);
  args.push(flag, value);
}

function appendBoolean(args, flag, value) {
  if (value === undefined) return;
  if (value !== true) fail('INVALID_SKILL_ARGUMENT', `${flag} is a flag and can only be enabled with true.`);
  args.push(flag);
}

function commandForCli(cliPath, nodePath) {
  if (typeof cliPath !== 'string' || !cliPath.trim()) fail('CLI_PATH_REQUIRED', 'A Live2Pet CLI path or command is required.');
  const resolved = cliPath.trim();
  if (path.extname(resolved).toLowerCase() === '.cjs' || path.extname(resolved).toLowerCase() === '.js') {
    return { file: nodePath || process.execPath, prefix: [resolved] };
  }
  return { file: resolved, prefix: [] };
}

function createSkillClient({
  cliPath = process.env.LIVE2PET_CLI || 'live2pet',
  nodePath = process.execPath,
  cwd,
  env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxBuffer = DEFAULT_MAX_BUFFER,
  runProcess = defaultRunProcess,
  requiredOperations = [],
} = {}) {
  const command = commandForCli(cliPath, nodePath);
  let handshakePromise = null;
  let capabilities = null;

  async function runOperation(operation, args = []) {
    if (!OPERATIONS.includes(operation)) fail('UNSUPPORTED_SKILL_OPERATION', `Unsupported Live2Pet operation: ${operation}.`);
    const options = {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      timeout: timeoutMs,
      maxBuffer,
      windowsHide: true,
    };
    let output;
    try {
      output = await runProcess(command.file, [...command.prefix, operation, ...args], options);
    } catch (error) {
      const parsed = parseResponse(error && error.stdout);
      if (parsed) {
        const response = assertEnvelope(parsed, operation);
        if (!response.ok) {
          const detail = response.error || {};
          fail(detail.code || 'CLI_OPERATION_FAILED', detail.message || 'Live2Pet CLI operation failed.', redactAbsolutePaths(detail.details || {}), redactAbsolutePaths(response));
        }
        fail('CLI_EXEC_FAILED', 'Live2Pet CLI exited unsuccessfully despite an ok response.', {
          exitCode: typeof error?.code === 'number' ? error.code : undefined,
          signal: error?.signal || undefined,
        }, redactAbsolutePaths(response));
      }
      fail('CLI_EXEC_FAILED', 'Live2Pet CLI could not be executed.', {
        exitCode: typeof error?.code === 'number' ? error.code : undefined,
        signal: error?.signal || undefined,
      });
    }
    const response = assertEnvelope(parseResponse(output && output.stdout), operation);
    const safeResponse = redactAbsolutePaths(response);
    if (!safeResponse.ok) {
      const detail = safeResponse.error || {};
      fail(detail.code || 'CLI_OPERATION_FAILED', detail.message || 'Live2Pet CLI operation failed.', detail.details || {}, safeResponse);
    }
    return safeResponse;
  }

  async function handshake() {
    if (!handshakePromise) {
      handshakePromise = runOperation('version').then((response) => {
        const info = assertCompatibleVersion(response, requiredOperations);
        capabilities = new Set(info.operations);
        return info;
      }).catch((error) => {
        handshakePromise = null;
        throw error;
      });
    }
    return handshakePromise;
  }

  async function invoke(operation, args = []) {
    if (operation !== 'version') {
      await handshake();
      if (!capabilities.has(operation)) fail('MISSING_CLI_CAPABILITY', 'The installed Live2Pet CLI does not advertise this operation.', { operation, operations: [...capabilities] });
    }
    return runOperation(operation, args);
  }

  return {
    handshake,
    version: () => invoke('version'),
    inspect: (input) => invoke('inspect', (() => { const args = []; appendValue(args, '--input', input); return args; })()),
    runtimeDiagnose: (input) => invoke('runtime-diagnose', (() => { const args = []; appendValue(args, '--input', input); return args; })()),
    projectValidate: (input) => invoke('project-validate', (() => { const args = []; appendValue(args, '--input', input); return args; })()),
    projectRecover: (input) => invoke('project-recover', (() => { const args = []; appendValue(args, '--input', input); return args; })()),
    packageBuild: (input, options = {}) => invoke('package-build', (() => {
      const args = [];
      appendValue(args, '--input', input);
      appendValue(args, '--target', options.target);
      appendValue(args, '--output', options.output);
      appendValue(args, '--cache-dir', options.cacheDir);
      appendValue(args, '--runtime-version', options.runtimeVersion);
      appendValue(args, '--renderer-version', options.rendererVersion);
      appendValue(args, '--encoder-version', options.encoderVersion);
      appendBoolean(args, '--overwrite', options.overwrite);
      return args;
    })()),
    packageValidate: (input, target) => invoke('package-validate', (() => { const args = []; appendValue(args, '--input', input); appendValue(args, '--target', target); return args; })()),
    exportPackage: (input, output, options = {}) => invoke('export', (() => { const args = []; appendValue(args, '--input', input); appendValue(args, '--output', output); appendBoolean(args, '--overwrite', options.overwrite); return args; })()),
    installPackage: (input, options = {}) => {
      if (options.confirmInstall !== true) fail('INSTALL_AUTHORIZATION_REQUIRED', 'Installation requires explicit user authorization via confirmInstall: true.');
      return invoke('install', (() => {
        const args = [];
        appendValue(args, '--input', input);
        appendValue(args, '--target', options.target);
        appendValue(args, '--target-root', options.targetRoot);
        appendValue(args, '--package-id', options.packageId);
        appendValue(args, '--conflict', options.conflict);
        appendBoolean(args, '--confirm-install', true);
        return args;
      })());
    },
    skillStatus: (sourceDir, targetRoot) => invoke('skill-status', (() => { const args = []; appendValue(args, '--input', sourceDir); appendValue(args, '--target-root', targetRoot); return args; })()),
    skillInstall: (sourceDir, options = {}) => {
      if (options.confirmInstall !== true) fail('INSTALL_AUTHORIZATION_REQUIRED', 'Skill installation requires explicit user authorization via confirmInstall: true.');
      return invoke('skill-install', (() => {
        const args = [];
        appendValue(args, '--input', sourceDir);
        appendValue(args, '--target-root', options.targetRoot);
        appendBoolean(args, '--overwrite', options.overwrite);
        appendBoolean(args, '--confirm-install', true);
        return args;
      })());
    },
    cacheStatus: (cacheDir) => invoke('cache-status', (() => { const args = []; appendValue(args, '--cache-dir', cacheDir); return args; })()),
    cacheClear: (cacheDir, filter = {}) => invoke('cache-clear', (() => {
      const args = [];
      appendValue(args, '--cache-dir', cacheDir);
      const filters = [filter.all === true, filter.projectId !== undefined, filter.sourceFingerprint !== undefined].filter(Boolean).length;
      if (filters !== 1) fail('INVALID_SKILL_ARGUMENT', 'cacheClear requires exactly one of all, projectId, or sourceFingerprint.');
      appendBoolean(args, '--all', filter.all);
      appendValue(args, '--project-id', filter.projectId);
      appendValue(args, '--source-fingerprint', filter.sourceFingerprint);
      return args;
    })()),
  };
}

module.exports = {
  DEFAULT_MAX_BUFFER,
  DEFAULT_TIMEOUT_MS,
  OPERATIONS,
  PROTOCOL_VERSION,
  SkillProtocolError,
  assertCompatibleVersion,
  createSkillClient,
};
