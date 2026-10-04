# Patches over upstream KoInsight plugin

Fork of `plugins/koinsight.koplugin` from https://github.com/GeorgeSG/koinsight (MIT, see `LICENSE`).
Base: upstream plugin version `0.3.0` (`const.lua`).

Reapply these when pulling upstream changes:

1. `_meta.lua`: plugin `name` is `leituras`, `fullname` is `Leituras`.
2. `main.lua`:
   - widget `name` and main menu key renamed `koinsight` -> `leituras` (also in `initMenuOrder`).
   - "About KoInsight" renamed "About Leituras", text points to this fork.
   - gesture action `koinsight_sync`/`KoInsightSync` renamed `leituras_sync`/`LeiturasSync`
     (handler `onLeiturasSync`, title "Leituras: Sync all books"), so it never clashes with upstream.
   - log tag `[KoInsight]` renamed `[Leituras]` in every file.
3. `settings.lua`:
   - settings file/key renamed `koinsight` -> `leituras`, so it never mixes with an installed upstream plugin.
4. Bug fixes over upstream (candidates to send upstream):
   - `call_api.lua`: on HTTP errors, decode the response body and show the server's `error` field
     (e.g. "Server error: books and stats must be arrays"); log the error once.
   - `main.lua`: `isWiFiConnected()` returns `false` when the check fails, so suspend sync never runs blind.
   - `call_api.lua`, `db_reader.lua`, `upload.lua`, `main.lua`: helper functions and `message` made `local`
     so they no longer leak into KOReader's shared global table.
5. Manual "Synchronize data" no longer freezes the device (it ran every request on the UI loop):
   - `upload.lua`: `syncAllBooks` sends only device + statistics (the server ignores annotations),
     stops at the first failure and returns `ok, message`; the per-book annotation loop is gone,
     and with it `getAllBooksWithAnnotations`/`getBookDataFromSidecar` in `annotation_reader.lua`.
   - `main.lua`: `performFullSync` paints its message with `forceRePaint()` before the blocking sync
     and shows "Could not reach the Leituras server" on network errors.
   - `db_reader.lua`: `progressData(books)` maps book id -> md5 instead of a linear search per row,
     reuses the caller's `bookData()`, and the live page count is read once from the open document.
