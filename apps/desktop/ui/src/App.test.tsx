import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import type { Live2PetProject } from './app-host';
import { CLAWD_PROFILE, CODEX_PROFILE } from './target-profiles';

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

function installDesktopApi({ runtimes = emptyRuntimes, preview = false, buildHost = false, recentProjects = [], openCancelled = false, saveCancelled = false, openedProject = savedProject }: { runtimes?: typeof emptyRuntimes | { schemaVersion: 2; configured: boolean; restartRequired: false; runtimes: Array<{ runtimeName: string; runtimeKind: 'legacy-cubism2'; cubismGenerations: number[]; fingerprint: string; available: boolean }> }; preview?: boolean; buildHost?: boolean; recentProjects?: Array<{ documentId: string; name: string; fileName: string; available: boolean }>; openCancelled?: boolean; saveCancelled?: boolean; openedProject?: Live2PetProject } = {}) {
  const inspectSource = vi.fn(async () => ({
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
  const openPreview = vi.fn(async (input: { projectId: string; sourceFingerprint: string; bounds: { x: number; y: number; width: number; height: number } }) => ({ protocolVersion: 1 as const, ok: true, result: { schemaVersion: 1 as const, state: 'ready' as const, projectId: input.projectId, sourceFingerprint: input.sourceFingerprint, visible: true, bounds: input.bounds, playback: { motionId: null, expressionId: null, playing: false, loop: true, speed: 1 } } }));
  const openProject = vi.fn(async () => ({ protocolVersion: 1 as const, ok: true, result: openCancelled ? { cancelled: true as const, recentProjects } : { cancelled: false as const, documentId: 'opaque-document', fileName: 'saved.live2pet', project: openedProject, recentProjects } }));
  const saveProject = vi.fn(async (input: { project: Live2PetProject }) => ({ protocolVersion: 1 as const, ok: true, result: saveCancelled ? { cancelled: true as const, recentProjects } : { cancelled: false as const, documentId: 'opaque-saved-document', fileName: `${input.project.name}.live2pet`, project: input.project, recentProjects } }));
  let appCommandListener: ((command: 'open' | 'save' | 'settings' | 'build' | 'setup') => void) | undefined;
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
      getRecentProjects: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { recentProjects } })),
      openProject,
      saveProject,
      onAppCommand: vi.fn((listener) => { appCommandListener = listener; return () => { appCommandListener = undefined; }; }),
      getRuntimeSettings: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: runtimes })),
      configureRuntime,
      clearRuntimeSettings: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: emptyRuntimes })),
      getBuildCacheStatus: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { byteLength: 0, entryCount: 0, maxBytes: 1024 } })),
      clearBuildCache: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { removedEntries: 0, removedBytes: 0 } })),
      getFilePath: vi.fn((file: File) => `/Users/test/${file.name}`),
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
      } : {}),
    },
  });
  return { configureRuntime, inspectSource, openPreview, openProject, saveProject, buildProject, emitAppCommand: (command: 'open' | 'save' | 'settings' | 'build' | 'setup') => appCommandListener?.(command) };
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

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('live2pet.desktop.locale', 'en');
  setSystemDarkMode(false);
  installDesktopApi();
});

afterEach(() => cleanup());

