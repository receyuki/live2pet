import type { Entry } from "@zip.js/zip.js";
import { Button, ButtonGroup, Chip } from "@heroui/react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BuildArtifact, BuildTarget } from "./app-host";
import { readCompleteBuildArtifact } from "./build-artifact";
import type { Locale, MessageKey } from "./i18n";
import { translate } from "./i18n";

const MAX_ARCHIVE_BYTES = 96 * 1024 * 1024;
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_PREVIEW_BYTES = 128 * 1024 * 1024;
const MAX_ENTRY_COUNT = 2048;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const CODEX_ATLAS = { width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 } as const;
const CODEX_ROWS = ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"] as const;

type PreviewAsset = { id: string; label: string; path: string };
export type ClawdGeneratedPreview = { target: "clawd"; archive: Uint8Array; assets: PreviewAsset[] };
export type CodexGeneratedPreview = {
  target: "codex-pet";
  spritesheet: Uint8Array;
  atlas: typeof CODEX_ATLAS;
  rows: Array<{ id: string; row: number; frameCount: number }>;
};
export type GeneratedPreviewData = ClawdGeneratedPreview | CodexGeneratedPreview;

class GeneratedPreviewError extends Error {}

async function zipApi() {
  const api = await import("@zip.js/zip.js");
  api.configure({ useWebWorkers: false });
  return api;
}

function fail(message: string): never {
  throw new GeneratedPreviewError(message);
}

export function isSafeArchivePath(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || value.startsWith("/") || value.endsWith("/../")) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(bytes: Uint8Array, label: string): Record<string, unknown> {
  if (bytes.byteLength > MAX_MANIFEST_BYTES) fail(`${label} is too large to preview.`);
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!record(parsed)) fail(`${label} must contain a JSON object.`);
    return parsed;
  } catch (cause) {
    if (cause instanceof Error && cause.message.includes(label)) throw cause;
    fail(`${label} is not valid JSON.`);
  }
}

async function readEntry(entry: Entry, label: string, limit = MAX_ENTRY_BYTES): Promise<Uint8Array> {
  if (typeof entry.uncompressedSize === "number" && entry.uncompressedSize > limit) fail(`${label} is too large to preview.`);
  if (!entry.getData) fail(`${label} cannot be read.`);
  const { Uint8ArrayWriter } = await zipApi();
  const value = await entry.getData(new Uint8ArrayWriter());
  if (value.byteLength > limit) fail(`${label} is too large to preview.`);
  return value;
}

function collectAssetLabels(manifest: Record<string, unknown>): Map<string, string[]> {
  const labels = new Map<string, string[]>();
  const add = (file: unknown, label: string) => {
    if (typeof file !== "string" || !file || file.includes("/") || file.includes("\\")) return;
    const current = labels.get(file) ?? [];
    if (!current.includes(label)) current.push(label);
    labels.set(file, current);
  };
  if (record(manifest.states)) {
    for (const [slot, value] of Object.entries(manifest.states)) {
      if (Array.isArray(value)) value.forEach((file) => add(file, slot));
    }
  }
  if (record(manifest.reactions)) {
    for (const [slot, value] of Object.entries(manifest.reactions)) {
      if (!record(value)) continue;
      add(value.file, slot);
      add(value.fileLeft, `${slot} left`);
      add(value.fileRight, `${slot} right`);
      if (Array.isArray(value.files)) value.files.forEach((file) => add(file, slot));
    }
  }
  for (const field of ["idleAnimations", "workingTiers", "jugglingTiers"] as const) {
    const values = manifest[field];
    if (Array.isArray(values)) values.forEach((value) => record(value) && add(value.file, field));
  }
  return labels;
}

function validateEntries(entries: Entry[]): Map<string, Entry> {
  if (entries.length > MAX_ENTRY_COUNT) fail(`The package contains more than ${MAX_ENTRY_COUNT} entries.`);
  const files = new Map<string, Entry>();
  for (const entry of entries) {
    if (!entry || typeof entry.filename !== "string") fail("The package contains an unnamed entry.");
    if (entry.directory || entry.filename.endsWith("/")) continue;
    if (!isSafeArchivePath(entry.filename)) fail(`Unsafe package path: ${entry.filename}`);
    if (files.has(entry.filename)) fail(`Duplicate package path: ${entry.filename}`);
    if (typeof entry.uncompressedSize === "number" && entry.uncompressedSize > MAX_ENTRY_BYTES) fail(`Package entry is too large: ${entry.filename}`);
    files.set(entry.filename, entry);
  }
  return files;
}

