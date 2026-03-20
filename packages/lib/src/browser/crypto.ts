import { fromBase64, toBase64, fromBase32, toBase32, toHex, fromHex } from "../shared/encoding";
import { PASSWORD_WORDS } from "./password-words";

const DEFAULT_SIGNATURE_AGE = 1000 * 60 * 60; // 1 hour
const CLOCK_SKEW_TOLERANCE = 1000 * 30; // 30 seconds

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PASSWORD_UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const PASSWORD_LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const PASSWORD_DIGITS = "0123456789";
const PASSWORD_SYMBOLS = "!@#$%^&*()-_=+[]{}<>?";

export type RandomPasswordOptions = {
  length?: number;
  uppercase?: boolean;
  numbers?: boolean;
  symbols?: boolean;
};

export type MemorablePasswordOptions = {
  words?: number;
  capitalize?: boolean;
  fullWords?: boolean;
  separator?: string;
  addNumber?: boolean;
  addSymbol?: boolean;
};

export type PinPasswordOptions = {
  length?: number;
};

//====================================
// COMMON UTILITIES
//====================================

/**
 * Async hash a string using SHA-256
 * @param s - The string or Uint8Array to hash
 * @returns Hexadecimal hash string
 * @example hash("hello") // "2cf24d..."
 * @see common.hash for synchronous but slower version
 */
const hash = async (s: string | Uint8Array): Promise<string> => {
  const data = s instanceof Uint8Array ? s : encoder.encode(s);
  const hash = await globalThis.crypto.subtle.digest("SHA-256", data as BufferSource);
  return toHex(new Uint8Array(hash));
};

/**
 * Sync hash a string using FNV-1a algorithm. Don't use for security purposes!!
 * @param s - The string to hash
 * @returns Hexadecimal hash string
 */
const fnv1aHash = (s: string): string => {
  const FNV_OFFSET_BASIS = 2166136261;
  const FNV_PRIME = 16777619;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < s.length; i++) {
    hash ^= s.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16);
};

/**
 * Generate a human-readable ID with customizable segment lengths
 * @param pattern - Segment lengths as separate arguments (default: 3, 4, 3, 4)
 * @returns Hyphen-separated ID using alphanumeric characters
 * @example
 * readableId() // "a3X-B7nm-4Kp-qR9v"
 * readableId(5, 5) // "3nK4p-Xm9Bq"
 * readableId(8) // "nm4K9pXq" (no hyphens)
 * readableId(2, 4, 2, 4, 2) // "a3-B7nm-4K-qR9v-X2"
 */
const readableId = (...pattern: number[]): string => {
  if (pattern.length === 0) pattern = [3, 4, 3, 4];
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(pattern.reduce((a, b) => a + b)));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);

  let i = 0;
  return pattern
    .map((len) => {
      const start = i;
      const end = i + len;
      i = end;
      return chars.slice(start, end).join("");
    })
    .join("-");
};

/**
 * Generate a high-entropy key for symmetric encryption
 * @param length - Key length in bytes (default: 32 for 256-bit)
 * @returns Hex-encoded random key
 * @example
 * const key = generateKey(); // "a3f2b8c9d4e5f6..."
 * const key128 = generateKey(16); // 128-bit key
 */
const generateKey = (length: number = 32): string => {
  return toHex(globalThis.crypto.getRandomValues(new Uint8Array(length)));
};

const randomIndex = (max: number): number => {
  if (max <= 1) return 0;
  const ceiling = Math.floor(0x100000000 / max) * max;
  const buffer = new Uint32Array(1);

  do {
    globalThis.crypto.getRandomValues(buffer);
  } while (buffer[0]! >= ceiling);

  return buffer[0]! % max;
};

const randomPick = (source: string): string => source[randomIndex(source.length)]!;

const randomPickWord = (): string => PASSWORD_WORDS[randomIndex(PASSWORD_WORDS.length)]!;

const secureShuffle = <T>(items: T[]): T[] => {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
};

