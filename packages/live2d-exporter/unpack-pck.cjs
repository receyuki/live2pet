#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === '--pck') options.pck = value, index += 1;
    else if (arg === '--output') options.output = value, index += 1;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.pck || !options.output) {
    throw new Error('Usage: unpack-pck.cjs --pck /path/model.pck --output /path/model');
  }
  return options;
}

function bytesMatch(bytes, signature) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function entryType(bytes) {
  if (bytesMatch(bytes, [0x23, 0x20, 0x4c, 0x69, 0x76, 0x65, 0x32, 0x44])) return 'motion';
  if (bytesMatch(bytes, [0x6d, 0x6f, 0x63])) return 'model';
  if (bytesMatch(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'texture';
  if (bytes[0] === 0x7b) return 'json';
  return 'unknown';
}

function safeOutput(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const base = `${path.resolve(root)}${path.sep}`;
  if (!target.startsWith(base)) throw new Error(`Unsafe PCK path: ${relativePath}`);
  return target;
}

function writeResource(root, relativePath, data) {
  const target = safeOutput(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}

function main() {
  const options = parseArgs(process.argv);
  const bytes = fs.readFileSync(options.pck);
  if (bytes.length < 12 || !bytesMatch(bytes, [0x50, 0x43, 0x4b, 0x00])) {
    throw new Error('Not a supported Live2D PCK file (missing PCK\\0 header)');
  }

  const version = bytes.readFloatLE(4);
  const count = bytes.readUInt32LE(8);
  const recordSize = 25;
  const headerSize = 12 + count * recordSize;
  if (!count || count > 4096 || headerSize > bytes.length) throw new Error(`Invalid PCK table: ${count} entries`);

  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const base = 12 + index * recordSize;
    const flags = bytes.readUInt8(base + 8);
    const offset = bytes.readUInt32LE(base + 9);
    const storedSize = bytes.readUInt32LE(base + 13);
    const originalSize = bytes.readUInt32LE(base + 17);
    if (offset < headerSize || storedSize > bytes.length || offset + storedSize > bytes.length) {
      throw new Error(`PCK entry ${index} is out of bounds`);
    }
    if (flags !== 0 || storedSize !== originalSize) {
      throw new Error(`Unsupported compression/encryption flag on PCK entry ${index}: ${flags}`);
    }
    const data = bytes.subarray(offset, offset + storedSize);
    entries.push({ index, data, type: entryType(data) });
  }

  const jsonEntries = entries.filter((entry) => entry.type === 'json');
  const jsonPayloads = jsonEntries.map((entry) => {
    try { return { entry, text: entry.data.toString('utf8') }; }
    catch { return { entry, text: null }; }
  });
  const modelJson = jsonPayloads.find((item) => item.text?.includes('"model"') && item.text?.includes('"motions"'));
  if (!modelJson) throw new Error('No Live2D model.json found in PCK');

  const settings = JSON.parse(modelJson.text);
  if (!settings.model || !Array.isArray(settings.textures) || !settings.motions) {
    throw new Error('Embedded JSON is not a complete Cubism 2 model configuration');
  }

  const modelEntries = entries.filter((entry) => entry.type === 'model');
  const textureEntries = entries.filter((entry) => entry.type === 'texture');
  const motionEntries = entries.filter((entry) => entry.type === 'motion');
  const motionDefinitions = Object.values(settings.motions).flat();
  const expressionDefinitions = Array.isArray(settings.expressions) ? settings.expressions.filter((entry) => entry?.file) : [];
  const extraJsonEntries = jsonEntries.filter((entry) => entry.index !== modelJson.entry.index);
  const binaryEntries = entries.filter((entry) => !['json', 'motion', 'texture'].includes(entry.type));
  const binaryRefs = [settings.model, settings.physics, settings.pose].filter(Boolean);

  if (modelEntries.length < 1) throw new Error('No Cubism 2 model binary found in PCK');
  if (textureEntries.length < settings.textures.length) throw new Error('PCK contains too few textures');
  if (motionEntries.length < motionDefinitions.length) throw new Error('PCK contains too few motions');
  if (extraJsonEntries.length < expressionDefinitions.length) throw new Error('PCK contains too few expressions');
  if (binaryEntries.length < binaryRefs.length) throw new Error('PCK contains too few model-side binary resources');

  fs.mkdirSync(options.output, { recursive: true });
  writeResource(options.output, 'model.json', modelJson.entry.data);
  binaryRefs.forEach((name, index) => writeResource(options.output, name, binaryEntries[index].data));
  settings.textures.forEach((name, index) => writeResource(options.output, name, textureEntries[index].data));
  motionDefinitions.forEach((definition, index) => writeResource(options.output, definition.file, motionEntries[index].data));
  expressionDefinitions.forEach((definition, index) => writeResource(options.output, definition.file, extraJsonEntries[index].data));

  const manifest = {
    source: path.resolve(options.pck),
    version,
    entryCount: count,
    model: 'model.json',
    resources: [
      ...binaryRefs,
      ...settings.textures,
      ...motionDefinitions.map((definition) => definition.file),
      ...expressionDefinitions.map((definition) => definition.file),
    ],
  };
  fs.writeFileSync(path.join(options.output, 'pck-unpack-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main();
