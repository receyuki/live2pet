import { cleanup, render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildView, targetReadiness } from "./BuildView";
import { chooseInstallRoot, installArtifact, getTargetInstallations, hasTargetInstallationApi } from "./app-host";
import { downloadBuildArtifact } from "./build-artifact";
import { initialBuildState } from "./build-state";
import type { Live2PetProject, SourceInspection } from "./app-host";

vi.mock("./app-host", async (importOriginal) => ({ ...(await importOriginal<typeof import("./app-host")>()), hasBuildApi: () => true, hasTargetInstallationApi: vi.fn(() => false), getTargetInstallations: vi.fn(), chooseInstallRoot: vi.fn(), installArtifact: vi.fn() }));
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
  vi.mocked(hasTargetInstallationApi).mockReturnValue(false);
  vi.mocked(getTargetInstallations).mockReset();
  vi.mocked(downloadBuildArtifact).mockReset().mockResolvedValue({ cancelled: false, path: '/output/pet.zip', filename: 'pet.zip', byteLength: 100 });
  vi.mocked(chooseInstallRoot).mockReset().mockResolvedValue({ target: "clawd", cancelled: false, locationId: "location-12345678", label: "selected-folder" });
  vi.mocked(installArtifact).mockReset().mockResolvedValue({ target: "clawd", files: [], path: "<selected-install-root>" });
  vi.spyOn(window, "confirm").mockReset().mockReturnValue(true);
});

it('exposes the durable package name and blocks builds for an empty name', async () => {
  const onName = vi.fn();
  render(<BuildView locale="en" project={project} inspection={inspection} runtimeReady state={initialBuildState()} onName={onName} onBuild={vi.fn()} onCancel={vi.fn()} onPreset={vi.fn()} />);
  await userEvent.setup().type(screen.getByRole('textbox', { name: /Pet \/ theme name/ }), 'A');
  expect(onName).toHaveBeenCalledWith('PetA');
  expect(targetReadiness({ ...project, name: '' }, inspection, true, 'clawd').ready).toBe(false);
});

it('confirms the detected saved destination and installs through its opaque handle', async () => {
  vi.mocked(hasTargetInstallationApi).mockReturnValue(true);
  vi.mocked(getTargetInstallations).mockResolvedValue({platform:'darwin',targets:[{target:'clawd',locationId:'saved-root-token',application:{status:'found',source:'auto'},root:{path:'/Users/test/custom-themes',source:'manual',state:'ready'}}]});
  const state = initialBuildState();
  state.clawd = {...state.clawd,status:'succeeded',progress:100,artifact:{artifactId:'artifact-1',target:'clawd',filename:'clawd.zip',byteLength:3},summary:{target:'clawd',validation:{ok:true},preview:{ready:true}}};
  render(<BuildView locale="en" project={project} inspection={inspection} runtimeReady state={state} onBuild={vi.fn()} onCancel={vi.fn()} onPreset={vi.fn()} />);
  await userEvent.setup().click(screen.getByRole('button',{name:'Install Clawd Theme Package'}));
  expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('/Users/test/custom-themes'));
  expect(installArtifact).toHaveBeenCalledWith({artifactId:'artifact-1',target:'clawd',conflict:'cancel',confirmInstall:true,locationId:'saved-root-token'});
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  vi.mocked(installArtifact).mockClear();
  await userEvent.setup().click(screen.getByRole('button',{name:'Install Clawd Theme Package'}));
  expect(installArtifact).not.toHaveBeenCalled();
});

