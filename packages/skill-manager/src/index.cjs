const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SKILL_ID = 'live2pet';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const MAX_FILE_COUNT = 128;
const REQUIRED_FILES = Object.freeze(['SKILL.md', 'agents/openai.yaml']);
const ALLOWED_ROOTS = Object.freeze(['SKILL.md', 'agents', 'references', 'scripts']);

class SkillManagerError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SkillManagerError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new SkillManagerError(code, message, details);
}

function requireDirectory(directory, label) {
  if (typeof directory !== 'string' || !directory.trim()) fail('SKILL_PATH_REQUIRED', `${label} is required.`);
  const absolute = path.resolve(directory);
  let stat;
  try { stat = fs.lstatSync(absolute); } catch (error) { fail(error.code === 'ENOENT' ? 'SKILL_NOT_FOUND' : 'SKILL_READ_FAILED', `${label} could not be read.`, { cause: error.code || 'UNKNOWN' }); }
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('SKILL_SOURCE_INVALID', `${label} must be a real directory.`);
  return absolute;
}

function safeRelativeName(relative) {
  return relative && !relative.startsWith('/') && !relative.includes('\\') && !relative.includes('\0') && path.posix.normalize(relative) === relative && relative !== '.' && relative !== '..' && !relative.startsWith('../');
}

function isAllowedFile(relative) {
  return ALLOWED_ROOTS.some((root) => relative === root || relative.startsWith(`${root}/`));
}

function collectFiles(root) {
  const files = [];
  let totalBytes = 0;
  function visit(directory, prefix = '') {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch (error) { fail('SKILL_READ_FAILED', 'The skill bundle could not be enumerated.', { cause: error.code || 'UNKNOWN' }); }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeRelativeName(relative)) fail('SKILL_FILE_UNSAFE', `Skill bundle contains an unsafe path: ${relative}`);
      if (entry.isSymbolicLink()) fail('SKILL_SYMLINK_UNSUPPORTED', `Skill bundle cannot contain symlinks: ${relative}`);
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!isAllowedFile(`${relative}/placeholder`)) fail('SKILL_FILE_UNSUPPORTED', `Skill bundle contains an unsupported directory: ${relative}`);
        visit(full, relative);
        continue;
      }
      if (!entry.isFile()) fail('SKILL_FILE_UNSUPPORTED', `Skill bundle contains a non-regular file: ${relative}`);
      if (!isAllowedFile(relative)) fail('SKILL_FILE_UNSUPPORTED', `Skill bundle file is outside the allowed skill surface: ${relative}`);
      const content = fs.readFileSync(full);
      if (content.byteLength > MAX_FILE_BYTES) fail('SKILL_FILE_TOO_LARGE', `Skill bundle file exceeds ${MAX_FILE_BYTES} bytes: ${relative}`);
      if (content.includes(0)) fail('SKILL_BINARY_UNSUPPORTED', `Skill bundle file must be text: ${relative}`);
      totalBytes += content.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) fail('SKILL_TOO_LARGE', `Skill bundle exceeds ${MAX_TOTAL_BYTES} bytes.`);
      files.push({ name: relative, bytes: content });
      if (files.length > MAX_FILE_COUNT) fail('SKILL_FILE_COUNT_LIMIT', `Skill bundle contains more than ${MAX_FILE_COUNT} files.`);
    }
  }
  visit(root);
  files.sort((left, right) => left.name.localeCompare(right.name));
  return { files, totalBytes };
}

function validateManifest(files) {
  const byName = new Map(files.map((file) => [file.name, file.bytes]));
  for (const required of REQUIRED_FILES) if (!byName.has(required)) fail('SKILL_FILE_MISSING', `Skill bundle is missing ${required}.`);
  const skillText = byName.get('SKILL.md').toString('utf8');
  const frontmatter = skillText.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter || !/^name:\s*live2pet\s*$/m.test(frontmatter[1])) fail('SKILL_MANIFEST_INVALID', 'SKILL.md must declare name: live2pet in its frontmatter.');
  if (!/^description:\s*\S.+$/m.test(frontmatter[1])) fail('SKILL_MANIFEST_INVALID', 'SKILL.md must declare a non-empty description.');
}

function digestFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) hash.update(file.name).update('\0').update(file.bytes).update('\0');
  return hash.digest('hex');
}

function readSkillBundle(sourceDir) {
  const root = requireDirectory(sourceDir, 'Skill source directory');
  const collected = collectFiles(root);
  validateManifest(collected.files);
  return { root, files: collected.files, byteLength: collected.totalBytes, sha256: digestFiles(collected.files) };
}

function resolveSkillInstallRoot({ targetRoot, homeDir = os.homedir(), env = process.env } = {}) {
  const configured = targetRoot === undefined || targetRoot === null ? (env.LIVE2PET_SKILLS_ROOT || null) : targetRoot;
  if (configured !== null) {
    if (typeof configured !== 'string' || !configured.trim() || !path.isAbsolute(configured.trim())) fail('INVALID_SKILL_TARGET_ROOT', 'Skill target root must be an absolute directory path.');
    const skillsRoot = path.resolve(configured.trim());
    return { skillId: SKILL_ID, skillsRoot, path: path.join(skillsRoot, SKILL_ID), source: targetRoot == null ? 'environment' : 'explicit' };
  }
  if (typeof homeDir !== 'string' || !homeDir.trim() || !path.isAbsolute(homeDir.trim())) fail('INVALID_HOME_DIRECTORY', 'homeDir must be an absolute path.');
  const codexHome = env.CODEX_HOME === undefined ? path.join(path.resolve(homeDir), '.codex') : env.CODEX_HOME;
  if (typeof codexHome !== 'string' || !codexHome.trim() || !path.isAbsolute(codexHome.trim())) fail('INVALID_CODEX_HOME', 'CODEX_HOME must be an absolute path.');
  const skillsRoot = path.join(path.resolve(codexHome), 'skills');
  return { skillId: SKILL_ID, skillsRoot, path: path.join(skillsRoot, SKILL_ID), source: 'default' };
}