const insertPartAtRandomPosition = (parts: string[], value: string): void => {
  parts.splice(randomIndex(parts.length + 1), 0, value);
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const generateRandomPassword = (options: RandomPasswordOptions = {}): string => {
  const length = clamp(Math.floor(options.length ?? 20), 4, 64);
  const uppercase = options.uppercase ?? true;
  const numbers = options.numbers ?? true;
  const symbols = options.symbols ?? false;
  const pools: string[] = [PASSWORD_LOWERCASE];
  if (uppercase) pools.push(PASSWORD_UPPERCASE);
  if (numbers) pools.push(PASSWORD_DIGITS);
  if (symbols) pools.push(PASSWORD_SYMBOLS);

  const allChars = pools.join("");
  const required: string[] = [randomPick(PASSWORD_LOWERCASE)];
  if (uppercase) required.push(randomPick(PASSWORD_UPPERCASE));
  if (numbers) required.push(randomPick(PASSWORD_DIGITS));
  if (symbols) required.push(randomPick(PASSWORD_SYMBOLS));

  const chars = [...required];
  while (chars.length < length) {
    chars.push(randomPick(allChars));
  }

  return secureShuffle(chars).join("");
};

const transformMemorableWord = (word: string, options: Required<Pick<MemorablePasswordOptions, "capitalize" | "fullWords">>): string => {
  const base = options.fullWords ? word : word.slice(0, Math.max(3, Math.min(5, word.length)));
  return options.capitalize ? `${base[0]?.toUpperCase() ?? ""}${base.slice(1)}` : base;
};

const generateMemorablePassword = (options: MemorablePasswordOptions = {}): string => {
  const words = clamp(Math.floor(options.words ?? 4), 3, 10);
  const capitalize = options.capitalize ?? false;
  const fullWords = options.fullWords ?? true;
  const separator = options.separator ?? "-";
  const addNumber = options.addNumber ?? false;
  const addSymbol = options.addSymbol ?? false;
  const readableSymbols = "._+!";
  const parts = Array.from({ length: words }, () => transformMemorableWord(randomPickWord(), { capitalize, fullWords }));
  if (addNumber) insertPartAtRandomPosition(parts, randomPick(PASSWORD_DIGITS));
  if (addSymbol) insertPartAtRandomPosition(parts, randomPick(readableSymbols));
  return parts.join(separator);
};

const generatePin = (options: PinPasswordOptions = {}): string => {
  const length = clamp(Math.floor(options.length ?? 6), 3, 12);
  return Array.from({ length }, () => randomPick(PASSWORD_DIGITS)).join("");
};

export const common = {
  hash,
  fnv1aHash,
  readableId,
  uuid: () => globalThis.crypto.randomUUID(),
  generateKey,
};

export const password = {
  random: generateRandomPassword,
  memorable: generateMemorablePassword,
  pin: generatePin,
};

//====================================
// ASYMMETRIC ENCRYPTION (KEY PAIRS)
//====================================

/**
 * Split hybrid key into ECDSA and ECDH parts
 * @param hybridKey - Serialized hybrid key
 * @returns Tuple of [ecdsaKey, ecdhKey]
 */
const splitHybridKey = (hybridKey: string): [string, string] => {
  const prefix = hybridKey[0]; // Contains version and type
  const keys = hybridKey.slice(1);
  const [ecdsa, ecdh] = keys.split(":");
  return [`${prefix}${ecdsa}`, `${prefix}${ecdh}`];
};

/**
 * Deserialize a Base64 key string back to CryptoKey
 * @param serialized - Base64 string with type prefix
 * @param algorithm - Algorithm name
 * @param usages - Key usages
 * @returns CryptoKey
 */
const deserializeKey = async (serialized: string, algorithm: "ECDSA" | "ECDH", usages: KeyUsage[]): Promise<CryptoKey> => {
  // Extract version and type from first byte
  const firstByte = serialized.charCodeAt(0);
  const version = (firstByte >> 4) & 0x0f;
  const isPrivate = (firstByte & 0x0f) === 1;

  if (version !== 1) {
    throw new Error(`Unsupported key version: ${version}`);
  }

  const format = isPrivate ? "pkcs8" : "spki";
  const keyData = fromBase64(serialized.slice(1));
  return await globalThis.crypto.subtle.importKey(format, keyData as BufferSource, { name: algorithm, namedCurve: "P-256" }, true, usages);
};

/**
 * Create digital signature for authentication
 * @param data - Object containing private key and message to sign
 * @param data.privateKey - Serialized private key
 * @param data.message - Message to sign
 * @returns Signature with nonce and timestamp
 */
const sign = async (data: {
  privateKey: string;
  message: string;
}): Promise<{
  nonce: string;
  timestamp: number;
  signature: string;
}> => {
  const nonce = globalThis.crypto.randomUUID();
  const timestamp = Date.now();
  const { message, privateKey } = data;

  const [ecdsaKey] = splitHybridKey(privateKey);
  const messageBuffer = encoder.encode(`${nonce}:${message}:${timestamp}`);
  const signature = await globalThis.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await deserializeKey(ecdsaKey, "ECDSA", ["sign"]),
    messageBuffer as BufferSource,
  );

  return {
    nonce,
    timestamp,
    signature: toBase64(new Uint8Array(signature)),
  };
};

