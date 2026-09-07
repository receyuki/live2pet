import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { Live2PetProject, SourceInspection, VisualElement } from './app-host';
import { CLAWD_PROFILE, CODEX_PROFILE } from './target-profiles';
import { PROJECT_DRAFT_KEY, writeProjectDraft } from './project-draft';

const emptyRuntimes = { schemaVersion: 2 as const, configured: false, restartRequired: false, runtimes: [] };

const savedProject = {
  schemaVersion: 1 as const,
  projectId: 'saved-project',
  appVersion: '0.1.0',
  name: 'Saved Project',
  source: { kind: 'pck' as const, name: 'Saved Source', fingerprint: 'saved-fingerprint', path: '/Users/test/Saved Source.pck', modelConfig: 'model.json' },
  recipes: [],
  targets: {
    clawd: { profile: 'clawd', mappings: {}, reactions: {}, options: {} },
    'codex-pet': { profile: 'codex-pet', mappings: {}, reactions: {}, options: {} },
  },
};

function installDesktopApi({ runtimes = emptyRuntimes, preview = true, previewVisualElements = [], previewThumbnail, buildHost = false, recentProjects = [], openCancelled = false, saveCancelled = false, openedProject = savedProject }: { runtimes?: typeof emptyRuntimes | { schemaVersion: 2; configured: boolean; restartRequired: false; runtimes: Array<{ runtimeName: string; runtimeKind: 'legacy-cubism2'; cubismGenerations: number[]; fingerprint: string; available: boolean }> }; preview?: boolean; previewVisualElements?: VisualElement[]; previewThumbnail?: (input: { id: string }) => Promise<{ id: string; dataUrl: string | null }> | { id: string; dataUrl: string | null }; buildHost?: boolean; recentProjects?: Array<{ documentId: string; name: string; fileName: string; available: boolean }>; openCancelled?: boolean; saveCancelled?: boolean; openedProject?: Live2PetProject } = {}) {
  const inspectSource = vi.fn(async (): Promise<{ protocolVersion: 1; ok: true; result: SourceInspection }> => ({
    protocolVersion: 1 as const,
    ok: true,
    result: {
      schemaVersion: 1 as const,
      source: { kind: 'pck' as const, name: 'Vicious Khepri', fingerprint: 'fixture', modelConfig: 'model.json' },
      model: { cubism: 2, configFile: 'model.json', modelFile: 'model.moc', textures: ['texture.png'] },
      motions: [{ id: 'idle:0', group: 'idle', index: 0, name: 'Breathing', sourceFile: 'idle.mtn', duration: 2.5 }],
      expressions: [{ id: '0', index: 0, name: 'Smile', sourceFile: 'smile.exp.json' }],
      resources: [],
      warnings: [],
    },
  }));
  const configureRuntime = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: runtimes }));
  const spinePack = { schemaVersion: 2 as const, packs: [{ schemaVersion: 2 as const, id: 'spine-player-4.3', runtimeLine: '4.3', version: '4.3.13', downloadable: true, installed: false }] };
  const getSpinePackStatus = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: spinePack }));
  const installSpinePack = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: { ...spinePack, packs: spinePack.packs.map((pack) => ({ ...pack, installed: true })) } }));
  const removeSpinePack = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: spinePack }));
  const sourceLibrary = { schemaVersion: 1 as const, libraryId: 'library-1', name: 'Models', kind: 'local' as const, maxDepth: 2, candidates: [{ id: 'source-1', name: 'Spine Hero', relativePath: 'heroes/hero.json', format: 'spine' as const, version: null, runtimeLine: null, binary: false }] };
  const openSourceLibrary = vi.fn(async (_inputPath?: string) => ({ protocolVersion: 1 as const, ok: true, result: { cancelled: false as const, library: sourceLibrary } }));
  const inspectLibrarySource = vi.fn(async ({ sourceId }: { sourceId: string }) => ({ protocolVersion: 1 as const, ok: true, result: { sourcePath: '/Users/test/Models/hero', candidate: sourceLibrary.candidates.find((candidate) => candidate.id === sourceId)!, inspection: (await inspectSource()).result } }));
  const getSourceLibraryCacheStatus = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: { schemaVersion: 1 as const, maxBytes: 1024 ** 3, byteLength: 64 * 1024 ** 2, entryCount: 2 } }));
  const configureSourceLibraryCache = vi.fn(async (maxBytes: number) => ({ protocolVersion: 1 as const, ok: true, result: { schemaVersion: 1 as const, maxBytes, byteLength: 64 * 1024 ** 2, entryCount: 2 } }));
  const clearSourceLibraryCache = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: { schemaVersion: 1 as const, maxBytes: 1024 ** 3, byteLength: 0, entryCount: 0, removedEntries: 2, removedBytes: 64 * 1024 ** 2 } }));
  const relinkSource = vi.fn(async ({ project }: { project: Live2PetProject; inputPath: string }) => ({
    protocolVersion: 1 as const,
    ok: true,
    result: {
      project,
      inspection: {
        schemaVersion: 1 as const,
        source: { kind: project.source.kind, name: project.source.name, fingerprint: project.source.fingerprint, modelConfig: project.source.modelConfig ?? 'model.json' },
        model: { cubism: 2, configFile: project.source.modelConfig ?? 'model.json', modelFile: 'model.moc', textures: ['texture.png'] },
        motions: [{ id: 'idle:0', group: 'idle', index: 0, name: 'Breathing', sourceFile: 'idle.mtn', duration: 2.5 }],
        expressions: [{ id: '0', index: 0, name: 'Smile', sourceFile: 'smile.exp.json' }], resources: [], warnings: [],
      },
      status: 'relinked' as const,
      reviewRequired: false,
      affectedRecipeIds: [],
    },
  }));
  const acknowledgeSourceReview = vi.fn(async ({ project }: { project: Live2PetProject }) => ({ protocolVersion: 1 as const, ok: true, result: { project: { ...project, sourceReview: { ...project.sourceReview!, required: false, reviewedFingerprint: project.source.fingerprint } } } }));
  const openPreview = vi.fn(async (input: { projectId: string; sourceFingerprint: string; bounds: { x: number; y: number; width: number; height: number } }) => ({ protocolVersion: 1 as const, ok: true, result: { schemaVersion: 1 as const, state: 'ready' as const, projectId: input.projectId, sourceFingerprint: input.sourceFingerprint, visible: true, bounds: input.bounds, playback: { motionId: null, expressionId: null, playing: false, loop: true, speed: 1 } } }));
  const getPreviewVisualElements = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: previewVisualElements }));
  const getPreviewVisualElementThumbnail = vi.fn(async (input: { id: string }) => ({ protocolVersion: 1 as const, ok: true, result: await (previewThumbnail?.(input) ?? { id: input.id, dataUrl: `data:image/png;base64,${input.id}` }) }));
  const openProject = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: openCancelled ? { cancelled: true as const, recentProjects } : { cancelled: false as const, documentId: 'opaque-document', fileName: 'saved.live2pet', project: openedProject, recentProjects } }));
  const saveProject = vi.fn(async (input: { project: Live2PetProject }) => ({ protocolVersion: 1 as const, ok: true, result: saveCancelled ? { cancelled: true as const, recentProjects } : { cancelled: false as const, documentId: 'opaque-saved-document', fileName: `${input.project.name}.live2pet`, project: input.project, recentProjects } }));
  const clearRecentProjects = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: { recentProjects: [] } }));
  let appCommandListener: ((command: 'new' | 'open' | 'save' | 'settings' | 'build' | 'setup' | 'undo' | 'redo') => void) | undefined;
  let buildProgressListener: ((event: { protocolVersion: 1; buildId: string; sequence: number; target: 'clawd'; stage: string; status: string; fraction: number }) => void) | undefined;
  const buildProject = vi.fn(async () => {
    buildProgressListener?.({ protocolVersion: 1, buildId: 'build_12345678', sequence: 1, target: 'clawd', stage: 'package', status: 'completed', fraction: 1 });
    return { protocolVersion: 1 as const, ok: true, result: { projectId: openedProject.projectId, targets: ['clawd' as const], builds: { clawd: { target: 'clawd' as const, validation: { ok: true }, preview: { ready: true } } }, warnings: [], artifacts: [{ artifactId: 'artifact-1', target: 'clawd' as const, filename: 'saved-clawd.zip', byteLength: 3 }] } };
  });
  Object.defineProperty(window, 'live2pet', {
    configurable: true,
    value: {
      getVersion: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { appVersion: '0.1.0', protocolVersion: 1, methods: [] } })),
      inspectSource,
      relinkSource,
      acknowledgeSourceReview,
      getRecentProjects: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { recentProjects } })),
      clearRecentProjects,
      openProject,
      saveProject,
      onAppCommand: vi.fn((listener) => { appCommandListener = listener; return () => { appCommandListener = undefined; }; }),
      getRuntimeSettings: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: runtimes })),
      configureRuntime,
      clearRuntimeSettings: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: emptyRuntimes })),
      getSpinePackStatus,
      installSpinePack,
      removeSpinePack,
      openSourceLibrary,
      openGitHubLibrary: vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: { cancelled: false as const, library: { ...sourceLibrary, kind: 'github' as const } } })),
      inspectLibrarySource,
      getSourceLibraryCacheStatus,
      configureSourceLibraryCache,
      clearSourceLibraryCache,
      getBuildCacheStatus: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { byteLength: 0, entryCount: 0, maxBytes: 1024 } })),
      clearBuildCache: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { removedEntries: 0, removedBytes: 0 } })),
      getFilePath: vi.fn((file: File) => `/Users/test/${file.webkitRelativePath || file.name}`),
      ...(buildHost ? {
        buildProject,
        cancelBuild: vi.fn(async (buildId: string) => ({ protocolVersion: 1, ok: true, result: { buildId, cancelled: true, active: true } })),
        onBuildProgress: vi.fn((listener) => { buildProgressListener = listener; return () => { buildProgressListener = undefined; }; }),
        getBuildArtifact: vi.fn(),
        chooseInstallRoot: vi.fn(),
        installArtifact: vi.fn(),
      } : {}),
      ...(preview ? {
        openPreview,
        layoutPreview: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { schemaVersion: 1, state: 'ready', projectId: 'vicious-khepri', sourceFingerprint: 'fixture', visible: false, bounds: null } })),
        playPreview: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { schemaVersion: 1, state: 'ready' } })),
        setPreviewExpression: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { schemaVersion: 1, state: 'ready' } })),
        controlPreview: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { schemaVersion: 1, state: 'ready' } })),
        closePreview: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { schemaVersion: 1, state: 'idle' } })),
        onPreviewStatus: vi.fn(() => () => undefined),
        getPreviewVisualElements,
        getPreviewVisualElementThumbnail,
      } : {}),
    },
  });
  return { configureRuntime, getSpinePackStatus, installSpinePack, removeSpinePack, openSourceLibrary, inspectLibrarySource, getSourceLibraryCacheStatus, configureSourceLibraryCache, clearSourceLibraryCache, inspectSource, relinkSource, acknowledgeSourceReview, openPreview, getPreviewVisualElements, getPreviewVisualElementThumbnail, openProject, saveProject, clearRecentProjects, buildProject, emitAppCommand: (command: 'new' | 'open' | 'save' | 'settings' | 'build' | 'setup' | 'undo' | 'redo') => appCommandListener?.(command) };
}

