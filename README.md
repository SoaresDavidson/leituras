# Leituras

Reading statistics from KOReader (Kindle) into a personal web dashboard.

KOReader + `plugin/leituras.koplugin` (fork of the KoInsight plugin) -> `POST /api/plugin/import` -> SQLite -> React dashboard with login.

## Setup

```bash
cp .env.example .env          # fill LAN_IP
docker compose up -d --build
docker compose exec leituras node dist/cli.js set-password
```

Copy `plugin/leituras.koplugin` to `koreader/plugins/` on the Kindle over USB, then in KOReader open
Tools > Leituras > Set server URL, and enter `http://<LAN_IP>:3333`. The plugin endpoints have no auth:
the port is published on the LAN IP only, so anyone on that network can send data.
It syncs on suspend/power off (when Wi-Fi is on), or via Tools > Leituras > Synchronize data.

To skip typing the URL on the Kindle keyboard, create `koreader/settings/leituras.lua` over USB
instead, with KOReader closed (it may overwrite the file on exit):

```lua
-- we can read Lua syntax here!
return {
    ["leituras"] = {
        ["server_url"] = "http://<LAN_IP>:3333",
    },
}
```

## Dashboard settings

The Settings tab shows or hides items of the Painel (focus, the three indicators, yearly activity, books finished per month, book list).
The choice is stored per instance on the server (`setting` table, keys `painel.*`), so it is the same in every browser and device.
Hiding only affects display, never data or calculations. With no saved choice everything is visible; "Restaurar padrão" removes it.

## Development

```bash
npm install
npm run set-password
npm run dev      # server on :3333, Vite on :5173 (proxies /api)
npm test
```

The plugin fork and how to reapply it on upstream changes: `plugin/PATCHES.md`.

## License and credits

MIT, see `LICENSE`.

`plugin/leituras.koplugin` is a fork of the KOReader plugin from
[KoInsight](https://github.com/GeorgeSG/koinsight) by Georgi Gardev, used under the MIT license
(original notice in `plugin/LICENSE`). Leituras is not affiliated with or endorsed by KoInsight.
