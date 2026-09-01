const { deflateSync, inflateSync } = require('node:zlib');

const CAPTURE_CACHE_SCHEMA_VERSION = 1;
const CAPTURE_CACHE_COMPRESSION = 'deflate-stack-v1';
const MAX_CAPTURE_CACHE_HEADER_BYTES = 1024 * 1024;
const MAX_CAPTURE_CACHE_FRAMES = 4096;
const MAX_CAPTURE_CACHE_CHUNKS = 512;
const MAX_CAPTURE_CACHE_DIMENSION = 4096;
const MAX_CAPTURE_CACHE_FRAME_BYTES = 64 * 1024 * 1024;
const MAX_CAPTURE_CACHE_CHUNK_BYTES = 64 * 1024 * 1024;
const MAX_CAPTURE_CACHE_BYTES = 1024 * 1024 * 1024;

class CaptureCacheError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CaptureCacheError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new CaptureCacheError(code, message, details);
}

function normalizeBytes(value, label) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  fail('INVALID_CAPTURE_CACHE', `${label} must be a byte buffer.`);
}

function normalizeFrameMetadata(frame, index, motionId) {
  if (!frame || typeof frame !== 'object' || !Number.isInteger(frame.width) || frame.width < 1 || frame.width > MAX_CAPTURE_CACHE_DIMENSION || !Number.isInteger(frame.height) || frame.height < 1 || frame.height > MAX_CAPTURE_CACHE_DIMENSION) {
    fail('INVALID_CAPTURE_CACHE', `Frame ${index} must declare positive dimensions.`);
  }
  const frameBytes = frame.width * frame.height * 4;
  if (!Number.isSafeInteger(frameBytes) || frameBytes > MAX_CAPTURE_CACHE_FRAME_BYTES) fail('INVALID_CAPTURE_CACHE', `Frame ${index} exceeds the ${MAX_CAPTURE_CACHE_FRAME_BYTES}-byte RGBA limit.`);
  const id = typeof frame.id === 'string' && frame.id.trim() ? frame.id.trim() : `${motionId}#${index}`;
  return {
    id,
    width: frame.width,
    height: frame.height,
    ...(Number.isInteger(frame.sourceIndex) ? { sourceIndex: frame.sourceIndex } : {}),
    ...(Number.isFinite(frame.time) ? { time: frame.time } : {}),
    ...(frame.bounds === null || (frame.bounds && typeof frame.bounds === 'object') ? { bounds: frame.bounds } : {}),
    ...(Number.isFinite(frame.visualChange) ? { visualChange: frame.visualChange } : {}),
    ...(Number.isFinite(frame.boundsDelta) ? { boundsDelta: frame.boundsDelta } : {}),
  };
}

function normalizeFrameList(frames, motionId) {
  if (!Array.isArray(frames) || !frames.length || frames.length > MAX_CAPTURE_CACHE_FRAMES) fail('INVALID_CAPTURE_CACHE', `Capture cache requires between 1 and ${MAX_CAPTURE_CACHE_FRAMES} frames.`);
  const seen = new Set();
  return frames.map((frame, index) => {
    const metadata = normalizeFrameMetadata(frame, index, motionId);
    if (seen.has(metadata.id)) fail('INVALID_CAPTURE_CACHE', `Capture cache contains duplicate frame id: ${metadata.id}`);
    seen.add(metadata.id);
    return metadata;
  });
}