async function parseClawd(files: Map<string, Entry>, archive: Uint8Array): Promise<ClawdGeneratedPreview> {
  const manifests = [...files.keys()].filter((name) => /^[^/]+\/theme\.json$/i.test(name));
  if (manifests.length !== 1) fail("The Clawd package must contain one root theme.json.");
  const manifestPath = manifests[0];
  const root = manifestPath.slice(0, -"theme.json".length);
  if ([...files.keys()].some((name) => !name.startsWith(root))) fail("The Clawd package contains a file outside its theme root.");
  const manifest = parseJson(await readEntry(files.get(manifestPath)!, "theme.json", MAX_MANIFEST_BYTES), "theme.json");
  const labels = collectAssetLabels(manifest);
  const assetPrefix = `${root}assets/`;
  const assetEntries = [...files.entries()].filter(([name]) => name.startsWith(assetPrefix) && name.toLowerCase().endsWith(".webp") && !name.slice(assetPrefix.length).includes("/"));
  if (!assetEntries.length) fail("The Clawd package does not contain generated WebP assets.");
  let expandedBytes = 0;
  const assets: PreviewAsset[] = [];
  for (const [path, entry] of assetEntries) {
    expandedBytes += typeof entry.uncompressedSize === "number" ? entry.uncompressedSize : 0;
    if (expandedBytes > MAX_EXPANDED_PREVIEW_BYTES) fail("The generated preview assets are too large to open safely.");
    const file = path.slice(assetPrefix.length);
    const referencedBy = labels.get(file);
    assets.push({ id: file, label: referencedBy?.length ? referencedBy.join(" · ") : file.replace(/\.webp$/i, ""), path });
  }
  return { target: "clawd", archive, assets };
}

async function parseCodex(files: Map<string, Entry>): Promise<CodexGeneratedPreview> {
  const manifestEntry = files.get("pet.json");
  const spriteEntry = files.get("spritesheet.webp");
  if (!manifestEntry || !spriteEntry) fail("The Codex package is missing pet.json or spritesheet.webp.");
  const manifest = parseJson(await readEntry(manifestEntry, "pet.json", MAX_MANIFEST_BYTES), "pet.json");
  if (!record(manifest.atlas) || !Array.isArray(manifest.rows) || manifest.spritesheetPath !== "spritesheet.webp") fail("pet.json does not match the generated preview contract.");
  for (const [key, expected] of Object.entries(CODEX_ATLAS)) if (manifest.atlas[key] !== expected) fail(`pet.json has an invalid atlas ${key}.`);
  const rows = manifest.rows.map((value, index) => {
    if (!record(value) || value.id !== CODEX_ROWS[index] || value.row !== index || !Number.isInteger(value.frameCount) || Number(value.frameCount) < 1 || Number(value.frameCount) > CODEX_ATLAS.columns || !Array.isArray(value.frames) || value.frames.length !== value.frameCount) fail(`pet.json row ${index} is malformed.`);
    return { id: CODEX_ROWS[index], row: index, frameCount: Number(value.frameCount) };
  });
  if (rows.length !== CODEX_ATLAS.rows) fail("pet.json does not contain every generated preview row.");
  return { target: "codex-pet", spritesheet: await readEntry(spriteEntry, "spritesheet.webp"), atlas: CODEX_ATLAS, rows };
}

export async function parseGeneratedPreview(bytes: Uint8Array, target: BuildTarget): Promise<GeneratedPreviewData> {
  if (!bytes.byteLength) fail("The generated package is empty.");
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) fail("The generated package is too large to preview safely.");
  const { Uint8ArrayReader, ZipReader } = await zipApi();
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const files = validateEntries(await reader.getEntries());
    return target === "clawd" ? await parseClawd(files, bytes) : await parseCodex(files);
  } catch (cause) {
    if (cause instanceof GeneratedPreviewError) throw cause;
    throw new GeneratedPreviewError("The generated package could not be opened as a ZIP archive.");
  } finally {
    try { await reader.close(); } catch { /* Nothing remains open after a failed preview. */ }
  }
}

export async function loadGeneratedPreview(artifact: BuildArtifact): Promise<GeneratedPreviewData> {
  if (artifact.byteLength > MAX_ARCHIVE_BYTES) fail("The generated package is too large to preview safely.");
  return parseGeneratedPreview(await readCompleteBuildArtifact(artifact.artifactId), artifact.target);
}

export async function readGeneratedPreviewAsset(archive: Uint8Array, path: string): Promise<Uint8Array> {
  if (!isSafeArchivePath(path) || !path.toLowerCase().endsWith(".webp")) fail("The selected generated asset path is invalid.");
  const { Uint8ArrayReader, ZipReader } = await zipApi();
  const reader = new ZipReader(new Uint8ArrayReader(archive));
  try {
    const entry = validateEntries(await reader.getEntries()).get(path);
    if (!entry) fail("The selected generated asset is missing from the package.");
    return await readEntry(entry, path);
  } catch (cause) {
    if (cause instanceof GeneratedPreviewError) throw cause;
    throw new GeneratedPreviewError("The selected generated asset could not be opened.");
  } finally {
    try { await reader.close(); } catch { /* Nothing remains open after a failed preview. */ }
  }
}

type Props = { artifact: BuildArtifact; locale: Locale };

