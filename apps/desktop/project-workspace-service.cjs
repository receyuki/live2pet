const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  acknowledgeSourceReview,
  loadProjectFile,
  relinkProjectSource,
  saveProjectFile,
  validateProject,
} = require('@live2pet/project');
const { openPortableProject, savePortableProject } = require('./portable-project.cjs');

const PROJECT_STATE_VERSION = 1;
const WINDOW_STATE_VERSION = 1;
const MAX_RECENT_PROJECTS = 10;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const PROJECT_EXTENSION = '.l2p';
const PORTABLE_PROJECT_EXTENSION = '.l2pack';
const LEGACY_PROJECT_EXTENSION = '.live2pet';
const PROJECT_EXTENSIONS = new Set([PROJECT_EXTENSION, PORTABLE_PROJECT_EXTENSION, LEGACY_PROJECT_EXTENSION]);

function isRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function atomicWriteJson(filePath, value) {
  const absolute = path.resolve(filePath);
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(absolute), { recursive: true, mode: 0o700 });
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, absolute);
  } catch (error) {
    try { fs.unlinkSync(temporary); } catch {}
    throw error;
  }
}

function safeLabel(value, fallback, max = 256) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\0-\x1f\x7f]/g, '').trim();
  return normalized && normalized.length <= max ? normalized : fallback;
}

function normalizeRecentState(value) {
  if (!isRecord(value) || value.version !== PROJECT_STATE_VERSION || !Array.isArray(value.recent)) return [];
  const seenIds = new Set();
  const seenPaths = new Set();
  const recent = [];
  for (const entry of value.recent.slice(0, MAX_RECENT_PROJECTS)) {
    if (!isRecord(entry) || typeof entry.documentId !== 'string' || !DOCUMENT_ID_PATTERN.test(entry.documentId)) continue;
    if (typeof entry.path !== 'string' || !entry.path || entry.path.length > 4096 || entry.path.includes('\0') || !path.isAbsolute(entry.path)) continue;
    const absolute = path.resolve(entry.path);
    if (seenIds.has(entry.documentId) || seenPaths.has(absolute)) continue;
    const fileName = safeLabel(entry.fileName, path.basename(absolute));
    const name = safeLabel(entry.name, path.basename(fileName, path.extname(fileName)) || 'Untitled');
    seenIds.add(entry.documentId);
    seenPaths.add(absolute);
    recent.push({ documentId: entry.documentId, path: absolute, name, fileName });
  }
  return recent;
}

function readRecentState(stateFile) {
  try {
    const text = fs.readFileSync(stateFile, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > 128 * 1024) return [];
    return normalizeRecentState(JSON.parse(text));
  } catch {
    return [];
  }
}

function projectDialogOptions(kind, defaultPath, portable = false) {
  if (kind === 'open') {
    return {
      title: 'Open Live2Pet Project',
      properties: ['openFile'],
      filters: [{ name: 'Live2Pet Project', extensions: ['l2p', 'l2pack', 'live2pet', 'json'] }],
    };
  }
  return {
    title: 'Save Live2Pet Project',
    ...(defaultPath ? { defaultPath } : {}),
    filters: [{ name: portable ? 'Live2Pet Portable Project' : 'Live2Pet Project', extensions: [portable ? 'l2pack' : 'l2p'] }],
  };
}

function ensureProjectExtension(filePath, extension = PROJECT_EXTENSION) {
  const current = path.extname(filePath).toLowerCase();
  if (!current) return `${filePath}${extension}`;
  if (current === extension || (extension === PROJECT_EXTENSION && current === LEGACY_PROJECT_EXTENSION)) return filePath;
  if (PROJECT_EXTENSIONS.has(current)) return `${filePath.slice(0, -current.length)}${extension}`;
  return `${filePath}${extension}`;
}

function rethrowProjectError(error, code, message) {
  if (error?.name === 'ProjectValidationError') throw error;
  throw Object.assign(new Error(message), { code });
}

