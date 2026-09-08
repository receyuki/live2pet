const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function fail(message) {
  throw new Error(message);
}

function readProductVersion(root = repositoryRoot) {
  const manifestPath = path.join(root, 'apps', 'desktop', 'package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) {
    fail(`Invalid product version in ${path.relative(root, manifestPath)}.`);
  }
  return manifest.version;
}

function versionFromTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v') || !SEMVER.test(tag.slice(1))) {
    fail(`Release tag must use the form vX.Y.Z; received ${JSON.stringify(tag)}.`);
  }
  return tag.slice(1);
}

function extractChangelogEntry(changelog, version) {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[${escapedVersion}\\](?: - \\d{4}-\\d{2}-\\d{2})?\\s*$`, 'm');
  const match = heading.exec(changelog);
  if (!match) fail(`CHANGELOG.md does not contain a section for ${version}.`);
  const start = match.index + match[0].length;
  const remainder = changelog.slice(start);
  const nextHeading = /^## /m.exec(remainder);
  const entry = remainder.slice(0, nextHeading ? nextHeading.index : undefined).trim();
  if (!entry) fail(`CHANGELOG.md section ${version} is empty.`);
  return entry;
}

function releaseMetadata({ root = repositoryRoot, tag }) {
  const productVersion = readProductVersion(root);
  const tagVersion = versionFromTag(tag);
  if (tagVersion !== productVersion) {
    fail(`Release tag ${tag} does not match apps/desktop/package.json version ${productVersion}.`);
  }
  const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
  return {
    version: productVersion,
    title: `Live2Pet ${productVersion}`,
    notes: extractChangelogEntry(changelog, productVersion),
  };
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--tag') options.tag = argv[++index];
    else if (argument === '--notes-output') options.notesOutput = argv[++index];
    else fail(`Unknown release metadata option: ${argument}`);
  }
  if (!options.tag) fail('Pass the release tag with --tag vX.Y.Z.');
  return options;
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const metadata = releaseMetadata({ tag: options.tag });
    if (options.notesOutput) fs.writeFileSync(options.notesOutput, `${metadata.notes}\n`);
    process.stdout.write(`${JSON.stringify(metadata)}\n`);
  } catch (error) {
    process.stderr.write(`RELEASE_METADATA_INVALID: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  extractChangelogEntry,
  readProductVersion,
  releaseMetadata,
  versionFromTag,
};