/**
 * Verify a digital signature
 * @param data - Verification parameters
 * @param data.publicKey - Serialized public key
 * @param data.signature - Base64 signature to verify
 * @param data.nonce - Unique nonce from signing
 * @param data.message - Original message
 * @param data.timestamp - Timestamp from signing
 * @param data.maxAge - Maximum age of signature in ms (default: 1 hour)
 * @returns True if signature is valid, false otherwise
 */
const verify = async (data: {
  publicKey: string;
  signature: string;
  nonce: string;
  timestamp: number;
  message: string;
  maxAge?: number;
}): Promise<boolean> => {
  const { signature, nonce, message, publicKey, timestamp, maxAge = DEFAULT_SIGNATURE_AGE } = data;

  const now = Date.now();

  // Reject timestamps too far in the future (clock skew)
  if (timestamp > now + CLOCK_SKEW_TOLERANCE) return false;

  // Reject timestamps too old
  if (now - timestamp > maxAge) return false;

  try {
    const [ecdsaKey] = splitHybridKey(publicKey);
    return await globalThis.crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      await deserializeKey(ecdsaKey, "ECDSA", ["verify"]),
      fromBase64(signature) as BufferSource,
      encoder.encode(`${nonce}:${message}:${timestamp}`) as BufferSource,
    );
  } catch {
    return false;
  }
};

/**
 * Generate hybrid key pair (ECDSA + ECDH)
 * @returns Object with serialized hybrid private and public keys
 * @example
 * const { privateKey, publicKey } = await generate();
 * // Can be used for signing and encryption
 */
const generate = async (): Promise<{
  privateKey: string;
  publicKey: string;
}> => {
  // Generate both key pairs
  const ecdsa = await globalThis.crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);

  const ecdh = await globalThis.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);

  // Export and combine keys with versioning
  const ecdsaPriv = toBase64(new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", ecdsa.privateKey)));
  const ecdhPriv = toBase64(new Uint8Array(await globalThis.crypto.subtle.exportKey("pkcs8", ecdh.privateKey)));
  const ecdsaPub = toBase64(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", ecdsa.publicKey)));
  const ecdhPub = toBase64(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", ecdh.publicKey)));

  // Version 1, type in lower nibble
  const privPrefix = String.fromCharCode(0x11); // version 1, private
  const pubPrefix = String.fromCharCode(0x10); // version 1, public

  return {
    privateKey: `${privPrefix}${ecdsaPriv}:${ecdhPriv}`,
    publicKey: `${pubPrefix}${ecdsaPub}:${ecdhPub}`,
  };
};

/**
 * Encrypt data using ECDH + AES-GCM
 * @param data - Object containing payload and public key
 * @param data.payload - String to encrypt
 * @param data.publicKey - Serialized hybrid public key
 * @returns Encrypted data with ephemeral public key
 * @example
 * const encrypted = await asymmetric.encrypt({ payload: "secret", publicKey });
 * @security Uses Additional Authenticated Data (AAD) to cryptographically bind the ephemeral
 * public key to the ciphertext, preventing key substitution attacks
 */
const asymEncrypt = async (data: { payload: string; publicKey: string }): Promise<string> => {
  const { payload, publicKey } = data;
  const [, ecdhKey] = splitHybridKey(publicKey);

  // Generate ephemeral key pair
  const ephemeral = await globalThis.crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);

  // Import recipient's public key
  const recipientPubKey = await deserializeKey(ecdhKey, "ECDH", []);

  // Derive shared secret via deriveBits
  const sharedSecret = await globalThis.crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: recipientPubKey,
    },
    ephemeral.privateKey,
    256, // 32 bytes
  );

  // Export public keys for binding
  const ephPubRaw = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", ephemeral.publicKey));

  // Create salt from ephemeral public key for context binding
  const salt = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", ephPubRaw)).slice(0, 16);

  // Import shared secret for HKDF
  const sharedKey = await globalThis.crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);

  // Derive encryption key with HKDF
  const encryptKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("asym:v1:encrypt"),
    },
    sharedKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );

  // Encrypt with ephemeral public key as AAD
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: ephPubRaw,
    },
    encryptKey,
    encoder.encode(payload),
  );

  // Format: version + ephemeral public key + iv + ciphertext
  const version = 0x01;
  const ephPubEncoded = toBase64(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki", ephemeral.publicKey)));

  const result = new Uint8Array([version, ...iv, ...new Uint8Array(encrypted)]);

  return `${ephPubEncoded}:${toBase64(result)}`;
};

