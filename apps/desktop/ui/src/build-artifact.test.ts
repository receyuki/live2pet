import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBuildArtifact } from "./app-host";
import { readCompleteBuildArtifact } from "./build-artifact";

vi.mock("./app-host", () => ({ getBuildArtifact: vi.fn() }));

describe("readCompleteBuildArtifact", () => {
  beforeEach(() => vi.mocked(getBuildArtifact).mockReset());

  it("requests every sequential chunk and assembles the complete ZIP", async () => {
    vi.mocked(getBuildArtifact)
      .mockResolvedValueOnce({ artifactId: "artifact", target: "clawd", filename: "pet.zip", byteLength: 5, offset: 0, nextOffset: 3, done: false, bytes: Uint8Array.from([1, 2, 3]) })
      .mockResolvedValueOnce({ artifactId: "artifact", target: "clawd", filename: "pet.zip", byteLength: 5, offset: 3, nextOffset: 5, done: true, bytes: Uint8Array.from([4, 5]) });
    await expect(readCompleteBuildArtifact("artifact")).resolves.toEqual(Uint8Array.from([1, 2, 3, 4, 5]));
    expect(vi.mocked(getBuildArtifact).mock.calls).toEqual([["artifact", 0], ["artifact", 3]]);
  });

  it("rejects a stale or malformed chunk sequence", async () => {
    vi.mocked(getBuildArtifact).mockResolvedValue({ artifactId: "artifact", target: "clawd", filename: "pet.zip", byteLength: 5, offset: 1, nextOffset: 3, done: false, bytes: Uint8Array.from([1, 2]) });
    await expect(readCompleteBuildArtifact("artifact")).rejects.toThrow("inconsistent");
  });
});
