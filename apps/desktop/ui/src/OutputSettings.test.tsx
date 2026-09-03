import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OutputSettings } from './OutputSettings';
import { configureOutputSettings, getOutputSettings } from './app-host';
import { translate } from './i18n';

vi.mock('./app-host', () => ({ getOutputSettings: vi.fn(), configureOutputSettings: vi.fn() }));
beforeEach(() => {
  vi.mocked(getOutputSettings).mockReset().mockResolvedValue({ schemaVersion: 1, mode: 'ask' });
  vi.mocked(configureOutputSettings).mockReset().mockResolvedValue({ cancelled: false });
});
afterEach(cleanup);

it.each(['en', 'zh-CN'] as const)('can select an output folder and restore asking in %s', async locale => {
  render(<OutputSettings locale={locale} />);
  const user = userEvent.setup();
  expect(await screen.findByRole('button', { name: translate(locale, 'outputAskEveryTime') })).toBeDisabled();
  vi.mocked(getOutputSettings).mockResolvedValue({ schemaVersion: 1, mode: 'folder', folder: '/chosen/packages', folderState: 'ready' });
  await user.click(screen.getByRole('button', { name: translate(locale, 'outputChooseFolder') }));
  expect(configureOutputSettings).toHaveBeenLastCalledWith('choose-folder');
  expect(await screen.findByText('/chosen/packages')).toBeVisible();
  vi.mocked(getOutputSettings).mockResolvedValue({ schemaVersion: 1, mode: 'ask', folder: '/chosen/packages', folderState: 'ready' });
  await user.click(screen.getByRole('button', { name: translate(locale, 'outputAskEveryTime') }));
  expect(configureOutputSettings).toHaveBeenLastCalledWith('ask-every-time');
});

it('reports inaccessible configured folders without inventing a replacement', async () => {
  vi.mocked(getOutputSettings).mockResolvedValue({ schemaVersion: 1, mode: 'folder', folder: '/gone', folderState: 'unavailable' });
  render(<OutputSettings locale="en" />);
  expect(await screen.findByRole('alert')).toHaveTextContent(translate('en', 'outputFolderUnavailable'));
  expect(configureOutputSettings).not.toHaveBeenCalled();
});

it('can retry after failing to read output settings', async () => {
  vi.mocked(getOutputSettings).mockRejectedValueOnce(new Error('Settings unreadable'));
  render(<OutputSettings locale="en" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings unreadable');
  await userEvent.setup().click(screen.getByRole('button', { name: translate('en', 'targetRefresh') }));
  expect(await screen.findByRole('button', { name: translate('en', 'outputAskEveryTime') })).toBeDisabled();
});
