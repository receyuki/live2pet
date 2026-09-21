const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

async function runServiceScenarios({ installation, packageBuild, project, workspace }, root) {
  const installRoot = path.join(root, 'installed');
  const archive = await packageBuild.createCodexPetZip({ manifest: { id: 'synthetic-pet', displayName: 'Synthetic Pet', description: 'Acceptance fixture', spritesheetPath: 'spritesheet.webp' }, spritesheet: Uint8Array.from([1, 2, 3, 4]) });
  await installation.installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: installRoot });
  const installed = path.join(installRoot, 'synthetic-pet');
  const priorManifest = fs.readFileSync(path.join(installed, 'pet.json'));
  const priorPixels = fs.readFileSync(path.join(installed, 'spritesheet.webp'));
  await assert.rejects(installation.installPackage({ target: 'codex-pet', packageBytes: archive.buffer, targetRoot: installRoot, conflict: 'upgrade', beforeCommit() { throw new Error('synthetic commit failure'); } }), error => error.code === 'INSTALL_FAILED' && error.details.cause === 'synthetic commit failure');
  assert.deepEqual(fs.readFileSync(path.join(installed, 'pet.json')), priorManifest);
  assert.deepEqual(fs.readFileSync(path.join(installed, 'spritesheet.webp')), priorPixels);
  assert.deepEqual(fs.readdirSync(installRoot), ['synthetic-pet']);

  const sourcePath = path.join(root, 'source');
  fs.mkdirSync(sourcePath);
  const sourceBytes = Buffer.from('{"synthetic":true}\n');
  fs.writeFileSync(path.join(sourcePath, 'model.json'), sourceBytes);
  const document = project.createProject({ projectId: 'synthetic-project', name: 'Original', source: { kind: 'standard-directory', name: 'source', fingerprint: 'fixture', path: sourcePath, modelConfig: 'model.json' }, targets: {} });
  const projectPath = path.join(root, 'saved.l2p');
  let selected = { canceled: false, filePath: projectPath };
  const service = workspace.createProjectWorkspaceService({ stateFile: path.join(root, 'recent.json'), portableRoot: path.join(root, 'portable'), showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => selected });
  const saved = await service.saveProject({ project: document });
  await service.saveProject({ documentId: saved.documentId, project: { ...document, name: 'Replacement' } });
  assert.equal((await service.openProject({ inputPath: projectPath })).project.name, 'Replacement');
  const replacementBytes = fs.readFileSync(projectPath);
  selected = { canceled: true };
  const cancelled = await service.saveProject({ documentId: saved.documentId, project: { ...document, name: 'Cancelled' }, saveAs: true });
  assert.equal(cancelled.cancelled, true);
  assert.deepEqual(fs.readFileSync(projectPath), replacementBytes);

  const pendingDialogs = [];
  const concurrentService = workspace.createProjectWorkspaceService({ stateFile: path.join(root, 'concurrent-recent.json'), showOpenDialog: async () => ({ canceled: true }), showSaveDialog: () => new Promise(resolve => pendingDialogs.push(resolve)) });
  const snapshot = structuredClone(document);
  const expectedSnapshotPath = path.join(root, 'expected-snapshot.l2p');
  project.saveProjectFile(expectedSnapshotPath, snapshot);
  const pendingSnapshot = concurrentService.saveProject({ project: snapshot });
  assert.equal(pendingDialogs.length, 1);
  snapshot.name = 'Later caller edit';
  snapshot.source.name = 'Later source label';
  snapshot.visualSettings.hiddenElementIds.push('part:later-edit');
  const laterEdit = structuredClone(snapshot);
  const snapshotPath = path.join(root, 'snapshot.l2p');
  pendingDialogs.shift()({ canceled: false, filePath: snapshotPath });
  await pendingSnapshot;
  assert.deepEqual(fs.readFileSync(snapshotPath), fs.readFileSync(expectedSnapshotPath));
  assert.deepEqual(snapshot, laterEdit);

  const alpha = { ...structuredClone(document), projectId: 'concurrent-alpha', name: 'Concurrent Alpha' };
  const beta = { ...structuredClone(document), projectId: 'concurrent-beta', name: 'Concurrent Beta' };
  const alphaPath = path.join(root, 'alpha.l2p');
  const betaPath = path.join(root, 'beta.l2p');
  const expectedAlphaPath = path.join(root, 'expected-alpha.l2p');
  const expectedBetaPath = path.join(root, 'expected-beta.l2p');
  project.saveProjectFile(expectedAlphaPath, alpha);
  project.saveProjectFile(expectedBetaPath, beta);
  const alphaSave = concurrentService.saveProject({ project: alpha });
  const betaSave = concurrentService.saveProject({ project: beta });
  assert.equal(pendingDialogs.length, 2);
  pendingDialogs[1]({ canceled: false, filePath: betaPath });
  await betaSave;
  assert.equal(fs.existsSync(alphaPath), false);
  pendingDialogs[0]({ canceled: false, filePath: alphaPath });
  await alphaSave;
  assert.deepEqual(fs.readFileSync(alphaPath), fs.readFileSync(expectedAlphaPath));
  assert.deepEqual(fs.readFileSync(betaPath), fs.readFileSync(expectedBetaPath));

  const portablePath = path.join(root, 'saved.l2pack');
  selected = { canceled: false, filePath: portablePath };
  await service.saveProject({ project: document, portable: true });
  // Moving the synthetic source proves reopening uses the package contents.
  fs.renameSync(sourcePath, path.join(root, 'original-source'));
  const reopened = await service.openProject({ inputPath: portablePath });
  assert.equal(reopened.project.name, document.name);
  assert.deepEqual(fs.readFileSync(path.join(reopened.project.source.path, 'model.json')), sourceBytes);
  const recentBeforeReject = await service.getRecentProjects();
  const corruptPath = path.join(root, 'corrupt.l2pack');
  fs.writeFileSync(corruptPath, 'not a ZIP archive');
  await assert.rejects(service.openProject({ inputPath: corruptPath }));
  assert.deepEqual(await service.getRecentProjects(), recentBeforeReject);
  assert.deepEqual(fs.readFileSync(projectPath), replacementBytes);
  return { installRollback: true, projectReplacement: true, cancelledSavePreserved: true, saveSnapshotPreserved: true, concurrentSavesIsolated: true, portableReopen: true, portableReject: true };
}

async function acceptPackagedServices(asarPath) {
  if (!path.isAbsolute(asarPath || '') || path.basename(asarPath) !== 'app.asar') throw new Error('--asar must identify an absolute packaged app.asar path.');
  const requirePackaged = createRequire(path.join(asarPath, 'main.cjs'));
  const modules = {};
  for (const [key, specifier] of Object.entries({ installation: '@live2pet/installation', packageBuild: '@live2pet/package-build', project: '@live2pet/project', workspace: './project-workspace-service.cjs' })) {
    const resolved = requirePackaged.resolve(specifier);
    const relative = path.relative(asarPath, resolved);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error(`Acceptance module resolved outside the packaged ASAR: ${specifier}`);
    modules[key] = requirePackaged(specifier);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-packaged-services-'));
  try { return { contractVersion: 1, packagedModules: true, scenarios: await runServiceScenarios(modules, root) }; }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (args.length !== 2 || args[0] !== '--asar') throw new Error('Usage: accept-packaged-services.cjs --asar /absolute/path/app.asar');
    return acceptPackagedServices(args[1]);
  }).then(report => process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)).catch(error => {
    process.stderr.write(`PACKAGED_SERVICES_FAILED: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { acceptPackagedServices, runServiceScenarios };
