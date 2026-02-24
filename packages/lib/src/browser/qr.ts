/**
 * QR code payload generation and rendering library.
 *
 * Payload generators are pure functions that produce standard QR code strings.
 * Rendering wraps lean-qr to produce scalable SVGs.
 *
 * @example
 * import { qr } from "@/browser/qr";
 *
 * const data = qr.wifi({ ssid: "Office", password: "secret", encryption: "WPA" });
 * const svg = qr.toSvg(data, { correctionLevel: "M", on: "#000", off: "#fff" });
 */

import { generate, correction, type Correction } from "lean-qr";
import { toSvgSource } from "lean-qr/extras/svg";

// ====================================
// TYPES
// ====================================

type CorrectionLevel = "L" | "M" | "Q" | "H";

type WifiOptions = {
  ssid: string;
  password?: string;
  encryption?: "WPA" | "WEP" | "nopass";
  hidden?: boolean;
};

type EmailOptions = {
  to: string;
  subject?: string;
  body?: string;
};

type TelOptions = {
  number: string;
};

type VCardOptions = {
  firstName: string;
  lastName?: string;
  organization?: string;
  title?: string;
  phone?: string;
  email?: string;
  website?: string;
  street?: string;
  city?: string;
  zip?: string;
  country?: string;
};

type EventOptions = {
  title: string;
  location?: string;
  /** datetime-local format: "2025-06-15T14:30" */
  start?: string;
  /** datetime-local format: "2025-06-15T15:30" */
  end?: string;
  description?: string;
};

type RenderOptions = {
  /** Foreground color (default "#000000") */
  on?: string;
  /** Background color (default "#ffffff", or "transparent") */
  off?: string;
  /** Error correction level (default "M") */
  correctionLevel?: CorrectionLevel;
};

// ====================================
// HELPERS
// ====================================

/** Escape special characters in WiFi SSID/password fields */
const escapeWifi = (s: string): string => s.replace(/([\\;,:"'])/g, "\\$1");

/**
 * Convert datetime-local value to VEVENT date format.
 * "2025-06-15T14:30" → "20250615T143000"
 */
const formatDt = (dt: string): string => dt.replace(/-/g, "").replace(":", "") + "00";

// ====================================
// PAYLOAD GENERATORS
// ====================================

const wifi = (opts: WifiOptions): string => {
  const enc = opts.encryption ?? "WPA";
  const parts = [`T:${enc}`, `S:${escapeWifi(opts.ssid)}`];
  if (opts.password && enc !== "nopass") {
    parts.push(`P:${escapeWifi(opts.password)}`);
  }
  if (opts.hidden) {
    parts.push("H:true");
  }
  return `WIFI:${parts.join(";")};;`;
};

const email = (opts: EmailOptions): string => {
  const params: string[] = [];
  if (opts.subject?.trim()) params.push(`subject=${encodeURIComponent(opts.subject.trim())}`);
  if (opts.body?.trim()) params.push(`body=${encodeURIComponent(opts.body.trim())}`);
  return `mailto:${opts.to.trim()}${params.length ? "?" + params.join("&") : ""}`;
};

const tel = (opts: TelOptions): string => `tel:${opts.number.trim()}`;

const vcard = (opts: VCardOptions): string => {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${opts.lastName ?? ""};${opts.firstName}`,
    `FN:${[opts.firstName, opts.lastName].filter(Boolean).join(" ")}`,
  ];
  if (opts.organization) lines.push(`ORG:${opts.organization}`);
  if (opts.title) lines.push(`TITLE:${opts.title}`);
  if (opts.phone) lines.push(`TEL:${opts.phone}`);
  if (opts.email) lines.push(`EMAIL:${opts.email}`);
  if (opts.website) lines.push(`URL:${opts.website}`);
  if (opts.street || opts.city || opts.zip || opts.country) {
    lines.push(`ADR:;;${opts.street ?? ""};${opts.city ?? ""};;${opts.zip ?? ""};${opts.country ?? ""}`);
  }
  lines.push("END:VCARD");
  return lines.join("\n");
};

const event = (opts: EventOptions): string => {
  const lines = ["BEGIN:VEVENT", `SUMMARY:${opts.title}`];
  if (opts.location) lines.push(`LOCATION:${opts.location}`);
  if (opts.start) lines.push(`DTSTART:${formatDt(opts.start)}`);
  if (opts.end) lines.push(`DTEND:${formatDt(opts.end)}`);
  if (opts.description) lines.push(`DESCRIPTION:${opts.description}`);
  lines.push("END:VEVENT");
  return lines.join("\n");
};

// ====================================
// RENDERING
// ====================================

const correctionMap: Record<CorrectionLevel, Correction> = {
  L: correction.L,
  M: correction.M,
  Q: correction.Q,
  H: correction.H,
};

/** Generate a scalable SVG string from data. */
const toSvg = (data: string, opts?: RenderOptions): string => {
  const qrCode = generate(data, {
    minCorrectionLevel: correctionMap[opts?.correctionLevel ?? "M"],
  });
  return toSvgSource(qrCode, {
    on: opts?.on ?? "#000000",
    off: opts?.off ?? "#ffffff",
  });
};

// ====================================
// EXPORT
// ====================================

export const qr = {
  wifi,
  email,
  tel,
  vcard,
  event,
  toSvg,
} as const;
