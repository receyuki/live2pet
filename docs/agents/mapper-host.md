# Mapper host integration

`@live2pet/mapper-session` contains the host boundary used by the future Electron main process and by local browser previews. It does not expose a general local web server.

```js
const { startMapperSessionHost } = require('@live2pet/mapper-session');

const host = await startMapperSessionHost({
  project,
  mapperPath: '/path/to/apps/mapper/index.html',
  mapperUrl: 'file:///path/to/apps/mapper/index.html',
});

const launch = host.getLaunchDescriptor();
// Pass launch.mapperUrl to the trusted browser host. Do not serialize a token.
```

The helper reads only the explicitly supplied Mapper document, enforces the 4 MiB document limit, and accepts only a `file:` URL or a loopback `http:` URL. For a `file:` Mapper, it automatically allowlists the browser's opaque `null` Origin and still permits the session's own loopback origin for trusted programmatic clients. The URL fragment contains a one-time bootstrap code, not the bearer token. The Mapper exchanges it at `POST /bootstrap`, removes the fragment from its history entry, and keeps the returned token in memory.

The host descriptor contains only the protocol version, session id, loopback API origin, expiry, and launch URL. Keep the returned host handle private to the App main process; use `getClient()` for typed project operations and `close()` when the mapping task ends.

This boundary is intentionally separate from Electron IPC. The eventual App must expose only typed preload methods to the renderer, keep Node integration disabled, and package the Mapper's local dependencies instead of relying on the prototype's development paths.
