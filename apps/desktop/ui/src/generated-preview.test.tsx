import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { configure, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readCompleteBuildArtifact } from "./build-artifact";
import { GeneratedPreview, isSafeArchivePath, parseGeneratedPreview, readGeneratedPreviewAsset } from "./generated-preview";

vi.mock("./build-artifact", () => ({ readCompleteBuildArtifact: vi.fn() }));

configure({ useWebWorkers: false });

async function archive(entries: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, value] of Object.entries(entries)) {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    await writer.add(name, new Uint8ArrayReader(bytes));
  }
  return writer.close();
}

function codexManifest() {
  return {
    spritesheetPath: "spritesheet.webp",
    atlas: { width: 1536, height: 1872, columns: 8, rows: 9, cellWidth: 192, cellHeight: 208 },
    rows: ["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"].map((id, row) => { const frameCount = [6, 8, 8, 4, 5, 8, 6, 6, 6][row]; return { id, row, frameCount, frames: Array.from({ length: frameCount }, (_, index) => ({ index })) }; }),
  };
}

it('previews V2 neutral-look cells without treating them as extra required animations', async () => {
  const manifest = { ...codexManifest(), spriteVersionNumber: 2, atlas: { ...codexManifest().atlas, rows: 11, height: 2288 }, gaze: { mode: 'neutral' } };
  const preview = await parseGeneratedPreview(await archive({ 'pet.json': JSON.stringify(manifest), 'spritesheet.webp': new Uint8Array([1, 2, 3]) }), 'codex-pet');
  expect(preview.target).toBe('codex-pet');
  if (preview.target === 'codex-pet') {
    expect(preview.atlas.rows).toBe(11);
    expect(preview.rows.at(-1)).toMatchObject({ id: 'neutral-look', row: 9, frameCount: 1 });
    expect(preview.rows).toHaveLength(10);
  }
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.mocked(readCompleteBuildArtifact).mockReset();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ clearRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("Image", class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private value = "";
    set src(value: string) { this.value = value; if (value) queueMicrotask(() => this.onload?.()); }
    get src() { return this.value; }
  });
});

describe("generated package preview", () => {
  it("opens generated Clawd WebP assets and labels them from the theme contract", async () => {
    const bytes = await archive({
      "pet/theme.json": JSON.stringify({ states: { idle: ["idle.webp"], thinking: ["thinking.webp"] }, reactions: {} }),
      "pet/assets/idle.webp": Uint8Array.from([1, 2, 3]),
      "pet/assets/thinking.webp": Uint8Array.from([4, 5, 6]),
    });
    const result = await parseGeneratedPreview(bytes, "clawd");
    expect(result.target).toBe("clawd");
    if (result.target === "clawd") {
      expect(result.assets.map(({ id, label }) => [id, label])).toEqual([["idle.webp", "idle"], ["thinking.webp", "thinking"]]);
      expect("bytes" in result.assets[0]).toBe(false);
      await expect(readGeneratedPreviewAsset(result.archive, result.assets[1].path)).resolves.toEqual(Uint8Array.from([4, 5, 6]));
    }
  });

  it("opens the final Codex spritesheet using the generated atlas rows", async () => {
    const bytes = await archive({ "pet.json": JSON.stringify(codexManifest()), "spritesheet.webp": Uint8Array.from([7, 8, 9]) });
    const result = await parseGeneratedPreview(bytes, "codex-pet");
    expect(result.target).toBe("codex-pet");
    if (result.target === "codex-pet") {
      expect(result.rows).toHaveLength(9);
      expect(result.rows[1]).toEqual({ id: "running-right", row: 1, frameCount: 8 });
      expect(result.spritesheet).toEqual(Uint8Array.from([7, 8, 9]));
    }
  });

  it("rejects unsafe paths and malformed target packages", async () => {
    expect(isSafeArchivePath("../escape.webp")).toBe(false);
    expect(isSafeArchivePath("pet/assets/idle.webp")).toBe(true);
    const bytes = await archive({ "pet/theme.json": "{}", "pet/README.md": "missing generated assets" });
    await expect(parseGeneratedPreview(bytes, "clawd")).rejects.toThrow(/does not contain generated WebP assets/i);
  });

  it("revokes generated image URLs when the preview leaves the page", async () => {
    const bytes = await archive({ "pet.json": JSON.stringify(codexManifest()), "spritesheet.webp": Uint8Array.from([7, 8, 9]) });
    vi.mocked(readCompleteBuildArtifact).mockResolvedValue(bytes);
    const view = render(<GeneratedPreview artifact={{ artifactId: "artifact-1", target: "codex-pet", filename: "pet.zip", byteLength: bytes.byteLength }} locale="en" />);
    const canvas = await screen.findByRole("img", { name: /idle generated preview/i });
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas).not.toHaveAttribute("style");
    await waitFor(() => expect(vi.mocked(HTMLCanvasElement.prototype.getContext).mock.results[0]?.value?.drawImage).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    view.unmount();
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview"));
  });

  it("contains preview failures without removing package actions from BuildView", async () => {
    vi.mocked(readCompleteBuildArtifact).mockRejectedValue(new Error("broken package"));
    render(<GeneratedPreview artifact={{ artifactId: "artifact-2", target: "clawd", filename: "theme.zip", byteLength: 10 }} locale="en" />);
    expect(await screen.findByText(/download and install are still available/i)).toBeVisible();
    expect(screen.getByText(/invalid or incomplete/i)).toBeVisible();
  });
});