describe('Live2Pet desktop shell', () => {
  it('creates an unsaved schema-1 project on import and saves it through the opaque document API', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { saveProject } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    expect(await screen.findByText('Unsaved changes')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Save project' }));

    await vi.waitFor(() => expect(saveProject).toHaveBeenCalledOnce());
    expect(saveProject.mock.calls[0][0]).toMatchObject({ project: { schemaVersion: 1, projectId: 'vicious-khepri', source: { path: '/Users/test/Vicious Khepri.pck' }, recipes: [] } });
    expect(await screen.findByText('Saved')).toBeVisible();
    expect(screen.getByText('Vicious Khepri.live2pet')).toBeVisible();
  });

  it('renders every shared target slot without creating automatic mappings', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { saveProject } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
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

  it('assigns only the selected target and can clear the assignment', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    await user.click(screen.getByRole('button', { name: 'Smile' }));
    await user.click(screen.getByRole('button', { name: 'Use selected · Idle' }));
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

  it('persists the explicit Motion and Expression recipe in the save payload', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { saveProject } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
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
    await vi.waitFor(() => expect(buildProject).toHaveBeenCalledWith({ project: expect.any(Object), targets: ['clawd'] }));
    expect(await screen.findByText('saved-clawd.zip')).toBeVisible();
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Build' }));
    expect(screen.getByText('saved-clawd.zip')).toBeVisible();
  });

  it('opens a recent project by opaque id and re-inspects its referenced source', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const recent = [{ documentId: 'opaque-document', name: 'Saved Project', fileName: 'saved.live2pet', available: true }];
    const { openProject, inspectSource } = installDesktopApi({ recentProjects: recent });
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole('button', { name: /Saved Project/ }));
    expect(openProject).toHaveBeenCalledWith({ documentId: 'opaque-document' });
    await vi.waitFor(() => expect(inspectSource).toHaveBeenCalledWith({ inputPath: '/Users/test/Saved Source.pck', projectId: 'saved-project' }));
    expect(await screen.findByRole('heading', { name: 'Source Package' })).toBeVisible();
  });

  it('routes native menu commands and returns from reopened Setup to the project', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const api = installDesktopApi();
    const user = userEvent.setup();
    render(<App />);

    api.emitAppCommand('open');
    expect(await screen.findByRole('heading', { name: 'Source Package' })).toBeVisible();
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
    expect(await screen.findByRole('heading', { name: 'Turn Live2D motions into desktop pets.' })).toBeVisible();
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

  it('imports a PCK through the Desktop inspection service and shows its real inventory', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { inspectSource } = installDesktopApi();
    const user = userEvent.setup();
    const { container } = render(<App />);
    const input = container.querySelector('input[accept=".pck"]') as HTMLInputElement;

    await user.upload(input, new File(['fixture'], 'Vicious Khepri.pck'));

    expect(await screen.findByText('Vicious Khepri')).toBeVisible();
    expect(screen.getByText(/Cubism 2/)).toBeVisible();
    expect(screen.getByText('model.moc')).toBeVisible();
    expect(inspectSource).toHaveBeenCalledWith({ inputPath: '/Users/test/Vicious Khepri.pck', projectId: 'vicious-khepri' });
  });

  it('routes a project with a missing runtime to Settings and preserves its Source destination', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));

    await user.click(await screen.findByRole('button', { name: 'Configure runtime' }));
    expect(screen.getByRole('heading', { name: 'Runtimes' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('heading', { name: 'Source Package' })).toBeVisible();
  });

  it('uses the base Expression until the user explicitly selects one', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await user.click(
      within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }),
    );

    expect(screen.getByText('Breathing · Base expression')).toBeVisible();
  });

  it('opens the embedded preview with the same project id used for PCK inspection', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const runtimes = { schemaVersion: 2 as const, configured: true, restartRequired: false as const, runtimes: [{ runtimeName: 'live2d.min.js', runtimeKind: 'legacy-cubism2' as const, cubismGenerations: [2], fingerprint: 'a'.repeat(64), available: true }] };
    const { openPreview } = installDesktopApi({ runtimes, preview: true });
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.upload(container.querySelector('input[accept=".pck"]') as HTMLInputElement, new File(['fixture'], 'Vicious Khepri.pck'));
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: 'Map' }));
    const surface = container.querySelector('.preview-native-surface') as HTMLDivElement;
    vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue({ x: 280, y: 90, width: 640, height: 520, top: 90, right: 920, bottom: 610, left: 280, toJSON: () => ({}) });
    fireEvent(window, new Event('resize'));

    await vi.waitFor(() => expect(openPreview).toHaveBeenCalledWith({ projectId: 'vicious-khepri', sourceFingerprint: 'fixture', bounds: { x: 280, y: 90, width: 640, height: 520 } }));
  });

  it('imports a dropped Source Package without browser navigation', async () => {
    localStorage.setItem('live2pet.desktop.setup-completed', 'true');
    const { inspectSource } = installDesktopApi();
    render(<App />);
    const pck = new File(['fixture'], 'Vicious Khepri.pck');

    fireEvent.drop(screen.getByLabelText('Import Live2D source'), {
      dataTransfer: {
        types: ['Files'],
        files: [pck],
        items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) }],
      },
    });

    expect(await screen.findByText(/Cubism 2/)).toBeVisible();
    expect(inspectSource).toHaveBeenCalledOnce();
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
    fireEvent.drop(screen.getByLabelText('Import Live2D source'), {
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

    expect(screen.getByRole('heading', { name: 'Turn Live2D motions into desktop pets.' })).toBeVisible();
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
    expect(screen.getByRole('heading', { name: 'Live2D Preview' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Assignment' })).toBeVisible();
    expect(screen.getByText(/design preview is read-only/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Use selected · Idle' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /Touch Head/ }));
    expect(screen.getAllByText('Touch Head').length).toBeGreaterThan(1);
    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Live2D Preview' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Storage/ }));
    expect(screen.getByRole('heading', { name: 'Storage' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(screen.getByRole('heading', { name: 'Live2D Preview' })).toBeVisible();
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
    await user.click(within(screen.getByRole('navigation', { name: 'Project' })).getByRole('button', { name: '映射' }));
    expect(screen.getByRole('button', { name: /触摸头部/ })).toBeVisible();
    expect(screen.getByRole('button', { name: '微笑' })).toBeVisible();
    expect(screen.getByText('思考中')).toBeVisible();
  });
});
