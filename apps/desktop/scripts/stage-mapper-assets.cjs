const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE_MAPPER = path.resolve(__dirname, '../../mapper/index.html');
const DEFAULT_OUTPUT = path.resolve(__dirname, '../mapper-dist');

const ASSETS = Object.freeze([
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
  if (!fs.statSync(SOURCE_MAPPER).isFile()) fail('The shared Mapper document is missing.');

  for (const asset of ASSETS) {
    if (!fs.statSync(asset.source, { throwIfNoEntry: false })?.isFile()) {
      fail(`The local ${asset.packageName} ${asset.version} browser asset is missing: ${asset.target}`);
    }
    if (!fs.statSync(asset.licenseSource, { throwIfNoEntry: false })?.isFile()) {
      fail(`The local ${asset.packageName} license file is missing.`);
    }
  }

  const parent = path.dirname(output);
  fs.mkdirSync(parent, { recursive: true });
  const staging = fs.mkdtempSync(path.join(parent, `${path.basename(output)}-`), { encoding: 'utf8' });
  try {
    let mapperHtml = fs.readFileSync(SOURCE_MAPPER, 'utf8');
    for (const [from, to] of REPLACEMENTS) mapperHtml = mapperHtml.replaceAll(from, to);
    if (mapperHtml.includes('../../packages/') || mapperHtml.includes('../../node_modules/')) {
      fail('The staged Mapper still contains a workspace-relative dependency path.');
    }
    if (/<script[^>]+live2dcubismcore/i.test(mapperHtml)) {
      fail('Cubism Core must remain user-provided and cannot be staged.');
    }
    fs.writeFileSync(path.join(staging, 'index.html'), mapperHtml, 'utf8');

    const manifest = {
      schemaVersion: 1,
      source: 'apps/mapper/index.html',
      runtimePolicy: 'Cubism Core and legacy runtimes are user-provided and are never staged.',
      assets: ASSETS.map((asset) => {
        const destination = path.join(staging, asset.target);
        copyFile(asset.source, destination);
        return {
          path: asset.target,
          package: asset.packageName,
          version: asset.version,
          license: asset.license,
          sha256: sha256(destination),
        };
      }),
    };
    const notices = [];
    for (const asset of ASSETS) {
      const key = `${asset.packageName}@${asset.version}`;
      if (notices.some((notice) => notice.key === key)) continue;
      const licensePath = path.join(staging, 'licenses', `${asset.packageName.replaceAll('/', '_')}@${asset.version}.txt`);
      copyFile(asset.licenseSource, licensePath);
      notices.push({ key, packageName: asset.packageName, version: asset.version, license: asset.license, path: path.relative(staging, licensePath).replaceAll(path.sep, '/') });
    }
    manifest.licenses = notices.map(({ key, ...notice }) => notice);
    fs.writeFileSync(path.join(staging, 'asset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    fs.rmSync(output, { recursive: true, force: true });
    fs.renameSync(staging, output);
    return { output, assets: manifest.assets, licenses: manifest.licenses };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
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

module.exports = { ASSETS, DEFAULT_OUTPUT, SOURCE_MAPPER, stageMapperAssets };
