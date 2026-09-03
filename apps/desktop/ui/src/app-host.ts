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
  schemaVersion: 1 | 2;
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
  visualSettings?: VisualSettings;
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
export type SourceRelinkResult = {
  project: Live2PetProject;
  inspection: SourceInspection;
  status: 'relinked' | 'source-changed';
  reviewRequired: boolean;
  affectedRecipeIds: string[];
};
export type AppCommand = 'open' | 'save' | 'settings' | 'build' | 'setup' | 'undo' | 'redo';
export type BuildTarget = 'clawd' | 'codex-pet';
export type RenderPreset = 'compact' | 'balanced' | 'high';

export type BuildProgressEvent = {
  protocolVersion: 1;
  buildId: string;
  sequence: number;
  target: BuildTarget;
  stage: string;
  status: string;
  fraction?: number;
  percent?: number;
  message?: string;
  previewReady?: boolean;
};

export type BuildArtifact = { artifactId: string; target: BuildTarget; filename: string; byteLength: number };
export type BuildSummary = {
  target: BuildTarget;
  validation?: { ok?: boolean; errors?: unknown[]; warnings?: unknown[] } | null;
  preview?: { ready?: boolean } | null;
  package?: { format?: string; byteLength?: number; files?: string[]; artifactName?: string } | null;
};
export type BuildProjectResult = {
  projectId: string;
  targets: BuildTarget[];
  builds: Partial<Record<BuildTarget, BuildSummary>>;
  warnings: unknown[];
  artifacts: BuildArtifact[];
};
export type BuildArtifactChunk = BuildArtifact & { offset: number; nextOffset: number; done: boolean; bytes: Uint8Array };
export type InstallRootResult = { target: BuildTarget; cancelled: true } | { target: BuildTarget; cancelled: false; locationId: string; label: string; displayPath?: string };
export type InstallationAction = 'choose-root' | 'reset-root' | 'choose-app' | 'reset-app';
export type TargetInstallation = {
  target: BuildTarget;
  locationId: string;
  application: { status: 'found' | 'not-found' | 'unavailable' | 'unsupported'; source: 'auto' | 'manual'; path?: string; version?: string };
  root: { path: string; source: 'manual' | 'default' | 'environment'; state: 'ready' | 'will-create' | 'not-directory' | 'unavailable' };
};
export type TargetInstallations = { platform: string; targets: TargetInstallation[] };
export type InstallResult = { protocolVersion?: number; target: BuildTarget; packageId?: string; conflict?: string; files: string[]; byteLength?: number; path: '<selected-install-root>' | '<platform-default-target-root>' };

