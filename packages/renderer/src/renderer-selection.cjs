const {
  selectPixiLive2dAdapter,
} = require('./pixi-live2d-adapter.cjs');
const { SpinePlayerAdapter } = require('./spine-player-adapter.cjs');

/**
 * Select the Pixi adapter deterministically from the inspected Cubism
 * generation. Cubism 2 stays on its explicit legacy boundary; modern
 * generations share the modern Pixi adapter.
 */
function selectRendererAdapter(input) {
  if (input && typeof input === 'object' && input.format === 'spine') {
    if (input.runtimeLine !== '4.3') throw Object.assign(new Error(`No Spine adapter is registered for runtime line ${String(input.runtimeLine)}.`), { code: 'UNSUPPORTED_SPINE_VERSION' });
    return { kind: 'spine-player-4.3', Adapter: SpinePlayerAdapter };
  }
  return selectPixiLive2dAdapter(input);
}

function createRendererAdapter({ source, cubismVersion, ...options } = {}) {
  const descriptor = source && typeof source === 'object' ? source : cubismVersion;
  const { Adapter } = selectRendererAdapter(descriptor);
  return new Adapter(options);
}

module.exports = {
  createRendererAdapter,
  selectRendererAdapter,
};
