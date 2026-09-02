import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';

const emptyRuntimes = { schemaVersion: 2 as const, configured: false, restartRequired: false, runtimes: [] };

function installDesktopApi() {
  Object.defineProperty(window, 'live2pet', {
    configurable: true,
    value: {
      getVersion: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { appVersion: '0.1.0', protocolVersion: 1, methods: [] } })),
      getRuntimeSettings: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: emptyRuntimes })),
      configureRuntime: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: emptyRuntimes })),
      clearRuntimeSettings: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: emptyRuntimes })),
      getBuildCacheStatus: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { byteLength: 0, entryCount: 0, maxBytes: 1024 } })),
      clearBuildCache: vi.fn(async () => ({ protocolVersion: 1, ok: true, result: { removedEntries: 0, removedBytes: 0 } })),
      getFilePath: vi.fn(() => null),
    },
  });
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
