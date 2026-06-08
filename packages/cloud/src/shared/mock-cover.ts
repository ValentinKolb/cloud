import { Buffer } from "node:buffer";

export type MockCoverTheme = "blue" | "emerald" | "amber" | "rose" | "violet" | "slate" | "teal";

export type MockCoverIcon = "book" | "camera" | "device-projector" | "microphone" | "package";

export type MockCoverOptions = {
  icon?: MockCoverIcon | string;
  theme?: MockCoverTheme;
  seed?: string;
  label?: string;
  size?: number;
};

export type MockCover = {
  svg: string;
  dataUrl: string;
  mimeType: "image/svg+xml";
};

const themes: Record<MockCoverTheme, { from: string; to: string; accent: string; panel: string }> = {
  blue: { from: "#dbeafe", to: "#93c5fd", accent: "#2563eb", panel: "#eff6ff" },
  emerald: { from: "#d1fae5", to: "#6ee7b7", accent: "#059669", panel: "#ecfdf5" },
  amber: { from: "#fef3c7", to: "#fbbf24", accent: "#d97706", panel: "#fffbeb" },
  rose: { from: "#ffe4e6", to: "#fda4af", accent: "#e11d48", panel: "#fff1f2" },
  violet: { from: "#ede9fe", to: "#c4b5fd", accent: "#7c3aed", panel: "#f5f3ff" },
  slate: { from: "#e2e8f0", to: "#94a3b8", accent: "#475569", panel: "#f8fafc" },
  teal: { from: "#ccfbf1", to: "#5eead4", accent: "#0f766e", panel: "#f0fdfa" },
};

const themeNames = Object.keys(themes) as MockCoverTheme[];

const iconPaths: Record<MockCoverIcon, string[]> = {
  book: ["M3 19a9 9 0 0 1 9 0a9 9 0 0 1 9 0", "M3 6a9 9 0 0 1 9 0a9 9 0 0 1 9 0", "M3 6l0 13", "M12 6l0 13", "M21 6l0 13"],
  camera: [
    "M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2",
    "M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0",
  ],
  "device-projector": [
    "M8 9a5 5 0 1 0 10 0a5 5 0 0 0 -10 0",
    "M9 6h-4a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2 -2v-8a2 2 0 0 0 -2 -2h-2",
    "M6 15h1",
    "M7 18l-1 2",
    "M18 18l1 2",
  ],
  microphone: [
    "M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5",
    "M5 10a7 7 0 0 0 14 0",
    "M8 21l8 0",
    "M12 17l0 4",
  ],
  package: ["M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5", "M12 12l8 -4.5", "M12 12l0 9", "M12 12l-8 -4.5", "M16 5.25l-8 4.5"],
};

const aliases: Record<string, MockCoverIcon> = {
  books: "book",
  "ti ti-book": "book",
  "ti ti-books": "book",
  "ti ti-camera": "camera",
  "ti ti-device-projector": "device-projector",
  "ti ti-microphone": "microphone",
  "ti ti-package": "package",
  "ti ti-packages": "package",
};

const hashSeed = (seed: string): number => {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const resolveIcon = (icon: MockCoverOptions["icon"]): MockCoverIcon => {
  const key = String(icon ?? "package")
    .trim()
    .toLowerCase();
  if (key in iconPaths) return key as MockCoverIcon;
  return aliases[key] ?? "package";
};

export const createMockCoverSvg = (options: MockCoverOptions = {}): string => {
  const size = Math.max(160, Math.min(options.size ?? 720, 1600));
  const seed = options.seed ?? options.label ?? options.icon ?? "mock-cover";
  const themeName = options.theme ?? themeNames[hashSeed(String(seed)) % themeNames.length] ?? "blue";
  const theme = themes[themeName];
  const icon = resolveIcon(options.icon);
  const gradientId = `g${hashSeed(`${seed}:gradient`).toString(36)}`;
  const title = escapeXml(options.label ?? "Mock cover");
  const iconMarkup = iconPaths[icon].map((path) => `<path d="${path}" />`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 720 720" role="img" aria-label="${title}">
  <defs>
    <linearGradient id="${gradientId}" x1="72" x2="648" y1="72" y2="648" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${theme.from}" />
      <stop offset="1" stop-color="${theme.to}" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="22" stdDeviation="24" flood-color="#0f172a" flood-opacity=".16" />
    </filter>
  </defs>
  <rect width="720" height="720" fill="url(#${gradientId})" />
  <rect x="160" y="160" width="400" height="400" rx="96" fill="${theme.panel}" opacity=".92" filter="url(#shadow)" />
  <g transform="translate(216 216) scale(12)" fill="none" stroke="${theme.accent}" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
    ${iconMarkup}
  </g>
</svg>`;
};

export const createMockCover = (options: MockCoverOptions = {}): MockCover => {
  const svg = createMockCoverSvg(options);
  return {
    svg,
    dataUrl: `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`,
    mimeType: "image/svg+xml",
  };
};

export const parseDataUrl = (dataUrl: string): { mimeType: string; bytes: Uint8Array } | null => {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return null;
  return {
    mimeType: match[1] || "application/octet-stream",
    bytes: new Uint8Array(Buffer.from(match[2] ?? "", "base64")),
  };
};
