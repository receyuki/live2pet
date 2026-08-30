#!/usr/bin/env node

const { run } = require('../src/index.cjs');

run().then((response) => {
  process.stdout.write(`${JSON.stringify(response, null, process.argv.includes('--pretty') ? 2 : 0)}\n`);
  if (!response.ok) process.exitCode = 1;
}).catch((error) => {
  process.stdout.write(`${JSON.stringify({ protocolVersion: 1, operation: 'unknown', operationId: null, ok: false, progress: [{ stage: 'cli', status: 'failed' }], warnings: [], error: { code: 'CLI_FATAL', message: error.message || String(error) } })}\n`);
  process.exitCode = 1;
});
