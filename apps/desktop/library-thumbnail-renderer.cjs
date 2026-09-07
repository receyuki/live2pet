const sharp = require('sharp');
const fs = require('node:fs');
const path = require('node:path');
const { inspectSourcePackage } = require('@live2pet/source-inspector');
const { createPreviewSessionService } = require('./preview-session-service.cjs');

function createLibraryThumbnailRenderer(options) {
  return async (candidate) => {
    if (fs.statSync(candidate.inputPath).isDirectory()) {
      const root = fs.realpathSync(candidate.inputPath);
      for (const name of ['preview.png', 'cover.png', 'thumbnail.png', 'preview.jpg', 'cover.jpg']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        const real = fs.realpathSync(file);
        if (!real.startsWith(`${root}${path.sep}`) || fs.statSync(real).size > 8 * 1024 * 1024) continue;
        try {
          const png = await sharp(real, { limitInputPixels: 16 * 1024 * 1024 }).resize(256, 256, { fit: 'inside' }).png().toBuffer();
          return { dataUrl: `data:image/png;base64,${png.toString('base64')}` };
        } catch { /* A bad cover must not prevent rendering the actual model. */ }
      }
    }
    const manifest = inspectSourcePackage(candidate.inputPath, { modelConfig: candidate.modelConfig });
    const session = createPreviewSessionService({
      ...options,
      resolveSource: () => ({ inputPath: candidate.inputPath, manifest, sourceFingerprint: manifest.source.fingerprint }),
    });
    try {
      return await session.withRenderer({ projectId: 'library-thumbnail', sourceFingerprint: manifest.source.fingerprint, bounds: { x: 0, y: 0, width: 256, height: 256 } }, async (renderer) => {
        const motion = (typeof renderer.getMotions === 'function' ? renderer.getMotions() : manifest.motions)[0];
        if (!motion) return { dataUrl: null };
        const frame = await renderer.captureRgba({ width: 256, height: 256, motionId: motion.id, time: Math.min(0.1, motion.duration || 0) });
        const png = await sharp(Buffer.from(frame.rgba), { raw: { width: frame.width, height: frame.height, channels: 4 } }).png().toBuffer();
        return { dataUrl: `data:image/png;base64,${png.toString('base64')}` };
      });
    } finally { await session.close(); }
  };
}

module.exports = { createLibraryThumbnailRenderer };
