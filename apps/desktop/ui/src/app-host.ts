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
  source: { kind: 'standard-directory' | 'destiny-child-pck'; name: string; fingerprint: string; modelConfig: string };
  model: { cubism: number; configFile: string; modelFile: string | null; textures: string[] };
  motions: SourceMotion[];
  expressions: SourceExpression[];
  resources: Array<{ kind: string; path: string; required: boolean; exists: boolean }>;
  warnings: Array<{ code: string; resource?: string; kind?: string }>;
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
  getRuntimeSettings(): Promise<AppResponse<RuntimeSettings>>;
  configureRuntime(input: { inputPath: string }): Promise<AppResponse<RuntimeSettings>>;
  clearRuntimeSettings(): Promise<AppResponse<RuntimeSettings>>;
  getBuildCacheStatus(): Promise<AppResponse<{ schemaVersion: 1; byteLength: number; entryCount: number; maxBytes: number }>>;
  clearBuildCache(input: { confirmClear: true }): Promise<AppResponse<{ removedEntries: number; removedBytes: number; schemaVersion: 1; byteLength: number; entryCount: number; maxBytes: number }>>;
  getFilePath(file: File): string | null;
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

export function getDesktopFilePath(file: File): string | null {
  return desktopApi()?.getFilePath(file) ?? null;
}