export type PreviewBounds = { x: number; y: number; width: number; height: number };
export type VisualSettings = { hiddenElementIds: string[] };
export type VisualElement = { id: string; name: string; kind: 'part' | 'slot'; parentId?: string };
export type VisualElementThumbnail = { id: string; dataUrl: string | null };
export type PreviewStatus = {
  schemaVersion: 1;
  state: 'idle' | 'opening' | 'ready' | 'failed';
  projectId: string | null;
  sourceFingerprint: string | null;
  visible: boolean;
  bounds: PreviewBounds | null;
  playback?: { motionId: string | null; expressionId: string | null; playing: boolean; loop: boolean; speed: number; time?: number };
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
  relinkSource(input: { project: Live2PetProject; inputPath: string }): Promise<AppResponse<SourceRelinkResult>>;
  acknowledgeSourceReview(input: { project: Live2PetProject }): Promise<AppResponse<{ project: Live2PetProject }>>;
  getRecentProjects(): Promise<AppResponse<{ recentProjects: RecentProject[] }>>;
  openProject(input?: { documentId?: string; inputPath?: string }): Promise<AppResponse<ProjectFileResult>>;
  saveProject(input: { documentId?: string; project: Live2PetProject; saveAs?: boolean }): Promise<AppResponse<ProjectFileResult>>;
  onAppCommand?(listener: (command: AppCommand) => void): () => void;
  getRuntimeSettings(): Promise<AppResponse<RuntimeSettings>>;
  configureRuntime(input: { inputPath: string }): Promise<AppResponse<RuntimeSettings>>;
  clearRuntimeSettings(input?: { fingerprint: string }): Promise<AppResponse<RuntimeSettings>>;
  getBuildCacheStatus(): Promise<AppResponse<{ schemaVersion: 1; byteLength: number; entryCount: number; maxBytes: number }>>;
  clearBuildCache(input: { confirmClear: true }): Promise<AppResponse<{ removedEntries: number; removedBytes: number; schemaVersion: 1; byteLength: number; entryCount: number; maxBytes: number }>>;
  buildProject?(input: { project: Live2PetProject; targets: BuildTarget[]; optionsByTarget: Partial<Record<BuildTarget, { package: true; spriteVersionNumber?: 2 }>> }): Promise<AppResponse<BuildProjectResult>>;
  cancelBuild?(buildId: string): Promise<AppResponse<{ buildId: string; cancelled: boolean; active: boolean }>>;
  onBuildProgress?(listener: (event: BuildProgressEvent) => void): () => void;
  getBuildArtifact?(artifactId: string, offset?: number): Promise<AppResponse<BuildArtifactChunk>>;
  chooseInstallRoot?(target: BuildTarget): Promise<AppResponse<InstallRootResult>>;
  getTargetInstallations?(): Promise<AppResponse<TargetInstallations>>;
  configureTargetInstallation?(input: { target: BuildTarget; action: InstallationAction }): Promise<AppResponse<{ cancelled: boolean }>>;
  installArtifact?(input: { artifactId: string; target: BuildTarget; conflict?: 'cancel' | 'upgrade' | 'side-by-side'; confirmInstall: true; locationId?: string }): Promise<AppResponse<InstallResult>>;
  getFilePath(file: File): string | null;
  openPreview?(input: { projectId: string; sourceFingerprint: string; bounds: PreviewBounds; visualSettings?: VisualSettings }): Promise<AppResponse<PreviewStatus>>;
  getPreviewVisualElements?(): Promise<AppResponse<VisualElement[]>>;
  getPreviewVisualElementThumbnail?(input: { id: string }): Promise<AppResponse<VisualElementThumbnail>>;
  setPreviewVisualSettings?(input: VisualSettings): Promise<AppResponse<PreviewStatus>>;
  layoutPreview?(input: { visible: boolean; bounds?: PreviewBounds }): Promise<AppResponse<PreviewStatus>>;
  playPreview?(input: { motionId: string; loop?: boolean; speed?: number }): Promise<AppResponse<PreviewStatus>>;
  setPreviewExpression?(input: { expressionId: string | null }): Promise<AppResponse<PreviewStatus>>;
  controlPreview?(input: { action: 'pause' | 'resume' | 'restart' | 'seek'; time?: number }): Promise<AppResponse<PreviewStatus>>;
  getPreviewStatus?(): Promise<AppResponse<PreviewStatus>>;
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

export async function clearRuntimeSettings(fingerprint?: string): Promise<RuntimeSettings> {
  const api = desktopApi();
  if (!api) return { schemaVersion: 2, configured: false, restartRequired: false, runtimes: [] };
  return unwrap(api.clearRuntimeSettings(fingerprint ? { fingerprint } : undefined));
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

export async function relinkSource(project: Live2PetProject, file: File): Promise<SourceRelinkResult> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Source Packages can only be relinked from the Desktop App.');
  const inputPath = api.getFilePath(file);
  if (!inputPath) throw new DesktopApiError('SOURCE_PATH_UNAVAILABLE', 'The selected Source Package path is unavailable.');
  return unwrap(api.relinkSource({ project, inputPath }));
}

export async function relinkSourcePath(project: Live2PetProject, inputPath: string): Promise<SourceRelinkResult> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Source Packages can only be relinked from the Desktop App.');
  return unwrap(api.relinkSource({ project, inputPath }));
}

export async function acknowledgeSourceReview(project: Live2PetProject): Promise<Live2PetProject> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Source review can only be acknowledged from the Desktop App.');
  return (await unwrap(api.acknowledgeSourceReview({ project }))).project;
}

export async function getRecentProjects(): Promise<RecentProject[]> {
  const api = desktopApi();
  if (!api) return [];
  return (await unwrap(api.getRecentProjects())).recentProjects;
}

export async function openProject(documentId?: string, inputPath?: string): Promise<ProjectFileResult> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Projects can only be opened from the Desktop App.');
  return unwrap(api.openProject(inputPath ? { inputPath } : documentId ? { documentId } : {}));
}

export async function saveProject(input: { documentId?: string; project: Live2PetProject; saveAs?: boolean }): Promise<ProjectFileResult> {
  const api = desktopApi();
  if (!api) throw new DesktopApiError('DESKTOP_REQUIRED', 'Projects can only be saved from the Desktop App.');
  return unwrap(api.saveProject(input));
}

export function onAppCommand(listener: (command: AppCommand) => void): () => void {
  return desktopApi()?.onAppCommand?.(listener) ?? (() => undefined);
}

