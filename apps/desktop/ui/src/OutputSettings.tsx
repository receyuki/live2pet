import { Button, Card, Chip } from '@heroui/react';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { configureOutputSettings, getOutputSettings, type OutputSettings as OutputSettingsData, type OutputSettingsAction } from './app-host';
import { translate, type Locale, type MessageKey } from './i18n';

export function OutputSettings({ locale }: { locale: Locale }) {
  const t = (key: MessageKey) => translate(locale, key);
  const [data, setData] = useState<OutputSettingsData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  async function refresh() {
    setBusy(true); setError('');
    try { setData(await getOutputSettings()); }
    catch (cause) { setData(null); setError(cause instanceof Error ? cause.message : t('error')); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function configure(action: OutputSettingsAction) {
    setBusy(true); setError('');
    try { await configureOutputSettings(action); setData(await getOutputSettings()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('error')); }
    finally { setBusy(false); }
  }
  return <div className="target-settings" aria-busy={busy}>
    {busy && <p role="status">{t('loading')}</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <Card className="surface-card"><Card.Content>
      <h2>{t('outputSettingsTitle')}</h2>
      <p className="muted">{t('outputSettingsHint')}</p>
      {data && <>
        <Chip size="sm" variant="soft">{t(data.mode === 'ask' ? 'outputAskEveryTime' : 'outputUseFolder')}</Chip>
        {data.mode === 'folder' && <p className="target-path">{data.folder}</p>}
        {data.mode === 'folder' && data.folderState !== 'ready' && <p className="inline-error" role="alert">{t('outputFolderUnavailable')}</p>}
        <div className="target-settings-actions">
          <Button size="sm" variant={data.mode === 'ask' ? 'primary' : 'secondary'} isDisabled={busy || data.mode === 'ask'} onPress={() => void configure('ask-every-time')}>{t('outputAskEveryTime')}</Button>
          <Button size="sm" variant="secondary" isDisabled={busy} onPress={() => void configure('choose-folder')}><FolderOpen size={15} />{t('outputChooseFolder')}</Button>
        </div>
      </>}
      <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => void refresh()}><RefreshCw size={15} />{t('targetRefresh')}</Button>
    </Card.Content></Card>
  </div>;
}
