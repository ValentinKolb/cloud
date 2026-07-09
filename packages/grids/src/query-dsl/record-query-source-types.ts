export type ConvertResult = { ok: true; source: string } | { ok: false; reason: string };

export const unsupported = (reason: string): ConvertResult => ({ ok: false, reason });
