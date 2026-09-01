const { RendererContractError } = require('./errors.cjs');
const {
  LegacyPixiLive2dAdapter,
  PixiLive2dAdapter,
  selectPixiLive2dAdapter,
} = require('./pixi-live2d-adapter.cjs');
const { OfficialCubismWebFrameworkAdapter } = require('./official-cubism-adapter.cjs');

const MODERN_RENDERER_ADAPTERS = Object.freeze(['pixi', 'official']);

function fail(code, message, details = {}) {
  throw new RendererContractError(code, message, details);
}

function normalizeModernAdapter(value) {
  const adapter = value == null ? 'pixi' : String(value).trim().toLowerCase();
  if (!MODERN_RENDERER_ADAPTERS.includes(adapter)) {
    fail('UNSUPPORTED_RENDERER_ADAPTER', `Modern renderer adapter must be one of: ${MODERN_RENDERER_ADAPTERS.join(', ')}.`, { adapter });
  }
  return adapter;
}

/**
 * Select a renderer from the inspected Cubism generation. Legacy Cubism 2
 * always stays on its explicit adapter; modern generations may opt into the
 * user-provided official Framework bridge while Pixi remains the fallback.
 */
function selectRendererAdapter(cubismVersion, { modern = 'pixi', modernAdapter } = {}) {
  const version = Number(cubismVersion);
  if (version === 2) return { kind: 'legacy-cubism2', Adapter: LegacyPixiLive2dAdapter, adapter: 'pixi' };
  if ([3, 4, 5].includes(version)) {
    const adapter = normalizeModernAdapter(modernAdapter === undefined ? modern : modernAdapter);
    if (adapter === 'official') return { kind: 'modern-cubism-official', Adapter: OfficialCubismWebFrameworkAdapter, adapter };
    return { kind: 'modern-cubism', Adapter: PixiLive2dAdapter, adapter };
  }
  // Keep the Pixi selector as the source of truth for unsupported generations
  // and its existing typed error/details contract.
  return selectPixiLive2dAdapter(version);
}

function createRendererAdapter({ source, cubismVersion, modern = 'pixi', modernAdapter, ...options } = {}) {
  const version = source && typeof source === 'object' ? source.cubismVersion : cubismVersion;
  const { Adapter } = selectRendererAdapter(version, { modern, modernAdapter });
  return new Adapter(options);
}

module.exports = {
  MODERN_RENDERER_ADAPTERS,
  createRendererAdapter,
  normalizeModernAdapter,
  selectRendererAdapter,
};
