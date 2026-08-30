# Ship the skill as a client of the installed application runtime

The Live2Pet Codex skill will require the Live2Pet desktop application to be installed and will invoke its headless CLI without requiring the Electron GUI to remain open. This keeps the skill small and ensures that App and skill builds use the same Electron, rendering, encoding, validation, and packaging runtime.

For visual mapping, the CLI will start an ephemeral **Mapper Session** on the loopback interface. Codex opens that session in an in-app browser tab, where the same React three-column mapper used by the Electron App previews Live2D and edits the Live2Pet Project. The session server will:

- bind only to `127.0.0.1`/loopback;
- require a random, single-session bearer token;
- expose only the selected project's allowlisted files and typed mapper operations;
- enforce Origin checks and a restrictive Content Security Policy;
- avoid exposing general filesystem or command execution APIs; and
- stop on completion, explicit close, or a short idle timeout.

If the Codex browser surface is unavailable, the skill falls back to opening the same project in the Electron App. Headless inspect, validate, build, export, and explicitly authorized install commands do not start a Mapper Session.

Shipping a second complete runtime inside the skill was rejected because it would duplicate large platform binaries and create version drift. Requiring a permanently running GUI was rejected because it would make automation fragile. Rendering every Motion into chat media was rejected as the primary mapping workflow because it is slower and produces unnecessary temporary artifacts.