function normalizeChunkList(chunks, frames) {
  if (!Array.isArray(chunks) || !chunks.length || chunks.length > MAX_CAPTURE_CACHE_CHUNKS) fail('INVALID_CAPTURE_CACHE', `Capture cache requires between 1 and ${MAX_CAPTURE_CACHE_CHUNKS} chunks.`);
  const normalized = [];
  let nextFrame = 0;
  let width = null;
  let height = null;
  for (const [index, chunk] of chunks.entries()) {
    if (!chunk || typeof chunk !== 'object' || !Number.isSafeInteger(chunk.startFrame) || chunk.startFrame !== nextFrame || !Number.isSafeInteger(chunk.frameCount) || chunk.frameCount < 1 || chunk.startFrame + chunk.frameCount > frames.length) {
      fail('INVALID_CAPTURE_CACHE', `Capture cache chunk ${index} is not contiguous with the frame list.`);
    }
    if (chunk.compression !== CAPTURE_CACHE_COMPRESSION) fail('INVALID_CAPTURE_CACHE', `Capture cache chunk ${index} uses unsupported compression.`);
    const chunkWidth = Number.isInteger(chunk.width) ? chunk.width : frames[chunk.startFrame].width;
    const chunkHeight = Number.isInteger(chunk.height) ? chunk.height : frames[chunk.startFrame].height;
    const frameBytes = chunkWidth * chunkHeight * 4;
    if (!Number.isSafeInteger(frameBytes) || chunkWidth < 1 || chunkWidth > MAX_CAPTURE_CACHE_DIMENSION || chunkHeight < 1 || chunkHeight > MAX_CAPTURE_CACHE_DIMENSION || frameBytes > MAX_CAPTURE_CACHE_FRAME_BYTES || frameBytes * chunk.frameCount > MAX_CAPTURE_CACHE_CHUNK_BYTES) fail('INVALID_CAPTURE_CACHE', `Capture cache chunk ${index} dimensions exceed the bounded RGBA limit.`);
    if (width === null) { width = chunkWidth; height = chunkHeight; }
    const chunkFrames = frames.slice(chunk.startFrame, chunk.startFrame + chunk.frameCount);
    if (chunkWidth !== width || chunkHeight !== height || chunkFrames.some((frame) => frame.width !== chunkWidth || frame.height !== chunkHeight)) fail('INVALID_CAPTURE_CACHE', `Capture cache chunk ${index} dimensions do not match the frame list.`);
    const bytes = normalizeBytes(chunk.rgbaDeflate, `Capture cache chunk ${index}.rgbaDeflate`);
    if (!bytes.length || bytes.length > MAX_CAPTURE_CACHE_CHUNK_BYTES) fail('INVALID_CAPTURE_CACHE', `Capture cache chunk ${index} exceeds the compressed byte limit.`);
    normalized.push({ startFrame: chunk.startFrame, frameCount: chunk.frameCount, width: chunkWidth, height: chunkHeight, bytes });
    nextFrame += chunk.frameCount;
  }
  if (nextFrame !== frames.length) fail('INVALID_CAPTURE_CACHE', `Capture cache chunks contain ${nextFrame} frames; expected ${frames.length}.`);
  return normalized;
}

function encodeCaptureSet({ motionId, frames, rgbaChunks, fps, delay, loop = 0, quality = 80, alphaQuality = 100, lossless = false, expressionId = null } = {}) {
  if (typeof motionId !== 'string' || !motionId.trim()) fail('INVALID_CAPTURE_CACHE', 'Capture cache requires a Motion id.');
  const normalizedFrames = normalizeFrameList(frames, motionId.trim());
  let chunks;
  if (rgbaChunks !== undefined) {
    chunks = normalizeChunkList(rgbaChunks, normalizedFrames);
  } else {
    const raw = frames.map((frame, index) => {
      const bytes = normalizeBytes(frame && frame.rgba, `Frame ${index}.rgba`);
      const expected = frame.width * frame.height * 4;
      if (bytes.byteLength !== expected) fail('INVALID_CAPTURE_CACHE', `Frame ${index} RGBA length does not match its dimensions.`);
      return bytes;
    });
    const first = normalizedFrames[0];
    if (normalizedFrames.some((frame) => frame.width !== first.width || frame.height !== first.height)) fail('INVALID_CAPTURE_CACHE', 'Capture cache frames must share one width and height.');
    const compressed = deflateSync(Buffer.concat(raw));
    chunks = [{ startFrame: 0, frameCount: normalizedFrames.length, width: first.width, height: first.height, bytes: compressed }];
  }
  const metadata = {
    schemaVersion: CAPTURE_CACHE_SCHEMA_VERSION,
    compression: CAPTURE_CACHE_COMPRESSION,
    motionId: motionId.trim(),
    expressionId: expressionId || null,
    frames: normalizedFrames,
    chunks: chunks.map((chunk, index) => ({ startFrame: chunk.startFrame, frameCount: chunk.frameCount, width: chunk.width, height: chunk.height, offset: index === 0 ? 0 : undefined, length: chunk.bytes.byteLength })),
    ...(Number.isFinite(fps) && fps > 0 ? { fps } : {}),
    ...(Array.isArray(delay) ? { delay: [...delay] } : Number.isFinite(delay) ? { delay } : {}),
    loop,
    quality,
    alphaQuality,
    lossless: Boolean(lossless),
  };
  let offset = 0;
  metadata.chunks.forEach((chunk) => { chunk.offset = offset; offset += chunk.length; });
  if (!Number.isSafeInteger(offset) || offset > MAX_CAPTURE_CACHE_BYTES) fail('CAPTURE_CACHE_TOO_LARGE', 'Capture cache payload exceeds the 1 GiB limit.', { byteLength: offset });
  const header = Buffer.from(JSON.stringify(metadata), 'utf8');
  if (header.byteLength > MAX_CAPTURE_CACHE_HEADER_BYTES) fail('INVALID_CAPTURE_CACHE', 'Capture cache metadata exceeds the 1 MiB limit.');
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(header.byteLength, 0);
  return Buffer.concat([prefix, header, ...chunks.map((chunk) => chunk.bytes)]);
}

