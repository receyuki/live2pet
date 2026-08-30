const ASSET_CACHE_SCHEMA_VERSION = 1;
const MAX_ASSET_CACHE_HEADER_BYTES = 64 * 1024;

class AssetCacheError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'AssetCacheError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new AssetCacheError(code, message, details);
}

function normalizeBytes(value) {
  if (Buffer.isBuffer(value)) return Buffer.from(value);
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  fail('INVALID_ASSET_CACHE', 'Encoded asset bytes must be a byte buffer.');
}

function normalizeMetadata({ format, width, height, frameCount = 1, delays } = {}) {
  if (typeof format !== 'string' || !format.trim()) fail('INVALID_ASSET_CACHE', 'Encoded asset format is required.');
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) fail('INVALID_ASSET_CACHE', 'Encoded asset dimensions must be positive integers.');
  if (!Number.isInteger(frameCount) || frameCount < 1 || frameCount > 4096) fail('INVALID_ASSET_CACHE', 'Encoded asset frameCount must be between 1 and 4096.');
  const normalizedDelays = delays == null ? Array(frameCount).fill(100) : delays;
  if (!Array.isArray(normalizedDelays) || normalizedDelays.length !== frameCount || normalizedDelays.some((delay) => !Number.isInteger(delay) || delay < 1 || delay > 60000)) fail('INVALID_ASSET_CACHE', 'Encoded asset delays must contain one valid millisecond value per frame.');
  return { format: format.trim().toLowerCase(), width, height, frameCount, delays: [...normalizedDelays] };
}

function encodeAsset({ format, width, height, frameCount = 1, delays, bytes } = {}) {
  const payload = normalizeBytes(bytes);
  if (!payload.length) fail('INVALID_ASSET_CACHE', 'Encoded asset bytes cannot be empty.');
  const metadata = normalizeMetadata({ format, width, height, frameCount, delays });
  const header = Buffer.from(JSON.stringify({ schemaVersion: ASSET_CACHE_SCHEMA_VERSION, ...metadata }), 'utf8');
  if (header.byteLength > MAX_ASSET_CACHE_HEADER_BYTES) fail('INVALID_ASSET_CACHE', 'Encoded asset cache metadata exceeds the 64 KiB limit.');
  const prefix = Buffer.allocUnsafe(4);
  prefix.writeUInt32LE(header.byteLength, 0);
  return Buffer.concat([prefix, header, payload]);
}

function decodeAsset(value) {
  const bytes = normalizeBytes(value);
  if (bytes.byteLength < 5) fail('INVALID_ASSET_CACHE', 'Encoded asset cache bytes are truncated before the header.');
  const headerLength = bytes.readUInt32LE(0);
  if (!headerLength || headerLength > MAX_ASSET_CACHE_HEADER_BYTES || 4 + headerLength >= bytes.byteLength) fail('INVALID_ASSET_CACHE', 'Encoded asset cache header length is invalid.');
  let header;
  try { header = JSON.parse(bytes.toString('utf8', 4, 4 + headerLength)); } catch (error) { fail('INVALID_ASSET_CACHE', 'Encoded asset cache header is not valid JSON.', { cause: String(error.message || error) }); }
  if (!header || header.schemaVersion !== ASSET_CACHE_SCHEMA_VERSION) fail('INVALID_ASSET_CACHE', 'Encoded asset cache header does not match the supported schema.');
  const metadata = normalizeMetadata(header);
  const payload = Buffer.from(bytes.subarray(4 + headerLength));
  if (!payload.length) fail('INVALID_ASSET_CACHE', 'Encoded asset cache payload is empty.');
  return { ...metadata, bytes: payload };
}

module.exports = {
  ASSET_CACHE_SCHEMA_VERSION,
  AssetCacheError,
  decodeAsset,
  encodeAsset,
};
