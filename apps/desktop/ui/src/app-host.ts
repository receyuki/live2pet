export type RuntimeDescriptor = {
  runtimeName: string;
  runtimeKind: 'legacy-cubism2' | 'modern-cubism-core';
  cubismGenerations: number[];
  fingerprint: string;
  available: boolean;
};

export type RuntimeSettings = {
  schemaVersion: 2;
  configured: boolean;
  restartRequired: boolean;
  runtimes: RuntimeDescriptor[];
};

export type SourceMotion = {
  id: string;
  group: string;
  index: number;
  name: string;
  sourceFile: string;
  duration: number | null;
};

export type SourceExpression = {
  id: string;
  index: number;
  name: string;
  sourceFile: string;
};

export type SourceInspection = {
  schemaVersion: 1;
  source: { kind: 'standard-directory' | 'pck' | 'destiny-child-pck'; name: string; fingerprint: string; modelConfig: string };
  model: { cubism: number; configFile: string; modelFile: string | null; textures: string[] };
  motions: SourceMotion[];
  expressions: SourceExpression[];
  resources: Array<{ kind: string; path: string; required: boolean; exists: boolean }>;
  warnings: Array<{ code: string; resource?: string; kind?: string }>;
};

export type Live2PetProject = {
  schemaVersion: 1;
  projectId: string;
  appVersion: string;
  name: string;
  source: {
    kind: SourceInspection['source']['kind'];
    name: string;
    fingerprint: string;
    path?: string;
    modelConfig?: string;
  };
  recipes: Array<{ id: string; motionId: string; expressionId: string | null; label?: string }>;
  targets: {
    clawd: ProjectTarget;
    'codex-pet': ProjectTarget;
  };
  rightsNote?: string;
  sourceReview?: { required: boolean; reason?: string; reviewedFingerprint?: string; affectedRecipeIds: string[] };
};

export type ProjectTarget = {
  profile: string;
  mappings: Record<string, string>;
  reactions: Record<string, string>;
  recipeMappings?: Record<string, string>;
  renderPreset?: 'compact' | 'balanced' | 'high';
  options: Record<string, unknown>;
};

export type RecentProject = { documentId: string; name: string; fileName: string; available: boolean };
export type ProjectFileResult =
  | { cancelled: true; recentProjects: RecentProject[] }
  | { cancelled: false; documentId: string; fileName: string; project: Live2PetProject; recentProjects: RecentProject[] };
export type AppCommand = 'open' | 'save' | 'settings' | 'build' | 'setup';

export type PreviewBounds = { x: number; y: number; width: number; height: number };
export type PreviewStatus = {
  schemaVersion: 1;
  state: 'idle' | 'opening' | 'ready' | 'failed';
  projectId: string | null;
  sourceFingerprint: string | null;
  visible: boolean;
  bounds: PreviewBounds | null;
  playback?: { motionId: string | null; expressionId: string | null; playing: boolean; loop: boolean; speed: number };
  error?: { code: string; message: string };
};

type AppResponse<T> = {
  protocolVersion: 1;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
};

type Live2PetApi = {
  getVersion(): Promise<
    AppResponse<{
      appVersion: string;
      protocolVersion: 1;
      methods: string[];
    }>
  >;
  inspectSource(input: { inputPath: string; projectId: string }): Promise<AppResponse<SourceInspection>>;
  getRecentProjects(): Promise<AppResponse<{ recentProjects: RecentProject[] }>>;
  openProject(input?: { documentId?: string }): Promise<AppResponse<ProjectFileResult>>;
  saveProject(input: { documentId?: string; project: Live2PetProject; saveAs?: boolean }): Promise<AppResponse<ProjectFileResult>>;
  onAppCommand?(listener: (command: AppCommand) => void): () => void;
  getRuntimeSettings(): Promise<AppResponse<RuntimeSettings>>;
  configureRuntime(input: { inputPath: string }): Promise<AppResponse<RuntimeSettings>>;
  clearRuntimeSettings(): Promise<AppResponse<RuntimeSettings>>;
  getBuildCacheStatus(): Promise<AppResponse<{ schemaVersion: 1; byteLength: number; entryCount: number; maxBytes: number }>>;
  clearBuildCache(input: { confirmClear: true }): Promise<AppResponse<{ removedEntries: number; removedBytes: number; schemaVersion: 1; byteLength: number; entryCount: number; maxBytes: number }>>;
  getFilePath(file: File): string | null;
  openPreview?(input: { projectId: string; sourceFingerprint: string; bounds: PreviewBounds }): Promise<AppResponse<PreviewStatus>>;
  layoutPreview?(input: { visible: boolean; bounds?: PreviewBounds }): Promise<AppResponse<PreviewStatus>>;
  playPreview?(input: { motionId: string; loop?: boolean; speed?: number }): Promise<AppResponse<PreviewStatus>>;
  setPreviewExpression?(input: { expressionId: string | null }): Promise<AppResponse<PreviewStatus>>;
  controlPreview?(input: { action: 'pause' | 'resume' | 'restart' }): Promise<AppResponse<PreviewStatus>>;
  closePreview?(): Promise<AppResponse<PreviewStatus>>;
  onPreviewStatus?(listener: (status: PreviewStatus) => void): () => void;
};

