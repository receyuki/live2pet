#!/usr/bin/env node

const crypto = require('node:crypto');
const { inspectSourcePackage, SourceInspectionError } = require('../src/index.cjs');

function parseArgs(argv) {
  const options = { pretty: false };
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--input') {
      options.input = argv[index + 1];
      index += 1;
    } else if (argument === '--pretty') {
      options.pretty = true;
    } else if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else {
      throw new SourceInspectionError('UNKNOWN_ARGUMENT', `Unknown argument: ${argument}`);
    }
  }
  return options;
}

function print(value, pretty) {
  process.stdout.write(`${JSON.stringify(value, null, pretty ? 2 : 0)}\n`);
}

function main() {
  const operationId = crypto.randomUUID();
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      print({ usage: 'live2pet-inspect --input <source-directory-or-pck> [--pretty]' }, true);
      return;
    }
    if (!options.input) throw new SourceInspectionError('INPUT_REQUIRED', 'Usage: live2pet-inspect --input <source-directory-or-pck>');
    const result = inspectSourcePackage(options.input);
    print({
      protocolVersion: 1,
      operationId,
      operation: 'inspect',
      ok: true,
      progress: [{ stage: 'inspect', status: 'completed' }],
      warnings: result.warnings,
      result,
    }, options.pretty);
  } catch (error) {
    const normalized = error instanceof SourceInspectionError
      ? error
      : new SourceInspectionError('INSPECTION_FAILED', error.message || String(error));
    print({
      protocolVersion: 1,
      operationId,
      operation: 'inspect',
      ok: false,
      progress: [{ stage: 'inspect', status: 'failed' }],
      warnings: [],
      error: { code: normalized.code, message: normalized.message, details: normalized.details },
    }, false);
    process.exitCode = 1;
  }
}

main();
