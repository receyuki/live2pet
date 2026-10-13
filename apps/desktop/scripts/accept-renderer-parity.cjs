// Opt-in local quantitative acceptance; no personal paths or models are bundled.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const sharp = require('sharp');
const { inspectSourcePackage } = require('@live2pet/source-inspector');
const { loadRuntimeForGeneration } = require('@live2pet/runtime');
const { resolveSpinePack } = require('@live2pet/spine-pack');
const { createRendererAssetServer, spineSourceFromManifest, pixiSourceFromManifest } = require('@live2pet/renderer');

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-renderer-parity-'));
  const servers = [], cases = [], originals = [];
  const inputs = JSON.parse(process.env.LIVE2PET_PARITY_MODELS || '[]');
  assert.ok(process.env.LIVE2PET_SPINE_PACKS, 'Provide the verified local pack storage.');
  console.log(`PARITY_ROOT=${root}`);
  async function add(name, sourceRoot, modelConfig, expectations = {}) {
    const manifest = inspectSourcePackage(sourceRoot, { modelConfig });
    let options;
    if (manifest.model.format === 'spine') {
      const pack = resolveSpinePack(process.env.LIVE2PET_SPINE_PACKS, manifest.model.runtimeLine, { spineVersion: manifest.model.spineVersion });
      options = { spineAssets: { script: pack.scriptPath, style: pack.stylePath, ...(pack.adapter ? { adapter: pack.adapter, runtimeLine: pack.runtimeLine, pixi: pack.pixiPath, unsafeEval: pack.unsafeEvalPath, base: pack.basePath, decoder: pack.decoderPath } : {}) } };
    } else {
      const runtime = await loadRuntimeForGeneration(process.env.LIVE2PET_RUNTIME_SETTINGS, manifest.model.cubism, { readOnly: true });
      const vendor = path.resolve(__dirname, '../renderer-vendor/vendor');
      options = { runtimePath: runtime.runtimePath, previewAssets: { pixi: path.join(vendor, 'pixi.min.js'), unsafeEval: path.join(vendor, 'unsafe-eval.min.js'), live2dAdapter: path.join(vendor, manifest.model.cubism === 2 ? 'cubism2.min.js' : 'cubism4.min.js') } };
    }
    const server = await createRendererAssetServer({ sourceRoot, ...options }); servers.push(server);
    const source = (manifest.model.format === 'spine' ? spineSourceFromManifest : pixiSourceFromManifest)(manifest, { baseUrl: server.baseUrl + '/model' });
    if (server.legacyDecoderUrl) source.legacyDecoderUrl = server.legacyDecoderUrl;
    cases.push({ name, source, previewUrl: server.previewUrl, pngPath: path.join(root, `${cases.length}.png`), ...expectations });
  }
  try {
    for (const version of ['4.0.64', '4.1.24', '4.2.119', '4.3.13']) for (const pma of [false, true]) {
      const directory = path.join(root, `${version}-${pma ? 'pma' : 'straight'}`); fs.mkdirSync(directory);
      const rgb = pma ? [26, 51, 77] : [51, 102, 153];
      await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: rgb[0], g: rgb[1], b: rgb[2], alpha: 128 / 255 } } }).png().toFile(path.join(directory, 'tile.png'));
      fs.writeFileSync(path.join(directory, 'tile.atlas'), `tile.png\nsize: 64,64\nfilter: Linear,Linear\n${pma ? 'pma: true\n' : ''}tile\nbounds: 0,0,64,64\n`);
      fs.writeFileSync(path.join(directory, 'tile.json'), JSON.stringify({ skeleton: { spine: version }, bones: [{ name: 'root' }], slots: [{ name: 'body', bone: 'root', attachment: 'tile' }], skins: [{ name: 'default', attachments: { body: { tile: { type: 'region', width: 64, height: 64 } } } }], animations: { idle: {} } }));
      await add(`${version} ${pma ? 'PMA' : 'Straight'} fixture`, directory, null, { expectedPma: pma, expectedCenter: [26, 51, 77, 128], build: !pma });
    }
    for (const [index, input] of inputs.entries()) {
      const fingerprint = inspectSourcePackage(input.inputPath, { modelConfig: input.modelConfig }).source.fingerprint;
      originals.push({ ...input, fingerprint });
      const copy = path.join(root, `model-${index}`); fs.cpSync(input.inputPath, copy, { recursive: true });
      await add(input.name || `Model ${index}`, copy, input.modelConfig, input.expectations);
    }
    const electron = path.resolve(__dirname, '../node_modules/.bin/electron');
    const runner = path.resolve(__dirname, '../../../packages/renderer/test/fidelity.electron.cjs');
    const code = await new Promise((resolve, reject) => {
      const child = spawn(electron, [runner], { env: { ...process.env, LIVE2PET_FIDELITY_CASES: JSON.stringify(cases) }, stdio: 'inherit' });
      child.on('error', reject); child.on('exit', resolve);
    });
    assert.equal(code, 0, 'Quantitative renderer acceptance failed.');
    for (const input of originals) assert.equal(inspectSourcePackage(input.inputPath, { modelConfig: input.modelConfig }).source.fingerprint, input.fingerprint, `${input.name}: original files changed`);
  } finally { await Promise.all(servers.map(server => server.close())); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
