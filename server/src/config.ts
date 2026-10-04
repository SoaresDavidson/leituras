import path from 'node:path';

export type Config = {
  port: number;
  host: string;
  dataPath: string;
  timeZone: string;
  webDistPath: string;
};

export function loadConfig(env = process.env): Config {
  const dataPath = path.resolve(env.DATA_PATH ?? 'data');
  return {
    port: Number(env.PORT ?? 3333),
    host: env.HOST ?? '0.0.0.0',
    dataPath,
    timeZone: env.TZ_NAME ?? 'America/Fortaleza',
    webDistPath: path.resolve(env.WEB_DIST ?? path.join(import.meta.dirname, '../../web/dist')),
  };
}
