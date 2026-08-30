const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  SkillManagerError,
  getSkillStatus,
  installSkill,
  readSkillBundle,
  resolveSkillInstallRoot,
} = require('../src/index.cjs');

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'live2pet-skill-')); }

function writeSkill(root, description = 'A test skill.') {
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'SKILL.md'), `---\nname: live2pet\ndescription: ${description}\n---\n\n# Live2Pet\n`);
  fs.writeFileSync(path.join(root, 'agents', 'openai.yaml'), 'interface:\n  display_name: Live2Pet\n');
}

test('validates and hashes the repository skill bundle', () => {
  const root = path.resolve(__dirname, '../../../skills/live2pet');
  const bundle = readSkillBundle(root);
  assert.deepEqual(bundle.files.map((file) => file.name), ['agents/openai.yaml', 'SKILL.md']);
  assert.equal(bundle.sha256.length, 64);
  assert.ok(bundle.byteLength > 0);
});

test('resolves the Codex skill root from an explicit parent or CODEX_HOME', () => {
  assert.deepEqual(resolveSkillInstallRoot({ targetRoot: '/tmp/codex-skills' }), {
    skillId: 'live2pet', skillsRoot: '/tmp/codex-skills', path: '/tmp/codex-skills/live2pet', source: 'explicit',
  });
  assert.deepEqual(resolveSkillInstallRoot({ homeDir: '/Users/demo', env: { CODEX_HOME: '/srv/codex' } }), {
    skillId: 'live2pet', skillsRoot: '/srv/codex/skills', path: '/srv/codex/skills/live2pet', source: 'default',
  });
});

test('requires explicit authorization and does not create the target root', () => {
  const root = tempDir();
  const source = path.join(root, 'source');
  const target = path.join(root, 'codex', 'skills');
  writeSkill(source);
  assert.throws(() => installSkill({ sourceDir: source, targetRoot: target }), (error) => error instanceof SkillManagerError && error.code === 'INSTALL_AUTHORIZATION_REQUIRED');
  assert.equal(fs.existsSync(target), false);
});

test('installs, reports, and atomically upgrades the skill bundle', () => {
  const root = tempDir();
  const source = path.join(root, 'source');
  const target = path.join(root, 'codex', 'skills');
  writeSkill(source, 'first version.');
  const first = installSkill({ sourceDir: source, targetRoot: target, confirmInstall: true });
  assert.equal(first.upgraded, false);
  const initial = getSkillStatus({ sourceDir: source, targetRoot: target });
  assert.equal(initial.upToDate, true);
  writeSkill(source, 'second version.');
  const upgraded = installSkill({ sourceDir: source, targetRoot: target, confirmInstall: true, overwrite: true });
  assert.equal(upgraded.upgraded, true);
  assert.equal(getSkillStatus({ sourceDir: source, targetRoot: target }).upToDate, true);
});

test('restores the previous skill when an upgrade commit fails', () => {
  const root = tempDir();
  const source = path.join(root, 'source');
  const target = path.join(root, 'codex', 'skills');
  writeSkill(source, 'stable.');
  installSkill({ sourceDir: source, targetRoot: target, confirmInstall: true });
  writeSkill(source, 'broken upgrade.');
  assert.throws(() => installSkill({ sourceDir: source, targetRoot: target, confirmInstall: true, overwrite: true, beforeCommit: () => { throw new Error('simulated failure'); } }), (error) => error instanceof SkillManagerError && error.code === 'SKILL_INSTALL_FAILED' && error.details.cause === 'simulated failure');
  assert.match(fs.readFileSync(path.join(target, 'live2pet', 'SKILL.md'), 'utf8'), /stable/);
  assert.deepEqual(fs.readdirSync(target), ['live2pet']);
});

test('rejects symlinks and files outside the text-only skill surface', () => {
  const root = tempDir();
  const symlinkSource = path.join(root, 'symlink');
  fs.mkdirSync(symlinkSource);
  fs.symlinkSync(path.join(root, 'missing'), path.join(symlinkSource, 'SKILL.md'));
  assert.throws(() => readSkillBundle(symlinkSource), (error) => error instanceof SkillManagerError && error.code === 'SKILL_SYMLINK_UNSUPPORTED');

  const binarySource = path.join(root, 'binary');
  writeSkill(binarySource);
  fs.mkdirSync(path.join(binarySource, 'examples'));
  fs.writeFileSync(path.join(binarySource, 'examples', 'model.pck'), Buffer.from([0, 1, 2]));
  assert.throws(() => readSkillBundle(binarySource), (error) => error instanceof SkillManagerError && error.code === 'SKILL_FILE_UNSUPPORTED');
});
