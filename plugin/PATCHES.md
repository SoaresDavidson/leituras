# Patches over upstream KoInsight plugin

Fork of `plugins/koinsight.koplugin` from https://github.com/GeorgeSG/koinsight (MIT, see `LICENSE`).
Base: upstream plugin version `0.3.0` (`const.lua`).

Reapply these when pulling upstream changes:

1. `_meta.lua`: plugin `name` is `leituras`, `fullname` is `Leituras`.
2. `main.lua`:
   - widget `name` and main menu key renamed `koinsight` -> `leituras` (also in `initMenuOrder`).
   - "Set server URL" menu entry renamed "Set server URL and token".
   - "About KoInsight" renamed "About Leituras", text points to this fork.
   - gesture action `koinsight_sync`/`KoInsightSync` renamed `leituras_sync`/`LeiturasSync`
     (handler `onLeiturasSync`, title "Leituras: Sync all books"), so it never clashes with upstream.
   - log tag `[KoInsight]` renamed `[Leituras]` in every file.
3. `settings.lua`:
   - settings file/key renamed `koinsight` -> `leituras`, so it never mixes with an installed upstream plugin.
   - new `token` setting, stored next to `server_url`; `getToken()` reads it,
     `setServerSettings(url, token)` replaces `setServerURL(url)`.
   - server settings dialog gains a password field for the token; Apply rejects an empty token.
4. `upload.lua`: `get_headers()` sends `Authorization: Bearer <token>` on every request.
5. Bug fixes over upstream (candidates to send upstream):
   - `call_api.lua`: on HTTP errors, decode the response body and show the server's `error` field
     (e.g. "Server error: Invalid token"); log the error once.
   - `main.lua`: `isWiFiConnected()` returns `false` when the check fails, so suspend sync never runs blind.
   - `call_api.lua`, `db_reader.lua`, `upload.lua`, `main.lua`: helper functions and `message` made `local`
     so they no longer leak into KOReader's shared global table.
