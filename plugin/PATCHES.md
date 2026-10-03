# Patches over upstream KoInsight plugin

Fork of `plugins/koinsight.koplugin` from https://github.com/GeorgeSG/koinsight (MIT, see `LICENSE`).
Base: upstream plugin version `0.3.0` (`const.lua`).

Reapply these when pulling upstream changes:

1. `_meta.lua`: plugin `name` is `leituras`, `fullname` is `Leituras`.
2. `main.lua`:
   - widget `name` and main menu key renamed `koinsight` -> `leituras` (also in `initMenuOrder`).
   - "Set server URL" menu entry renamed "Set server URL and token".
   - "About KoInsight" renamed "About Leituras", text points to this fork.
3. `settings.lua`:
   - settings file/key renamed `koinsight` -> `leituras`, so it never mixes with an installed upstream plugin.
   - new `token` setting, stored next to `server_url`; `getToken()` reads it,
     `setServerSettings(url, token)` replaces `setServerURL(url)`.
   - server settings dialog gains a password field for the token; Apply rejects an empty token.
4. `upload.lua`: `get_headers()` sends `Authorization: Bearer <token>` on every request.
