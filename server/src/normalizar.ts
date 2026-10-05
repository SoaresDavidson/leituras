// Shared by the metadata sources: their JSON is untrusted, so malformed fields are dropped

export const FONTE_TIMEOUT_MS = 8000;
export const FONTE_LIMITE = 5; // hits asked from each source
export const MAX_ASSUNTOS = 8;

export type Consulta = { title: string; author?: string };

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean) : []);
export const positiveInt = (v: unknown) => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : null);
export const objects = (v: unknown) => (Array.isArray(v) ? v.filter(isObject) : []);
