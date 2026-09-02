import { getBuildArtifact, type BuildArtifact } from "./app-host";

export async function readCompleteBuildArtifact(artifactId: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  let expectedLength: number | null = null;
  for (;;) {
    const chunk = await getBuildArtifact(artifactId, offset);
    if (chunk.artifactId !== artifactId || chunk.offset !== offset || chunk.nextOffset < offset || chunk.nextOffset - offset !== chunk.bytes.byteLength) throw new Error("The build artifact transfer was inconsistent.");
    expectedLength ??= chunk.byteLength;
    if (chunk.byteLength !== expectedLength || chunk.nextOffset > expectedLength) throw new Error("The build artifact size changed during transfer.");
    chunks.push(chunk.bytes);
    offset = chunk.nextOffset;
    if (chunk.done) break;
    if (chunk.nextOffset === chunk.offset) throw new Error("The build artifact transfer stopped before completion.");
  }
  if (offset !== expectedLength) throw new Error("The build artifact transfer ended early.");
  const bytes = new Uint8Array(offset);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
  return bytes;
}

export async function downloadBuildArtifact(artifact: BuildArtifact): Promise<void> {
  const bytes = await readCompleteBuildArtifact(artifact.artifactId);
  const blob = new Blob([Uint8Array.from(bytes).buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
