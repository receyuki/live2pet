const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PROTOCOL = 'live2pet-visibility-edit';
const MAX_JSON_BYTES = 64 * 1024;
const ID = /^[0-9a-f]{32}$/;
const REVISION = /^[0-9a-f]{64}$/;
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/;

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function invalidRequest() {
  return failure('INVALID_VISIBILITY_EDIT_REQUEST', 'The visibility edit request is invalid or its resources are unsafe.');
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isText(value, maximum = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && !CONTROLS.test(value);
}

function parseVisibilityEditArgument(argv) {
  const positions = argv.flatMap((arg, index) => arg === '--live2pet-visibility-edit' ? [index] : []);
  if (!positions.length) return null;
  const requestPath = argv[positions[0] + 1];
  if (positions.length !== 1 || typeof requestPath !== 'string' || CONTROLS.test(requestPath)
    || !path.isAbsolute(requestPath) || path.basename(requestPath) !== 'request.json') {
    throw failure('INVALID_VISIBILITY_EDIT_ARGUMENT', 'Visibility editing requires one absolute request.json path.');
  }
  return path.normalize(requestPath);
}

function validateSettings(settings, code = 'INVALID_VISIBILITY_EDIT_REQUEST') {
  const ids = settings?.hiddenElementIds;
  if (!isObject(settings) || Object.keys(settings).some(key => key !== 'hiddenElementIds')
    || !Array.isArray(ids) || ids.length > 4096 || ids.some(id => !isText(id)) || new Set(ids).size !== ids.length) {
    throw failure(code, 'Visibility settings require unique model element identities and cannot include temporary Solo state.');
  }
  return { hiddenElementIds: [...ids] };
}

function validateLoadedSettings(visualSettings, elements) {
  const settings = validateSettings(visualSettings, 'INVALID_VISIBILITY_EDIT_SETTINGS');
  if (!Array.isArray(elements) || elements.some(element => !isObject(element) || !isText(element.id))) {
    throw failure('INVALID_VISIBILITY_EDIT_SETTINGS', 'Loaded model elements are required before applying visibility settings.');
  }
  const known = new Set(elements.map(element => element.id));
  if (settings.hiddenElementIds.some(id => !known.has(id))) {
    throw failure('INVALID_VISIBILITY_EDIT_SETTINGS', 'Visibility settings contain an element absent from the loaded model.');
  }
  return settings;
}

function confinedPath(root, relative, prefix) {
  if (!isText(relative, 4096) || relative.includes('\\') || relative.startsWith('/')
    || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')
    || !relative.startsWith(prefix)) throw invalidRequest();
  let current = root;
  for (const segment of relative.split('/')) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) throw invalidRequest();
  }
  if (!fs.lstatSync(current).isFile()) throw invalidRequest();
  return current;
}

function verifySourceTree(root, depth = 0, count = { value: 0 }) {
  if (depth > 128) throw invalidRequest();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (++count.value > 10000 || entry.isSymbolicLink()) throw invalidRequest();
    if (entry.isDirectory()) verifySourceTree(path.join(root, entry.name), depth + 1, count);
    else if (!entry.isFile()) throw invalidRequest();
  }
}

