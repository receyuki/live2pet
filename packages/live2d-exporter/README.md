# Live2D frame exporter

This is a prototype command-line exporter used by the shared renderer work. It loads a user-provided Cubism model through Pixi and captures transparent PNG frames.

Modern Cubism models use the local Core file in `vendor/` during development. Cubism 2 models require an explicit local legacy runtime:

```sh
node export.cjs \
  --model /path/to/model.json \
  --runtime /path/to/live2d.min.js \
  --motion idle.mtn \
  --output /tmp/live2pet-frames
```

The exporter never fetches a runtime from a CDN. Keep the selected runtime and model outside the repository; they are user-provided assets with their own licensing and provenance.