function setSystemDarkMode(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })),
  });
}

it.each(['direct', 'full'])('labels mapping requirements for %s sleep mode', async (sleepMode) => {
  localStorage.setItem('live2pet.desktop.setup-completed', 'true');
  installDesktopApi({ openedProject: { ...savedProject, targets: { ...savedProject.targets, clawd: { ...savedProject.targets.clawd, options: { sleepMode } } } } });
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Open project' }));
  await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
  const group = (id: string) => within(document.querySelector(`#mapping-group-${id}`)!.closest('section')!);
  expect(group('core').getByText('Required', { exact: true })).toBeVisible();
  expect(group('optional').getByText('Optional', { exact: true })).toBeVisible();
  expect(group('full-sleep').getByText(sleepMode === 'full' ? 'Required' : 'Optional', { exact: true })).toBeVisible();
  expect(group('reactions').getByText('Optional', { exact: true })).toBeVisible();
  await user.click(screen.getByRole('button', { name: /^Codex Pet$/ }));
  expect(group('rows').getByText('Required', { exact: true })).toBeVisible();
});

it('keeps build progress in the footer while Settings is open', async () => {
  localStorage.setItem('live2pet.desktop.setup-completed', 'true');
  const api = installDesktopApi({ buildHost: true, runtimes: { schemaVersion: 2, configured: true, restartRequired: false, runtimes: [{ runtimeKind: 'legacy-cubism2', runtimeName: 'core', cubismGenerations: [2], fingerprint: 'a', available: true }] }, openedProject: { ...savedProject, targets: { ...savedProject.targets, clawd: { ...savedProject.targets.clawd, mappings: Object.fromEntries(CLAWD_PROFILE.states.core.map(slot => [slot, 'motion:idle:0'])) } } } });
  const finish = api.buildProject.getMockImplementation()!;
  let resolveBuild!: (value: Awaited<ReturnType<typeof finish>>) => void;
  api.buildProject.mockImplementation(() => new Promise(resolve => { resolveBuild = resolve; }));
  const user = userEvent.setup();
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Open project' }));
  await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Build' }));
  await user.click(screen.getAllByRole('button', { name: 'Build Pet Package' })[0]);
  const footer = () => within(screen.getByRole('contentinfo'));
  expect(footer().getByRole('progressbar', { name: 'Clawd build progress' })).toHaveAttribute('aria-valuenow', '0');
  expect(footer().getByRole('progressbar').querySelector('[data-slot="progress-bar-fill"]')).not.toBeNull();
  await user.click(screen.getByRole('button', { name: /^Settings$/ }));
  expect(footer().getByRole('progressbar', { name: 'Clawd build progress' })).toBeVisible();
  resolveBuild(await finish());
  await vi.waitFor(() => expect(footer().getByText(/Succeeded/)).toBeVisible());
  await user.click(footer().getByRole('button', { name: /Clawd/ }));
  expect(await screen.findByRole('heading', { name: 'Package Build' })).toBeVisible();
});

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('live2pet.desktop.locale', 'en');
  setSystemDarkMode(false);
  installDesktopApi();
});