/**
 * Decrypt data using ECDH + AES-GCM
 * @param data - Object containing payload and private key
 * @param data.payload - Encrypted data with ephemeral key
 * @param data.privateKey - Serialized hybrid private key
 * @returns Decrypted string
 * @example
 * const decrypted = await asymmetric.decrypt({ payload: encrypted, privateKey });
 * @security Verifies Additional Authenticated Data (AAD) to ensure the ciphertext
 * is bound to the original ephemeral key, failing if tampered
 */
const asymDecrypt = async (data: { payload: string; privateKey: string }): Promise<string> => {
  const { payload: encryptedData, privateKey } = data;
  const [ephPub, encData] = encryptedData.split(":") as [string, string];
  const encrypted = fromBase64(encData);

  // Check version
  const version = encrypted[0];
  if (version !== 0x01) {
    throw new Error(`Unsupported asymmetric encryption version: ${version}`);
  }

  const [, ecdhKey] = splitHybridKey(privateKey);
  const iv = encrypted.subarray(1, 13);
  const ciphertext = encrypted.subarray(13);

  // Import keys
  const ephemeralPub = await globalThis.crypto.subtle.importKey(
    "spki" as const,
    fromBase64(ephPub) as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );

  const myPrivateKey = await deserializeKey(ecdhKey, "ECDH", ["deriveBits"]);

  // Derive shared secret via deriveBits
  const sharedSecret = await globalThis.crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: ephemeralPub,
    },
    myPrivateKey,
    256, // 32 bytes
  );

  // Export ephemeral public key for salt
  const ephPubRaw = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", ephemeralPub));

  // For decryption, we'll use just the ephemeral key for salt
  // This is still secure as the ephemeral key is unique per encryption
  const salt = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", ephPubRaw)).slice(0, 16);

  // Import shared secret for HKDF
  const sharedKey = await globalThis.crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);

  // Derive decryption key with HKDF
  const decryptKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("asym:v1:encrypt"),
    },
    sharedKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  // Decrypt with ephemeral key as AAD
  const decrypted = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: ephPubRaw as BufferSource,
    },
    decryptKey,
    ciphertext as BufferSource,
  );

  return decoder.decode(decrypted);
};

/**
 * Asymmetric encryption utilities (hybrid ECDSA + ECDH)
 */
export const asymmetric = {
  generate,
  sign,
  verify,
  encrypt: asymEncrypt,
  decrypt: asymDecrypt,
};

//====================================
// SYMMETRIC ENCRYPTION
//====================================

/**
 * Derive an AES key from a password using PBKDF2 (slow, for passwords)
 * @param password - Password to derive key from
 * @returns AES-GCM CryptoKey for encryption/decryption
 */
const deriveKeyPBKDF2 = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
  const keyMaterial = await globalThis.crypto.subtle.importKey("raw", encoder.encode(password) as BufferSource, "PBKDF2", false, ["deriveKey"]);

  return await globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

/**
 * Derive an AES key using HKDF (fast, for high-entropy keys)
 * @param key - High-entropy key material
 * @returns AES-GCM CryptoKey for encryption/decryption
 */
const deriveKeyHKDF = async (key: string, salt: Uint8Array): Promise<CryptoKey> => {
  const keyMaterial = await globalThis.crypto.subtle.importKey("raw", encoder.encode(key) as BufferSource, "HKDF", false, ["deriveKey"]);

  return await globalThis.crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: salt as BufferSource,
      info: encoder.encode("sym:v1:encrypt") as BufferSource,
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

/**
 * Encrypt data using AES-GCM
 * @param data - Object containing payload, key and optional stretched flag
 * @param data.payload - String to encrypt
 * @param data.key - Password or key for encryption
 * @param data.stretched - Whether to use PBKDF2 (true) or HKDF (false), default: true
 * @returns Encrypted data as hex string (includes stretched flag and IV)
 * @example
 * const encrypted = await encrypt({ payload: "secret data", key: "user-password" });
 * const encrypted = await encrypt({ payload: "data", key: "high-entropy-key-(api-key)", stretched: false });
 */
const symEncrypt = async (data: { payload: string; key: string; stretched?: boolean }): Promise<string> => {
  const { payload, key, stretched = true } = data;

  // Generate random salt
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));

  // Derive key based on type
  const cryptoKey = stretched ? await deriveKeyPBKDF2(key, salt) : await deriveKeyHKDF(key, salt);

  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, encoder.encode(payload));

  // Format: [version (1 byte)] + [stretched flag (1 byte)] + [salt (16 bytes)] + [iv (12 bytes)] + [ciphertext]
  const version = 0x01;
  const flag = stretched ? 0x01 : 0x00;
  const result = new Uint8Array([version, flag, ...salt, ...iv, ...new Uint8Array(encrypted)]);

  return toHex(result);
};

