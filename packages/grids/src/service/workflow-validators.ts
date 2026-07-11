import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { get as settingsGet } from "@valentinkolb/cloud/services/settings";
import { err, fail, ok, type Result } from "@valentinkolb/stdlib";

const PRIVATE_HTTP_SETTING = "grids.http_request_allow_private_networks";

type ScheduleLike = {
  kind: "schedule";
  cron: string;
  timezone?: string;
};

const isValidCronPart = (part: string, min: number, max: number): boolean => {
  if (!part || !/^[0-9*/,\-]+$/.test(part)) return false;
  const atoms = part.split(",");
  return atoms.every((atom) => {
    const [range, stepRaw] = atom.split("/");
    if (stepRaw !== undefined) {
      const step = Number(stepRaw);
      if (!Number.isInteger(step) || step < 1) return false;
      if (range !== "*" && !range?.includes("-")) return false;
    }
    if (range === "*") return true;
    if (!range) return false;
    const bounds = range.split("-");
    if (bounds.length > 2) return false;
    const nums = bounds.map((value) => Number(value));
    if (nums.some((value) => !Number.isInteger(value) || value < min || value > max)) return false;
    if (nums.length === 2 && nums[0]! > nums[1]!) return false;
    return true;
  });
};

export const validateSchedule = (trigger: ScheduleLike): Result<void> => {
  const parts = trigger.cron.trim().split(/\s+/);
  if (parts.length !== 5) return fail(err.badInput("schedule cron must have 5 fields"));
  const ranges = [
    { min: 0, max: 59, name: "minute" },
    { min: 0, max: 23, name: "hour" },
    { min: 1, max: 31, name: "day of month" },
    { min: 1, max: 12, name: "month" },
    { min: 0, max: 7, name: "day of week" },
  ];
  for (let i = 0; i < parts.length; i++) {
    if (!isValidCronPart(parts[i]!, ranges[i]!.min, ranges[i]!.max)) {
      return fail(err.badInput(`schedule cron has invalid ${ranges[i]!.name} field`));
    }
  }
  if (trigger.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: trigger.timezone }).format(new Date());
    } catch {
      return fail(err.badInput("schedule timezone must be a valid IANA timezone"));
    }
  }
  return ok();
};

const ipv4ToNumber = (ip: string): number => ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;

const ipv4InRange = (ip: string, base: string, bits: number): boolean => {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToNumber(ip) & mask) === (ipv4ToNumber(base) & mask);
};

const isUnsafeHttpAddress = (address: string): boolean => {
  if (isIP(address) === 4) {
    return (
      ipv4InRange(address, "0.0.0.0", 8) ||
      ipv4InRange(address, "10.0.0.0", 8) ||
      ipv4InRange(address, "127.0.0.0", 8) ||
      ipv4InRange(address, "169.254.0.0", 16) ||
      ipv4InRange(address, "172.16.0.0", 12) ||
      ipv4InRange(address, "192.168.0.0", 16)
    );
  }
  const lower = address.toLowerCase();
  if (lower.startsWith("::ffff:")) return isUnsafeHttpAddress(lower.slice("::ffff:".length));
  return lower === "::" || lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd");
};

const isUnsafeHttpHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "metadata.google.internal" ||
    host.endsWith(".internal") ||
    (isIP(host) !== 0 && isUnsafeHttpAddress(host))
  );
};

export const validateHttpRequestTarget = async (rawUrl: string): Promise<Result<URL>> => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail(err.badInput("HTTP request URL is invalid"));
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return fail(err.badInput("HTTP request URL must use http or https"));
  }

  const allowPrivate = Boolean(await settingsGet<boolean>(PRIVATE_HTTP_SETTING));
  if (allowPrivate) return ok(url);
  if (isUnsafeHttpHost(url.hostname)) {
    return fail(err.badInput("HTTP request target is not allowed"));
  }

  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (addresses.some((entry) => isUnsafeHttpAddress(entry.address))) {
      return fail(err.badInput("HTTP request target is not allowed"));
    }
  } catch {
    // DNS failures are normal delivery failures; fetch records them.
  }
  return ok(url);
};
