const { redactMessage } = require('./preview-session-service.cjs');

class HostedBuildError extends Error {
  constructor(code, message) {
    super(redactMessage(message));
    this.name = 'HostedBuildError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new HostedBuildError(code, message);
}

function hasCapturedInput(target, input = {}) {
  if (input.renderer) return true;
  if (target === 'clawd') return Boolean(input.framesByMotion || input.frames);
  return Boolean(input.candidatesByRow || input.candidates);
}

function normalizeIdentity(project) {
  if (!project || typeof project !== 'object') fail('HOSTED_BUILD_PROJECT_REQUIRED', 'A Live2Pet Project is required for hosted renderer capture.');
  const projectId = typeof project.projectId === 'string' ? project.projectId.trim() : '';
  const sourceFingerprint = typeof project.source?.fingerprint === 'string' ? project.source.fingerprint.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9._-]{0,95}$/i.test(projectId)) fail('HOSTED_BUILD_PROJECT_REQUIRED', 'The project has no valid projectId for renderer capture.');
  if (!/^[a-f0-9]{64}$/.test(sourceFingerprint)) fail('HOSTED_BUILD_SOURCE_REQUIRED', 'The project has no valid Source Package fingerprint for renderer capture.');
  return { projectId, sourceFingerprint };
}

function createHostedBuildService({ previewSession, buildProject, captureBounds = { x: 0, y: 0, width: 768, height: 768 } } = {}) {
  if (!previewSession || typeof previewSession.withRenderer !== 'function') fail('INVALID_HOSTED_BUILD_SERVICE', 'Hosted builds require a preview session renderer provider.');
  if (typeof buildProject !== 'function') fail('INVALID_HOSTED_BUILD_SERVICE', 'Hosted builds require a buildProject function.');
  let captureQueue = Promise.resolve();

  const runCaptured = (operation) => {
    const result = captureQueue.then(operation, operation);
    captureQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return async function hostedBuild(input = {}) {
    const targets = Array.isArray(input.targets) && input.targets.length ? [...new Set(input.targets)] : ['clawd', 'codex-pet'];
    const inputsByTarget = { ...(input.inputsByTarget || {}) };
    const missingRendererTargets = targets.filter((target) => !hasCapturedInput(target, inputsByTarget[target]));
    if (!missingRendererTargets.length) return buildProject(input);
    const identity = normalizeIdentity(input.project);
    return runCaptured(async () => {
      try {
        return await previewSession.withRenderer({ ...identity, bounds: captureBounds }, async (renderer) => {
          const hostedInputs = { ...inputsByTarget };
          for (const target of missingRendererTargets) hostedInputs[target] = { ...(hostedInputs[target] || {}), renderer };
          return buildProject({ ...input, inputsByTarget: hostedInputs });
        });
      } catch (error) {
        if (error instanceof HostedBuildError) throw error;
        throw new HostedBuildError(error?.code || 'HOSTED_BUILD_FAILED', error?.message || error);
      }
    });
  };
}

module.exports = { HostedBuildError, createHostedBuildService, hasCapturedInput };
