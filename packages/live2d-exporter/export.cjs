#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');
const puppeteer = require('puppeteer');

function parseArgs(argv) {
  const options = {
    motion: 'idle.motion3.json',
    runtime: null,
    fps: 30,
    width: 1024,
    height: 1024,
    padding: 48,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--model') options.model = value, i += 1;
    else if (arg === '--output') options.output = value, i += 1;
    else if (arg === '--motion') options.motion = value, i += 1;
    else if (arg === '--runtime') options.runtime = value, i += 1;
    else if (arg === '--fps') options.fps = Number(value), i += 1;
    else if (arg === '--width') options.width = Number(value), i += 1;
    else if (arg === '--height') options.height = Number(value), i += 1;
    else if (arg === '--padding') options.padding = Number(value), i += 1;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.model || !options.output) {
    throw new Error('Usage: export.cjs --model /path/model3.json --output /path/frames [--motion idle.motion3.json] [--runtime /path/live2d.min.js]');
  }
  return options;
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.moc3': 'application/octet-stream',
    '.moc': 'application/octet-stream',
    '.dat': 'application/octet-stream',
    '.mtn': 'text/plain; charset=utf-8',
  }[ext] || 'application/octet-stream';
}

function safeFile(root, relativePath) {
  const target = path.resolve(root, relativePath);
  const base = path.resolve(root) + path.sep;
  if (target !== path.resolve(root) && !target.startsWith(base)) return null;
  return target;
}

function cubism2MotionDuration(text) {
  const fps = Number(text.match(/^\$fps\s*=\s*([\d.]+)/mi)?.[1]) || 30;
  let frameCount = 0;
  for (const line of text.split(/\r?\n|\r/)) {
    if (!line || line.startsWith('#') || line.startsWith('$')) continue;
    const separator = line.indexOf('=');
    if (separator < 0) continue;
    frameCount = Math.max(frameCount, line.slice(separator + 1).split(',').length);
  }
  return frameCount > 1 ? (frameCount - 1) / fps : null;
}

