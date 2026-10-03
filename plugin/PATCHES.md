# Patches over upstream KoInsight plugin

Fork of `plugins/koinsight.koplugin` from https://github.com/GeorgeSG/koinsight (MIT, see `LICENSE`).
Base: upstream plugin version `0.3.0` (`const.lua`).

Reapply these when pulling upstream changes:

1. `_meta.lua`: plugin `name` is `leituras`, `fullname` is `Leituras`.
2. `main.lua`:
   - widget `name` and main menu key renamed `koinsight` -> `leituras` (also in `initMenuOrder`).
   - "Set server URL" menu entry removed; the URL is not user-configurable.
3. `settings.lua`:
   - settings file/key renamed `koinsight` -> `leituras`, so it never mixes with an installed upstream plugin.
   - `getServerURL()` reads `leituras_config.lua`; new `getToken()` reads the token from it.
4. `upload.lua`: `get_headers()` sends `Authorization: Bearer <token>` on every request.
5. New `leituras_config.lua` (generated, git-ignored) with `server_url` and `token`.
