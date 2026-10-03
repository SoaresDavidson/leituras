import path from 'node:path';

export type Config = {
  port: number;
  host: string;
  dataPath: string;
  pluginToken: string;
  timeZone: string;
  publicUrl: string; // URL the Kindle uses to reach this server, baked into the plugin
  webDistPath: string;
};

export function loadConfig(env = process.env): Config {
  const dataPath = path.resolve(env.DATA_PATH ?? 'data');
  return {
    port: Number(env.PORT ?? 3333),
    host: env.HOST ?? '0.0.0.0',
    dataPath,
    pluginToken: env.PLUGIN_TOKEN ?? '',
    timeZone: env.TZ_NAME ?? 'America/Fortaleza',
    publicUrl: env.PUBLIC_URL ?? '',
    webDistPath: path.resolve(env.WEB_DIST ?? path.join(import.meta.dirname, '../../web/dist')),
  };
}
