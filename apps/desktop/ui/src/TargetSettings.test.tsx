import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TargetSettings } from './TargetSettings';
import { configureTargetInstallation, getTargetInstallations, type TargetInstallations } from './app-host';

vi.mock('./app-host', () => ({ getTargetInstallations: vi.fn(), configureTargetInstallation: vi.fn() }));
const fixture: TargetInstallations = { platform: 'darwin', targets: [
  {target:'clawd', locationId:'clawd-location', application:{status:'found', path:'/Applications/Clawd on Desk.app', version:'1.2.3', source:'auto'}, root:{path:'/Users/test/themes',source:'manual',state:'ready'}},
  {target:'codex-pet', locationId:'codex-location', application:{status:'not-found', source:'auto'}, root:{path:'/Users/test/.codex/pets',source:'default',state:'will-create'}},
] };
beforeEach(() => {
  vi.mocked(getTargetInstallations).mockReset().mockResolvedValue(fixture);
  vi.mocked(configureTargetInstallation).mockReset().mockResolvedValue({cancelled:false});
});
afterEach(cleanup);

it.each(['en', 'zh-CN'] as const)('shows real detection states and native configuration actions in %s', async locale => {
  const user = userEvent.setup();
  render(<TargetSettings locale={locale} />);
  expect(await screen.findByText('/Applications/Clawd on Desk.app')).toBeVisible();
  expect(screen.getByText('1.2.3')).toBeVisible();
  expect(screen.getByText(locale === 'en' ? 'Not found in checked locations' : '未在检查位置找到')).toBeVisible();
  expect(screen.getByText(locale === 'en' ? 'Created on confirmed installation' : '确认安装时创建')).toBeVisible();
  expect(screen.queryByText('hatch-pet')).not.toBeInTheDocument();
  const clawd = within(screen.getByRole('heading', {name:'Clawd on Desk'}).closest('[data-slot="card"]')! as HTMLElement);
  await user.click(clawd.getByRole('button', {name:locale === 'en' ? 'Choose package folder' : '选择安装目录'}));
  expect(configureTargetInstallation).toHaveBeenLastCalledWith('clawd', 'choose-root');
  await user.click(clawd.getByRole('button', {name:locale === 'en' ? 'Use default folder' : '恢复默认目录'}));
  expect(configureTargetInstallation).toHaveBeenLastCalledWith('clawd', 'reset-root');
  await user.click(clawd.getByRole('button', {name:locale === 'en' ? 'Locate App' : '手动定位 App'}));
  expect(configureTargetInstallation).toHaveBeenLastCalledWith('clawd', 'choose-app');
});

it('does not invent ready states when detection fails and can retry', async () => {
  vi.mocked(getTargetInstallations).mockRejectedValueOnce(new Error('Detection failed'));
  render(<TargetSettings locale="en" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Detection failed');
  expect(screen.queryByText('App found')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', {name:'Detect again'}));
  expect(await screen.findByText('/Applications/Clawd on Desk.app')).toBeVisible();
});
