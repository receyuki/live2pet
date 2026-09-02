const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');

test('HeroUI renderer is an explicit parallel Electron preview', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
  const main = fs.readFileSync(path.join(desktopRoot, 'main.cjs'), 'utf8');
  const vite = fs.readFileSync(path.join(desktopRoot, 'vite.config.mts'), 'utf8');

  assert.equal(manifest.dependencies['@heroui/react'], '^3.2.4');
  assert.equal(manifest.dependencies.react, '^19.2.8');
  assert.match(manifest.scripts['preview:shell'], /build:renderer.*--live2pet-ui-preview/);
  assert.match(main, /UI_PREVIEW_ARGUMENT = '--live2pet-ui-preview'/);
  assert.match(main, /DEVELOPMENT_RENDERER_PATH = path\.resolve\(__dirname, 'renderer-dist\/index\.html'\)/);
  assert.match(main, /if \(!app\.isPackaged && process\.argv\.includes\(UI_PREVIEW_ARGUMENT\)\)/);
  assert.match(main, /return mapperPath\(\)/, 'The working Mapper must remain the default before visual acceptance.');
  assert.match(vite, /base:\s*'\.\/'/);
  assert.match(vite, /renderer-dist/);
});

test('HeroUI renderer uses a strict local CSP and contains no bundled model or runtime', () => {
  const html = fs.readFileSync(path.join(desktopRoot, 'ui', 'index.html'), 'utf8');
  const sourceFiles = fs.readdirSync(path.join(desktopRoot, 'ui', 'src'));

  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|https?:\/\//);
  assert.match(html, /script-src 'self'/);
  assert.equal(sourceFiles.some((name) => /\.(?:moc3?|model3\.json|pck|webp)$/i.test(name)), false);
});
