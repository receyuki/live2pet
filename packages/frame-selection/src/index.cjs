const MAX_CANDIDATES = 10000;

class FrameSelectionError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'FrameSelectionError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new FrameSelectionError(code, message, details);
}

function number(value, label, { min = 0, max = 1 } = {}) {
  const result = value == null ? 0 : Number(value);
  if (!Number.isFinite(result) || result < min || result > max) fail('INVALID_FRAME_CANDIDATE', `${label} must be a finite number between ${min} and ${max}.`);
  return result;
}

function normalizeBounds(bounds, label) {
  if (bounds == null) return null;
  if (!bounds || typeof bounds !== 'object') fail('INVALID_FRAME_CANDIDATE', `${label} bounds must be an object.`);
  return {
    x: number(bounds.x, `${label} bounds.x`, { min: -1, max: 2 }),
    y: number(bounds.y, `${label} bounds.y`, { min: -1, max: 2 }),
    width: number(bounds.width, `${label} bounds.width`, { min: 0, max: 2 }),
    height: number(bounds.height, `${label} bounds.height`, { min: 0, max: 2 }),
  };
}

function boundsDelta(previous, current) {
  if (!previous || !current) return 0;
  return Math.min(1, (
    Math.abs(previous.x - current.x)
    + Math.abs(previous.y - current.y)
    + Math.abs(previous.width - current.width)
    + Math.abs(previous.height - current.height)
  ) / 4);
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates) || !candidates.length) fail('NO_FRAME_CANDIDATES', 'At least one frame candidate is required.');
  if (candidates.length > MAX_CANDIDATES) fail('TOO_MANY_FRAME_CANDIDATES', `Frame candidates exceed the ${MAX_CANDIDATES}-frame limit.`);
  return candidates.map((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') fail('INVALID_FRAME_CANDIDATE', `Frame candidate ${index} must be an object.`);
    const time = Number(candidate.time);
    if (!Number.isFinite(time) || time < 0) fail('INVALID_FRAME_CANDIDATE', `Frame candidate ${index} time must be a non-negative finite number.`);
    const bounds = normalizeBounds(candidate.bounds, `Frame candidate ${index}`);
    return {
      ...candidate,
      index,
      id: typeof candidate.id === 'string' && candidate.id ? candidate.id : `frame-${index}`,
      time,
      bounds,
      visualChange: number(candidate.visualChange, `Frame candidate ${index} visualChange`),
      boundsDelta: candidate.boundsDelta == null ? 0 : number(candidate.boundsDelta, `Frame candidate ${index} boundsDelta`),
    };
  }).sort((left, right) => left.time - right.time || left.index - right.index);
}

function candidateChange(previous, current) {
  const visual = Math.max(previous.visualChange, current.visualChange);
  const geometry = Math.max(previous.boundsDelta, current.boundsDelta, boundsDelta(previous.bounds, current.bounds));
  return { visual, geometry, score: visual * 0.65 + geometry * 0.35 };
}

function dedupeCandidates(candidates, { visualThreshold = 0.01, boundsThreshold = 0.01 } = {}) {
  const normalized = normalizeCandidates(candidates);
  const visualLimit = number(visualThreshold, 'visualThreshold');
  const boundsLimit = number(boundsThreshold, 'boundsThreshold');
  if (normalized.length < 3) return normalized;
  const result = [normalized[0]];
  for (let index = 1; index < normalized.length - 1; index += 1) {
    const previous = result[result.length - 1];
    const current = normalized[index];
    const change = candidateChange(previous, current);
    if (change.visual <= visualLimit && change.geometry <= boundsLimit) continue;
    result.push(current);
  }
  result.push(normalized[normalized.length - 1]);
  return result;
}

function selectMotionFrames(candidates, requestedCount, options = {}) {
  const count = Number(requestedCount);
  if (!Number.isInteger(count) || count < 1 || count > 4096) fail('INVALID_FRAME_COUNT', 'requestedCount must be an integer between 1 and 4096.');
  const source = normalizeCandidates(candidates);
  const deduplicated = options.dedupe === false ? source : dedupeCandidates(candidates, options);
  // A target row has a fixed frame count. If aggressive de-duplication would
  // make that count impossible, keep the normalized source candidates so the
  // caller receives the required number rather than a silently short row.
  const normalized = deduplicated.length < count && source.length >= count ? source : deduplicated;
  if (count >= normalized.length) return { requestedCount: count, candidateCount: candidates.length, deduplicatedCount: normalized.length, frames: normalized, indices: normalized.map((frame) => frame.index) };
  if (count === 1) return { requestedCount: count, candidateCount: candidates.length, deduplicatedCount: normalized.length, frames: [normalized[0]], indices: [normalized[0].index] };
  if (count === 2) {
    const frames = [normalized[0], normalized[normalized.length - 1]];
    return { requestedCount: count, candidateCount: candidates.length, deduplicatedCount: normalized.length, frames, indices: frames.map((frame) => frame.index) };
  }
  const selected = new Set([0, normalized.length - 1]);
  while (selected.size < count) {
    let bestIndex = -1;
    let bestScore = -Infinity;
    for (let index = 1; index < normalized.length - 1; index += 1) {
      if (selected.has(index)) continue;
      const frame = normalized[index];
      const previous = normalized[index - 1];
      const next = normalized[index + 1];
      const change = candidateChange(previous, frame);
      const nextChange = candidateChange(frame, next);
      const nearestDistance = Math.min(...[...selected].map((selectedIndex) => Math.abs(index - selectedIndex) / normalized.length));
      const temporalSpread = Math.min(0.1, nearestDistance);
      const score = Math.max(change.score, nextChange.score) + temporalSpread;
      if (score > bestScore || (score === bestScore && index < bestIndex)) {
        bestIndex = index;
        bestScore = score;
      }
    }
    if (bestIndex < 0) break;
    selected.add(bestIndex);
  }
  const frames = [...selected].sort((left, right) => left - right).map((index) => normalized[index]);
  return { requestedCount: count, candidateCount: candidates.length, deduplicatedCount: normalized.length, frames, indices: frames.map((frame) => frame.index) };
}

module.exports = {
  FrameSelectionError,
  MAX_CANDIDATES,
  boundsDelta,
  dedupeCandidates,
  selectMotionFrames,
};
