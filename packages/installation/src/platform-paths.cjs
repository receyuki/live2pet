const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SUPPORTED_TARGETS = Object.freeze(['clawd', 'codex-pet']);

class TargetPathError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TargetPathError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new TargetPathError(code, message, details);
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail('INVALID_TARGET_PATH', `${label} must be a non-empty path string.`);
  return value.trim();
}

function normalizePlatform(platform = process.platform) {
  if (!['darwin', 'win32', 'linux'].includes(platform)) fail('UNSUPPORTED_PLATFORM', `Live2Pet does not have a target path adapter for ${platform}.`, { platform, supported: ['darwin', 'win32', 'linux'] });
  return platform;
}

function normalizeHomeDir(homeDir = os.homedir(), pathModule = path) {
  const value = nonEmptyString(homeDir, 'homeDir');
  if (!pathModule.isAbsolute(value)) fail('INVALID_HOME_DIRECTORY', 'homeDir must be an absolute path.');
  return pathModule.resolve(value);
}

function normalizeEnv(env = process.env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) fail('INVALID_TARGET_ENVIRONMENT', 'env must be an environment object.');
  return env;
}

function explicitRoot(target, env, pathModule) {
  const variable = target === 'clawd' ? 'LIVE2PET_CLAWD_ROOT' : 'LIVE2PET_CODEX_ROOT';
  const value = env[variable];
  if (value === undefined) return null;
  const root = nonEmptyString(value, variable);
  if (!pathModule.isAbsolute(root)) fail('INVALID_TARGET_PATH', `${variable} must be an absolute path.`);
  return { path: pathModule.resolve(root), source: 'environment', variable };
}

function defaultRoot(target, { platform, homeDir, env, pathModule }) {
  if (target === 'codex-pet') {
    const codexHome = env.CODEX_HOME === undefined ? pathModule.join(homeDir, '.codex') : nonEmptyString(env.CODEX_HOME, 'CODEX_HOME');
    if (!pathModule.isAbsolute(codexHome)) fail('INVALID_TARGET_PATH', 'CODEX_HOME must be an absolute path.');
    return { path: pathModule.join(pathModule.resolve(codexHome), 'pets'), source: 'default', variable: env.CODEX_HOME === undefined ? null : 'CODEX_HOME' };
  }
  if (platform === 'win32') {
    const appData = env.APPDATA === undefined ? pathModule.join(homeDir, 'AppData', 'Roaming') : nonEmptyString(env.APPDATA, 'APPDATA');
    if (!pathModule.isAbsolute(appData)) fail('INVALID_TARGET_PATH', 'APPDATA must be an absolute path.');
    return { path: pathModule.join(pathModule.resolve(appData), 'clawd-on-desk', 'themes'), source: 'default', variable: env.APPDATA === undefined ? null : 'APPDATA' };
  }
  if (platform === 'darwin') return { path: pathModule.join(homeDir, 'Library', 'Application Support', 'clawd-on-desk', 'themes'), source: 'default', variable: null };
  const configHome = env.XDG_CONFIG_HOME === undefined ? pathModule.join(homeDir, '.config') : nonEmptyString(env.XDG_CONFIG_HOME, 'XDG_CONFIG_HOME');
  if (!pathModule.isAbsolute(configHome)) fail('INVALID_TARGET_PATH', 'XDG_CONFIG_HOME must be an absolute path.');
  return { path: pathModule.join(pathModule.resolve(configHome), 'clawd-on-desk', 'themes'), source: 'default', variable: env.XDG_CONFIG_HOME === undefined ? null : 'XDG_CONFIG_HOME' };
}

function resolveTargetRoot(target, { targetRoot, platform = process.platform, homeDir = os.homedir(), env = process.env } = {}) {
  if (!SUPPORTED_TARGETS.includes(target)) fail('UNKNOWN_PACKAGE_TARGET', 'Target must be clawd or codex-pet.', { target, supported: [...SUPPORTED_TARGETS] });
  const normalizedPlatform = normalizePlatform(platform);
  const pathModule = normalizedPlatform === 'win32' ? path.win32 : path;
  const normalizedHome = normalizeHomeDir(homeDir, pathModule);
  const normalizedEnv = normalizeEnv(env);
  if (targetRoot !== undefined && targetRoot !== null) {
    const explicit = nonEmptyString(targetRoot, 'targetRoot');
    if (!pathModule.isAbsolute(explicit)) fail('INVALID_TARGET_PATH', 'targetRoot must be an absolute path.');
    return { target, platform: normalizedPlatform, path: pathModule.resolve(explicit), source: 'explicit', variable: null };
  }
  const configured = explicitRoot(target, normalizedEnv, pathModule) || defaultRoot(target, { platform: normalizedPlatform, homeDir: normalizedHome, env: normalizedEnv, pathModule });
  return { target, platform: normalizedPlatform, ...configured };
}

function inspectTargetRoot(input, { fsModule = fs } = {}) {
  const resolved = typeof input === 'string' ? resolveTargetRoot(input) : input;
  if (!resolved || !SUPPORTED_TARGETS.includes(resolved.target) || typeof resolved.path !== 'string') fail('INVALID_TARGET_PATH', 'A resolved target root is required.');
  let exists = false;
  let directory = false;
  let writable = false;
  try {
    const stat = fsModule.statSync(resolved.path);
    exists = true;
    directory = stat.isDirectory();
    if (directory) {
      try { fsModule.accessSync(resolved.path, fs.constants.W_OK); writable = true; } catch { writable = false; }
    }
  } catch (error) {
    if (error && error.code !== 'ENOENT') fail('TARGET_PATH_INSPECTION_FAILED', 'The target root could not be inspected.', { cause: error.code || 'UNKNOWN' });
  }
  return { ...resolved, exists, directory, writable };
}

module.exports = {
  SUPPORTED_TARGETS,
  TargetPathError,
  inspectTargetRoot,
  resolveTargetRoot,
};