function createProjectWorkspaceService({ stateFile, portableRoot, showOpenDialog, showSaveDialog } = {}) {
  if (typeof stateFile !== 'string' || !path.isAbsolute(stateFile)) throw new TypeError('Project workspace stateFile must be an absolute path.');
  portableRoot ||= path.join(path.dirname(stateFile), 'portable-projects');
  if (typeof portableRoot !== 'string' || !path.isAbsolute(portableRoot)) throw new TypeError('Project workspace portableRoot must be an absolute path.');
  if (typeof showOpenDialog !== 'function' || typeof showSaveDialog !== 'function') throw new TypeError('Project workspace dialogs must be functions.');
  let recent = readRecentState(stateFile);

  const persist = () => atomicWriteJson(stateFile, { version: PROJECT_STATE_VERSION, recent });
  const publicRecent = () => recent.map((entry) => ({
    documentId: entry.documentId,
    name: entry.name,
    fileName: entry.fileName,
    available: (() => { try { return fs.statSync(entry.path).isFile(); } catch { return false; } })(),
  }));
  const register = (filePath, project, existingId = null) => {
    const absolute = path.resolve(filePath);
    const matching = recent.find((entry) => entry.path === absolute);
    const documentId = matching?.documentId || existingId || crypto.randomUUID();
    recent = recent.filter((entry) => entry.path !== absolute && entry.documentId !== documentId);
    recent.unshift({
      documentId,
      path: absolute,
      name: safeLabel(project?.name, path.basename(absolute, path.extname(absolute)) || 'Untitled'),
      fileName: path.basename(absolute),
    });
    recent = recent.slice(0, MAX_RECENT_PROJECTS);
    persist();
    return recent[0];
  };

  return Object.freeze({
    getRecentProjects: async () => publicRecent(),
    clearRecentProjects: async () => {
      recent = [];
      persist();
      return publicRecent();
    },
    openProject: async ({ documentId, inputPath } = {}) => {
      let filePath;
      let existingId = null;
      if (documentId !== undefined) {
        const entry = recent.find((item) => item.documentId === documentId);
        if (!entry) throw Object.assign(new Error('The recent project is no longer registered.'), { code: 'PROJECT_DOCUMENT_NOT_FOUND' });
        filePath = entry.path;
        existingId = entry.documentId;
      } else if (inputPath !== undefined) {
        filePath = inputPath;
      } else {
        const selected = await showOpenDialog(projectDialogOptions('open'));
        if (selected?.canceled || !selected?.filePaths?.[0]) return { cancelled: true, recentProjects: publicRecent() };
        filePath = selected.filePaths[0];
      }
      try {
        const extension = path.extname(filePath).toLowerCase();
        const project = extension === PORTABLE_PROJECT_EXTENSION
          ? await openPortableProject(filePath, portableRoot)
          : loadProjectFile(filePath);
        const entry = register(filePath, project, existingId);
        return { cancelled: false, documentId: entry.documentId, fileName: entry.fileName, project, recentProjects: publicRecent() };
      } catch (error) {
        rethrowProjectError(error, 'PROJECT_OPEN_FAILED', 'The selected Live2Pet project could not be opened.');
      }
    },
    saveProject: async ({ documentId, project, saveAs = false, portable = false } = {}) => {
      const validated = validateProject(project);
      const current = documentId === undefined ? null : recent.find((item) => item.documentId === documentId) || null;
      let filePath = !saveAs && !portable && current ? current.path : null;
      if (!filePath) {
        const extension = portable ? PORTABLE_PROJECT_EXTENSION : PROJECT_EXTENSION;
        const suggestedName = `${safeLabel(validated.name, 'Untitled')}${extension}`;
        const selected = await showSaveDialog(projectDialogOptions('save', portable ? suggestedName : current?.path || suggestedName, portable));
        if (selected?.canceled || !selected?.filePath) return { cancelled: true, recentProjects: publicRecent() };
        filePath = ensureProjectExtension(selected.filePath, extension);
      }
      try {
        if (path.extname(filePath).toLowerCase() === PORTABLE_PROJECT_EXTENSION) await savePortableProject(filePath, validated);
        else saveProjectFile(filePath, validated);
        const entry = register(filePath, validated, saveAs ? null : current?.documentId || null);
        return { cancelled: false, documentId: entry.documentId, fileName: entry.fileName, project: validated, recentProjects: publicRecent() };
      } catch (error) {
        rethrowProjectError(error, 'PROJECT_SAVE_FAILED', 'The Live2Pet project could not be saved.');
      }
    },
  });
}