afterEach(() => cleanup());

describe('Live2Pet desktop shell', () => {
  it('browses a local model library before inspecting the selected model', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const api = installDesktopApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Browse model folder' }));
    expect(await screen.findByRole('heading', { name: 'Models', level: 2 })).toBeVisible();
    expect(screen.getByText('heroes/hero.json')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /Spine Hero/ }));
    await vi.waitFor(() => expect(api.inspectLibrarySource).toHaveBeenCalledWith({ libraryId: 'library-1', sourceId: 'source-1', projectId: 'library-preview' }));
    expect(api.saveProject).not.toHaveBeenCalled();
    expect(screen.queryByRole('navigation', { name: 'Project' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Done' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(await screen.findByRole('button', { name: 'Use and start mapping' }));
    expect(api.inspectLibrarySource).toHaveBeenCalledWith({ libraryId: 'library-1', sourceId: 'source-1', projectId: 'spine-hero' });
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Use and start mapping' })).not.toBeInTheDocument());
    expect(screen.getByRole('main', { name: 'Map' })).toBeVisible();
    expect(document.querySelector('.model-current-details')).toBeNull();
    api.emitAppCommand('save');
    await vi.waitFor(() => expect(api.saveProject).toHaveBeenCalled());
    expect(api.saveProject.mock.calls[0][0].project.source.path).toBe('/Users/test/Models/hero');
  });

  it('lets the user change and clear the bounded GitHub model cache', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const api = installDesktopApi();
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: /Storage/ }));
    expect(await screen.findByText('2 downloaded models · 64 MiB')).toBeVisible();
    const limit = screen.getByRole('spinbutton', { name: 'GitHub model cache limit' });
    await user.clear(limit);
    await user.type(limit, '2');
    await user.click(screen.getByRole('button', { name: 'Save limit' }));
    expect(api.configureSourceLibraryCache).toHaveBeenCalledWith(2 * 1024 ** 3);
  });

  it('keeps setup, Welcome, and design preview free of decorative mascots', async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    expect(container.querySelector('.setup-art, .brand-mark')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add runtime' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Set up later' }));
    expect(container.querySelector('.welcome-visual, .brand-mark')).toBeNull();
    expect(screen.getByRole('button', { name: 'Open project' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Recent projects' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Open design preview' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    expect(container.querySelector('.character, .brand-mark')).toBeNull();
    expect(screen.getByText('No model preview')).toBeVisible();
    expect(screen.getByText(/The design preview does not contain a model/)).toBeVisible();
    expect(container.querySelector('.toolbar-brand strong')).toHaveTextContent('Saint Louis');
  });

  it('places Settings Done in the shared top toolbar rather than the sidebar', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const toolbar = container.querySelector('.app-toolbar') as HTMLElement;
    expect(within(toolbar).getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(within(toolbar).getByRole('button', { name: 'Done' })).toBeVisible();
    expect(container.querySelector('.settings-sidebar .settings-title')).toBeNull();
    expect(within(container.querySelector('.settings-sidebar') as HTMLElement).queryByRole('button', { name: 'Done' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Open project' })).toBeVisible();
  });
  it.each(['en', 'zh-CN'] as const)('opens localized runtime help from setup and Settings (%s)', async (locale) => {
    localStorage.setItem('live2pet.desktop.locale', locale);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const user = userEvent.setup();
    const view = render(<App />);
    const help = locale === 'en' ? 'Why a separate runtime? Download guide ↗' : '为什么要单独下载运行时？下载指南 ↗';
    const url = `https://github.com/receyuki/live2pet/blob/main/${locale === 'en' ? 'README.md' : 'README.zh-CN.md'}#runtime-setup`;
    await user.click(screen.getByRole('button', { name: help }));
    expect(open).toHaveBeenLastCalledWith(url, '_blank', 'noopener,noreferrer');
    view.unmount();
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    render(<App />);
    await user.click(screen.getByRole('button', { name: locale === 'en' ? 'Settings' : '设置' }));
    await user.click(screen.getByRole('button', { name: locale === 'en' ? 'Runtimes' : '运行时' }));
    await user.click(screen.getByRole('button', { name: help }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(open).toHaveBeenLastCalledWith(url, '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
  it('does not replace empty real motion and expression inventories with design fixtures', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const api = installDesktopApi();
    const response = await api.relinkSource({ project: savedProject, inputPath: savedProject.source.path });
    api.relinkSource.mockResolvedValue({ ...response, result: { ...response.result, inspection: { ...response.result.inspection, motions: [], expressions: [] } } });
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Open project' }));
    await screen.findByRole('main', { name: 'Map' });
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    expect(document.querySelectorAll('.motion-item')).toHaveLength(0);
    expect(document.querySelectorAll('.expression-grid button')).toHaveLength(0);
    expect(screen.getByText(/This model has no Expressions/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Smile' })).not.toBeInTheDocument();
  });
  it('creates an unsaved schema-2 project on import and saves it through the opaque document API', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { saveProject } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    expect(await screen.findByText('Unsaved changes')).toBeVisible();
    expect(screen.queryByText('Local project')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
    expect(saveProject.mock.calls[0][0]).toMatchObject({ project: { schemaVersion: 2, visualSettings: { hiddenElementIds: [] }, projectId: 'vicious-khepri', source: { path: '/Users/test/Vicious Khepri.pck' }, recipes: [] } });
    expect(await screen.findByText('Saved')).toBeVisible();
    expect(screen.getByText('Vicious Khepri.live2pet')).toBeVisible();
  });

  it('starts a new project from the toolbar without restarting the App', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const api = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    expect(await screen.findByRole('button', { name: 'New project' })).toBeVisible();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'New project' }));
    expect(await screen.findByRole('button', { name: 'Open project' })).toBeVisible();
    expect(screen.queryByRole('navigation', { name: 'Project' })).not.toBeInTheDocument();
    expect(confirm).toHaveBeenCalled();
    expect(api.inspectSource).toHaveBeenCalledTimes(2);
  });

  it('autosaves only the project document and clears the draft after a successful Save', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { saveProject } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await vi.waitFor(() => expect(localStorage.getItem(PROJECT_DRAFT_KEY)).not.toBeNull());
    const envelope = JSON.parse(localStorage.getItem(PROJECT_DRAFT_KEY)!);
    expect(Object.keys(envelope).sort()).toEqual(['project', 'savedAt', 'schemaVersion']);
    expect(envelope.project).not.toHaveProperty('inspection');
    expect(envelope.project).not.toHaveProperty('runtimeSettings');
    expect(envelope.project).not.toHaveProperty('buildState');
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Models' }));
    expect(screen.queryByRole('region', { name: 'Recover unsaved project' })).not.toBeInTheDocument();
    expect(container.querySelector('.model-current-details')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
    expect(localStorage.getItem(PROJECT_DRAFT_KEY)).toBeNull();
  });

  it('offers explicit recovery, re-inspects the source reference, and restores a dirty project', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    writeProjectDraft(savedProject, localStorage, new Date('2026-09-03T01:02:03.000Z'));
    const { relinkSource } = installDesktopApi();
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('region', { name: 'Recover unsaved project' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Recover' }));

    await vi.waitFor(() => expect(relinkSource).toHaveBeenCalledWith({ project: savedProject, inputPath: '/Users/test/Saved Source.pck' }));
    expect(await screen.findByRole('main', { name: 'Map' })).toBeVisible();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(localStorage.getItem(PROJECT_DRAFT_KEY)).not.toBeNull();
  });

  it('keeps the recovery draft when Save is cancelled', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { saveProject } = installDesktopApi({ saveCancelled: true });
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await vi.waitFor(() => expect(localStorage.getItem(PROJECT_DRAFT_KEY)).not.toBeNull());
    const draftBeforeSave = localStorage.getItem(PROJECT_DRAFT_KEY);
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
    expect(localStorage.getItem(PROJECT_DRAFT_KEY)).toBe(draftBeforeSave);
  });

  it('discards a recovery draft only through its explicit action', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    writeProjectDraft(savedProject);
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('region', { name: 'Recover unsaved project' })).not.toBeInTheDocument();
    expect(localStorage.getItem(PROJECT_DRAFT_KEY)).toBeNull();
  });

  it('guards replacing a dirty project and warns before window unload', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const api = installDesktopApi();
    const { openProject } = api;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    const unload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown'));
    const openButton = screen.queryByRole('button', { name: 'Open project' });
    expect(openButton).not.toBeInTheDocument();
    // Native Open is also a replacement path and must respect the same guard.
    api.emitAppCommand('open');
    expect(confirm).toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
  });

  it('renders every shared target slot without creating automatic mappings', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { saveProject } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));

    expect(screen.getAllByRole('button', { name: /^Use selected ·/ })).toHaveLength(CLAWD_PROFILE.states.all.length + CLAWD_PROFILE.reactions.length);
    expect(screen.getAllByText('No behavior linked yet')).toHaveLength(CLAWD_PROFILE.states.all.length + CLAWD_PROFILE.reactions.length);
    await user.click(screen.getByRole('button', { name: 'Codex Pet' }));
    expect(screen.getAllByRole('button', { name: /^Use selected ·/ })).toHaveLength(CODEX_PROFILE.rows.length);

    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
    expect(saveProject.mock.calls[0][0].project).toMatchObject({
      recipes: [],
      targets: { clawd: { mappings: {}, reactions: {} }, 'codex-pet': { mappings: {}, reactions: {} } },
    });
  });

  it('controls preview loop and speed by keyboard without changing the project', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    installDesktopApi({ preview: true, runtimes: { schemaVersion: 2, configured: true, restartRequired: false, runtimes: [{ runtimeName: 'live2d.min.js', runtimeKind: 'legacy-cubism2', cubismGenerations: [2], fingerprint: 'runtime', available: true }] } });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    vi.spyOn(container.querySelector('.preview-native-surface')!, 'getBoundingClientRect').mockReturnValue({ x: 280, y: 90, width: 400, height: 520, top: 90, right: 680, bottom: 610, left: 280, toJSON: () => ({}) });
    fireEvent(window, new Event('resize'));
    await vi.waitFor(() => expect(window.live2pet!.playPreview).toHaveBeenCalledWith({ motionId: 'idle:0', loop: true, speed: 1 }));
    await vi.waitFor(() => expect(localStorage.getItem(PROJECT_DRAFT_KEY)).not.toBeNull());
    const draft = localStorage.getItem(PROJECT_DRAFT_KEY);
    const loop = screen.getByRole('button', { name: 'Loop preview' });
    expect(loop).toHaveAttribute('aria-pressed', 'true');
    loop.focus();
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(window.live2pet!.playPreview).toHaveBeenLastCalledWith({ motionId: 'idle:0', loop: false, speed: 1 }));
    expect(loop).toHaveAttribute('aria-pressed', 'false');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Preview speed: 1×' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(window.live2pet!.playPreview).toHaveBeenLastCalledWith({ motionId: 'idle:0', loop: false, speed: 1.5 }));
    expect(localStorage.getItem(PROJECT_DRAFT_KEY)).toBe(draft);
  });

  it('assigns only the selected target and can clear the assignment', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    screen.getByRole('button', { name: 'Smile' }).focus();
    await user.keyboard('{Enter}');
    screen.getByRole('button', { name: 'Use selected · Idle' }).focus();
    await user.keyboard('{Enter}');
    const assignedIdleRow = screen.getByRole('button', { name: 'Use selected · Idle' }).closest('.mapping-row');
    expect(within(assignedIdleRow as HTMLElement).getByText('Breathing · Smile')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Codex Pet' }));
    const codexIdleRow = screen.getByRole('button', { name: 'Use selected · Idle' }).closest('.mapping-row');
    expect(within(codexIdleRow as HTMLElement).getByText('No behavior linked yet')).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Clawd' }));
    await user.click(screen.getByRole('button', { name: 'Clear · Idle' }));
    const clawdIdleRow = screen.getByRole('button', { name: 'Use selected · Idle' }).closest('.mapping-row');
    expect(within(clawdIdleRow as HTMLElement).getByText('No behavior linked yet')).toBeVisible();
  });

  it('routes Desktop undo and redo to project mappings while preserving focused text editing', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const api = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    await user.click(screen.getByRole('button', { name: 'Use selected · Idle' }));
    const idleRow = () => screen.getByRole('button', { name: 'Use selected · Idle' }).closest('.mapping-row') as HTMLElement;
    expect(within(idleRow()).getByText(/^Breathing/)).toBeVisible();

    api.emitAppCommand('undo');
    await vi.waitFor(() => expect(within(idleRow()).getByText('No behavior linked yet')).toBeVisible());
    api.emitAppCommand('redo');
    await vi.waitFor(() => expect(within(idleRow()).getByText(/^Breathing/)).toBeVisible());

    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    api.emitAppCommand('undo');
    expect(within(idleRow()).getByText(/^Breathing/)).toBeVisible();
    input.remove();
  });

  it('uses project history shortcuts only as a browser fallback and ignores editable targets', () => {
    Object.defineProperty(window, 'live2pet', { configurable: true, value: undefined });
    render(<App />);

    const projectUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(projectUndo);
    expect(projectUndo.defaultPrevented).toBe(true);

    const input = document.createElement('input');
    document.body.append(input);
    const textUndo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    input.dispatchEvent(textUndo);
    expect(textUndo.defaultPrevented).toBe(false);
    input.remove();
  });

  it('persists the explicit Motion and Expression recipe in the save payload', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { saveProject } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    await user.click(screen.getByRole('button', { name: 'Smile' }));
    await user.click(screen.getByRole('button', { name: 'Use selected · Idle' }));
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
    const project = saveProject.mock.calls[0][0].project;
    expect(project.targets.clawd.mappings.idle).toBe('motion:idle:0');
    expect(project.targets['codex-pet'].mappings).toEqual({});
    expect(project.recipes).toEqual([expect.objectContaining({ motionId: 'idle:0', expressionId: '0' })]);
    expect(project.targets.clawd.recipeMappings?.idle).toBe(project.recipes[0].id);
  });

  it('shows stored recipes and fallbacks when opening an existing mapped project', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const openedProject: Live2PetProject = {
      ...savedProject,
      recipes: [{ id: 'breathing-smile', motionId: 'idle:0', expressionId: '0' }],
      targets: {
        clawd: { profile: 'clawd', mappings: { idle: 'motion:idle:0', sleeping: 'fallback:idle' }, reactions: {}, recipeMappings: { idle: 'breathing-smile' }, options: {} },
        'codex-pet': { profile: 'codex-pet', mappings: { idle: 'motion:idle:0' }, reactions: {}, recipeMappings: { idle: 'breathing-smile' }, options: {} },
      },
    };
    const recent = [{ documentId: 'opaque-document', name: 'Saved Project', fileName: 'saved.live2pet', available: true }];
    installDesktopApi({ recentProjects: recent, openedProject });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Saved Project/ }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    expect(screen.getByText('Breathing · Smile')).toBeVisible();
    expect(screen.getByText('Fallback · Idle')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Codex Pet' }));
    expect(screen.getByText('Breathing · Smile')).toBeVisible();
  });

  it('persists render presets and keeps a completed build while navigating', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const readyProject: Live2PetProject = {
      ...savedProject,
      targets: {
        clawd: { profile: 'clawd', mappings: { idle: 'motion:idle:0', thinking: 'motion:idle:0', working: 'motion:idle:0', sleeping: 'fallback:idle' }, reactions: {}, options: {} },
        'codex-pet': { profile: 'codex-pet', mappings: Object.fromEntries(CODEX_PROFILE.rowIds.map((slot) => [slot, 'motion:idle:0'])), reactions: {}, options: {} },
      },
    };
    const recent = [{ documentId: 'opaque-document', name: 'Saved Project', fileName: 'saved.live2pet', available: true }];
    const { buildProject, saveProject } = installDesktopApi({
      recentProjects: recent,
      openedProject: readyProject,
      buildHost: true,
      runtimes: { schemaVersion: 2, configured: true, restartRequired: false, runtimes: [{ runtimeName: 'Cubism 2', runtimeKind: 'legacy-cubism2', cubismGenerations: [2], fingerprint: 'runtime-fixture', available: true }] },
    });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Saved Project/ }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Build' }));
    const clawdCard = screen.getByRole('heading', { name: 'Clawd Theme Package' }).closest('[data-slot="card"]') as HTMLElement;
    await user.click(within(clawdCard).getByRole('button', { name: 'High' }));
    expect(await screen.findByText('Unsaved changes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save project' }));
    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
    expect(saveProject.mock.calls[0][0].project.targets.clawd.renderPreset).toBe('high');

    await user.click(within(clawdCard).getByRole('button', { name: 'Build Pet Package' }));
    await vi.waitFor(() => expect(buildProject).toHaveBeenCalledWith({ project: expect.any(Object), targets: ['clawd'], optionsByTarget: { clawd: { package: true } } }));
    expect(await screen.findByText('saved-clawd.zip')).toBeVisible();
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Build' }));
    expect(screen.getByText('saved-clawd.zip')).toBeVisible();
  });

  it('opens a recent project by opaque id and relinks its referenced source through the host', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const recent = [{ documentId: 'opaque-document', name: 'Saved Project', fileName: 'saved.live2pet', available: true }];
    const { openProject, relinkSource } = installDesktopApi({ recentProjects: recent });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Saved Project/ }));
    expect(openProject).toHaveBeenCalledWith({ documentId: 'opaque-document' });
    await vi.waitFor(() => expect(relinkSource).toHaveBeenCalledWith({ project: savedProject, inputPath: '/Users/test/Saved Source.pck' }));
    expect(await screen.findByRole('main', { name: 'Map' })).toBeVisible();
  });

  it('blocks Map and Build until changed Source recipes are explicitly reviewed', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const projectWithRecipe: Live2PetProject = {
      ...savedProject,
      recipes: [{ id: 'idle-recipe', motionId: 'idle:0', expressionId: null, label: 'Friendly idle' }],
    };
    const recent = [{ documentId: 'opaque-document', name: 'Saved Project', fileName: 'saved.live2pet', available: true }];
    const api = installDesktopApi({ recentProjects: recent, openedProject: projectWithRecipe });
    api.relinkSource.mockResolvedValueOnce({
      protocolVersion: 1,
      ok: true,
      result: {
        project: {
          ...projectWithRecipe,
          source: { ...projectWithRecipe.source, fingerprint: 'changed-fingerprint' },
          sourceReview: { required: true, reason: 'source-fingerprint-changed', affectedRecipeIds: ['idle-recipe'] },
        },
        inspection: {
          schemaVersion: 1,
          source: { kind: 'pck', name: 'Saved Source', fingerprint: 'changed-fingerprint', modelConfig: 'model.json' },
          model: { cubism: 2, configFile: 'model.json', modelFile: 'model.moc', textures: [] },
          motions: [], expressions: [], resources: [], warnings: [],
        },
        status: 'source-changed',
        reviewRequired: true,
        affectedRecipeIds: ['idle-recipe'],
      },
    } as any);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Saved Project/ }));
    const review = await screen.findByRole('region', { name: 'Review changed Source Package' });
    expect(within(review).getByText('Friendly idle')).toBeVisible();
    expect(within(review).getByText('idle-recipe')).toBeVisible();
    const projectNav = within(screen.getByRole('navigation', { name: 'Project' }));
    expect(projectNav.getByRole('button', { name: 'Map' })).toBeDisabled();
    expect(projectNav.getByRole('button', { name: 'Build' })).toBeDisabled();
    expect(screen.queryByText('/Users/test/Saved Source.pck')).not.toBeInTheDocument();

    await user.click(within(review).getByRole('button', { name: 'I reviewed these recipes' }));
    await vi.waitFor(() => expect(api.acknowledgeSourceReview).toHaveBeenCalledOnce());
    expect(projectNav.getByRole('button', { name: 'Map' })).toBeEnabled();
    expect(projectNav.getByRole('button', { name: 'Build' })).toBeEnabled();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
  });

  it('relinks one dropped Live2D PCK from Source without exposing its absolute path', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const recent = [{ documentId: 'opaque-document', name: 'Saved Project', fileName: 'saved.live2pet', available: true }];
    const api = installDesktopApi({ recentProjects: recent });
    api.relinkSource.mockRejectedValueOnce(new Error('Source missing'));
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(await screen.findByRole('button', { name: /Saved Project/ }));
    await vi.waitFor(() => expect(api.relinkSource).toHaveBeenCalledOnce());

    fireEvent.drop(container.querySelector('.source-grid [data-slot="card"]') as HTMLElement, {
      dataTransfer: { types: ['Files'], files: [new File(['new'], 'Replacement.pck')], items: [] },
    });

    await vi.waitFor(() => expect(api.relinkSource).toHaveBeenLastCalledWith({ project: savedProject, inputPath: '/Users/test/Replacement.pck' }));
    expect(screen.queryByText('/Users/test/Replacement.pck')).not.toBeInTheDocument();
  });

  it('routes native menu commands and returns from reopened Setup to the project', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const api = installDesktopApi();
    const user = userEvent.setup();
    render(<App />);

    api.emitAppCommand('open');
    expect(await screen.findByRole('main', { name: 'Map' })).toBeVisible();
    api.emitAppCommand('build');
    expect(await screen.findByRole('heading', { name: 'Package Build' })).toBeVisible();
    api.emitAppCommand('setup');
    expect(await screen.findByRole('heading', { name: 'Bring your models to life.' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Return to workspace' }));
    expect(await screen.findByRole('heading', { name: 'Package Build' })).toBeVisible();
    api.emitAppCommand('settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  it('keeps Welcome unchanged when the project picker is cancelled', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    installDesktopApi({ openCancelled: true });
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open project' }));
    expect(await screen.findByRole('heading', { name: 'Models', level: 1 })).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains how to recover an unavailable recent project without calling open', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const recent = [{ documentId: 'missing-document', name: 'Missing Project', fileName: 'missing.live2pet', available: false }];
    const { openProject } = installDesktopApi({ recentProjects: recent });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Missing Project/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Restore or move the .live2pet file back');
    expect(openProject).not.toHaveBeenCalled();
  });

  it('clears recent-project history without removing project files', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const recent = [{ documentId: 'opaque-document', name: 'Saved Project', fileName: 'saved.live2pet', available: true }];
    const { clearRecentProjects } = installDesktopApi({ recentProjects: recent });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: 'Clear' }));
    await vi.waitFor(() => expect(clearRecentProjects).toHaveBeenCalledOnce());
    expect(confirm).toHaveBeenCalledWith('Clear the recent-project list? Your .live2pet files will not be deleted.');
    expect(await screen.findByText('Your recent projects will appear here.')).toBeVisible();
    expect(screen.queryByText('Saved Project')).not.toBeInTheDocument();
  });

  it('imports a PCK through the Desktop inspection service and shows its real inventory', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { inspectSource } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);
    const input = container.querySelector('input[accept=".pck"]') as HTMLInputElement;

    await user.upload(input, new File(['fixture'], 'Vicious Khepri.pck'));

    expect((await screen.findAllByText('Vicious Khepri'))[0]).toBeVisible();
    expect(screen.getByText(/Cubism 2/)).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Source Package' })).toBeVisible();
    expect(inspectSource).toHaveBeenCalledWith({ inputPath: '/Users/test/Vicious Khepri.pck', projectId: 'library-preview' });
  });

  it('recognizes a Spine 4.3 source and installs its optional renderer inline', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const api = installDesktopApi({ preview: false });
    api.inspectSource.mockResolvedValue({
      protocolVersion: 1,
      ok: true,
      result: {
        schemaVersion: 1,
        source: { kind: 'spine-directory', name: 'Spine Hero', fingerprint: 'spine-fixture', modelConfig: 'hero.json' },
        model: { format: 'spine', configFile: 'hero.json', modelFile: 'hero.json', textures: ['hero.png'], atlasFile: 'hero.atlas', spineVersion: '4.3.75', runtimeLine: '4.3', binary: false },
        motions: [{ id: 'idle', group: 'animation', index: 0, name: 'idle', sourceFile: 'hero.json', duration: 1.5 }],
        expressions: [],
        resources: [],
        warnings: [],
      },
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Spine Hero.pck'));

    expect(await screen.findByText(/Spine 4\.3/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(api.installSpinePack).toHaveBeenCalledWith('4.3');
    expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeDisabled();
  });

  it('routes a project with a missing runtime to Settings and preserves its Source destination', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    installDesktopApi({ preview: false });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));

    await user.click(await screen.findByRole('button', { name: 'Configure renderer' }));
    expect(screen.getByRole('heading', { name: 'Runtimes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('heading', { name: 'Source Package' })).toBeVisible();
  });

  it('uses the base Expression until the user explicitly selects one', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await user.click(
      within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }),
    );

    expect(screen.getByText('Breathing · Base expression')).toBeVisible();
  });

  it('removes one chosen runtime without sending a clear-all request', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const runtimes = { schemaVersion: 2 as const, configured: true, restartRequired: false as const, runtimes: [{ runtimeName: 'live2d.min.js', runtimeKind: 'legacy-cubism2' as const, cubismGenerations: [2], fingerprint: 'a'.repeat(64), available: true }] };
    installDesktopApi({ runtimes });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Runtimes' }));
    await user.click(await screen.findByRole('button', { name: 'Remove live2d.min.js' }));
    expect(window.live2pet!.clearRuntimeSettings).toHaveBeenCalledWith({ fingerprint: 'a'.repeat(64) });
  });

  it('opens the embedded preview with the same project id used for PCK inspection', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const runtimes = { schemaVersion: 2 as const, configured: true, restartRequired: false as const, runtimes: [{ runtimeName: 'live2d.min.js', runtimeKind: 'legacy-cubism2' as const, cubismGenerations: [2], fingerprint: 'a'.repeat(64), available: true }] };
    const { openPreview } = installDesktopApi({ runtimes, preview: true });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    const surface = container.querySelector('.preview-native-surface') as HTMLDivElement;
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ x: 280, y: 90, width: 640, height: 520, top: 90, right: 920, bottom: 610, left: 280, toJSON: () => ({}) });
    fireEvent(window, new Event('resize'));

    await vi.waitFor(() => expect(openPreview).toHaveBeenCalledWith({ projectId: 'vicious-khepri', sourceFingerprint: 'fixture', bounds: { x: 280, y: 90, width: 640, height: 520 }, visualSettings: { hiddenElementIds: [] } }));
    const slider = screen.getByRole('slider', { name: 'Motion position' });
    await vi.waitFor(() => expect(slider).toBeEnabled());
    await vi.waitFor(() => expect(window.live2pet!.playPreview).toHaveBeenCalled());
    fireEvent.input(slider, { target: { value: '0.5' } });
    fireEvent.change(slider, { target: { value: '0.07' } });
    await vi.waitFor(() => expect(window.live2pet!.controlPreview).toHaveBeenCalledWith({ action: 'seek', time: 0.5 }));
    expect(window.live2pet!.controlPreview).not.toHaveBeenCalledWith({ action: 'seek', time: 0.07 });
    await user.click(screen.getByRole('button', { name: 'Reset preview' }));
    await vi.waitFor(() => expect(openPreview).toHaveBeenCalledTimes(3));
    expect(openPreview).toHaveBeenLastCalledWith({ projectId: 'vicious-khepri', sourceFingerprint: 'fixture', bounds: { x: 280, y: 90, width: 640, height: 520 }, visualSettings: { hiddenElementIds: [] } });
  });

  it('loads inline thumbnails serially, keeps the selected large preview, and reuses them across tabs', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const runtimes = { schemaVersion: 2 as const, configured: true, restartRequired: false as const, runtimes: [{ runtimeName: 'live2d.min.js', runtimeKind: 'legacy-cubism2' as const, cubismGenerations: [2], fingerprint: 'a'.repeat(64), available: true }] };
    let resolveBackground!: (value: { id: string; dataUrl: string | null }) => void;
    let resolveBody!: (value: { id: string; dataUrl: string | null }) => void;
    const background = new Promise<{ id: string; dataUrl: string | null }>((resolve) => { resolveBackground = resolve; });
    const body = new Promise<{ id: string; dataUrl: string | null }>((resolve) => { resolveBody = resolve; });
    const api = installDesktopApi({
      runtimes,
      preview: true,
      previewVisualElements: [
        { id: 'BG', name: 'Background', kind: 'part' },
        { id: 'BODY', name: 'Body', kind: 'part' },
      ],
      previewThumbnail: ({ id }) => id === 'BG' ? background : body,
    });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    const surface = container.querySelector('.preview-native-surface') as HTMLDivElement;
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ x: 280, y: 90, width: 640, height: 520, top: 90, right: 920, bottom: 610, left: 280, toJSON: () => ({}) });
    fireEvent(window, new Event('resize'));

    await vi.waitFor(() => expect(api.openPreview).toHaveBeenCalled());
    await vi.waitFor(() => expect(api.getPreviewVisualElements).toHaveBeenCalled());
    expect(screen.getByRole('tab', { name: 'Animations' })).toHaveClass('button--primary');
    expect(screen.getByRole('tab', { name: 'Animations' }).closest('[role="tablist"]')).toHaveClass('button-group', 'button-group--horizontal', 'target-switch');
    expect(screen.getByRole('tab', { name: 'Visibility' })).toHaveClass('button--secondary');
    await user.click(screen.getByRole('tab', { name: 'Visibility' }));
    expect(screen.getByRole('tab', { name: 'Visibility' })).toHaveClass('button--primary');
    expect(screen.getByRole('tab', { name: 'Animations' })).toHaveClass('button--secondary');
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Inspect · Background' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'Inspect · Background' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Inspect · Background' })).toHaveAttribute('aria-pressed', 'true'));
    expect(await screen.findByRole('progressbar', { name: 'Loading…' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Inspect · Body' }));
    expect(api.getPreviewVisualElementThumbnail).toHaveBeenNthCalledWith(1, { id: 'BG' });
    expect(api.getPreviewVisualElementThumbnail).toHaveBeenCalledTimes(1);

    resolveBackground({ id: 'BG', dataUrl: 'data:image/png;base64,background' });
    await Promise.resolve();
    expect(await screen.findByRole('img', { name: 'Background · BG' })).toBeVisible();
    await vi.waitFor(() => expect(api.getPreviewVisualElementThumbnail).toHaveBeenNthCalledWith(2, { id: 'BODY' }));
    expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeVisible();

    resolveBody({ id: 'BODY', dataUrl: 'data:image/png;base64,body' });
    await vi.waitFor(() => expect(screen.getAllByRole('img', { name: 'Body · BODY' })).toHaveLength(2));
    await user.click(screen.getByRole('tab', { name: 'Animations' }));
    expect(screen.queryByRole('region', { name: 'Element preview' })).not.toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    await vi.waitFor(() => expect(screen.getByRole('tab', { name: 'Visibility' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getAllByRole('img', { name: 'Body · BODY' })).toHaveLength(2);
    expect(api.getPreviewVisualElementThumbnail).toHaveBeenCalledTimes(2);
  });

  it('imports a dropped Source Package without browser navigation', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { inspectSource } = installDesktopApi();
    render(<App />);
    const pck = new File(['fixture'], 'Vicious Khepri.pck');

    fireEvent.drop(screen.getByLabelText('Import model source'), {
      dataTransfer: {
        types: ['Files'],
        files: [pck],
        items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }],
      },
    });

    expect(await screen.findByText(/Cubism 2/)).toBeVisible();
    expect(inspectSource).toHaveBeenCalledOnce();
  });

  it('opens a dropped model collection as a library instead of one Source Package', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { inspectSource, openSourceLibrary } = installDesktopApi();
    render(<App />);
    const model = new File(['{}'], 'model3.json');
    const texture = new File(['png'], 'texture.png');
    const directory = new File([''], 'live2d');
    Object.defineProperty(model, 'webkitRelativePath', { value: 'live2d/character/model3.json' });
    Object.defineProperty(texture, 'webkitRelativePath', { value: 'live2d/character/textures/texture.png' });

    fireEvent.drop(screen.getByLabelText('Import model source'), {
      dataTransfer: {
        types: ['Files'],
        files: [model, texture],
        items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => directory }],
      },
    });

    await vi.waitFor(() => expect(openSourceLibrary).toHaveBeenCalledWith('/Users/test/live2d'));
    expect(inspectSource).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Models', level: 2 })).toBeVisible();
  });

  it.each(['welcome', 'settings'])('opens a dropped project from %s without inspecting it as a model', async (destination) => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { openProject, inspectSource } = installDesktopApi();
    const user = userEvent.setup();
    render(<App />);
    if (destination === 'settings') await user.click(screen.getByRole('button', { name: /^Settings$/ }));
    fireEvent.drop(destination === 'welcome' ? screen.getByLabelText('Import model source') : screen.getByRole('main'), { dataTransfer: { types: ['Files'], files: [new File(['{}'], 'My Pet.live2pet')] } });
    await vi.waitFor(() => expect(openProject).toHaveBeenCalledWith({ inputPath: '/Users/test/My Pet.live2pet' }));
    expect(inspectSource).not.toHaveBeenCalled();
    expect(await screen.findByRole('main', { name: 'Map' })).toBeVisible();
  });

  it('preserves unsaved work when a dropped project replacement is declined', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { openProject, relinkSource } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use and start mapping' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Use and start mapping' }));
    await screen.findByRole('main', { name: 'Map' });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const zone = screen.getByRole('main', { name: 'Map' });
    const dataTransfer = { types: ['Files'], files: [new File(['{}'], 'Another.live2pet')] };
    fireEvent.dragEnter(zone, { dataTransfer });
    fireEvent.drop(zone, { dataTransfer });
    expect(confirm).toHaveBeenCalled();
    expect(openProject).not.toHaveBeenCalled();
    expect(relinkSource).not.toHaveBeenCalled();
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(container.querySelector('.drop-overlay')).toBeNull();
    confirm.mockRestore();
  });

  it('saves a runtime dropped on first-time setup', async () => {
    const { configureRuntime } = installDesktopApi();
    render(<App />);
    const runtime = new File(['runtime'], 'live2dcubismcore.min.js');

    fireEvent.drop(screen.getByLabelText('Runtime library'), {
      dataTransfer: { types: ['Files'], files: [runtime], items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }] },
    });

    expect(configureRuntime).toHaveBeenCalledWith({ inputPath: '/Users/test/live2dcubismcore.min.js' });
  });

  it('rejects multiple dropped Source Packages before inspection', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { inspectSource } = installDesktopApi();
    render(<App />);
    fireEvent.drop(screen.getByLabelText('Import model source'), {
      dataTransfer: {
        types: ['Files'],
        files: [new File(['a'], 'one.pck'), new File(['b'], 'two.pck')],
        items: [],
      },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('Drop one file or folder at a time.');
    expect(inspectSource).not.toHaveBeenCalled();
  });

  it('keeps runtime SDK folder selection keyboard reachable', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Choose SDK folder' })).toHaveFocus();
  });

  it('shows full-page setup once and continues to Welcome', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Bring your models to life.' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Set up later' }));

    expect(screen.getByRole('heading', { name: 'Models', level: 1 })).toBeVisible();
    expect(localStorage.getItem('live2pet.desktop.setup-completed')).toBe('true');
  });

  it('keeps runtime upload keyboard reachable through a visible HeroUI button', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.tab();
    expect(screen.getByRole('button', { name: 'Add runtime' })).toHaveFocus();
  });

  it('preserves the selected motion after visiting full-page Settings', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Open design preview' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    expect(screen.getByRole('heading', { name: 'Motion & Expression' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Model Preview' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Assignment' })).toBeVisible();
    expect(screen.getByText(/design preview is read-only/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use selected · Idle' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Touch Head/ }));
    expect(screen.getAllByText('Touch Head').length).toBeGreaterThan(1);
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Model Preview' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Storage/ }));
    expect(screen.getByRole('heading', { name: 'Storage' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.getByRole('heading', { name: 'Model Preview' })).toBeVisible();
    expect(screen.getAllByText('Touch Head').length).toBeGreaterThan(1);
  });

  it('switches to Simplified Chinese without losing the Settings destination', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: '简体中文' }));

    expect(screen.getByRole('heading', { name: '设置' })).toBeVisible();
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('resolves System appearance from the OS and allows an explicit override', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    setSystemDarkMode(true);
    const user = userEvent.setup();
    render(<App />);

    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    await user.click(screen.getByRole('button', { name: 'Light' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('localizes synthetic motions, expressions, and assignments', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    localStorage.setItem('live2pet.desktop.locale', 'zh-CN');
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '打开设计预览' }));
    await user.click(within(screen.getByRole('navigation', { name: '项目' })).getByRole('button', { name: '映射' }));
    expect(screen.getByRole('button', { name: /触摸头部/ })).toBeVisible();
    expect(screen.getByRole('button', { name: '微笑' })).toBeVisible();
    expect(screen.getByText('思考中')).toBeVisible();
  });
});
