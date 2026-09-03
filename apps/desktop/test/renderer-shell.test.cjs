const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const desktopRoot = path.resolve(__dirname, '..');

test('HeroUI is the default development and packaged Electron renderer', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
  const main = fs.readFileSync(path.join(desktopRoot, 'main.cjs'), 'utf8');
  const vite = fs.readFileSync(path.join(desktopRoot, 'vite.config.mts'), 'utf8');

  assert.equal(manifest.devDependencies['@heroui/react'], '^3.2.4');
  assert.equal(manifest.devDependencies.react, '^19.2.8');
  assert.equal(manifest.dependencies['@live2pet/renderer'], 'workspace:*');
  const previewService = fs.readFileSync(path.join(desktopRoot, 'preview-session-service.cjs'), 'utf8');
  assert.match(previewService, /require\('@live2pet\/renderer'\)/);
  assert.doesNotMatch(previewService, /require\('\.\.\/\.\.\/packages\//);
  assert.equal(manifest.scripts['preview:shell'], 'pnpm start');
  assert.match(manifest.scripts.start, /prepare:mapper.*build:renderer.*electron \./);
  assert.match(main, /DEVELOPMENT_RENDERER_PATH = path\.resolve\(__dirname, 'renderer-dist\/index\.html'\)/);
  assert.match(main, /return app\.isPackaged \? PACKAGED_RENDERER_PATH : DEVELOPMENT_RENDERER_PATH/);
  assert.doesNotMatch(main, /UI_PREVIEW_ARGUMENT|DEVELOPMENT_MAPPER_PATH|PACKAGED_MAPPER_PATH/);
  assert.match(main, /renderer: 'heroui'/);
  assert.match(main, /#root.*\.setup-view/);
  assert.match(vite, /base:\s*'\.\/'/);
  assert.match(vite, /renderer-dist/);
  assert.match(vite, /license:\s*\{ fileName: 'THIRD-PARTY-LICENSES\.md' \}/);
});

test('HeroUI renderer uses a strict local CSP and contains no bundled model or runtime', () => {
  const html = fs.readFileSync(path.join(desktopRoot, 'ui', 'index.html'), 'utf8');
  const sourceFiles = fs.readdirSync(path.join(desktopRoot, 'ui', 'src'));

  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /unsafe-inline|unsafe-eval|https?:\/\//);
  assert.match(html, /script-src 'self'/);
  assert.equal(sourceFiles.some((name) => /\.(?:moc3?|model3\.json|pck|webp)$/i.test(name)), false);
});
