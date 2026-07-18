import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_ATTACHMENT_LINK_FILE_BYTES = 100 * 1024 * 1024;

const PUBLIC_TOKEN_BYTES = 32;
const PUBLIC_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_HASH_PATTERN = /^[0-9a-f]{64}$/;
const MAX_PASSWORD_BYTES = 256;
const MAX_DOWNLOAD_LIMIT = 1_000_000;

export type AttachmentLinkSnapshot = Readonly<{
  tokenHash: string;
  passwordHash: string | null;
  fileSizeBytes: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
  downloadCount: number;
  maxDownloads: number | null;
}>;

export type CreateAttachmentLinkInput = Readonly<{
  fileSizeBytes: number;
  now: Date;
  password?: string | null;
  expiresAt?: Date | null;
  maxDownloads?: number | null;
}>;

export type CreateAttachmentLinkResult =
  | Readonly<{
      ok: true;
      publicToken: string;
      persistent: AttachmentLinkSnapshot;
    }>
  | Readonly<{
      ok: false;
      code: "invalid_file_size" | "invalid_time" | "invalid_expiry" | "invalid_password" | "invalid_download_limit";
    }>;

export type AttachmentLinkDownloadDecision =
  | Readonly<{ ok: true; nextDownloadCount: number }>
  | Readonly<{ ok: false; code: "unavailable" }>;

const unavailable: AttachmentLinkDownloadDecision = Object.freeze({ ok: false, code: "unavailable" });

const isValidDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());

const isValidFileSize = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_ATTACHMENT_LINK_FILE_BYTES;

const isValidDownloadCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) < Number.MAX_SAFE_INTEGER;

const isValidMaxDownloads = (value: unknown): value is number | null =>
  value === null || (Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_DOWNLOAD_LIMIT);

const isValidPassword = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && Buffer.byteLength(value, "utf8") <= MAX_PASSWORD_BYTES;

const tokenMatches = (publicToken: unknown, tokenHash: unknown): boolean => {
  if (typeof publicToken !== "string" || typeof tokenHash !== "string") return false;
  if (!PUBLIC_TOKEN_PATTERN.test(publicToken) || !TOKEN_HASH_PATTERN.test(tokenHash)) return false;
  const actual = Buffer.from(hashAttachmentLinkToken(publicToken), "hex");
  const expected = Buffer.from(tokenHash, "hex");
  return timingSafeEqual(actual, expected);
};

export const hashAttachmentLinkToken = (publicToken: string): string => createHash("sha256").update(publicToken).digest("hex");

export const createAttachmentLink = async (input: CreateAttachmentLinkInput): Promise<CreateAttachmentLinkResult> => {
  if (!isValidFileSize(input.fileSizeBytes)) return { ok: false, code: "invalid_file_size" };
  if (!isValidDate(input.now)) return { ok: false, code: "invalid_time" };

  const expiresAt = input.expiresAt ?? null;
  if (expiresAt !== null && (!isValidDate(expiresAt) || expiresAt.getTime() <= input.now.getTime())) {
    return { ok: false, code: "invalid_expiry" };
  }

  const maxDownloads = input.maxDownloads ?? null;
  if (!isValidMaxDownloads(maxDownloads)) return { ok: false, code: "invalid_download_limit" };

  const password = input.password ?? null;
  if (password !== null && !isValidPassword(password)) {
    return { ok: false, code: "invalid_password" };
  }

  const publicToken = randomBytes(PUBLIC_TOKEN_BYTES).toString("base64url");
  const passwordHash = password === null ? null : await Bun.password.hash(password, "argon2id");
  return {
    ok: true,
    publicToken,
    persistent: {
      tokenHash: hashAttachmentLinkToken(publicToken),
      passwordHash,
      fileSizeBytes: input.fileSizeBytes,
      expiresAt,
      revokedAt: null,
      downloadCount: 0,
      maxDownloads,
    },
  };
};

export const decideAttachmentLinkDownload = async (input: {
  link: AttachmentLinkSnapshot;
  publicToken: string;
  password?: string | null;
  now: Date;
}): Promise<AttachmentLinkDownloadDecision> => {
  const { link } = input;
  if (!isValidDate(input.now) || !tokenMatches(input.publicToken, link.tokenHash)) return unavailable;
  if (!isValidFileSize(link.fileSizeBytes) || !isValidDownloadCount(link.downloadCount)) return unavailable;
  if (!isValidMaxDownloads(link.maxDownloads)) return unavailable;
  if (link.expiresAt !== null && !isValidDate(link.expiresAt)) return unavailable;
  if (link.revokedAt !== null && !isValidDate(link.revokedAt)) return unavailable;
  if (link.revokedAt !== null || (link.expiresAt !== null && input.now.getTime() >= link.expiresAt.getTime())) return unavailable;
  if (link.maxDownloads !== null && link.downloadCount >= link.maxDownloads) return unavailable;

  if (link.passwordHash !== null) {
    if (typeof link.passwordHash !== "string" || link.passwordHash.length === 0 || !isValidPassword(input.password)) {
      return unavailable;
    }
    try {
      if (!(await Bun.password.verify(input.password, link.passwordHash))) return unavailable;
    } catch {
      return unavailable;
    }
  }

  // Persistence must claim this count atomically against the validated snapshot before streaming bytes.
  return { ok: true, nextDownloadCount: link.downloadCount + 1 };
};
