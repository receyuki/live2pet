import { Button, Card, Chip } from '@heroui/react';
import { FolderOpen, RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { configureTargetInstallation, getTargetInstallations, type BuildTarget, type InstallationAction, type TargetInstallations } from './app-host';
import { translate, type Locale, type MessageKey } from './i18n';

export function TargetSettings({ locale }: { locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [data, setData] = useState<TargetInstallations | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function refresh() {
    setBusy(true); setError('');
    try { setData(await getTargetInstallations()); }
    catch (cause) { setData(null); setError(cause instanceof Error ? cause.message : t('error')); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function configure(target: BuildTarget, action: InstallationAction) {
    setBusy(true); setError('');
    try { await configureTargetInstallation(target, action); setData(await getTargetInstallations()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('error')); }
    finally { setBusy(false); }
  }
  return <div className="target-settings" aria-busy={busy}>
    <div className="target-settings-tools"><Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void refresh()}><RefreshCw size={15} />{t('targetRefresh')}</Button></div>
    {busy && <p role="status">{t('loading')}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    {data?.targets.map(record => <Card className="surface-card" key={record.target}><Card.Content>
      <h2>{record.target === 'clawd' ? 'Clawd on Desk' : 'Codex'}</h2>
      <div className="target-detection-row"><strong>{t('targetApp')}</strong><Chip size="sm" variant="soft" color={record.application.status === 'found' ? 'success' : 'default'}>{t(`targetApp_${record.application.status}`)}</Chip></div>
      {record.application.path && <p className="target-path">{record.application.path}</p>}
      {record.application.version && <small>{record.application.version}</small>}
      {record.application.status !== 'found' && <p className="muted">{t('targetSearchHint')}</p>}
      <div className="target-settings-actions">
        <Button size="sm" variant="secondary" isDisabled={busy || data.platform !== 'darwin'} onPress={() => void configure(record.target, 'choose-app')}><FolderOpen size={15} />{t('targetChooseApp')}</Button>
        {record.application.source === 'manual' && <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => void configure(record.target, 'reset-app')}><RotateCcw size={15} />{t('targetAutoApp')}</Button>}
      </div>
      <div className="target-detection-row"><strong>{t('targetRoot')}</strong><Chip size="sm" variant="soft">{t(`targetRoot_${record.root.state}`)}</Chip></div>
      <p className="target-path">{record.root.path}</p>
      <small>{t(`targetSource_${record.root.source}`)}</small>
      <div className="target-settings-actions">
        <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void configure(record.target, 'choose-root')}><FolderOpen size={15} />{t('targetChooseRoot')}</Button>
        {record.root.source === 'manual' && <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => void configure(record.target, 'reset-root')}><RotateCcw size={15} />{t('targetDefaultRoot')}</Button>}
      </div>
    </Card.Content></Card>)}
    <p className="muted">{t('targetSettingsHint')}</p>
  </div>;
}
