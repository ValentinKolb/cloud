import type { AppAppearance } from "../contracts/app";
import type { RuntimeContext } from "./runtime";

const isHexColor = (value: string | undefined): value is `#${string}` => /^#[0-9a-f]{6}$/i.test(value ?? "");
const clampStrength = (value: number | undefined, fallback: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(100, value ?? fallback)) : fallback;

export const appAppearanceStyle = (appearance: AppAppearance | undefined): string | undefined => {
  if (!isHexColor(appearance?.accent)) return undefined;
  const from = isHexColor(appearance.background?.from) ? appearance.background.from : appearance.accent;
  const to = isHexColor(appearance.background?.to) ? appearance.background.to : from;
  const via = isHexColor(appearance.background?.via) ? appearance.background.via : "#ffffff";
  const angle = Number.isFinite(appearance.background?.angle) ? Math.max(0, Math.min(360, appearance.background?.angle ?? 135)) : 135;
  const strength = clampStrength(appearance.background?.strength, 20);
  const darkStrength = Math.min(100, strength + 4);
  return `--app-accent:${appearance.accent};--app-canvas-from:${from};--app-canvas-via:${via};--app-canvas-to:${to};--app-canvas-angle:${angle}deg;--app-canvas-strength:${strength}%;--app-canvas-dark-strength:${darkStrength}%`;
};

export const appAccentStyle = (accent: string | undefined): string | undefined =>
  isHexColor(accent) ? `--app-accent:${accent}` : undefined;

export const resolveCurrentApp = (apps: RuntimeContext["apps"], pathname: string) =>
  apps
    .flatMap((app) => app.routes.map((route) => ({ app, route })))
    .filter(({ route }) => route === "/" || pathname === route || pathname.startsWith(`${route}/`))
    .sort((a, b) => b.route.length - a.route.length)[0]?.app;
