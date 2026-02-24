//====================================
// COMMON UTILITIES
//====================================

// Base32 alphabet (RFC 4648)
const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const base32ReverseMap = new Map<string, number>();

// Initialize base32ReverseMap
for (let i = 0; i < base32Alphabet.length; i++) {
  base32ReverseMap.set(base32Alphabet[i]!, i);
}

// Check if native hex functions are available
const hasHexBuiltin = (() => typeof Uint8Array.prototype.toHex === "function" && typeof Uint8Array.fromHex === "function")();

//====================================
// BASE 64
//====================================

/**
 * Converts bytes to base64 string - optimized for both browser and Node.js
 */
export function toBase64(bytes: Uint8Array): string {
  // Node.js - use Buffer (fastest)
  if (typeof globalThis.Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  // Browser - chunked processing for large data
  const CHUNK_SIZE = 0x8000; // 32KB chunks to avoid stack overflow
  let binary = "";

  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

/**
 * Converts base64 string to bytes - optimized for both browser and Node.js
 */
export function fromBase64(base64: string): Uint8Array {
  // Node.js - use Buffer (fastest)
  if (typeof globalThis.Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  // Browser - optimized version
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

//====================================
// HEX
//====================================

/**
 * Converts bytes to hexadecimal string
 */
export function toHex(bytes: Uint8Array): string {
  if (hasHexBuiltin) return bytes.toHex();

  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i]!.toString(16).padStart(2, "0"));
  }
  return hex.join("");
}

/**
 * Converts hexadecimal string to bytes
 */
export function fromHex(hex: string): Uint8Array {
  if (hasHexBuiltin) return Uint8Array.fromHex(hex);

  if (hex.length % 2) throw new Error("unpadded hex string");

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

//====================================
// BASE 32
//====================================

/**
 * Converts bytes to base32 string - optimized for both browser and Node.js
 */
export function toBase32(bytes: Uint8Array): string {
  let result = "";
  let buffer = 0;
  let bufferBits = 0;

  for (let i = 0; i < bytes.length; i++) {
    buffer = (buffer << 8) | bytes[i]!;
    bufferBits += 8;

    while (bufferBits >= 5) {
      const index = (buffer >> (bufferBits - 5)) & 0x1f;
      result += base32Alphabet[index];
      bufferBits -= 5;
    }
  }

  // Handle remaining bits
  if (bufferBits > 0) {
    const index = (buffer << (5 - bufferBits)) & 0x1f;
    result += base32Alphabet[index];
  }

  // Add padding if needed
  const padding = (8 - (result.length % 8)) % 8;
  result += "=".repeat(padding);

  return result;
}

/**
 * Converts base32 string to bytes - optimized for both browser and Node.js
 */
export function fromBase32(base32: string): Uint8Array {
  // Remove any padding and convert to uppercase
  const normalized = base32.toUpperCase().replace(/=/g, "");

  // Decode Base32
  const bytes: number[] = [];
  let buffer = 0;
  let bufferBits = 0;

  for (let i = 0; i < normalized.length; i++) {
    const value = base32ReverseMap.get(normalized[i]!);
    if (value === undefined) continue; // Skip invalid characters

    buffer = (buffer << 5) | value;
    bufferBits += 5;

    while (bufferBits >= 8) {
      bytes.push((buffer >> (bufferBits - 8)) & 0xff);
      bufferBits -= 8;
    }
  }

  return new Uint8Array(bytes);
}

export const encoding = {
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  toBase32,
  fromBase32,
} as const;
