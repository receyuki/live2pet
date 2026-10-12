// Personal, offline import only. No runtime bytes are bundled with Live2Pet.
const path = require('node:path');
const fs = require('node:fs');
const { LOCAL_SPINE_PACKS, importLocalSpinePack } = require('../../../packages/spine-pack/src/index.cjs');

function importFromRyutility(destination, checkout) {
  const modules = path.join(checkout, 'node_modules');
  const pinned = { 'pixi.js': '6.5.10', '@pixi-spine/base': '3.1.2', '@pixi-spine/runtime-3.8': '3.1.2', 'pixi-spine-runtime-3.6': '3.1.3' };
  for (const [name, version] of Object.entries(pinned)) {
    if (JSON.parse(fs.readFileSync(path.join(modules, name, 'package.json'), 'utf8')).version !== version) throw new Error(`Unexpected ${name} version; expected ${version}.`);
  }
  const common = {
    'pixi.min.js': path.join(modules, 'pixi.js/dist/browser/pixi.min.js'),
    'unsafe-eval.min.js': path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/@pixi/unsafe-eval/dist/browser/unsafe-eval.min.js'),
    'LICENSE': path.join(checkout, 'resources/spine/runtimes/4.0/LICENSE'),
    'PIXI-LICENSE': path.join(modules, 'pixi.js/LICENSE'),
    'UNSAFE-EVAL-LICENSE': path.resolve(__dirname, '../../../packages/live2d-exporter/node_modules/@pixi/unsafe-eval/LICENSE'),
    'spine-base.js': path.join(modules, '@pixi-spine/base/dist/base.js'),
  };
  return LOCAL_SPINE_PACKS.map((pack) => importLocalSpinePack(destination, {
    packId: pack.id, confirmInstall: true,
    files: { ...common, 'spine-player.min.js': pack.runtimeLine === '2.1'
      ? path.join(checkout, 'resources/spine/runtimes/2.1/spine-player.min.js')
      : pack.runtimeLine === '3.6' ? path.join(modules, 'pixi-spine-runtime-3.6/dist/runtime-3.6.js')
        : path.join(modules, '@pixi-spine/runtime-3.8/dist/runtime-3.8.js') },
  }));
}

if (require.main === module) {
  const [destination, checkout] = process.argv.slice(2);
  if (!destination || !checkout || !path.isAbsolute(destination) || !path.isAbsolute(checkout)) throw new Error('Usage: node install-local-spine-compat.cjs /absolute/pack-root /absolute/RYutility-checkout');
  console.log(JSON.stringify(importFromRyutility(destination, checkout), null, 2));
}
module.exports = { importFromRyutility };
