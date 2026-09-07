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
  const partIds = modern ? Array.from(core._model?.parts?.ids || []) : [];
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
          if (typeof id === 'string' && !partIds.includes(id) && core.getPartsDataIndex(id) >= 0) partIds.push(id);
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
  const elements = partIds.map((id, index) => {
    const parentId = modern ? partIds[core._model.parts.parentIndices?.[index]] : null;
    return { id, name: names.get(id) || id, kind: 'part', ...(parentId ? { parentId } : {}) };
  });
  const drawables = modern ? core._model?.drawables : null;
  const drawableIndexByElementId = new Map();
  if (drawables) for (let index = 0; index < drawables.ids.length; index++) {
    if (drawables.parentPartIndices[index] >= 0) continue;
    const rawId = String(drawables.ids[index]);
    const id = `drawable:${rawId}`;
    drawableIndexByElementId.set(id, index);
    elements.push({ id, name: rawId, kind: 'drawable' });
  }
  const elementIds = elements.map(element => element.id);
  const getOpacity = id => modern ? core.getPartOpacityById(id) : core.getPartsOpacity(id);
  const setOpacity = (id, opacity) => modern ? core.setPartOpacityById(id, opacity) : core.setPartsOpacity(id, opacity);
  const getParameter = index => modern ? core.getParameterValueByIndex(index) : core.getParamFloat(index);
  const setParameter = (index, value) => modern ? core.setParameterValueByIndex(index, value) : core.setParamFloat(index, value);
  let parameterCount = modern ? core.getParameterCount() : 0;
  if (!modern) {
    // Legacy indexed reads return undefined beyond the parameter table.
    while (parameterCount < 8192 && getParameter(parameterCount) !== undefined) parameterCount++;
    if (parameterCount === 8192) throw new Error('The model exceeds the supported parameter snapshot size.');
  }
  const readParameters = () => Array.from({ length: parameterCount }, (_, index) => getParameter(index));
  const writeParameters = values => values.forEach((value, index) => setParameter(index, value));
  let posedParameters = readParameters();
  let hidden = new Set();
  const originalGetDrawableOpacity = modern && typeof core.getDrawableOpacity === 'function' ? core.getDrawableOpacity.bind(core) : null;
  if (originalGetDrawableOpacity) core.getDrawableOpacity = index => {
    const elementId = `drawable:${String(drawables.ids[index])}`;
    return hidden.has(elementId) ? 0 : originalGetDrawableOpacity(index);
  };
  const captureBounds = new Map();
  let captureKey = null;
  const authored = new Map();
  const restoreAuthored = () => {
    for (const [id, opacity] of authored) setOpacity(id, opacity);
    authored.clear();
  };
  const applyHidden = () => {
    for (const id of hidden) {
      if (drawableIndexByElementId.has(id)) continue;
      authored.set(id, getOpacity(id));
      setOpacity(id, 0);
    }
  };
  // Restore the previous authored values before animation/pose; suppress only
  // after those updates and before Core calculates drawable opacity.
  internal.on('beforeMotionUpdate', restoreAuthored);
  internal.on('beforeModelUpdate', () => { posedParameters = readParameters(); applyHidden(); });
  const updateVisibility = () => {
    // Recalculate drawables using the last rendered pose, not another motion /
    // physics tick. Cubism restores base parameters after drawing its pose.
    const baseParameters = readParameters();
    restoreAuthored();
    writeParameters(posedParameters);
    try { applyHidden(); core.update(); }
    finally { writeParameters(baseParameters); }
  };
  const measureVisible = (expand = false, attempt = 0) => {
    const width = runtime.app.renderer.width;
    const height = runtime.app.renderer.height;
    const pixels = runtime.readPixels();
    let left = width, top = height, right = -1, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
    if (right < left) return null;
    // Some poses extend beyond the authored canvas. A clipped alpha rectangle
    // is not the model's full bounds: zoom out before measuring it for fitting.
    if (expand && attempt < 4 && (left === 0 || top === 0 || right === width - 1 || bottom === height - 1)) {
      runtime.model.scale.set(runtime.model.scale.x / 2);
      runtime.model.x = width / 2 + (runtime.model.x - width / 2) / 2;
      runtime.model.y = height / 2 + (runtime.model.y - height / 2) / 2;
      runtime.render();
      return measureVisible(true, attempt + 1);
    }
    const scale = runtime.model.scale.x;
    return { x: (left - runtime.model.x) / scale, y: (top - runtime.model.y) / scale, width: (right - left + 1) / scale, height: (bottom - top + 1) / scale };
  };
  runtime.visualElements = elements;
  runtime.measureVisibleBounds = measureVisible;
  const measureAnimated = async motion => {
    let union = null;
    const include = () => {
      const bounds = measureVisible(true);
      if (!bounds) return;
      if (!union) { union = bounds; return; }
      const right = Math.max(union.x + union.width, bounds.x + bounds.width);
      const bottom = Math.max(union.y + union.height, bounds.y + bounds.height);
      union.x = Math.min(union.x, bounds.x); union.y = Math.min(union.y, bounds.y);
      union.width = right - union.x; union.height = bottom - union.y;
    };
    // Build-only framing. Never scan motions on an interactive toggle.
    await runtime.resetMotion(motion, runtime.options.motionPriority);
    include();
    for (let index = 1; index <= 8; index++) {
      runtime.model.update(Math.max(0.001, motion.duration * 1000 / 8));
      runtime.render(); include();
    }
    return union;
  };
  runtime.prepareVisualCapture = async motionId => {
    if (!hidden.size) return;
    const key = JSON.stringify([motionId, runtime.state.expressionId ?? null]);
    if (captureKey === key) return;
    if (captureBounds.has(key)) {
      runtime.visualBounds = captureBounds.get(key);
      runtime.fit(); runtime.render();
      captureKey = key;
      return;
    }
    const captureMotion = runtime.source.motions.find(item => item.id === motionId);
    if (!captureMotion) throw new Error('Capture Motion is not available.');
    const previous = { ...runtime.state };
    runtime.app.stop();
    runtime.visualBounds = null;
    runtime.fit();
    // A large effect or camera move in a different Motion must not shrink
    // this asset. Keep one fixed envelope within this Motion, not across all.
    runtime.visualBounds = await measureAnimated(captureMotion);
    captureBounds.set(key, runtime.visualBounds);
    runtime.fit();
    const motion = runtime.source.motions.find(item => item.id === previous.motionId);
    if (motion) {
      await runtime.resetMotion(motion, runtime.options.motionPriority);
      runtime.model.update(Math.max(0.001, previous.time * 1000));
    }
    runtime.render();
    captureKey = key;
  };
  runtime.setVisualSettings = async settings => {
    const known = new Set(elementIds);
    const unknown = settings.hiddenElementIds.filter(id => !known.has(id));
    if (unknown.length) throw new Error(`Visual Elements are no longer available: ${unknown.join(', ')}. Restore visibility or relink the matching Source Package.`);
    if (JSON.stringify(runtime.visualSettings) === JSON.stringify(settings)) return { elements, settings: runtime.visualSettings, empty: hidden.size > 0 && !runtime.visualBounds };
    restoreAuthored();
    hidden = new Set(settings.hiddenElementIds);
    captureBounds.clear();
    captureKey = null;
    runtime.app.stop();
    runtime.visualBounds = null;
    runtime.fit();
    // Measure in the full-source frame first, never in a previously cropped
    // frame: restoring a Part must not retain the prior zoom/crop.
    updateVisibility();
    runtime.render();
    if (hidden.size) runtime.visualBounds = measureVisible(true);
    runtime.fit();
    runtime.render();
    runtime.syncTicker();
    runtime.visualSettings = { hiddenElementIds: [...hidden].sort() };
    return { elements, settings: runtime.visualSettings, empty: hidden.size > 0 && !runtime.visualBounds };
  };
  runtime.getVisualElementThumbnail = id => {
    if (!elementIds.includes(id)) throw new Error('Visual Element is not available in this Source Package.');
    const byId = new Map(elements.map(element => [element.id, element]));
    const keep = new Set([id]);
    let parent = byId.get(id)?.parentId;
    while (parent && !keep.has(parent)) { keep.add(parent); parent = byId.get(parent)?.parentId; }
    for (const element of elements) {
      let current = element.id;
      const visited = new Set();
      while (current && !visited.has(current)) {
        if (current === id) { keep.add(element.id); break; }
        visited.add(current); current = byId.get(current)?.parentId;
      }
    }
    const previousHidden = hidden;
    const previousBounds = runtime.visualBounds;
    runtime.app.stop();
    try {
      restoreAuthored();
      hidden = new Set(elementIds.filter(candidate => !keep.has(candidate)));
      runtime.visualBounds = null;
      runtime.fit();
      updateVisibility();
      runtime.render();
      const bounds = measureVisible(true);
      if (!bounds) return { id, dataUrl: null };
      const width = runtime.app.renderer.width, height = runtime.app.renderer.height;
      const pixels = runtime.readPixels();
      const source = document.createElement('canvas');
      source.width = width; source.height = height;
      source.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
      const output = document.createElement('canvas');
      output.width = output.height = 192;
      const scale = runtime.model.scale.x;
      const crop = { x: bounds.x * scale + runtime.model.x, y: bounds.y * scale + runtime.model.y, width: bounds.width * scale, height: bounds.height * scale };
      const fit = Math.min(180 / crop.width, 180 / crop.height);
      output.getContext('2d').drawImage(source, crop.x, crop.y, crop.width, crop.height, (192 - crop.width * fit) / 2, (192 - crop.height * fit) / 2, crop.width * fit, crop.height * fit);
      return { id, dataUrl: output.toDataURL('image/png') };
    } finally {
      restoreAuthored();
      hidden = previousHidden;
      runtime.visualBounds = previousBounds;
      runtime.fit();
      updateVisibility();
      runtime.render();
      runtime.syncTicker();
    }
  };
  runtime.scanVisualElements = async motionId => {
    if (!modern) throw new Error('Large Part detection requires a modern Cubism model.');
    const motion = runtime.source.motions.find(item => item.id === motionId);
    if (!motion) throw new Error('Scan Motion is not available.');
    const bounds = runtime.model.getLocalBounds();
    const canvasArea = bounds.width * bounds.height;
    const physics = internal.physics;
    const previousBounds = runtime.visualBounds;
    const candidates = new Map();
    runtime.app.stop();
    runtime.state.playing = false;
    // Inspect authored geometry, not physics transients from coarse sampling.
    // The live simulation is left untouched until the final restart.
    internal.physics = null;
    try {
      await runtime.resetMotion(motion, runtime.options.motionPriority);
      for (let sample = 0; sample <= 8; sample++) {
        if (sample) { runtime.model.update(Math.max(0.001, motion.duration * 1000 / 8)); runtime.render(); }
        const drawables = core._model.drawables;
        const areas = new Map();
        for (let index = 0; index < drawables.ids.length; index++) {
          const id = partIds[drawables.parentPartIndices[index]] || `drawable:${String(drawables.ids[index])}`;
          if (hidden.has(id) || drawables.opacities[index] <= 0) continue;
          const vertices = internal.getDrawableVertices(index);
          let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
          for (let v = 0; v < vertices.length; v += 2) {
            left = Math.min(left, vertices[v]); right = Math.max(right, vertices[v]);
            top = Math.min(top, vertices[v + 1]); bottom = Math.max(bottom, vertices[v + 1]);
          }
          const areaRatio = (right - left) * (bottom - top) / canvasArea;
          if (areaRatio >= 0.5) areas.set(id, Math.max(areas.get(id) || 0, areaRatio));
        }
        // At most nine pose snapshots, shared across candidates. Only the
        // eight largest candidates need expensive isolated image extraction.
        let pose;
        for (const [id, areaRatio] of areas) {
          if (areaRatio <= (candidates.get(id)?.areaRatio || 0)) continue;
          pose ||= { parameters: [...posedParameters], opacity: partIds.map(getOpacity) };
          candidates.set(id, { id, time: motion.duration * sample / 8, areaRatio, pose });
        }
      }
      const result = [];
      for (const candidate of [...candidates.values()].sort((a, b) => b.areaRatio - a.areaRatio).slice(0, 8)) {
        restoreAuthored();
        posedParameters = candidate.pose.parameters;
        partIds.forEach((id, index) => setOpacity(id, candidate.pose.opacity[index]));
        updateVisibility(); runtime.render();
        const thumbnail = runtime.getVisualElementThumbnail(candidate.id);
        if (thumbnail.dataUrl) result.push({ ...thumbnail, time: candidate.time, areaRatio: candidate.areaRatio });
      }
      return { motionId, candidates: result };
    } finally {
      restoreAuthored();
      internal.physics = physics;
      runtime.visualBounds = previousBounds;
      runtime.state.motionId = motionId;
      runtime.state.time = 0;
      runtime.fit();
      await runtime.resetMotion(motion, runtime.options.motionPriority, true);
      runtime.app.stop();
    }
  };
  runtime.visualSettings = { hiddenElementIds: [] };
  return elements;
}

function pageSetVisualSettings(settings) {
  return window.__live2petPixiLive2D.setVisualSettings(settings);
}

function pageVisualElementThumbnail(id) {
  return window.__live2petPixiLive2D.getVisualElementThumbnail(id);
}

function pageScanVisualElements(motionId) {
  return window.__live2petPixiLive2D.scanVisualElements(motionId);
}

module.exports = { normalizeVisualSettings, pageInitializeVisualElements, pageSetVisualSettings, pageVisualElementThumbnail, pageScanVisualElements };
