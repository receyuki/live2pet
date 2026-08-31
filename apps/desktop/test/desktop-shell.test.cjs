const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

test('desktop shell pins the mapper entrypoint and keeps navigation and IPC narrow', () => {
  const main = fs.readFileSync(path.join(root, 'main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.join(root, 'preload.cjs'), 'utf8');
  assert.match(main, /const DEVELOPMENT_MAPPER_PATH = path\.resolve\(__dirname, '\.\.\/mapper\/index\.html'\);/);
  assert.match(main, /const PACKAGED_MAPPER_PATH = path\.join\(process\.resourcesPath, 'mapper-dist', 'index\.html'\);/);
  assert.match(main, /return app\.isPackaged \? PACKAGED_MAPPER_PATH : DEVELOPMENT_MAPPER_PATH;/);
  assert.match(main, /mapperAssetRoot: app\.isPackaged \? path\.dirname\(documentPath\) : undefined,/);
  assert.match(main, /buildProjectService: buildProjectTargets/);
  assert.match(main, /event\.sender !== mainWindow\.webContents/);
  assert.match(main, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/);
  assert.match(main, /mainWindow\.once\('ready-to-show', showWindow\);[\s\S]*await mainWindow\.loadFile\(documentPath\);[\s\S]*!mainWindow\.isVisible\(\)/);
  assert.match(main, /webContents\.on\('will-navigate'/);
  assert.match(main, /webContents\.on\('will-attach-webview'/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setPermissionCheckHandler/);
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
  assert.match(forge, /extraResource:\s*\[path\.resolve\(__dirname, 'mapper-dist'\)\]/);
  assert.equal(manifest.scripts['prepare:mapper'], 'node scripts/stage-mapper-assets.cjs');
});