export function GeneratedPreview({ artifact, locale }: Props) {
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(locale, key, values);
  const [preview, setPreview] = useState<GeneratedPreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(0);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [imageBytes, setImageBytes] = useState<Uint8Array | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageReady, setImageReady] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decodedImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPreview(null);
    void loadGeneratedPreview(artifact).then((value) => { if (active) { setPreview(value); setSelected(0); setFrame(0); setPlaying(true); } }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : t("generatedPreviewUnavailable")); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [artifact.artifactId]);

  useEffect(() => {
    let active = true;
    setImageBytes(null);
    setImageError(null);
    if (!preview) return () => { active = false; };
    if (preview.target === "codex-pet") {
      setImageBytes(preview.spritesheet);
      return () => { active = false; };
    }
    const asset = preview.assets[selected];
    if (asset) void readGeneratedPreviewAsset(preview.archive, asset.path).then((value) => { if (active) setImageBytes(value); }).catch((cause) => { if (active) setImageError(cause instanceof Error ? cause.message : t("generatedPreviewUnavailable")); });
    return () => { active = false; };
  }, [preview, selected]);

  useEffect(() => {
    if (!imageBytes) { setImageUrl(null); return; }
    const url = URL.createObjectURL(new Blob([Uint8Array.from(imageBytes).buffer], { type: "image/webp" }));
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageBytes]);

  const codexRow = preview?.target === "codex-pet" ? preview.rows[selected] : null;
  useEffect(() => {
    if (!codexRow || !playing) return;
    const timer = window.setInterval(() => setFrame((value) => (value + 1) % codexRow.frameCount), 1000 / 12);
    return () => window.clearInterval(timer);
  }, [codexRow, playing]);

  useEffect(() => {
    setImageReady(false);
    decodedImageRef.current = null;
    if (!imageUrl || preview?.target !== "codex-pet") return;
    const image = new Image();
    image.onload = () => { decodedImageRef.current = image; setImageReady(true); };
    image.onerror = () => setImageError(t("generatedPreviewUnavailable"));
    image.src = imageUrl;
    return () => { image.onload = null; image.onerror = null; image.src = ""; decodedImageRef.current = null; };
  }, [imageUrl, preview?.target]);

  useEffect(() => {
    if (!imageReady || !codexRow || preview?.target !== "codex-pet" || !decodedImageRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, preview.atlas.cellWidth, preview.atlas.cellHeight);
    context.drawImage(decodedImageRef.current, frame * preview.atlas.cellWidth, codexRow.row * preview.atlas.cellHeight, preview.atlas.cellWidth, preview.atlas.cellHeight, 0, 0, preview.atlas.cellWidth, preview.atlas.cellHeight);
  }, [codexRow, frame, imageReady, preview]);

  if (loading) return <div className="generated-preview-status" role="status">{t("generatedPreviewLoading")}</div>;
  if (error || imageError || !preview) return <div className="generated-preview-status generated-preview-error" role="status"><strong>{t("generatedPreviewUnavailable")}</strong><small>{error ?? imageError}</small></div>;

  return (
    <section className="generated-preview" aria-label={t("generatedPreview")}>
      <div className="generated-preview-heading"><strong>{t("generatedPreview")}</strong><Chip size="sm" variant="soft">{preview.target === "clawd" ? t("generatedAssets", { value: preview.assets.length }) : t("generatedRows", { value: preview.rows.length })}</Chip></div>
      <div className="generated-preview-stage">
        {!imageUrl ? <span className="preview-message">{t("generatedPreviewLoading")}</span> : preview.target === "clawd" ? <img src={imageUrl} alt={preview.assets[selected]?.label ?? t("generatedPreview")} /> : <canvas ref={canvasRef} role="img" aria-label={`${codexRow?.id} ${t("generatedPreview")}`} className="generated-sprite-cell" width={preview.atlas.cellWidth} height={preview.atlas.cellHeight} />}
      </div>
      <div className="generated-preview-controls">
        <ButtonGroup aria-label={t("generatedPreviewSelection")} className="generated-preview-choices">
          {(preview.target === "clawd" ? preview.assets : preview.rows).map((item, index) => <Button size="sm" key={item.id} variant={selected === index ? "primary" : "secondary"} onPress={() => { setSelected(index); setFrame(0); }}>{"label" in item ? item.label : item.id}</Button>)}
        </ButtonGroup>
        {preview.target === "codex-pet" && <ButtonGroup aria-label={t("generatedPlayback")}><Button size="sm" variant="secondary" aria-label={playing ? t("pause") : t("play")} onPress={() => setPlaying((value) => !value)}>{playing ? <Pause size={14} /> : <Play size={14} />}</Button><Button size="sm" variant="secondary" aria-label={t("restart")} onPress={() => setFrame(0)}><RotateCcw size={14} /></Button></ButtonGroup>}
      </div>
    </section>
  );
}
