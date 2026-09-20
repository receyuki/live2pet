#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const TEST_FILE_PATTERN = /\.test\.(?:cjs|js|mjs)$/;
const JAVASCRIPT_FILE_PATTERN = /\.(?:cjs|js|mjs)$/;
const SKIPPED_DIRECTORY_NAMES = new Set(['.git', 'node_modules', 'out', 'renderer-dist', 'renderer-vendor', 'mapper-dist']);
const REFERENCE_ONLY_PACKAGE_NAMES = new Set(['@live2pet/exporter']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function packageManifest(root, relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const manifestPath = path.join(directory, 'package.json');
  if (!fs.existsSync(manifestPath)) return null;
  return { directory, manifestPath, manifest: readJson(manifestPath) };
}

function walkFiles(directory, predicate, root = ROOT) {
  if (!fs.existsSync(directory)) return [];
  const result = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) continue;
      result.push(...walkFiles(file, predicate, root));
    } else if (entry.isFile() && predicate(file)) {
      result.push(path.resolve(file));
    }
  }
  return result;
}

function productionPackages(root = ROOT) {
  const packageRoot = path.join(root, 'packages');
  if (!fs.existsSync(packageRoot)) return [];
  return fs.readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !SKIPPED_DIRECTORY_NAMES.has(entry.name))
    .map((entry) => packageManifest(root, path.join('packages', entry.name)))
    .filter((entry) => entry && !REFERENCE_ONLY_PACKAGE_NAMES.has(entry.manifest.name) && typeof entry.manifest.scripts?.test === 'string')
    .sort((left, right) => String(left.manifest.name).localeCompare(String(right.manifest.name)));
}

function normalizeFiles(files, root = ROOT) {
  const resolved = files.map((file) => path.resolve(root, file));
  const missing = resolved.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) throw new Error(`Syntax check file does not exist: ${missing.map((file) => path.relative(root, file)).join(', ')}`);
  return [...new Set(resolved)];
}

function collectJavaScriptFiles({ root = ROOT, scope = 'all', files = null } = {}) {
  if (files) return normalizeFiles(files, root);
  if (!['all', 'desktop'].includes(scope)) throw new Error(`Unknown syntax scope: ${scope}`);

  const isJavaScript = (file) => JAVASCRIPT_FILE_PATTERN.test(file);
  const roots = [];
  if (scope === 'all') {
    roots.push(path.join(root, 'scripts'), path.join(root, 'test'));
    roots.push(...productionPackages(root).map((entry) => entry.directory));
  }
  roots.push(path.join(root, 'apps', 'desktop'));
  return [...new Set(roots.flatMap((directory) => walkFiles(directory, isJavaScript, root)))].sort((left, right) => left.localeCompare(right));
}

function discoverTestSuites(root = ROOT) {
  const suites = [];
  const workspaceTests = walkFiles(path.join(root, 'test'), (file) => TEST_FILE_PATTERN.test(file), root);
  if (workspaceTests.length > 0) {
    suites.push({
      id: 'workspace:node',
      packageName: 'workspace',
      name: 'workspace Node tests',
      kind: 'node',
      files: workspaceTests,
    });
  }

  const desktop = packageManifest(root, path.join('apps', 'desktop'));
  if (desktop) {
    const desktopTests = walkFiles(path.join(desktop.directory, 'test'), (file) => TEST_FILE_PATTERN.test(file), root);
    if (desktopTests.length > 0) {
      suites.push({
        id: `${desktop.manifest.name}:node`,
        packageName: desktop.manifest.name,
        name: `${desktop.manifest.name} Node tests`,
        kind: 'node',
        files: desktopTests,
      });
    }
    if (typeof desktop.manifest.scripts?.['test:ui'] === 'string') {
      suites.push({
        id: `${desktop.manifest.name}:ui`,
        packageName: desktop.manifest.name,
        name: `${desktop.manifest.name} UI tests`,
        kind: 'ui',
        command: ['--filter', desktop.manifest.name, 'test:ui'],
        files: [],
      });
    }
  }

  for (const entry of productionPackages(root)) {
    const files = walkFiles(path.join(entry.directory, 'test'), (file) => TEST_FILE_PATTERN.test(file), root);
    if (files.length === 0) continue;
    suites.push({
      id: `${entry.manifest.name}:node`,
      packageName: entry.manifest.name,
      name: `${entry.manifest.name} Node tests`,
      kind: 'node',
      files,
    });
  }
  return suites;
}

function relativeFiles(files, root = ROOT) {
  return files.map((file) => path.relative(root, file).split(path.sep).join('/'));
}

function reportTestSuites(suites, { output = process.stdout, root = ROOT } = {}) {
  const nodeSuites = suites.filter((suite) => suite.kind === 'node');
  const uiSuites = suites.filter((suite) => suite.kind === 'ui');
  output.write(`[workspace-checks] discovered ${suites.length} suites across ${new Set(suites.map((suite) => suite.packageName)).size} packages\n`);
  for (const suite of suites) {
    const files = suite.files.length > 0 ? ` (${suite.files.length} files)` : '';
    output.write(`  - ${suite.name}${files}\n`);
  }
  output.write(`[workspace-checks] ${nodeSuites.length} Node suite(s), ${uiSuites.length} UI suite(s) will run\n`);
  return { nodeSuites, uiSuites };
}