function createProjectSourceService({ inspectSource, sourceRegistry, maxSources = 8 } = {}) {
  if (typeof inspectSource !== 'function') throw new TypeError('Project Source service requires an inspectSource function.');
  if (!(sourceRegistry instanceof Map)) throw new TypeError('Project Source service requires a sourceRegistry Map.');
  if (!Number.isInteger(maxSources) || maxSources < 1 || maxSources > 64) throw new TypeError('Project Source service maxSources must be an integer from 1 to 64.');

  const register = (projectId, inputPath, manifest) => {
    sourceRegistry.delete(projectId);
    sourceRegistry.set(projectId, {
      inputPath,
      sourceFingerprint: manifest.source.fingerprint,
      manifest,
    });
    while (sourceRegistry.size > maxSources) sourceRegistry.delete(sourceRegistry.keys().next().value);
  };

  return Object.freeze({
    relink: async ({ project, inputPath }) => {
      const current = validateProject(project);
      const previousRecord = sourceRegistry.get(current.projectId);
      const previousManifest = previousRecord?.sourceFingerprint === current.source.fingerprint
        ? previousRecord.manifest
        : undefined;
      const inspection = await inspectSource({ inputPath, ...(current.source.modelConfig ? { modelConfig: current.source.modelConfig } : {}) });
      const relinked = relinkProjectSource(current, {
        kind: inspection.source.kind,
        name: inspection.source.name,
        fingerprint: inspection.source.fingerprint,
        path: inputPath,
        modelConfig: inspection.source.modelConfig,
      }, { previousManifest, nextManifest: inspection });
      register(current.projectId, inputPath, inspection);
      return { ...relinked, inspection };
    },
    acknowledgeReview: async ({ project }) => ({ project: acknowledgeSourceReview(project) }),
  });
}

function intersectionArea(a, b) {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return width * height;
}

function normalizeWindowBounds(value, displays, { minWidth = 900, minHeight = 640 } = {}) {
  if (!isRecord(value) || !Array.isArray(displays) || !displays.length) return null;
  const bounds = { x: value.x, y: value.y, width: value.width, height: value.height };
  if (!Object.values(bounds).every(Number.isInteger) || bounds.width < minWidth || bounds.height < minHeight || bounds.width > 4096 || bounds.height > 4096) return null;
  const areas = displays.map((display) => display?.workArea).filter((area) => isRecord(area) && ['x', 'y', 'width', 'height'].every((key) => Number.isInteger(area[key])) && area.width >= minWidth && area.height >= minHeight);
  if (!areas.length) return null;
  const workArea = areas.reduce((best, area) => intersectionArea(bounds, area) > intersectionArea(bounds, best) ? area : best, areas[0]);
  if (intersectionArea(bounds, workArea) < 80 * 80) return null;
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height)),
    width,
    height,
  };
}

function loadWindowBounds(stateFile, displays, options) {
  try {
    const value = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (!isRecord(value) || value.version !== WINDOW_STATE_VERSION) return null;
    return normalizeWindowBounds(value.bounds, displays, options);
  } catch {
    return null;
  }
}

function createWindowStateWriter({ stateFile, getBounds, debounceMs = 250 } = {}) {
  if (typeof stateFile !== 'string' || !path.isAbsolute(stateFile) || typeof getBounds !== 'function') throw new TypeError('Window state persistence requires an absolute stateFile and getBounds function.');
  let timer = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const bounds = getBounds();
    if (bounds) atomicWriteJson(stateFile, { version: WINDOW_STATE_VERSION, bounds });
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };
  return Object.freeze({ schedule, flush });
}

module.exports = {
  MAX_RECENT_PROJECTS,
  PROJECT_EXTENSION,
  PORTABLE_PROJECT_EXTENSION,
  createProjectSourceService,
  createProjectWorkspaceService,
  createWindowStateWriter,
  loadWindowBounds,
  normalizeRecentState,
  normalizeWindowBounds,
};
