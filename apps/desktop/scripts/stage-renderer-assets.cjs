const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_OUTPUT = path.resolve(__dirname, '../renderer-vendor');
const RENDERER_ASSETS = Object.freeze([
  {
    source: path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/pixi.js/dist/browser/pixi.min.js'),
    target: 'vendor/pixi.min.js',
    packageName: 'pixi.js',
    version: '6.5.10',
    license: 'MIT',
    licenseSource: path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/pixi.js/LICENSE'),
  },
  {
    source: path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/@pixi/unsafe-eval/dist/browser/unsafe-eval.min.js'),
    target: 'vendor/unsafe-eval.min.js',
    packageName: '@pixi/unsafe-eval',
    version: '6.5.10',
    license: 'MIT',
    licenseSource: path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/@pixi/unsafe-eval/LICENSE'),
  },
  {
    source: path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/pixi-live2d-display/dist/cubism4.min.js'),
    target: 'vendor/cubism4.min.js',
    packageName: 'pixi-live2d-display',
    version: '0.4.0',
    license: 'MIT',
    licenseSource: path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/pixi-live2d-display/LICENSE'),
  },
  {
    source: path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/pixi-live2d-display/dist/cubism2.min.js'),
    target: 'vendor/cubism2.min.js',
    packageName: 'pixi-live2d-display',
    version: '0.4.0',
    license: 'MIT',
    licenseSource: path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/pixi-live2d-display/LICENSE'),
  },
]);

function fail(message) {
  throw Object.assign(new Error(message), { code: 'RENDERER_ASSET_STAGE_FAILED' });
}

function stageRendererAssets(output = DEFAULT_OUTPUT, assets = RENDERER_ASSETS) {
  if (!path.isAbsolute(output)) fail('Renderer staging output must be an absolute path.');
  for (const asset of assets) {
    if (!fs.statSync(asset.source, { throwIfNoEntry: false })?.isFile()) fail(`Missing renderer asset: ${asset.target}`);
    if (!fs.statSync(asset.licenseSource, { throwIfNoEntry: false })?.isFile()) fail(`Missing license for ${asset.packageName}.`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const staging = fs.mkdtempSync(path.join(path.dirname(output), `${path.basename(output)}-`));
  try {
    const manifest = {
      schemaVersion: 1,
      source: 'production-renderer',
      runtimePolicy: 'Cubism Core and legacy runtimes are user-provided and are never staged.',
      assets: [],
      licenses: [],
    };
    for (const asset of assets) {
      const destination = path.join(staging, asset.target);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(asset.source, destination);
      manifest.assets.push({
        path: asset.target, package: asset.packageName, version: asset.version, license: asset.license,
        sha256: crypto.createHash('sha256').update(fs.readFileSync(destination)).digest('hex'),
      });
      if (manifest.licenses.some(item => item.packageName === asset.packageName && item.version === asset.version)) continue;
      const licensePath = `licenses/${asset.packageName.replaceAll('/', '_')}@${asset.version}.txt`;
      fs.mkdirSync(path.dirname(path.join(staging, licensePath)), { recursive: true });
      fs.copyFileSync(asset.licenseSource, path.join(staging, licensePath));
      manifest.licenses.push({ packageName: asset.packageName, version: asset.version, license: asset.license, path: licensePath });
    }
    fs.writeFileSync(path.join(staging, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(staging, output);
    return { output, assets: manifest.assets, licenses: manifest.licenses };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { process.stdout.write(`${JSON.stringify(stageRendererAssets(), null, 2)}\n`); }
  catch (error) { process.stderr.write(`${error.code}: ${error.message}\n`); process.exitCode = 1; }
}
module.exports = { DEFAULT_OUTPUT, RENDERER_ASSETS, stageRendererAssets };
