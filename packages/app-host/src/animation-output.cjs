const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

function createAnimationOutputService({ getSettings, pickFolder, openPath }) {
  const directories = new Map();
  const fail = () => { throw Object.assign(new Error('Choose an available animation output folder.'), { code: 'ANIMATION_OUTPUT_UNAVAILABLE' }); };
  const remember = (directoryPath) => {
    const directoryId = randomUUID();
    directories.set(directoryId, directoryPath);
    return { cancelled: false, directoryId, directoryPath };
  };
  async function resolve(id) {
    const folder = directories.get(id);
    if (!folder || !(await fs.stat(folder)).isDirectory()) fail();
    return folder;
  }
  async function choose() {
    const settings = await getSettings();
    const selected = await pickFolder(settings.folder);
    if (!selected) return { cancelled: true };
    if (!path.isAbsolute(selected) || !(await fs.stat(selected)).isDirectory()) fail();
    return remember(selected);
  }
  const safeName = value => String(value || 'animation').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 100) || 'animation';
  async function prepare({ directoryId, project, motionIds }) {
    let folder;
    if (directoryId) folder = await resolve(directoryId);
    else {
      const settings = await getSettings();
      if (settings.mode === 'folder') {
        if (settings.folderState !== 'ready') fail();
        folder = settings.folder;
      } else {
        const selected = await choose();
        if (selected.cancelled) return selected;
        folder = selected.directoryPath;
      }
    }
    if (motionIds.length > 1) {
      const stem = safeName(project.name || project.projectId);
      for (let i = 0; ; i += 1) {
        const candidate = path.join(folder, `${stem}${i ? ` (${i})` : ''}`);
        try { await fs.mkdir(candidate); folder = candidate; break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
    }
    return remember(folder);
  }
  async function write(directoryId, animation) {
    const folder = await resolve(directoryId);
    const bytes = animation.buffer;
    if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new Error('Animation encoding did not produce bytes.');
    if (!['webp', 'apng'].includes(animation.format)) throw new Error('Unsupported animation output format.');
    const extension = animation.format;
    let stem = safeName(animation.motionId);
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `_${stem}`;
    for (let i = 0; ; i += 1) {
      const filename = `${stem}${i ? ` (${i})` : ''}.${extension}`;
      const outputPath = path.join(folder, filename);
      let handle;
      try { handle = await fs.open(outputPath, 'wx', 0o600); }
      catch (error) { if (error.code === 'EEXIST') continue; throw error; }
      try { await handle.writeFile(bytes); } catch (error) { await handle.close(); await fs.unlink(outputPath).catch(() => {}); throw error; }
      await handle.close();
      return { motionId: animation.motionId, filename, byteLength: bytes.byteLength };
    }
  }
  async function open(id) {
    const error = await openPath(await resolve(id));
    if (error) fail();
    return { opened: true };
  }
  return { choose, prepare, write, open };
}

module.exports = { createAnimationOutputService };
