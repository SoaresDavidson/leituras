# Leituras

Reading statistics from KOReader (Kindle) into a personal web dashboard.

KOReader + `plugin/leituras.koplugin` (fork of the KoInsight plugin) -> `POST /api/plugin/import` -> SQLite -> React dashboard with login.

## Setup

```bash
cp .env.example .env          # fill PLUGIN_TOKEN (openssl rand -hex 32), PUBLIC_URL, LAN_IP
docker compose up -d --build
docker compose exec leituras node dist/cli.js set-password
npm install && npm run build-plugin   # writes plugin/leituras.koplugin/leituras_config.lua
```

Copy `plugin/leituras.koplugin` to `koreader/plugins/` on the Kindle over USB. Nothing to configure in KOReader:
it syncs on suspend/power off (when Wi-Fi is on), or via Tools > Leituras > Synchronize data.

## Development

```bash
npm install
npm run set-password
npm run dev      # server on :3333, Vite on :5173 (proxies /api)
npm test
```

The plugin fork and how to reapply it on upstream changes: `plugin/PATCHES.md`.
