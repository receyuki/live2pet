const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { RENDERER_ASSETS, stageRendererAssets } = require('./stage-renderer-assets.cjs');

const SOURCE_MAPPER = path.resolve(__dirname, '../../mapper/index.html');
const DEFAULT_OUTPUT = path.resolve(__dirname, '../mapper-dist');
const SUPPORT_FILES = Object.freeze([
  {
    source: path.resolve(__dirname, '../../mapper/build-progress.js'),
    target: 'build-progress.js',
  },
  {
    source: path.resolve(__dirname, '../../mapper/clawd-capture-plan.js'),
    target: 'clawd-capture-plan.js',
  },
  {
    source: path.resolve(__dirname, '../../../packages/clawd-target/src/profile.js'),
    target: 'target-profiles/clawd.js',
  },
  {
    source: path.resolve(__dirname, '../../../packages/codex-target/src/profile.js'),
    target: 'target-profiles/codex-pet.js',
  },
]);

const ASSETS = Object.freeze([
  ...RENDERER_ASSETS,
  {
    source: path.resolve(__dirname, '../../../node_modules/.pnpm/@zip.js+zip.js@2.7.57/node_modules/@zip.js/zip.js/dist/zip-no-worker.min.js'),
    target: 'vendor/zip-no-worker.min.js',
    packageName: '@zip.js/zip.js',
    version: '2.7.57',
    license: 'BSD-3-Clause',
    licenseSource: path.resolve(__dirname, '../../../node_modules/.pnpm/@zip.js+zip.js@2.7.57/node_modules/@zip.js/zip.js/LICENSE'),
  },
]);

const REPLACEMENTS = Object.freeze([
  ['../../packages/clawd-target/src/profile.js', 'target-profiles/clawd.js'],
  ['../../packages/codex-target/src/profile.js', 'target-profiles/codex-pet.js'],
  ['../../packages/live2d-exporter/node_modules/pixi.js/dist/browser/pixi.min.js', 'vendor/pixi.min.js'],
  ['../../packages/live2d-exporter/node_modules/@pixi/unsafe-eval/dist/browser/unsafe-eval.min.js', 'vendor/unsafe-eval.min.js'],
  ['../../packages/live2d-exporter/node_modules/pixi-live2d-display/dist/cubism4.min.js', 'vendor/cubism4.min.js'],
  ['../../packages/live2d-exporter/node_modules/pixi-live2d-display/dist/cubism2.min.js', 'vendor/cubism2.min.js'],
  ['../../node_modules/.pnpm/@zip.js+zip.js@2.7.57/node_modules/@zip.js/zip.js/dist/zip-no-worker.min.js', 'vendor/zip-no-worker.min.js'],
]);

function fail(message) {
  const error = new Error(message);
  error.code = 'MAPPER_ASSET_STAGE_FAILED';
  throw error;
}

function parseOutput(argv) {
  const outputIndex = argv.indexOf('--output');
  if (outputIndex < 0) return DEFAULT_OUTPUT;
  const output = argv[outputIndex + 1];
  if (!output || output.startsWith('-')) fail('--output requires a directory path.');
  return path.resolve(output);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function copyFile(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function stageMapperAssets(output = DEFAULT_OUTPUT) {
  if (!path.isAbsolute(output)) fail('Mapper staging output must be an absolute path.');
  if (!fs.statSync(SOURCE_MAPPER, { throwIfNoEntry: false })?.isFile()) fail('The shared Mapper document is missing.');
  for (const file of SUPPORT_FILES) {
    if (!fs.statSync(file.source, { throwIfNoEntry: false })?.isFile()) fail(`The shared Mapper support file is missing: ${file.target}`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(output), `${path.basename(output)}-`));
  try {
    const assets = stageRendererAssets(staging, ASSETS);
    let mapperHtml = fs.readFileSync(SOURCE_MAPPER, 'utf8');
    for (const [from, to] of REPLACEMENTS) mapperHtml = mapperHtml.replaceAll(from, to);
    if (mapperHtml.includes('../../packages/') || mapperHtml.includes('../../node_modules/')) fail('The staged Mapper still contains a workspace-relative dependency path.');
    if (/<script[^>]+live2dcubismcore/i.test(mapperHtml)) fail('Cubism Core must remain user-provided and cannot be staged.');
    fs.writeFileSync(path.join(staging, 'index.html'), mapperHtml, 'utf8');
    for (const file of SUPPORT_FILES) copyFile(file.source, path.join(staging, file.target));
    const manifestPath = path.join(staging, 'asset-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.source = 'apps/mapper/index.html';
    manifest.supportFiles = SUPPORT_FILES.map(file => ({ path: file.target, sha256: sha256(path.join(staging, file.target)) }));
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(staging, output);
    return { ...assets, output };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    const result = stageMapperAssets(parseOutput(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.code || 'MAPPER_ASSET_STAGE_FAILED'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ASSETS, DEFAULT_OUTPUT, SOURCE_MAPPER, SUPPORT_FILES, stageMapperAssets };