function viewerHtml(options, motionTarget, cubismVersion) {
  const runtimeScripts = cubismVersion === 2
    ? `<script src="/runtime/${encodeURIComponent(path.basename(options.runtime))}"></script>
  <script src="/pixi/pixi.min.js"></script>
  <script src="/pixi-live2d/cubism2.min.js"></script>`
    : `<script src="/vendor/live2dcubismcore.min.js"></script>
  <script src="/pixi/pixi.min.js"></script>
  <script src="/pixi-live2d/cubism4.min.js"></script>`;
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
    canvas { display: block; background: transparent; }
  </style>
</head>
<body>
  <canvas id="stage" width="${options.width}" height="${options.height}"></canvas>
  ${runtimeScripts}
  <script>
    window.exportReady = false;
    window.exportError = null;
    (async () => {
      try {
        const app = new PIXI.Application({
          view: document.getElementById('stage'),
          width: ${options.width},
          height: ${options.height},
          backgroundAlpha: 0,
          antialias: true,
          autoStart: false,
          sharedTicker: false,
          preserveDrawingBuffer: true,
        });
        app.stop();

        const model = await PIXI.live2d.Live2DModel.from('/model/${path.basename(options.model)}', {
          autoUpdate: false,
          autoHitTest: false,
        });
        app.stage.addChild(model);

        const bounds = model.getLocalBounds();
        const usableWidth = ${options.width} - ${options.padding * 2};
        const usableHeight = ${options.height} - ${options.padding * 2};
        const scale = Math.min(usableWidth / bounds.width, usableHeight / bounds.height);
        model.scale.set(scale);
        model.x = (${options.width} - bounds.width * scale) / 2 - bounds.x * scale;
        model.y = (${options.height} - bounds.height * scale) / 2 - bounds.y * scale;

        await model.motion(${JSON.stringify(motionTarget.group)}, ${motionTarget.index}, 3);
        // Cubism 2 models do not necessarily populate drawable vertices until
        // their first update. Prime the model by 1 ms so exports do not begin
        // with a blank transparent frame while preserving the motion start.
        model.update(1);
        app.renderer.render(app.stage);

        window.stepFrame = (deltaMs) => {
          model.update(deltaMs);
          app.renderer.render(app.stage);
        };
        window.exportReady = true;
      } catch (error) {
        window.exportError = String(error && error.stack ? error.stack : error);
      }
    })();
  </script>
</body>
</html>`;
}

async function main() {
  const options = parseArgs(process.argv);
  options.model = path.resolve(options.model);
  options.output = path.resolve(options.output);
  const modelRoot = path.dirname(options.model);
  const modelConfig = JSON.parse(fs.readFileSync(options.model, 'utf8'));
  const cubismVersion = modelConfig.FileReferences ? 4 : 2;
  if (cubismVersion === 2 && !options.runtime) throw new Error('Cubism 2 export requires an explicit local --runtime path; external CDN runtimes are not used.');
  if (options.runtime) {
    options.runtime = path.resolve(options.runtime);
    if (!fs.existsSync(options.runtime) || !fs.statSync(options.runtime).isFile()) throw new Error(`Runtime file does not exist: ${options.runtime}`);
  }
  const motionGroups = cubismVersion === 4 ? modelConfig.FileReferences?.Motions || {} : modelConfig.motions || {};
  let motionTarget = null;
  for (const [group, entries] of Object.entries(motionGroups)) {
    const index = entries.findIndex((entry) => path.basename(entry.File || entry.file) === options.motion);
    if (index >= 0) {
      motionTarget = { group, index, entry: entries[index] };
      break;
    }
  }
  if (!motionTarget) throw new Error(`Motion not found: ${options.motion}`);
  const motionReference = motionTarget.entry.File || motionTarget.entry.file;
  const motionFile = safeFile(modelRoot, motionReference);
  const motionText = fs.readFileSync(motionFile, 'utf8');
  const duration = cubismVersion === 4
    ? Number(JSON.parse(motionText).Meta?.Duration)
    : cubism2MotionDuration(motionText);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Motion duration is missing or invalid');

  fs.mkdirSync(options.output, { recursive: true });
  const toolRoot = __dirname;
  const routes = {
    '/pixi/pixi.min.js': path.join(toolRoot, 'node_modules/pixi.js/dist/browser/pixi.min.js'),
    '/pixi-live2d/cubism2.min.js': path.join(toolRoot, 'node_modules/pixi-live2d-display/dist/cubism2.min.js'),
    '/pixi-live2d/cubism4.min.js': path.join(toolRoot, 'node_modules/pixi-live2d-display/dist/cubism4.min.js'),
    '/vendor/live2dcubismcore.min.js': path.join(toolRoot, 'vendor/live2dcubismcore.min.js'),
  };
  if (options.runtime) routes[`/runtime/${encodeURIComponent(path.basename(options.runtime))}`] = options.runtime;

  const server = http.createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (requestUrl.pathname === '/') {
        const body = viewerHtml(options, motionTarget, cubismVersion);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(body);
        return;
      }
      let file = routes[requestUrl.pathname];
      if (!file && requestUrl.pathname.startsWith('/model/')) {
        file = safeFile(modelRoot, decodeURIComponent(requestUrl.pathname.slice('/model/'.length)));
      }
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': mimeType(file), 'Access-Control-Allow-Origin': '*' });
      fs.createReadStream(file).pipe(response);
    } catch (error) {
      response.writeHead(500);
      response.end(String(error));
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--hide-scrollbars',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--use-angle=swiftshader',
      '--disable-background-timer-throttling',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: options.width, height: options.height, deviceScaleFactor: 1 });
    page.on('console', (message) => process.stderr.write(`[browser] ${message.text()}\n`));
    page.on('pageerror', (error) => process.stderr.write(`[browser-error] ${error.stack || error}\n`));
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => window.exportReady || window.exportError, { timeout: 30000 });
    const exportError = await page.evaluate(() => window.exportError);
    if (exportError) throw new Error(exportError);

    const frameCount = Math.ceil(duration * options.fps);
    const canvas = await page.$('#stage');
    for (let frame = 0; frame < frameCount; frame += 1) {
      if (frame > 0) await page.evaluate((delta) => window.stepFrame(delta), 1000 / options.fps);
      const filename = path.join(options.output, `frame_${String(frame).padStart(4, '0')}.png`);
      // Reading the transparent WebGL canvas directly is substantially faster
      // than asking DevTools to take a page screenshot for every frame.
      const dataUrl = await page.$eval('#stage', (element) => element.toDataURL('image/png'));
      fs.writeFileSync(filename, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
      if ((frame + 1) % options.fps === 0 || frame + 1 === frameCount) {
        process.stdout.write(`Captured ${frame + 1}/${frameCount}\n`);
      }
    }
    fs.writeFileSync(path.join(options.output, 'metadata.json'), JSON.stringify({
      model: options.model,
      motion: options.motion,
      motionGroup: motionTarget.group,
      cubismVersion,
      duration,
      fps: options.fps,
      frameCount,
      width: options.width,
      height: options.height,
    }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
