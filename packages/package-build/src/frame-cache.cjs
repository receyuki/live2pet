const FRAME_CACHE_SCHEMA_VERSION = 1;
const MAX_FRAME_CACHE_HEADER_BYTES = 1024 * 1024;

class FrameCacheError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FrameCacheError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FrameCacheError(code, message, details);
}

function normalizeRgba(frame, index) {
  if (!frame || !Number.isInteger(frame.width) || frame.width < 1 || !Number.isInteger(frame.height) || frame.height < 1 || !ArrayBuffer.isView(frame.rgba) || frame.rgba.byteLength !== frame.width * frame.height * 4) {
    fail('INVALID_FRAME_CACHE', `Frame ${index} does not contain a valid RGBA capture.`);
  }
  return Buffer.from(frame.rgba.buffer, frame.rgba.byteOffset, frame.rgba.byteLength);
}

function encodeFrameSet({ motionId, frames, fps, expressionId = null } = {}) {
  if (typeof motionId !== 'string' || !motionId.trim()) fail('INVALID_FRAME_CACHE', 'A Motion id is required for a frame cache entry.');
  if (!Array.isArray(frames) || !frames.length) fail('INVALID_FRAME_CACHE', 'A frame cache entry requires at least one frame.');
  if (!Number.isFinite(fps) || fps <= 0) fail('INVALID_FRAME_CACHE', 'A frame cache entry requires a positive fps value.');
  const captures = frames.map(normalizeRgba);
  let offset = 0;
  const metadata = frames.map((frame, index) => {
    const capture = captures[index];
    const result = {
      id: typeof frame.id === 'string' && frame.id ? frame.id : `${motionId}#${index}`,
      width: frame.width,
      height: frame.height,
      offset,
      length: capture.byteLength,
      ...(Number.isInteger(frame.sourceIndex) ? { sourceIndex: frame.sourceIndex } : {}),
      ...(Number.isFinite(frame.time) ? { time: frame.time } : {}),
      ...(frame.bounds === null || (frame.bounds && typeof frame.bounds === 'object') ? { bounds: frame.bounds } : {}),
      ...(Number.isFinite(frame.visualChange) ? { visualChange: frame.visualChange } : {}),
      ...(Number.isFinite(frame.boundsDelta) ? { boundsDelta: frame.boundsDelta } : {}),
    };
    offset += capture.byteLength;
    return result;
  });
  const header = Buffer.from(JSON.stringify({ schemaVersion: FRAME_CACHE_SCHEMA_VERSION, motionId, expressionId: expressionId || null, fps, frames: metadata }), 'utf8');
  if (header.byteLength > MAX_FRAME_CACHE_HEADER_BYTES) fail('INVALID_FRAME_CACHE', 'Frame cache metadata exceeds the 1 MiB limit.');
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(header.byteLength, 0);
  return Buffer.concat([prefix, header, ...captures]);
}

function decodeFrameSet(value) {
  if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) fail('INVALID_FRAME_CACHE', 'Frame cache bytes must be a byte buffer.');
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (bytes.byteLength < 4) fail('INVALID_FRAME_CACHE', 'Frame cache bytes are truncated before the header.');
  const headerLength = bytes.readUInt32LE(0);
  if (!headerLength || headerLength > MAX_FRAME_CACHE_HEADER_BYTES || 4 + headerLength > bytes.byteLength) fail('INVALID_FRAME_CACHE', 'Frame cache header length is invalid.');
  let header;
  try { header = JSON.parse(bytes.toString('utf8', 4, 4 + headerLength)); } catch (error) { fail('INVALID_FRAME_CACHE', 'Frame cache header is not valid JSON.', { cause: String(error.message || error) }); }
  if (!header || header.schemaVersion !== FRAME_CACHE_SCHEMA_VERSION || typeof header.motionId !== 'string' || !Array.isArray(header.frames) || !Number.isFinite(header.fps) || header.fps <= 0) fail('INVALID_FRAME_CACHE', 'Frame cache header does not match the supported schema.');
  const payloadOffset = 4 + headerLength;
  const seen = new Set();
  const frames = header.frames.map((metadata, index) => {
    if (!metadata || typeof metadata.id !== 'string' || !metadata.id || seen.has(metadata.id) || !Number.isInteger(metadata.width) || metadata.width < 1 || !Number.isInteger(metadata.height) || metadata.height < 1 || !Number.isInteger(metadata.offset) || metadata.offset < 0 || !Number.isInteger(metadata.length) || metadata.length !== metadata.width * metadata.height * 4 || metadata.offset + metadata.length > bytes.byteLength - payloadOffset) fail('INVALID_FRAME_CACHE', `Frame cache frame ${index} is invalid.`);
    seen.add(metadata.id);
    const frame = {
      id: metadata.id,
      width: metadata.width,
      height: metadata.height,
      rgba: Uint8Array.from(bytes.subarray(payloadOffset + metadata.offset, payloadOffset + metadata.offset + metadata.length)),
      ...(Number.isInteger(metadata.sourceIndex) ? { sourceIndex: metadata.sourceIndex } : {}),
      ...(Number.isFinite(metadata.time) ? { time: metadata.time } : {}),
      ...(metadata.bounds === null || (metadata.bounds && typeof metadata.bounds === 'object') ? { bounds: metadata.bounds } : {}),
      ...(Number.isFinite(metadata.visualChange) ? { visualChange: metadata.visualChange } : {}),
      ...(Number.isFinite(metadata.boundsDelta) ? { boundsDelta: metadata.boundsDelta } : {}),
    };
    return frame;
  });
  return { motionId: header.motionId, expressionId: header.expressionId || null, fps: header.fps, frames };
}

module.exports = {
  FRAME_CACHE_SCHEMA_VERSION,
  FrameCacheError,
  decodeFrameSet,
  encodeFrameSet,
};
