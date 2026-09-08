const RELEASES_API = 'https://api.github.com/repos/receyuki/live2pet/releases/latest';
const RELEASES_BASE = 'https://github.com/receyuki/live2pet/releases/tag/';
const MAX_RESPONSE_BYTES = 256 * 1024;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function updateError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function parseVersion(value) {
  const normalized = typeof value === 'string' ? value.trim().replace(/^v/, '') : '';
  const match = SEMVER.exec(normalized);
  if (!match) throw updateError('INVALID_UPDATE_VERSION', `Unsupported release version: ${String(value)}`);
  return { version: normalized, numbers: match.slice(1).map(Number) };
}

function compareVersions(left, right) {
  const a = parseVersion(left).numbers;
  const b = parseVersion(right).numbers;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function createUpdateService({ currentVersion, fetchImpl = globalThis.fetch, openExternal, timeoutMs = 8000 } = {}) {
  const current = parseVersion(currentVersion).version;
  if (typeof fetchImpl !== 'function') throw updateError('INVALID_UPDATE_SERVICE', 'An HTTPS fetch implementation is required.');
  if (typeof openExternal !== 'function') throw updateError('INVALID_UPDATE_SERVICE', 'An external-link handler is required.');

  const check = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(RELEASES_API, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Live2Pet/${current}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: controller.signal,
      });
    } catch (cause) {
      throw updateError('UPDATE_CHECK_FAILED', cause && cause.name === 'AbortError' ? 'The update check timed out.' : 'Live2Pet could not reach GitHub Releases.');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 404) return { schemaVersion: 1, state: 'no-release', currentVersion: current };
    if (!response.ok) throw updateError('UPDATE_CHECK_FAILED', `GitHub Releases returned HTTP ${response.status}.`);
    const length = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) throw updateError('UPDATE_RESPONSE_INVALID', 'The update response is unexpectedly large.');
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw updateError('UPDATE_RESPONSE_INVALID', 'The update response is unexpectedly large.');
    let release;
    try { release = JSON.parse(text); } catch { throw updateError('UPDATE_RESPONSE_INVALID', 'GitHub returned invalid release metadata.'); }
    if (!release || release.draft === true || release.prerelease === true || typeof release.tag_name !== 'string') throw updateError('UPDATE_RESPONSE_INVALID', 'GitHub returned unsupported release metadata.');
    const latestVersion = parseVersion(release.tag_name).version;
    const state = compareVersions(latestVersion, current) > 0 ? 'available' : 'up-to-date';
    return {
      schemaVersion: 1,
      state,
      currentVersion: current,
      latestVersion,
      releaseUrl: `${RELEASES_BASE}v${latestVersion}`,
    };
  };

  const open = async (version) => {
    const target = parseVersion(version).version;
    await openExternal(`${RELEASES_BASE}v${target}`);
    return { opened: true };
  };

  return Object.freeze({ check, open });
}

module.exports = {
  RELEASES_API,
  compareVersions,
  createUpdateService,
  parseVersion,
};
