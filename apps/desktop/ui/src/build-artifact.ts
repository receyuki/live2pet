import { getBuildArtifact, saveBuildArtifact, type BuildArtifact, type SaveArtifactResult } from "./app-host";

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

export function downloadBuildArtifact(artifact: BuildArtifact): Promise<SaveArtifactResult> {
  return saveBuildArtifact(artifact.artifactId);
}
