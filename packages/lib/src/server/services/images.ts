import sharp from "sharp";

const getUserColor = (id: string): string => {
  const colors = [
    "#3b82f6",
    "#8b5cf6",
    "#ec4899",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#14b8a6",
    "#06b6d4",
    "#6366f1",
    "#a855f7",
  ];

  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }

  return colors[hash % colors.length]!;
};

/**
 * Extracts raw image data from a base64 WebP data URL.
 * @param dataUrl - Data URL in format "data:image/webp;base64,..."
 * @returns Buffer with raw image data, or null if format is invalid
 */
export const parseWebpDataUrl = (dataUrl: string): Buffer | null => {
  const match = dataUrl.match(/^data:image\/webp;base64,(.+)$/);
  return match ? Buffer.from(match[1]!, "base64") : null;
};

/**
 * Generates a fallback avatar with initials using Sharp.
 * Creates a colored square with the first 2 characters of the text.
 * Color is deterministically generated from the ID.
 *
 * @param id - Unique identifier (used for consistent color generation)
 * @param text - Text to extract initials from (first 2 chars, uppercased)
 * @returns Buffer containing 128x128 WebP image
 */
export const generateFallback = async (id: string, text: string): Promise<Buffer> => {
  const initials = text.slice(0, 2).toUpperCase();
  const color = getUserColor(id);

  const svg = `
    <svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
      <rect width="128" height="128" fill="${color}"/>
      <text x="50%" y="50%" dy="0.38em" text-anchor="middle"
            font-family="'JetBrains Mono', monospace"
            font-size="56" font-weight="600" fill="white">
        ${initials}
      </text>
    </svg>
  `;

  return sharp(Buffer.from(svg)).webp({ quality: 90 }).toBuffer();
};

/**
 * Creates a cacheable WebP image response.
 * @param data - Raw WebP image data as Buffer
 * @returns Response with correct Content-Type and 1-hour cache
 */
export const webpResponse = (data: Buffer): Response =>
  new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "no-cache",
    },
  });

export const images = {
  parseWebpDataUrl,
  generateFallback,
  webpResponse,
} as const;
