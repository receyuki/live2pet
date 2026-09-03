const fs = require('node:fs/promises');
const constants = require('node:fs').constants;
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { resolveTargetRoot } = require('@live2pet/installation');

const HOSTS = {
  clawd: { name: 'Clawd on Desk.app', bundleId: 'com.clawd.on-desk' },
  'codex-pet': { name: 'Codex.app', bundleId: 'com.openai.codex' },
};
const ACTIONS = ['choose-root', 'reset-root', 'choose-app', 'reset-app'];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

async function readBundle(bundlePath) {
  const { stdout } = await promisify(execFile)('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(bundlePath, 'Contents', 'Info.plist')], { timeout: 3000, maxBuffer: 256 * 1024 });
  return JSON.parse(stdout);
}

async function inspectRoot(rootPath) {
  let current = rootPath;
  while (true) {
    try {
      const stat = await fs.stat(current);
      if (!stat.isDirectory()) return 'not-directory';
      await fs.access(current, constants.W_OK | constants.X_OK);
      return current === rootPath ? 'ready' : 'will-create';
    } catch (error) {
      if (error.code === 'ENOTDIR') return 'not-directory';
      if (error.code !== 'ENOENT') return 'unavailable';
      const parent = path.dirname(current);
      if (parent === current) return 'unavailable';
      current = parent;
    }
  }
}

function createTargetInstallationService({ settingsPath, pick, homeDir = os.homedir(), platform = process.platform, env = process.env, applicationDirs = ['/Applications', path.join(homeDir, 'Applications')], readApplication = readBundle } = {}) {
  let updates = Promise.resolve();
  async function load() {
    try {
      const value = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      if (value.schemaVersion !== 1 || !value.targets || typeof value.targets !== 'object' || Array.isArray(value.targets)) throw new Error('Invalid settings');
      for (const [target, settings] of Object.entries(value.targets)) {
        if (!Object.hasOwn(HOSTS, target) || !settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Invalid target');
        for (const [key, value] of Object.entries(settings)) {
          if (!['root', 'application'].includes(key) || typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('Invalid path');
        }
      }
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, targets: {} };
      fail('INSTALL_SETTINGS_INVALID', 'Saved installation settings could not be read. They have not been overwritten.');
    }
  }
  async function application(target, selected) {
    if (platform !== 'darwin') return { status: 'unsupported', source: 'auto' };
    const candidates = selected ? [selected] : applicationDirs.map(directory => path.join(directory, HOSTS[target].name));
    let unavailable = false;
    for (const candidate of candidates) {
      try {
        if (!(await fs.stat(candidate)).isDirectory()) continue;
        const info = await readApplication(candidate);
        if (info.CFBundleIdentifier !== HOSTS[target].bundleId) continue;
        return { status: 'found', source: selected ? 'manual' : 'auto', path: candidate, version: String(info.CFBundleShortVersionString ?? '') };
      } catch (error) { if (error.code !== 'ENOENT') unavailable = true; }
    }
    return { status: unavailable ? 'unavailable' : 'not-found', source: selected ? 'manual' : 'auto', ...(selected ? { path: selected } : {}) };
  }
  async function get() {
    await updates;
    const settings = await load();
    const targets = await Promise.all(Object.keys(HOSTS).map(async target => {
      const saved = settings.targets[target] ?? {};
      const resolved = resolveTargetRoot(target, { targetRoot: saved.root, homeDir, platform, env });
      return { target, application: await application(target, saved.application), root: { path: resolved.path, source: saved.root ? 'manual' : resolved.source, state: await inspectRoot(resolved.path) } };
    }));
    return { platform, targets };
  }
  function configure({ target, action }) {
    if (!Object.hasOwn(HOSTS, target) || !ACTIONS.includes(action)) fail('INVALID_INSTALL_SETTINGS_REQUEST', 'Choose a supported target and installation setting.');
    const operation = updates.then(async () => {
      const settings = await load();
      const saved = settings.targets[target] ?? {};
      const key = action.endsWith('app') ? 'application' : 'root';
      if (action.startsWith('choose')) {
        if (key === 'application' && platform !== 'darwin') fail('APP_DETECTION_UNSUPPORTED', 'Application detection is currently supported on macOS only.');
        const selected = await pick({ target, kind: key, defaultPath: saved[key] ?? (key === 'root' ? resolveTargetRoot(target, { homeDir, platform, env }).path : undefined) });
        if (!selected) return { cancelled: true };
        if (typeof selected !== 'string' || !path.isAbsolute(selected) || selected.includes('\0')) fail('INVALID_INSTALL_PATH', 'Choose an absolute local path.');
        if (key === 'application') {
          if ((await application(target, selected)).status !== 'found') fail('INSTALL_APP_MISMATCH', 'The selected App does not match this target. Choose the correct application bundle.');
        } else if (await inspectRoot(selected) !== 'ready') fail('INSTALL_ROOT_UNAVAILABLE', 'Choose an existing writable installation folder.');
        saved[key] = selected;
      } else delete saved[key];
      settings.targets[target] = saved;
      await fs.mkdir(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
      const temporary = `${settingsPath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(settings), { mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, settingsPath);
      } finally { await fs.unlink(temporary).catch(() => {}); }
      return { cancelled: false };
    });
    updates = operation.catch(() => {});
    return operation;
  }
  return { get, configure };
}

module.exports = { createTargetInstallationService, inspectRoot };
