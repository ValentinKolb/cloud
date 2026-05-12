/**
 * Resolve the public-facing speedtest base URL from the per-request
 * settings snapshot. Used both by the script-serving handler (to bake the
 * URL into the served script) and by the SSR page (to render the copyable
 * curl snippet).
 *
 * `app.url` accepts values with or without scheme — normalise here so
 * callers always get a usable absolute URL.
 */

const normalize = (raw: string): string => {
  const trimmed = raw.replace(/\/+$/, "");
  if (/^https?:\/\//.test(trimmed)) return trimmed;
  if (/^(localhost|127\.|\[?::1)/.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
};

type SettingsLike = { get: (key: "settings") => unknown };

export const resolveSpeedtestBase = (c: SettingsLike): string => {
  const settings = c.get("settings") as { app?: { url?: string } } | undefined;
  const raw = settings?.app?.url ?? "http://localhost:3000";
  return `${normalize(raw)}/tools/api/speedtest`;
};