declare global {
  interface Window {
    live2pet?: Live2PetApi;
  }
}

export class DesktopApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DesktopApiError';
    this.code = code;
  }
}

function desktopApi(): Live2PetApi | null {
  return window.live2pet ?? null;
}

async function unwrap<T>(request: Promise<AppResponse<T>>): Promise<T> {
  const response = await request;
  if (!response.ok || response.result === undefined) {
    throw new DesktopApiError(response.error?.code ?? 'APP_REQUEST_FAILED', response.error?.message ?? 'The Desktop App request failed.');
  }
  return response.result;
}

export function hasDesktopApi(): boolean {
  return desktopApi() !== null;
}

export async function getRuntimeSettings(): Promise<RuntimeSettings> {
  const api = desktopApi();
  if (!api) return { schemaVersion: 2, configured: false, restartRequired: false, runtimes: [] };
  return unwrap(api.getRuntimeSettings());
}

export async function configureRuntime(file: File): Promise<RuntimeSettings> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Runtime files can only be saved from the Desktop App.');
  const inputPath = api.getFilePath(file);
  if (!inputPath) throw new DesktopApiError('RUNTIME_PATH_UNAVAILABLE', 'The selected runtime path is unavailable.');
  return unwrap(api.configureRuntime({ inputPath }));
}

export async function configureRuntimePath(inputPath: string): Promise<RuntimeSettings> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Runtime folders can only be saved from the Desktop App.');
  return unwrap(api.configureRuntime({ inputPath }));
}

export async function clearRuntimeSettings(): Promise<RuntimeSettings> {
  const api = desktopApi();
  if (!api) return { schemaVersion: 2, configured: false, restartRequired: false, runtimes: [] };
  return unwrap(api.clearRuntimeSettings());
}

export async function getCacheStatus() {
  const api = desktopApi();
  if (!api) return { byteLength: 0, entryCount: 0, maxBytes: 1024 * 1024 * 1024 };
  return unwrap(api.getBuildCacheStatus());
}

export async function clearCache() {
  const api = desktopApi();
  if (!api) return { removedEntries: 0, removedBytes: 0 };
  return unwrap(api.clearBuildCache({ confirmClear: true }));
}

export async function getAppVersion() {
  const api = desktopApi();
  if (!api) return '0.1.0';
  const result = await unwrap(api.getVersion());
  return result.appVersion;
}

export async function inspectSource(inputPath: string, projectId: string): Promise<SourceInspection> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Source Packages can only be inspected from the Desktop App.');
  return unwrap(api.inspectSource({ inputPath, projectId }));
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  const api = desktopApi();
  if (!api) return [];
  return (await unwrap(api.getRecentProjects())).recentProjects;
}

export async function openProject(documentId?: string): Promise<ProjectFileResult> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Projects can only be opened from the Desktop App.');
  return unwrap(api.openProject(documentId ? { documentId } : {}));
}

export async function saveProject(input: { documentId?: string; project: Live2PetProject; saveAs?: boolean }): Promise<ProjectFileResult> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Projects can only be saved from the Desktop App.');
  return unwrap(api.saveProject(input));
}

export function onAppCommand(listener: (command: AppCommand) => void): () => void {
  return desktopApi()?.onAppCommand?.(listener) ?? (() => undefined);
}

export function getDesktopFilePath(file: File): string | null {
  return desktopApi()?.getFilePath(file) ?? null;
}

function previewApi() {
  const api = desktopApi();
  if (!api?.openPreview || !api.layoutPreview || !api.playPreview || !api.setPreviewExpression || !api.controlPreview || !api.closePreview) {
    throw new DesktopApiError('PREVIEW_UNAVAILABLE', 'Live2D preview requires the Desktop App preview service.');
  }
  return api;
}

export function hasPreviewApi(): boolean {
  const api = desktopApi();
  return Boolean(api?.openPreview && api.layoutPreview && api.playPreview && api.setPreviewExpression && api.controlPreview && api.closePreview);
}

export function openLive2DPreview(input: { projectId: string; sourceFingerprint: string; bounds: PreviewBounds }) {
  const api = previewApi();
  return unwrap(api.openPreview!(input));
}

export function layoutLive2DPreview(input: { visible: boolean; bounds?: PreviewBounds }) {
  const api = previewApi();
  return unwrap(api.layoutPreview!(input));
}

export function playLive2DPreview(input: { motionId: string; loop?: boolean; speed?: number }) {
  const api = previewApi();
  return unwrap(api.playPreview!(input));
}

export function setLive2DPreviewExpression(expressionId: string | null) {
  const api = previewApi();
  return unwrap(api.setPreviewExpression!({ expressionId }));
}

export function controlLive2DPreview(action: 'pause' | 'resume' | 'restart') {
  const api = previewApi();
  return unwrap(api.controlPreview!({ action }));
}

export function closeLive2DPreview() {
  const api = previewApi();
  return unwrap(api.closePreview!());
}

export function onLive2DPreviewStatus(listener: (status: PreviewStatus) => void): () => void {
  return desktopApi()?.onPreviewStatus?.(listener) ?? (() => undefined);
}
