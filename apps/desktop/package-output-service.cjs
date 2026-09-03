const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { inspectRoot } = require('./target-installation-service.cjs');

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const validPath = value => typeof value === 'string' && path.isAbsolute(value) && !value.includes('\0');

function createPackageOutputService({ settingsPath, pickFolder, pickSavePath } = {}) {
  let updates = Promise.resolve();
  async function load() {
    try {
      const value = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
      if (!value || value.schemaVersion !== 1 || !['ask', 'folder'].includes(value.mode) || (value.folder !== undefined && !validPath(value.folder)) || (value.mode === 'folder' && !value.folder)) throw new Error('Invalid settings');
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return { schemaVersion: 1, mode: 'ask' };
      fail('OUTPUT_SETTINGS_INVALID', 'Saved output settings could not be read. They have not been overwritten.');
    }
  }
  async function get() {
    await updates;
    const settings = await load();
    return { ...settings, ...(settings.folder ? { folderState: await inspectRoot(settings.folder) } : {}) };
  }
  function configure({ action }) {
    if (!['choose-folder', 'ask-every-time'].includes(action)) fail('INVALID_OUTPUT_SETTINGS_REQUEST', 'Choose a supported output setting.');
    const operation = updates.then(async () => {
      const settings = await load();
      if (action === 'choose-folder') {
        const selected = await pickFolder({ defaultPath: settings.folder });
        if (!selected) return { cancelled: true };
        if (!validPath(selected) || await inspectRoot(selected) !== 'ready') fail('OUTPUT_FOLDER_UNAVAILABLE', 'Choose an existing writable output folder.');
        settings.folder = selected;
        settings.mode = 'folder';
      } else settings.mode = 'ask';
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
  async function save({ filename, bytes }) {
    if (typeof filename !== 'string' || !filename || /[\\/\0]/.test(filename) || !filename.toLowerCase().endsWith('.zip') || !(bytes instanceof Uint8Array) || !bytes.byteLength) fail('INVALID_OUTPUT_ARTIFACT', 'A completed ZIP artifact is required.');
    const settings = await get();
    let destination;
    if (settings.mode === 'ask') {
      destination = await pickSavePath({ defaultPath: settings.folder ? path.join(settings.folder, filename) : filename });
      if (!destination) return { cancelled: true };
      if (!validPath(destination)) fail('INVALID_OUTPUT_PATH', 'Choose an absolute local save path.');
    } else {
      if (settings.folderState !== 'ready') fail('OUTPUT_FOLDER_UNAVAILABLE', 'The output folder is unavailable. Choose another folder or ask for a destination in Settings.');
      destination = path.join(settings.folder, filename);
    }
    const temporary = path.join(path.dirname(destination), `.live2pet-${randomUUID()}.tmp`);
    try {
      await fs.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
      if (settings.mode === 'ask') {
        // The native save dialog owns overwrite confirmation. Rename publishes
        // only the complete file and leaves any previous file intact on failure.
        await fs.rename(temporary, destination);
      } else {
        const stem = filename.slice(0, -4);
        for (let suffix = 0; ; suffix += 1) {
          destination = path.join(settings.folder, suffix ? `${stem} (${suffix}).zip` : filename);
          try {
            // Exclusive copy never replaces an existing package, including a
            // symlink or a competing save that claimed the same name.
            await fs.copyFile(temporary, destination, constants.COPYFILE_EXCL);
            break;
          } catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
      }
      return { cancelled: false, path: destination, filename: path.basename(destination), byteLength: bytes.byteLength };
    } finally { await fs.unlink(temporary).catch(() => {}); }
  }
  return { get, configure, save };
}

module.exports = { createPackageOutputService };
