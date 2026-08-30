#!/usr/bin/env node
const { randomUUID } = require('node:crypto');
const { inspectRuntime, RuntimeValidationError } = require('../src/index.cjs');

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const input = argument('--input');
  if (!input || process.argv.includes('--help')) {
    process.stdout.write('Usage: live2pet-runtime --input /path/to/CubismCore.js-or-sdk-directory\n');
    if (!input) process.exitCode = 2;
    return;
  }
  const operationId = randomUUID();
  try {
    const result = await inspectRuntime(input);
    process.stdout.write(`${JSON.stringify({
      protocolVersion: 1,
      operation: 'runtime-diagnose',
      operationId,
      ok: true,
      progress: [{ stage: 'runtime-diagnose', status: 'completed' }],
      warnings: [],
      result,
    }, null, 2)}\n`);
  } catch (error) {
    const typed = error instanceof RuntimeValidationError;
    process.stdout.write(`${JSON.stringify({
      protocolVersion: 1,
      operation: 'runtime-diagnose',
      operationId,
      ok: false,
      progress: [{ stage: 'runtime-diagnose', status: 'failed' }],
      warnings: [],
      error: { code: typed ? error.code : 'RUNTIME_DIAGNOSE_FAILED', message: error.message },
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

main();