function inspectInstalled(root) {
  if (!fs.existsSync(root)) return { exists: false, valid: false, files: [], byteLength: 0, sha256: null };
  try {
    const bundle = readSkillBundle(root);
    return { exists: true, valid: true, files: bundle.files.map((file) => file.name), byteLength: bundle.byteLength, sha256: bundle.sha256 };
  } catch (error) {
    if (!(error instanceof SkillManagerError)) throw error;
    return { exists: true, valid: false, files: [], byteLength: 0, sha256: null, error: { code: error.code, message: error.message } };
  }
}

function getSkillStatus({ sourceDir, targetRoot, homeDir, env } = {}) {
  const destination = resolveSkillInstallRoot({ targetRoot, homeDir, env });
  const source = sourceDir === undefined ? null : (() => {
    try {
      const bundle = readSkillBundle(sourceDir);
      return { available: true, valid: true, path: bundle.root, files: bundle.files.map((file) => file.name), byteLength: bundle.byteLength, sha256: bundle.sha256 };
    } catch (error) {
      if (!(error instanceof SkillManagerError)) throw error;
      return { available: false, valid: false, path: path.resolve(sourceDir), error: { code: error.code, message: error.message } };
    }
  })();
  const installed = inspectInstalled(destination.path);
  return { skillId: SKILL_ID, path: destination.path, source, installed, upToDate: Boolean(source?.valid && installed.valid && source.sha256 === installed.sha256) };
}

function progress(onProgress, stage, status, details = {}) {
  if (typeof onProgress === 'function') onProgress({ stage, status, ...details });
}

function copyBundle(stage, files) {
  for (const file of files) {
    const destination = path.join(stage, ...file.name.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.writeFileSync(destination, file.bytes, { flag: 'wx', mode: 0o600 });
  }
}

function installSkill({ sourceDir, targetRoot, homeDir, env, confirmInstall = false, overwrite = false, onProgress, beforeCommit } = {}) {
  if (confirmInstall !== true) fail('INSTALL_AUTHORIZATION_REQUIRED', 'Skill installation requires explicit user authorization via confirmInstall: true.');
  const source = readSkillBundle(sourceDir);
  const destination = resolveSkillInstallRoot({ targetRoot, homeDir, env });
  fs.mkdirSync(destination.skillsRoot, { recursive: true, mode: 0o700 });
  if (fs.existsSync(destination.path) && !overwrite) fail('SKILL_EXISTS', 'The Live2Pet skill is already installed; use overwrite only after explicit authorization.');
  if (fs.existsSync(destination.path) && !fs.statSync(destination.path).isDirectory()) fail('SKILL_DESTINATION_INVALID', 'The existing Live2Pet skill path is not a directory.');
  const stage = path.join(destination.skillsRoot, `.live2pet-skill-stage-${crypto.randomUUID()}`);
  const backup = fs.existsSync(destination.path) ? path.join(destination.skillsRoot, `.live2pet-skill-backup-${crypto.randomUUID()}`) : null;
  progress(onProgress, 'stage', 'started', { skillId: SKILL_ID });
  try {
    fs.mkdirSync(stage, { recursive: true, mode: 0o700 });
    copyBundle(stage, source.files);
    const staged = readSkillBundle(stage);
    if (staged.sha256 !== source.sha256) fail('SKILL_VERIFY_FAILED', 'The staged skill bundle did not match its source.');
    progress(onProgress, 'stage', 'completed', { skillId: SKILL_ID, files: source.files.length });
    if (backup) fs.renameSync(destination.path, backup);
    if (typeof beforeCommit === 'function') beforeCommit({ phase: 'before-commit', destination: destination.path });
    progress(onProgress, 'commit', 'started', { skillId: SKILL_ID, upgraded: Boolean(backup) });
    fs.renameSync(stage, destination.path);
    if (backup) fs.rmSync(backup, { recursive: true, force: true });
    progress(onProgress, 'commit', 'completed', { skillId: SKILL_ID, upgraded: Boolean(backup) });
    return { skillId: SKILL_ID, path: destination.path, files: source.files.map((file) => file.name), byteLength: source.byteLength, sha256: source.sha256, upgraded: Boolean(backup) };
  } catch (error) {
    try { if (fs.existsSync(destination.path) && backup) fs.rmSync(destination.path, { recursive: true, force: true }); } catch {}
    try { if (backup && fs.existsSync(backup) && !fs.existsSync(destination.path)) fs.renameSync(backup, destination.path); } catch {}
    try { if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true }); } catch {}
    if (error instanceof SkillManagerError) throw error;
    fail('SKILL_INSTALL_FAILED', 'The Live2Pet skill could not be installed.', { cause: error.code || String(error.message || error) });
  }
}

module.exports = {
  ALLOWED_ROOTS,
  MAX_FILE_BYTES,
  MAX_FILE_COUNT,
  MAX_TOTAL_BYTES,
  REQUIRED_FILES,
  SKILL_ID,
  SkillManagerError,
  getSkillStatus,
  installSkill,
  readSkillBundle,
  resolveSkillInstallRoot,
};