describe("BuildView", () => {
  it('retains all three presets and starts custom controls from the selected preset', async () => {
    const onCustomRender = vi.fn(), onPreset = vi.fn();
    const document = { ...project, targets: { ...project.targets, clawd: { ...project.targets.clawd, renderPreset: 'compact' as const } } };
    const props = { locale: 'en' as const, project: document, inspection, runtimeReady: true, state: initialBuildState(), onPreset, onCustomRender, onBuild: vi.fn(), onCancel: vi.fn() };
    const { rerender, container } = render(<BuildView {...props} />);
    const group = screen.getByRole('group', { name: 'Clawd Theme Package Render preset' });
    for (const name of ['Compact', 'Balanced', 'High', 'Custom']) expect(within(group).getByRole('button', { name })).toBeEnabled();
    await userEvent.click(within(group).getByRole('button', { name: 'Custom' }));
    expect(onCustomRender).toHaveBeenCalledWith(expect.objectContaining({ width: 512, height: 512, fps: 18, quality: 76 }));
    const settings = { width: 512, height: 512, fps: 18, quality: 76 };
    rerender(<BuildView {...props} project={{ ...document, targets: { ...document.targets, clawd: { ...document.targets.clawd, options: { renderOverrides: settings } } } }} />);
    const disclosure = container.querySelector('details')!;
    expect(disclosure).not.toHaveAttribute('open');
    expect(screen.getByText('512 × 512 px · 18 FPS · WebP quality 76')).toBeVisible();
    await userEvent.click(disclosure.querySelector('summary')!);
    expect(disclosure).toHaveAttribute('open');
    fireEvent.change(screen.getByRole('slider', { name: 'Resolution' }), { target: { value: '384' } });
    expect(onCustomRender).toHaveBeenLastCalledWith({ ...settings, width: 384, height: 384 });
    fireEvent.change(screen.getByRole('slider', { name: 'Frame rate' }), { target: { value: '12' } });
    expect(onCustomRender).toHaveBeenLastCalledWith({ ...settings, fps: 12 });
    await userEvent.click(within(group).getByRole('button', { name: 'Balanced' }));
    expect(onPreset).toHaveBeenCalledWith('clawd', 'balanced');
    await userEvent.click(disclosure.querySelector('summary')!);
    expect(disclosure).not.toHaveAttribute('open');
  });

  it('warns in readable units while keeping oversized artifacts saveable', async () => {
    const state = initialBuildState();
    state.clawd = { ...state.clawd, status: 'succeeded', progress: 100, artifact: { artifactId: 'large', target: 'clawd', filename: 'large.zip', byteLength: 89207688 } };
    render(<BuildView locale="zh-CN" project={project} inspection={inspection} runtimeReady state={state} onPreset={vi.fn()} onBuild={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('85.1 MiB');
    expect(screen.getByRole('alert')).toHaveTextContent('80 MiB');
    const save = screen.getByRole('button', { name: '保存 ZIP Clawd 主题包' });
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(downloadBuildArtifact).toHaveBeenCalledWith(state.clawd.artifact);
  });
  it.each(['en', 'zh-CN'] as const)('keeps Codex format explanations collapsed and keyboard accessible (%s)', async (locale) => {
    const user = userEvent.setup();
    render(<BuildView locale={locale} project={project} inspection={inspection} runtimeReady state={initialBuildState()} onPreset={vi.fn()} onBuild={vi.fn()} onCancel={vi.fn()} />);
    const details = screen.getByText(/Codex V2/);
    expect(details).not.toBeVisible();
    const button = screen.getByRole('button', { name: locale === 'en' ? 'Format details' : '格式说明' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(details).toBeVisible();
    await user.keyboard('{Enter}');
    expect(details).not.toBeVisible();
  });
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

    await user.click(screen.getByRole("button", { name: "Save ZIP Clawd Theme Package" }));
    expect(downloadBuildArtifact).toHaveBeenCalledOnce();
    expect(installArtifact).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Choose folder Clawd Theme Package" }));
    await user.click(screen.getByRole("button", { name: "Install Clawd Theme Package" }));
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(installArtifact).toHaveBeenCalledWith({ artifactId: "artifact-1", target: "clawd", conflict: "cancel", confirmInstall: true, locationId: "location-12345678" });
  });
});
