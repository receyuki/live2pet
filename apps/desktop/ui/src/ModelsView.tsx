import { ModelLibrary, ModelPreview } from './model-library';
import { Button, Card, Chip, Input, ProgressBar } from "@heroui/react";
import { Archive, Box, Download, FolderOpen, GitBranch, RotateCcw, Trash2, Upload } from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useRef, useState } from "react";
import {
  openSourceLibrary,
  openGitHubLibrary,
  downloadSourceLibrary,
  getDesktopFilePath,
  hasDesktopApi,
  onLibraryDownloadProgress,
  SourceLibrary,
  SourceLibraryCandidate,
  SourceLibrarySelection,
  SourceLibraryDownloadProgress,
  RecentProject,
} from "./app-host";
import { Locale, MessageKey, translate } from "./i18n";
import { sourcePathFromSelection } from "./source-selection";
import { hasDraggedFiles, isProjectFile, isSourceDirectoryDrop, sourceFilesFromDrop } from "./file-drop";
import type { ProjectDraft } from "./project-draft";

export function ModelsView({ locale, busy, error, recentProjects, draft, onImport, onLibrarySelection, onOpenProject, onOpenRecent, onClearRecent, onRecoverDraft, onDiscardDraft, library, setLibrary, pendingSource, onConfirmSource, onDismissSource, onConfigureRuntime, selectedLibraryModel, onSelectLibraryModel }: { selectedLibraryModel: SourceLibraryCandidate | null; onSelectLibraryModel: (model: SourceLibraryCandidate | null) => void; pendingSource: SourceLibrarySelection | null; onConfirmSource: (motion: string) => Promise<void>; onDismissSource: () => void; onConfigureRuntime: () => void; library: SourceLibrary | null; setLibrary: (library: SourceLibrary) => void; locale: Locale; busy: boolean; error: string; recentProjects: RecentProject[]; draft: ProjectDraft | null; onImport: (files: File[], directDrop?: boolean) => void; onLibrarySelection: (library: SourceLibrary, candidate: SourceLibraryCandidate, motion: string) => Promise<void>; onOpenProject: () => void; onOpenRecent: (project: RecentProject) => void; onClearRecent: () => void; onRecoverDraft: () => void; onDiscardDraft: () => void }) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [dragActive, setDragActive] = useState(false);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryError, setLibraryError] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [libraryDownloadBusy, setLibraryDownloadBusy] = useState(false);
  const [libraryDownloadProgress, setLibraryDownloadProgress] = useState<SourceLibraryDownloadProgress | null>(null);
  const [libraryDownloadSummary, setLibraryDownloadSummary] = useState("");
  const [thumbnailRevision, setThumbnailRevision] = useState(0);
  const dragDepth = useRef(0);
  const folderInput = useRef<HTMLInputElement>(null);
  const pckInput = useRef<HTMLInputElement>(null);
  function selected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length) onImport(files);
  }
  function dropSource(event: DragEvent<HTMLElement>) {
    if (busy || !hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = sourceFilesFromDrop(event.dataTransfer);
    if (files.some(isProjectFile)) return;
    if (!files.length) return;
    if (isSourceDirectoryDrop(event.dataTransfer)) {
      const inputPath = sourcePathFromSelection(files, getDesktopFilePath, true);
      if (inputPath) void browseLocalLibrary(inputPath);
      else setLibraryError(t("sourcePathUnavailable"));
      return;
    }
    onImport(files, true);
  }
  async function browseLocalLibrary(inputPath?: string) {
    setLibraryBusy(true); setLibraryError("");
    try { const result = await openSourceLibrary(inputPath); if (!result.cancelled) setLibrary(result.library); }
    catch (cause) { setLibraryError(cause instanceof Error ? cause.message : t("error")); }
    finally { setLibraryBusy(false); }
  }
  async function browseGitHubLibrary() {
    if (!githubUrl.trim()) return;
    setLibraryBusy(true); setLibraryError("");
    try { const result = await openGitHubLibrary(githubUrl.trim()); if (!result.cancelled) setLibrary(result.library); }
    catch (cause) { setLibraryError(cause instanceof Error ? cause.message : t("error")); }
    finally { setLibraryBusy(false); }
  }
  useEffect(() => {
    if (!library || library.kind !== 'github') return;
    return onLibraryDownloadProgress(event => {
      if (event.libraryId === library.libraryId) setLibraryDownloadProgress(event);
    });
  }, [library?.libraryId, library?.kind]);
  useEffect(() => {
    setLibraryDownloadBusy(false); setLibraryDownloadProgress(null); setLibraryDownloadSummary(""); setThumbnailRevision(0);
  }, [library?.libraryId]);
  async function downloadAllModels() {
    if (!library || library.kind !== 'github' || libraryDownloadBusy) return;
    setLibraryDownloadBusy(true); setLibraryError(""); setLibraryDownloadSummary("");
    setLibraryDownloadProgress({ protocolVersion: 1, downloadId: 'pending-download', sequence: 0, libraryId: library.libraryId, stage: 'downloading', total: library.candidates.length, completed: 0, downloaded: 0, cached: 0, failed: 0, percent: 0 });
    try {
      const result = await downloadSourceLibrary(library.libraryId);
      setLibraryDownloadSummary(t('libraryDownloadComplete', { downloaded: result.downloaded, cached: result.cached, failed: result.failed }));
      setThumbnailRevision(value => value + 1);
    } catch (cause) { setLibraryDownloadProgress(null); setLibraryError(cause instanceof Error ? cause.message : t("error")); }
    finally { setLibraryDownloadBusy(false); }
  }
  return (
    <main
      aria-label={t("importSource")}
      className={`welcome-view drop-zone${dragActive ? " drop-zone-active" : ""}`}
      onDragEnter={(event) => { if (!busy && hasDraggedFiles(event.dataTransfer)) { event.preventDefault(); dragDepth.current += 1; setDragActive(true); } }}
      onDragOver={(event) => { if (hasDraggedFiles(event.dataTransfer)) event.preventDefault(); }}
      onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragActive(false); }}
      onDrop={dropSource}
    >
      {dragActive && <div className="drop-overlay" aria-hidden="true"><Upload size={22} />{t("dropSource")}</div>}
      <section className="welcome-hero" data-tour-id="models-import">
        <div className="welcome-copy">
          <h1>{t("source")}</h1>
          <p>{t("libraryPreviewOnly")}</p>
          <div className="welcome-actions">
            <input ref={folderInput} className="visually-hidden" type="file" multiple {...{ webkitdirectory: "" }} onChange={selected} />
            <input ref={pckInput} className="visually-hidden" type="file" accept=".pck" onChange={selected} />
            <Button variant="primary" size="lg" isDisabled={busy || libraryBusy || !hasDesktopApi()} onPress={() => void browseLocalLibrary()}><FolderOpen size={18} />{t("browseLocalLibrary")}</Button>
            <Button variant="secondary" size="lg" isDisabled={busy || !hasDesktopApi()} onPress={() => folderInput.current?.click()}><FolderOpen size={18} />{t("importSource")}</Button>
            <Button variant="secondary" size="lg" isDisabled={busy || !hasDesktopApi()} onPress={() => pckInput.current?.click()}><Box size={18} />{t("importPck")}</Button>
            <Button variant="secondary" size="lg" isDisabled={busy || !hasDesktopApi()} onPress={onOpenProject}><FolderOpen size={18} />{t("openProject")}</Button>
          </div>
          <div className="github-library-row">
            <Input aria-label={t("githubLibraryUrl")} placeholder="https://github.com/owner/repo/tree/main/models" value={githubUrl} onChange={(event) => setGithubUrl(event.target.value)} />
            <Button variant="secondary" isDisabled={busy || libraryBusy || !githubUrl.trim() || !hasDesktopApi()} onPress={() => void browseGitHubLibrary()}><GitBranch size={16} />{t("browseGitHubLibrary")}</Button>
          </div>
          <p className="import-hint">{busy ? t("loading") : t("importHint")}</p>
          {(busy || libraryBusy) && <ProgressBar aria-label={t("loading")} isIndeterminate className="mt-4" />}
          {error && <p className="inline-error" role="alert">{error}</p>}
          {libraryError && <p className="inline-error" role="alert">{libraryError}</p>}
        </div>
      </section>
      {pendingSource && <section className="model-library-section direct-source-review"><ModelPreview key={pendingSource.sourcePath + pendingSource.inspection.source.fingerprint} candidate={pendingSource.candidate} direct={pendingSource} locale={locale} onUse={onConfirmSource} onClose={onDismissSource} onConfigureRuntime={onConfigureRuntime} /></section>}
      {!pendingSource && library && <section className="model-library-section" aria-label={t("modelLibraryTitle")} data-tour-id="model-library">
        <div className="section-heading-row"><div><p className="eyebrow">{t("modelLibraryTitle")}</p><h2>{library.name}</h2><p>{translate(locale, "modelLibraryCount", { count: library.candidates.length, depth: library.maxDepth })}</p></div><div className="model-library-heading-actions"><Chip size="sm" variant="soft">{library.kind === "github" ? "GitHub" : t("localFolder")}</Chip>{library.kind === 'github' && library.candidates.length > 0 && <Button size="sm" variant="secondary" isDisabled={libraryDownloadBusy} onPress={() => void downloadAllModels()}><Download size={15} />{libraryDownloadBusy ? t('libraryDownloading') : t('libraryDownloadAll')}</Button>}</div></div>
        {library.kind === 'github' && libraryDownloadProgress && <div className="library-download-progress" aria-live="polite"><div><strong>{t('libraryDownloadProgress', { completed: libraryDownloadProgress.completed, total: libraryDownloadProgress.total })}</strong><span>{libraryDownloadProgress.percent}%</span></div>{libraryDownloadProgress.currentName && libraryDownloadBusy && <small title={libraryDownloadProgress.currentName}>{libraryDownloadProgress.currentName}</small>}<ProgressBar aria-label={t('libraryDownloading')} value={libraryDownloadProgress.percent}><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar></div>}
        {libraryDownloadSummary && <p className="library-download-summary" role="status">{libraryDownloadSummary}</p>}
        {library.candidates.length === 0 ? <div className="empty-state">{t("modelLibraryEmpty")}</div> : <ModelLibrary key={library.libraryId} library={library} locale={locale} selectedModel={selectedLibraryModel} onSelectModel={onSelectLibraryModel} onUse={onLibrarySelection} onConfigureRuntime={onConfigureRuntime} thumbnailRevision={thumbnailRevision} />}
      </section>}
      {draft && <section className="draft-recovery" aria-label={t("draftRecoveryTitle")}>
        <Card className="surface-card"><Card.Content>
          <div className="draft-recovery-copy">
            <span className="large-icon"><RotateCcw size={18} /></span>
            <span><strong>{t("draftRecoveryTitle")}</strong><small>{translate(locale, "draftRecoveryBody", { name: draft.project.name, savedAt: new Date(draft.savedAt).toLocaleString(locale) })}</small></span>
          </div>
          <div className="draft-recovery-actions">
            <Button variant="ghost" isDisabled={busy} onPress={onDiscardDraft}>{t("discardDraft")}</Button>
            <Button variant="primary" isDisabled={busy} onPress={onRecoverDraft}>{t("recoverDraft")}</Button>
          </div>
        </Card.Content></Card>
      </section>}
      <section className="recent-section">
        <div className="section-heading-row"><div><p className="eyebrow">{t("recent")}</p><h2>{t("recent")}</h2></div>{recentProjects.length > 0 && <Button size="sm" variant="ghost" onPress={onClearRecent}><Trash2 size={15} />{t("clearRecent")}</Button>}</div>
        {recentProjects.length === 0 ? <div className="empty-state"><Archive size={18} />{t("noRecent")}</div> : (
          <div className="recent-list">
            {recentProjects.map((project) => (
              <Button
                key={project.documentId}
                className={`recent-project${project.available ? "" : " recent-project-unavailable"}`}
                variant="ghost"
                onPress={() => onOpenRecent(project)}
              >
                <span className="large-icon"><FolderOpen size={18} /></span>
                <span className="grow-copy"><strong>{project.name}</strong><small>{project.fileName}</small></span>
                <Chip color={project.available ? "success" : "default"} size="sm" variant="soft">{t(project.available ? "available" : "unavailable")}</Chip>
              </Button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