/**
 * Decrypt AES-GCM encrypted data
 * @param data - Object containing payload and key for decryption
 * @param data.payload - Hex-encoded encrypted data
 * @param data.key - Password or key for decryption
 * @returns Decrypted string
 * @throws Error if decryption fails (wrong key or corrupted data)
 * @example
 * const decrypted = await decrypt({ payload: encryptedHex, key: "password" });
 */
const symDecrypt = async (data: { payload: string; key: string }): Promise<string> => {
  const encrypted = fromHex(data.payload);

  // Check version
  const version = encrypted[0];
  if (version !== 0x01) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  // Parse format: [version (1 byte)][flag (1 byte)][salt (16 bytes)][iv (12 bytes)][ciphertext]
  const stretched = encrypted[1] === 0x01;
  const salt = encrypted.subarray(2, 18);
  const iv = encrypted.subarray(18, 30);
  const ciphertext = encrypted.subarray(30);

  // Derive key with correct method
  const cryptoKey = stretched ? await deriveKeyPBKDF2(data.key, salt) : await deriveKeyHKDF(data.key, salt);

  const decrypted = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, cryptoKey, ciphertext as BufferSource);

  return decoder.decode(decrypted);
};

/**
 * Symmetric encryption utilities using AES-GCM
 */
export const symmetric = {
  encrypt: symEncrypt,
  decrypt: symDecrypt,
};

//====================================
// TOTP (Time-based One-Time Password)
//====================================

/**
 * Generate HMAC-based key from secret
 * @param secret - Base32 encoded secret
 * @param counter - Counter value (time-based)
 * @returns HMAC digest
 */
const generateHMAC = async (secret: Uint8Array, counter: bigint): Promise<Uint8Array> => {
  const key = await globalThis.crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);

  // Convert counter to 8-byte buffer (big-endian)
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, counter, false);

  const signature = await globalThis.crypto.subtle.sign("HMAC", key, buffer);
  return new Uint8Array(signature);
};

/**
 * Generate TOTP code from HMAC
 * @param hmac - HMAC digest
 * @param digits - Number of digits (default: 6)
 * @returns TOTP code
 */
const truncate = (hmac: Uint8Array, digits: number = 6): string => {
  const offset = hmac[hmac.length - 1]! & 0xf;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) | ((hmac[offset + 1]! & 0xff) << 16) | ((hmac[offset + 2]! & 0xff) << 8) | (hmac[offset + 3]! & 0xff);

  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, "0");
};

/**
 * Create a new TOTP secret and URI
 * @param label - Account label (e.g., email)
 * @param issuer - Service name
 * @returns TOTP URI and shared secret for storage (base32 encoded)
 * @note Do not store the secret in plain text, also do not share the uri over an untrusted channel
 */
const createTotp = async (data: {
  label: string;
  issuer: string;
}): Promise<{
  uri: string;
  secret: string;
}> => {
  const { label, issuer } = data;

  // Generate 20 random bytes (160 bits) for secret
  const secretBytes = globalThis.crypto.getRandomValues(new Uint8Array(20));
  const secret = toBase32(secretBytes);

  // Create otpauth URI (with plain secret for QR code)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });

  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(label)}?${params}`;

  return { uri, secret };
};

/**
 * Verify a TOTP token
 * @param token - 6-digit token from user
 * @param secret - Base32 encoded shared secret
 * @param window - Time window for verification (default: 1 = ±30 seconds)
 * @returns True if token is valid
 * @example
 * const isValid = await totp.verify(token: "123456", secret: "*************....");
 */
const verifyTotp = async (data: { token: string; secret: string; window?: number }): Promise<boolean> => {
  const { token, secret, window = 1 } = data;

  try {
    const secretBytes = fromBase32(secret);
    const timeStep = 30; // 30 seconds per step
    const currentTime = Math.floor(Date.now() / 1000);
    const counter = BigInt(Math.floor(currentTime / timeStep));

    // Check current and adjacent time windows
    for (let i = -window; i <= window; i++) {
      const testCounter = counter + BigInt(i);
      const hmac = await generateHMAC(secretBytes, testCounter);
      const testToken = truncate(hmac, 6);

      if (token === testToken) {
        return true;
      }
    }

    return false;
  } catch {
    // Decryption failed or other error
    return false;
  }
};

/**
 * TOTP interface
 */
export const totp = {
  create: createTotp,
  verify: verifyTotp,
};

export const crypto = {
  common,
  asymmetric,
  password,
  symmetric,
  totp,
} as const;