function createVisibilityEditSession(requestPath) {
  let request, root, sourceRoot, modelConfig, runtimePath = null;
  try {
    if (typeof requestPath !== 'string' || !path.isAbsolute(requestPath) || path.basename(requestPath) !== 'request.json') throw invalidRequest();
    const requestStat = fs.lstatSync(requestPath);
    const suppliedRoot = path.dirname(requestPath);
    const rootStat = fs.lstatSync(suppliedRoot);
    if (!requestStat.isFile() || requestStat.isSymbolicLink() || requestStat.size > MAX_JSON_BYTES
      || !rootStat.isDirectory() || rootStat.isSymbolicLink()
      || (process.platform !== 'win32' && ((rootStat.mode | requestStat.mode) & 0o077))) throw invalidRequest();
    root = fs.realpathSync(suppliedRoot);
    const requestBytes = fs.readFileSync(requestPath);
    if (requestBytes.length > MAX_JSON_BYTES) throw invalidRequest();
    request = JSON.parse(requestBytes.toString('utf8'));
    const model = request?.model;
    if (!isObject(request) || request.protocol !== PROTOCOL || request.version !== 1 || !ID.test(request.sessionId)
      || !isObject(model) || !ID.test(model.id) || !REVISION.test(model.revision) || !isText(model.name)) throw invalidRequest();
    request.visualSettings = validateSettings(request.visualSettings);
    if (model.format === 'live2d') {
      if (![2, 3].includes(model.generation) || model.runtimeLine !== undefined || model.initialSkin !== undefined
        || !/\.json$/i.test(model.entry)) throw invalidRequest();
    } else if (model.format === 'spine') {
      if (model.generation !== undefined || !['2.1', '3.5', '3.6', '3.7', '3.8', '4.0', '4.1', '4.2', '4.3'].includes(model.runtimeLine)
        || model.runtimeLine === '3.5' && !/\.json$/i.test(model.entry)
        || (model.initialSkin !== undefined && !isText(model.initialSkin)) || !/\.(?:json|skel)$/i.test(model.entry)
        || request.runtime !== null) throw invalidRequest();
    } else throw invalidRequest();
    sourceRoot = path.join(root, 'source');
    const sourceStat = fs.lstatSync(sourceRoot);
    if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) throw invalidRequest();
    confinedPath(root, model.entry, 'source/');
    modelConfig = model.entry.slice('source/'.length);
    verifySourceTree(sourceRoot);
    if (request.runtime !== null) {
      if (!isObject(request.runtime) || model.format !== 'live2d' || request.runtime.generation !== model.generation
        || request.runtime.path !== 'runtime/core.js') throw invalidRequest();
      runtimePath = confinedPath(root, request.runtime.path, 'runtime/');
    }
  } catch {
    throw invalidRequest();
  }
  const resultPath = path.join(root, 'result.json');
  try {
    fs.lstatSync(resultPath);
    throw failure('VISIBILITY_EDIT_COMPLETED', 'This visibility edit session already has a result.');
  } catch (cause) {
    if (cause.code !== 'ENOENT') throw cause;
  }
  // Capture the authenticated identity separately; renderer state must not be
  // able to alter the session/model/revision returned to the session owner.
  const identity = { protocol: PROTOCOL, version: 1, sessionId: request.sessionId, modelId: request.model.id, modelRevision: request.model.revision };
  const validateAppliedSettings = (visualSettings, elements) => {
    const settings = validateLoadedSettings(visualSettings, elements);
    const envelope = { ...identity, status: 'applied', visualSettings: settings };
    if (Buffer.byteLength(`${JSON.stringify(envelope)}\n`) > MAX_JSON_BYTES) {
      throw failure('INVALID_VISIBILITY_EDIT_RESULT', 'The visibility edit result exceeds 64 KiB.');
    }
    return settings;
  };
  let completed = false;
  return {
    request, root, sourceRoot, modelConfig, runtimePath,
    get completed() { return completed; },
    validateSettings: validateAppliedSettings,
    finish(status, { visualSettings, elements, error } = {}) {
      if (completed) throw failure('VISIBILITY_EDIT_COMPLETED', 'This visibility edit session is already complete.');
      if (!['applied', 'cancelled', 'error'].includes(status)) throw failure('INVALID_VISIBILITY_EDIT_RESULT', 'Invalid visibility edit result status.');
      const result = { ...identity, status };
      if (status === 'applied') {
        result.visualSettings = validateAppliedSettings(visualSettings, elements);
      } else if (status === 'error') {
        result.error = {
          code: typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : 'VISIBILITY_EDIT_FAILED',
          message: 'The visibility editor could not complete this session.',
        };
      }
      const bytes = Buffer.from(`${JSON.stringify(result)}\n`);
      if (bytes.length > MAX_JSON_BYTES) throw failure('INVALID_VISIBILITY_EDIT_RESULT', 'The visibility edit result exceeds 64 KiB.');
      const temporary = path.join(root, `.result-${crypto.randomBytes(12).toString('hex')}.tmp`);
      try {
        fs.writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o600 });
        // A same-directory hard link atomically publishes the complete file
        // without rename's possibility of replacing another session result.
        fs.linkSync(temporary, resultPath);
        completed = true;
      } catch (cause) {
        if (cause.code === 'EEXIST') {
          completed = true;
          throw failure('VISIBILITY_EDIT_COMPLETED', 'This visibility edit session already has a result.');
        }
        throw failure('VISIBILITY_EDIT_WRITE_FAILED', 'The visibility edit result could not be saved.');
      } finally {
        try { fs.unlinkSync(temporary); } catch { /* A leftover private temp file is not a result. */ }
      }
      return result;
    },
  };
}

module.exports = { parseVisibilityEditArgument, createVisibilityEditSession };