function decodeCaptureSet(value, { inflate = true } = {}) {
  const bytes = normalizeBytes(value, 'Capture cache bytes');
  if (bytes.byteLength < 4) fail('INVALID_CAPTURE_CACHE', 'Capture cache bytes are truncated before the header.');
  const headerLength = bytes.readUInt32LE(0);
  if (!headerLength || headerLength > MAX_CAPTURE_CACHE_HEADER_BYTES || headerLength + 4 > bytes.byteLength) fail('INVALID_CAPTURE_CACHE', 'Capture cache header length is invalid.');
  let metadata;
  try { metadata = JSON.parse(bytes.toString('utf8', 4, 4 + headerLength)); }
  catch (error) { fail('INVALID_CAPTURE_CACHE', 'Capture cache header is not valid JSON.', { cause: String(error && error.message ? error.message : error) }); }
  if (!metadata || metadata.schemaVersion !== CAPTURE_CACHE_SCHEMA_VERSION || metadata.compression !== CAPTURE_CACHE_COMPRESSION || typeof metadata.motionId !== 'string' || !Array.isArray(metadata.frames) || !Array.isArray(metadata.chunks)) fail('INVALID_CAPTURE_CACHE', 'Capture cache header does not match the supported schema.');
  const frames = normalizeFrameList(metadata.frames, metadata.motionId);
  if (metadata.chunks.length > MAX_CAPTURE_CACHE_CHUNKS) fail('INVALID_CAPTURE_CACHE', `Capture cache contains more than ${MAX_CAPTURE_CACHE_CHUNKS} chunks.`);
  const payloadStart = 4 + headerLength;
  const payloadLength = bytes.byteLength - payloadStart;
  let nextOffset = 0;
  const chunkInputs = metadata.chunks.map((chunk, index) => {
    if (!chunk || typeof chunk !== 'object' || !Number.isSafeInteger(chunk.offset) || chunk.offset !== nextOffset || !Number.isSafeInteger(chunk.length) || chunk.length < 1 || chunk.length > MAX_CAPTURE_CACHE_CHUNK_BYTES || chunk.offset + chunk.length > payloadLength) {
      fail('INVALID_CAPTURE_CACHE', `Capture cache chunk ${index} has an invalid payload range.`);
    }
    nextOffset += chunk.length;
    return { ...chunk, rgbaDeflate: bytes.subarray(payloadStart + chunk.offset, payloadStart + chunk.offset + chunk.length), compression: metadata.compression };
  });
  if (nextOffset !== payloadLength) fail('INVALID_CAPTURE_CACHE', 'Capture cache payload contains trailing or missing bytes.');
  const chunks = normalizeChunkList(chunkInputs, frames);
  const common = {
    motionId: metadata.motionId,
    expressionId: metadata.expressionId || null,
    frames,
    ...(metadata.fps === undefined ? {} : { fps: metadata.fps }),
    ...(metadata.delay === undefined ? {} : { delay: metadata.delay }),
    loop: metadata.loop,
    quality: metadata.quality,
    alphaQuality: metadata.alphaQuality,
    lossless: metadata.lossless,
  };
  if (!inflate) {
    return {
      ...common,
      rgbaChunks: chunks.map((chunk) => ({
        startFrame: chunk.startFrame,
        frameCount: chunk.frameCount,
        width: chunk.width,
        height: chunk.height,
        rgbaDeflate: chunk.bytes,
        compression: metadata.compression,
      })),
    };
  }
  const decodedFrames = [];
  for (const chunk of chunks) {
    let raw;
    const expected = chunk.width * chunk.height * 4 * chunk.frameCount;
    try { raw = inflateSync(chunk.bytes, { maxOutputLength: expected }); } catch (error) { fail('INVALID_CAPTURE_CACHE', 'Capture cache chunk could not be decompressed within its declared size.', { cause: String(error && error.message ? error.message : error) }); }
    if (raw.byteLength !== expected) fail('INVALID_CAPTURE_CACHE', 'Capture cache chunk decompressed to an unexpected size.', { expectedBytes: expected, actualBytes: raw.byteLength });
    for (let index = 0; index < chunk.frameCount; index += 1) {
      const frameIndex = chunk.startFrame + index;
      const metadataFrame = frames[frameIndex];
      const frameBytes = chunk.width * chunk.height * 4;
      decodedFrames[frameIndex] = { ...metadataFrame, rgba: Uint8Array.from(raw.subarray(index * frameBytes, (index + 1) * frameBytes)) };
    }
  }
  return { ...common, frames: decodedFrames };
}

module.exports = {
  CAPTURE_CACHE_COMPRESSION,
  CAPTURE_CACHE_SCHEMA_VERSION,
  CaptureCacheError,
  MAX_CAPTURE_CACHE_BYTES,
  MAX_CAPTURE_CACHE_CHUNK_BYTES,
  MAX_CAPTURE_CACHE_DIMENSION,
  MAX_CAPTURE_CACHE_FRAME_BYTES,
  MAX_CAPTURE_CACHE_FRAMES,
  decodeCaptureSet,
  encodeCaptureSet,
};