function runCommand(command, args, { cwd = ROOT, stdio = 'inherit' } = {}) {
  const result = spawnSync(command, args, { cwd, stdio, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result.status === null ? 1 : result.status;
}

function pnpmInvocation(environment = process.env) {
  const entrypoint = environment.npm_execpath;
  if (typeof entrypoint !== 'string' || !entrypoint.trim()) {
    const error = new Error('Run this command through pnpm so the workspace verification uses the locked package manager.');
    error.code = 'PNPM_REQUIRED';
    throw error;
  }
  return { command: process.execPath, prefix: [entrypoint] };
}

function runSyntaxCheck({ root = ROOT, scope = 'all', files = null, output = process.stdout, errorOutput = process.stderr } = {}) {
  const candidates = collectJavaScriptFiles({ root, scope, files });
  output.write(`[workspace-checks] JavaScript syntax check: ${candidates.length} CommonJS/JavaScript files\n`);
  const failures = [];
  for (const file of candidates) {
    const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
    if (result.status !== 0) {
      failures.push(file);
      errorOutput.write(`[workspace-checks] syntax check failed: ${path.relative(root, file)}\n`);
      if (result.stderr) errorOutput.write(result.stderr);
      if (result.stdout) errorOutput.write(result.stdout);
    }
  }
  if (failures.length > 0) {
    errorOutput.write(`[workspace-checks] ${failures.length} syntax file(s) failed\n`);
    return { files: candidates, failures, status: 1 };
  }
  output.write(`[workspace-checks] JavaScript syntax check passed (${candidates.length} files)\n`);
  return { files: candidates, failures: [], status: 0 };
}

function runWorkspaceTests({ root = ROOT, output = process.stdout, environment = process.env } = {}) {
  const suites = discoverTestSuites(root);
  const { nodeSuites, uiSuites } = reportTestSuites(suites, { output, root });
  const nodeFiles = nodeSuites.flatMap((suite) => suite.files);
  if (nodeFiles.length > 0) {
    output.write(`[workspace-checks] running Node suites: ${nodeSuites.map((suite) => suite.packageName).join(', ')}\n`);
    const status = runCommand(process.execPath, ['--test', ...nodeFiles], { cwd: root });
    if (status !== 0) return status;
  }
  const invocation = uiSuites.length > 0 ? pnpmInvocation(environment) : null;
  for (const suite of uiSuites) {
    output.write(`[workspace-checks] running UI suite: ${suite.packageName}\n`);
    const status = runCommand(invocation.command, [...invocation.prefix, ...suite.command], { cwd: root });
    if (status !== 0) return status;
  }
  return 0;
}

function runTypecheck({ root = ROOT, output = process.stdout, errorOutput = process.stderr, skipUi = false, environment = process.env } = {}) {
  const syntax = runSyntaxCheck({ root, scope: 'all', output, errorOutput });
  if (syntax.status !== 0 || skipUi) return syntax.status;
  output.write('[workspace-checks] UI TypeScript check (separate from CommonJS syntax checks)\n');
  const invocation = pnpmInvocation(environment);
  return runCommand(invocation.command, [...invocation.prefix, '--filter', '@live2pet/desktop', 'typecheck:ui'], { cwd: root });
}

function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  const options = { command, scope: 'all', files: null, skipUi: false };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--scope') options.scope = rest[++index];
    else if (arg === '--files') {
      options.files = [];
      while (index + 1 < rest.length && !rest[index + 1].startsWith('--')) options.files.push(rest[++index]);
    } else if (arg.startsWith('--files=')) options.files = arg.slice('--files='.length).split(',').filter(Boolean);
    else if (arg === '--skip-ui') options.skipUi = true;
    else if (arg.startsWith('--')) throw new Error(`Unknown option: ${arg}`);
    else {
      options.files ||= [];
      options.files.push(arg);
    }
  }
  return options;
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.command === 'syntax') return runSyntaxCheck({ scope: options.scope, files: options.files }).status;
  if (options.command === 'test' || options.command === 'tests') return runWorkspaceTests();
  if (options.command === 'typecheck') return runTypecheck({ skipUi: options.skipUi });
  process.stdout.write('Usage: node scripts/workspace-checks.cjs <syntax|test|typecheck> [--scope desktop] [--files file... ]\n');
  return options.command === 'help' ? 0 : 1;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`[workspace-checks] ${error.stack || error.message || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  collectJavaScriptFiles,
  discoverTestSuites,
  normalizeFiles,
  parseArgs,
  pnpmInvocation,
  reportTestSuites,
  runSyntaxCheck,
  runTypecheck,
  runWorkspaceTests,
  relativeFiles,
};