export function hasBuildApi(): boolean {
  const api = desktopApi();
  return Boolean(api?.buildProject && api.cancelBuild && api.getBuildArtifact && api.chooseInstallRoot && api.installArtifact);
}

function buildApi(): Live2PetApi {
  const api = desktopApi();
  if (!api?.buildProject || !api.cancelBuild || !api.getBuildArtifact || !api.chooseInstallRoot || !api.installArtifact) {
    throw new DesktopApiError('APP_BUILD_UNAVAILABLE', 'Package Build requires the Desktop App build service.');
  }
  return api;
}

export function buildProject(project: Live2PetProject, target: BuildTarget): Promise<BuildProjectResult> {
  return unwrap(buildApi().buildProject!({ project, targets: [target], optionsByTarget: { [target]: { package: true, ...(target === 'codex-pet' ? { spriteVersionNumber: 2 as const } : {}) } } }));
}

export function cancelBuild(buildId: string) {
  return unwrap(buildApi().cancelBuild!(buildId));
}

export function onBuildProgress(listener: (event: BuildProgressEvent) => void): () => void {
  return desktopApi()?.onBuildProgress?.(listener) ?? (() => undefined);
}

export function getBuildArtifact(artifactId: string, offset = 0): Promise<BuildArtifactChunk> {
  return unwrap(buildApi().getBuildArtifact!(artifactId, offset));
}

export function chooseInstallRoot(target: BuildTarget): Promise<InstallRootResult> {
  return unwrap(buildApi().chooseInstallRoot!(target));
}

export function hasTargetInstallationApi(): boolean {
  return Boolean(desktopApi()?.getTargetInstallations && desktopApi()?.configureTargetInstallation);
}

export function getTargetInstallations(): Promise<TargetInstallations> {
  const api = desktopApi();
  if (!api?.getTargetInstallations) return Promise.reject(new DesktopApiError('APP_INSTALL_SETTINGS_UNAVAILABLE', 'Target detection requires the Desktop App.'));
  return unwrap(api.getTargetInstallations());
}

export function configureTargetInstallation(target: BuildTarget, action: InstallationAction): Promise<{ cancelled: boolean }> {
  const api = desktopApi();
  if (!api?.configureTargetInstallation) return Promise.reject(new DesktopApiError('APP_INSTALL_SETTINGS_UNAVAILABLE', 'Target configuration requires the Desktop App.'));
  return unwrap(api.configureTargetInstallation({ target, action }));
}

export function installArtifact(input: { artifactId: string; target: BuildTarget; conflict?: 'cancel' | 'upgrade' | 'side-by-side'; confirmInstall: true; locationId?: string }): Promise<InstallResult> {
  return unwrap(buildApi().installArtifact!(input));
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

export function openLive2DPreview(input: { projectId: string; sourceFingerprint: string; bounds: PreviewBounds; visualSettings?: VisualSettings }) {
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

export async function getPreviewVisualElements(): Promise<VisualElement[]> {
  const api = previewApi();
  return api.getPreviewVisualElements ? unwrap(api.getPreviewVisualElements()) : [];
}

export function getPreviewVisualElementThumbnail(id: string): Promise<VisualElementThumbnail> {
  const api = previewApi();
  if (!api.getPreviewVisualElementThumbnail) throw new DesktopApiError('PREVIEW_UNAVAILABLE', 'Visual Element thumbnails require the current Desktop App.');
  return unwrap(api.getPreviewVisualElementThumbnail({ id }));
}

export function setPreviewVisualSettings(settings: VisualSettings) {
  const api = previewApi();
  if (!api.setPreviewVisualSettings) throw new DesktopApiError('PREVIEW_UNAVAILABLE', 'Visual Settings require the current Desktop App.');
  return unwrap(api.setPreviewVisualSettings(settings));
}

export function controlLive2DPreview(action: 'pause' | 'resume' | 'restart' | 'seek', time?: number) {
  const api = previewApi();
  return unwrap(api.controlPreview!({ action, ...(time === undefined ? {} : { time }) }));
}

export async function readLive2DPreviewStatus() {
  const api = previewApi();
  return api.getPreviewStatus ? unwrap(api.getPreviewStatus()) : null;
}

export function closeLive2DPreview() {
  const api = previewApi();
  return unwrap(api.closePreview!());
}

export function onLive2DPreviewStatus(listener: (status: PreviewStatus) => void): () => void {
  return desktopApi()?.onPreviewStatus?.(listener) ?? (() => undefined);
}
