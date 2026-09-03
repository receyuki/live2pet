import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildView, targetReadiness } from "./BuildView";
import { chooseInstallRoot, installArtifact } from "./app-host";
import { downloadBuildArtifact } from "./build-artifact";
import { initialBuildState } from "./build-state";
import type { Live2PetProject, SourceInspection } from "./app-host";

vi.mock("./app-host", async (importOriginal) => ({ ...(await importOriginal<typeof import("./app-host")>()), hasBuildApi: () => true, chooseInstallRoot: vi.fn(), installArtifact: vi.fn() }));
vi.mock("./build-artifact", () => ({ downloadBuildArtifact: vi.fn() }));
vi.mock("./generated-preview", () => ({ GeneratedPreview: () => <div>generated preview</div> }));

const inspection = { schemaVersion: 1, source: { kind: "pck", name: "Pet", fingerprint: "fixture", modelConfig: "model.json" }, model: { cubism: 2, configFile: "model.json", modelFile: "model.moc", textures: [] }, motions: [], expressions: [], resources: [], warnings: [] } satisfies SourceInspection;
const project = {
  schemaVersion: 1, projectId: "pet", appVersion: "0.1.0", name: "Pet", source: { kind: "pck", name: "Pet", fingerprint: "fixture" }, recipes: [],
  targets: {
    clawd: { profile: "clawd", mappings: { idle: "motion:a", thinking: "motion:a", working: "motion:a", sleeping: "fallback:idle" }, reactions: {}, options: {} },
    "codex-pet": { profile: "codex-pet", mappings: Object.fromEntries(["idle", "running-right", "running-left", "waving", "jumping", "failed", "waiting", "running", "review"].map((slot) => [slot, "motion:a"])), reactions: {}, options: {} },
  },
} satisfies Live2PetProject;

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(downloadBuildArtifact).mockReset().mockResolvedValue();
  vi.mocked(chooseInstallRoot).mockReset().mockResolvedValue({ target: "clawd", cancelled: false, locationId: "location-12345678", label: "selected-folder" });
  vi.mocked(installArtifact).mockReset().mockResolvedValue({ target: "clawd", files: [], path: "<selected-install-root>" });
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

it('exposes the durable package name and blocks builds for an empty name', async () => {
  const onName = vi.fn();
  render(<BuildView locale="en" project={project} inspection={inspection} runtimeReady state={initialBuildState()} onName={onName} onBuild={vi.fn()} onCancel={vi.fn()} onPreset={vi.fn()} />);
  await userEvent.setup().type(screen.getByRole('textbox', { name: /Pet \/ theme name/ }), 'A');
  expect(onName).toHaveBeenCalledWith('PetA');
  expect(targetReadiness({ ...project, name: '' }, inspection, true, 'clawd').ready).toBe(false);
});

describe("BuildView", () => {
  it('explains a queued target without marking the other idle target as building', () => {
    const state = initialBuildState();
    state['codex-pet'] = { ...state['codex-pet'], status: 'building', stage: 'queue', buildId: 'queued-build' };
    render(<BuildView locale="en" project={project} inspection={inspection} runtimeReady state={state} onPreset={vi.fn()} onBuild={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Queued', { exact: true })).toBeVisible();
    expect(screen.getByText(/Waiting for another build to release the shared renderer/)).toBeVisible();
    expect(screen.getByText('Not built', { exact: true })).toBeVisible();
  });
  it("computes readiness independently from shared target profiles", () => {
    expect(targetReadiness(project, inspection, true, "clawd")).toEqual({ ready: true, missing: [] });
    const incomplete = { ...project, targets: { ...project.targets, "codex-pet": { ...project.targets["codex-pet"], mappings: {} } } };
    expect(targetReadiness(incomplete, inspection, true, "codex-pet").ready).toBe(false);
    expect(targetReadiness(project, inspection, true, "clawd").ready).toBe(true);
    expect(targetReadiness(project, inspection, false, "clawd").missing).toContain("matching Cubism runtime");
    expect(targetReadiness({ ...project, sourceReview: { required: true, affectedRecipeIds: [] } }, inspection, true, "clawd").missing).toContain("source review");
    const fullSleep = { ...project, targets: { ...project.targets, clawd: { ...project.targets.clawd, options: { sleepMode: "full" } } } };
    expect(targetReadiness(fullSleep, inspection, true, "clawd").missing).toEqual(expect.arrayContaining(["yawning", "dozing", "collapsing", "waking"]));
  });

  it("keeps Download separate from confirmed installation and supports an opaque folder choice", async () => {
    const user = userEvent.setup();
    const state = initialBuildState();
    state.clawd = { ...state.clawd, status: "succeeded", progress: 100, artifact: { artifactId: "artifact-1", target: "clawd", filename: "clawd.zip", byteLength: 3 }, summary: { target: "clawd", validation: { ok: true }, preview: { ready: true } } };
    render(<BuildView locale="en" project={project} inspection={inspection} runtimeReady state={state} onPreset={vi.fn()} onBuild={vi.fn()} onCancel={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Download Clawd Theme Package" }));
    expect(downloadBuildArtifact).toHaveBeenCalledOnce();
    expect(installArtifact).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Choose folder Clawd Theme Package" }));
    await user.click(screen.getByRole("button", { name: "Install Clawd Theme Package" }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(installArtifact).toHaveBeenCalledWith({ artifactId: "artifact-1", target: "clawd", conflict: "cancel", confirmInstall: true, locationId: "location-12345678" });
  });
});
