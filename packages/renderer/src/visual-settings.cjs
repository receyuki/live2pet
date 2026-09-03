const { RendererContractError } = require('./errors.cjs');

function normalizeVisualSettings(value = { hiddenElementIds: [] }) {
  const ids = value?.hiddenElementIds;
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(ids) || ids.length > 4096
    || ids.some(id => typeof id !== 'string' || !id.length || id.length > 256 || /[\u0000-\u001f\u007f-\u009f]/.test(id))) {
    throw new RendererContractError('INVALID_VISUAL_SETTINGS', 'Visual Settings require at most 4096 non-empty Visual Element identities.');
  }
  return { hiddenElementIds: [...new Set(ids)].sort() };
}

// Serialized into the isolated page; keep all browser-side helpers inside it.
async function pageInitializeVisualElements() {
  const runtime = window.__live2petPixiLive2D;
  const internal = runtime.model.internalModel;
  const core = internal.coreModel;
  const modern = runtime.source.cubismVersion !== 2;
  const ids = modern ? Array.from(core._model?.parts?.ids || []) : [];
  if (!modern) {
    // Cubism 2 exposes Part lookup, but not enumeration. Its model-context
    // tables contain stable ID objects; validate candidates with the public
    // lookup instead of depending on minifier-specific table/property names.
    const context = core.getModelContext();
    for (const table of Object.values(context)) {
      if (!Array.isArray(table) || table.length > 4096) continue;
      for (const entry of table) {
        if (!entry || typeof entry !== 'object') continue;
        for (const value of Object.values(entry)) {
          const id = value && typeof value === 'object' ? value.id : null;
          if (typeof id === 'string' && !ids.includes(id) && core.getPartsDataIndex(id) >= 0) ids.push(id);
        }
      }
    }
  }
  let names = new Map();
  if (runtime.source.displayInfoUrl) {
    try {
      const response = await fetch(runtime.source.displayInfoUrl);
      const metadata = response.ok ? await response.json() : null;
      names = new Map((metadata?.Parts || []).filter(part => typeof part.Id === 'string' && typeof part.Name === 'string').map(part => [part.Id, part.Name]));
    } catch { /* Display names are optional; stable model identities remain usable. */ }
  }
  const elements = ids.map((id, index) => {
    const parentId = modern ? ids[core._model.parts.parentIndices?.[index]] : null;
    return { id, name: names.get(id) || id, kind: 'part', ...(parentId ? { parentId } : {}) };
  });
  const getOpacity = id => modern ? core.getPartOpacityById(id) : core.getPartsOpacity(id);
  const setOpacity = (id, opacity) => modern ? core.setPartOpacityById(id, opacity) : core.setPartsOpacity(id, opacity);
  let hidden = new Set();
  const authored = new Map();
  const restoreAuthored = () => {
    for (const [id, opacity] of authored) setOpacity(id, opacity);
    authored.clear();
  };
  const applyHidden = () => {
    for (const id of hidden) {
      authored.set(id, getOpacity(id));
      setOpacity(id, 0);
    }
  };
  // Restore the previous authored values before animation/pose; suppress only
  // after those updates and before Core calculates drawable opacity.
  internal.on('beforeMotionUpdate', restoreAuthored);
  internal.on('beforeModelUpdate', applyHidden);
  const measureVisible = () => {
    const width = runtime.app.renderer.width;
    const height = runtime.app.renderer.height;
    const extract = runtime.app.renderer.extract || runtime.app.renderer.plugins.extract;
    const pixels = extract.pixels(runtime.app.stage, new window.PIXI.Rectangle(0, 0, width, height));
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (right < left) return null;
    const scale = runtime.model.scale.x;
    return { x: (left - runtime.model.x) / scale, y: (top - runtime.model.y) / scale, width: (right - left + 1) / scale, height: (bottom - top + 1) / scale };
  };
  runtime.visualElements = elements;
  runtime.measureVisibleBounds = measureVisible;
  const measureAnimated = async () => {
    let union = null;
    const include = () => {
      const bounds = measureVisible();
      if (!bounds) return;
      if (!union) { union = bounds; return; }
      const right = Math.max(union.x + union.width, bounds.x + bounds.width);
      const bottom = Math.max(union.y + union.height, bounds.y + bounds.height);
      union.x = Math.min(union.x, bounds.x); union.y = Math.min(union.y, bounds.y);
      union.width = right - union.x; union.height = bottom - union.y;
    };
    // A shared source-motion envelope prevents selecting another recipe from
    // changing the export crop. Sample poses, not encoded frames: this runs
    // only when visibility changes, without capturing or transferring RGBA.
    for (const motion of runtime.source.motions) {
      await runtime.resetMotion(motion, runtime.options.motionPriority);
      include();
      for (let index = 1; index <= 8; index++) {
        runtime.model.update(Math.max(0.001, motion.duration * 1000 / 8));
        runtime.render(); include();
      }
    }
    if (!runtime.source.motions.length) { runtime.model.update(0.001); runtime.render(); include(); }
    return union;
  };
  runtime.setVisualSettings = async settings => {
    const known = new Set(ids);
    const unknown = settings.hiddenElementIds.filter(id => !known.has(id));
    if (unknown.length) throw new Error(`Visual Elements are no longer available: ${unknown.join(', ')}. Restore visibility or relink the matching Source Package.`);
    if (JSON.stringify(runtime.visualSettings) === JSON.stringify(settings)) return { elements, settings: runtime.visualSettings, empty: hidden.size > 0 && !runtime.visualBounds };
    restoreAuthored();
    hidden = new Set(settings.hiddenElementIds);
    const previous = { ...runtime.state };
    runtime.app.stop();
    runtime.visualBounds = null;
    runtime.fit();
    // Measure in the full-source frame first, never in a previously cropped
    // frame: restoring a Part must not retain the prior zoom/crop.
    if (hidden.size) runtime.visualBounds = await measureAnimated();
    else { runtime.model.update(0.001); runtime.render(); }
    runtime.fit();
    const motion = runtime.source.motions.find(item => item.id === previous.motionId);
    if (hidden.size && motion) {
      await runtime.resetMotion(motion, runtime.options.motionPriority);
      runtime.model.update(Math.max(0.001, previous.time * 1000));
    }
    runtime.render();
    runtime.syncTicker();
    runtime.visualSettings = { hiddenElementIds: [...hidden].sort() };
    return { elements, settings: runtime.visualSettings, empty: hidden.size > 0 && !runtime.visualBounds };
  };
  runtime.visualSettings = { hiddenElementIds: [] };
  return elements;
}

function pageSetVisualSettings(settings) {
  return window.__live2petPixiLive2D.setVisualSettings(settings);
}

module.exports = { normalizeVisualSettings, pageInitializeVisualElements, pageSetVisualSettings };
