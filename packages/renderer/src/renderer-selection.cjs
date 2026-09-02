const {
  selectPixiLive2dAdapter,
} = require('./pixi-live2d-adapter.cjs');

/**
 * Select the Pixi adapter deterministically from the inspected Cubism
 * generation. Cubism 2 stays on its explicit legacy boundary; modern
 * generations share the modern Pixi adapter.
 */
function selectRendererAdapter(cubismVersion) {
  return selectPixiLive2dAdapter(cubismVersion);
}

function createRendererAdapter({ source, cubismVersion, ...options } = {}) {
  const version = source && typeof source === 'object' ? source.cubismVersion : cubismVersion;
  const { Adapter } = selectRendererAdapter(version);
  return new Adapter(options);
}

module.exports = {
  createRendererAdapter,
  selectRendererAdapter,
};
