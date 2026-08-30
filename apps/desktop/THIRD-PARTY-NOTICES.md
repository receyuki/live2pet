# Third-party notices

The `prepare:mapper` staging step copies the following browser assets into the
development or packaged Mapper bundle. The staging output includes the
corresponding upstream license text under `licenses/`.

| Package | Version | License | Upstream |
| --- | --- | --- | --- |
| `pixi.js` | 6.5.10 | MIT | https://github.com/pixijs/pixi.js |
| `pixi-live2d-display` | 0.4.0 | MIT | https://github.com/guansss/pixi-live2d-display |
| `@zip.js/zip.js` | 2.7.57 | BSD-3-Clause | https://github.com/gildas-lormeau/zip.js |

Live2D Cubism Core and legacy runtimes are not third-party assets staged by
Live2Pet. They remain user-provided files selected at runtime and are never
copied into the repository, project, cache, package, or release artifact.
