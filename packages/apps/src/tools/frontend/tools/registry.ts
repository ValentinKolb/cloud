export type ToolCategory = "generators" | "encoders" | "security" | "media";

export type ToolDef = {
  id: string;
  name: string;
  icon: string;
  description: string;
  category: ToolCategory;
  color: "blue" | "emerald" | "violet" | "orange" | "red" | "amber" | "zinc";
  /** Show prominently on the overview page */
  featured?: boolean;
};

export const categories: Record<ToolCategory, { label: string; icon: string }> = {
  generators: { label: "Generators", icon: "ti ti-sparkles" },
  encoders: { label: "Encoders", icon: "ti ti-arrows-exchange" },
  security: { label: "Security", icon: "ti ti-shield-lock" },
  media: { label: "Media", icon: "ti ti-photo" },
};

export const tools: ToolDef[] = [
  // Generators
  {
    id: "mailto",
    name: "Mailto Link",
    icon: "ti ti-mail-forward",
    description: "Build mailto links with To, CC, BCC, Subject & Body",
    category: "generators",
    color: "blue",
    featured: true,
  },
  {
    id: "qr",
    name: "QR Code",
    icon: "ti ti-qrcode",
    description: "Generate QR codes for URLs, WiFi, vCards & more",
    category: "generators",
    color: "emerald",
    featured: true,
  },
  {
    id: "uuid",
    name: "UUID",
    icon: "ti ti-fingerprint",
    description: "Generate random UUIDs (v4)",
    category: "generators",
    color: "blue",
  },
  {
    id: "lorem",
    name: "Lorem Ipsum",
    icon: "ti ti-align-left",
    description: "Generate placeholder text",
    category: "generators",
    color: "emerald",
  },
  // Encoders
  {
    id: "encoding",
    name: "Base64 / Hex / Base32",
    icon: "ti ti-transform",
    description: "Encode and decode text in various formats",
    category: "encoders",
    color: "violet",
  },
  {
    id: "color",
    name: "Color Converter",
    icon: "ti ti-palette",
    description: "Convert between HEX, RGB, HSL",
    category: "encoders",
    color: "orange",
  },
  // Security
  {
    id: "hash",
    name: "Hash Generator",
    icon: "ti ti-hash",
    description: "Generate SHA-256 and FNV-1a hashes",
    category: "security",
    color: "red",
  },
  {
    id: "encryption",
    name: "Encryption",
    icon: "ti ti-lock",
    description: "Symmetric (AES-GCM) & asymmetric (ECDH) encryption",
    category: "security",
    color: "amber",
    featured: true,
  },
  // Media
  {
    id: "image",
    name: "Image Processor",
    icon: "ti ti-photo-edit",
    description: "Resize, crop, filter, rotate & export images",
    category: "media",
    color: "violet",
    featured: true,
  },
];

/**
 * Returns one tool definition by id for route resolution and detail pages.
 */
export const toolById = (id: string): ToolDef | undefined => tools.find((t) => t.id === id);

/**
 * Returns all tool definitions that belong to the requested category.
 */
export const toolsByCategory = (category: ToolCategory): ToolDef[] => tools.filter((t) => t.category === category);
