const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('desktop shell pins the mapper entrypoint and keeps navigation and IPC narrow', () => {
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  assert.match(main, /const MAPPER_PATH = path\.resolve\(__dirname, '\.\.\/mapper\/index\.html'\);/);
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /mainWindow\.once\('ready-to-show', showWindow\);[\s\S]*await mainWindow\.loadFile\(MAPPER_PATH\);[\s\S]*!mainWindow\.isVisible\(\)/);
  assert.doesNotMatch(main, /nodeIntegration:\s*true/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\('live2pet'/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^,]+,\s*\{\s*ipcRenderer/);
});

test('desktop package keeps Electron and future Forge settings explicit', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const forge = fs.readFileSync(path.join(root, 'forge.config.cjs'), 'utf8');
  assert.equal(manifest.devDependencies.electron, '44.0.0');
  assert.equal(manifest.scripts.start, 'electron .');
  assert.match(forge, /asar:\s*true/);
  assert.match(forge, /executableName:\s*'live2pet'/);
});
