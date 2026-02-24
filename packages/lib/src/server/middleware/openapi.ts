import { resolver, type GenerateSpecOptions } from "hono-openapi";
import type { ZodType } from "zod";
import { getSync } from "@valentinkolb/cloud-core/services/settings";

// ==========================
// Response Helpers
// ==========================

/**
 * Helper to define JSON response schema for OpenAPI documentation.
 *
 * @param schema - Zod schema for the response body
 * @param description - Human-readable description of the response
 * @returns OpenAPI response object with application/json content type
 */
export const jsonResponse = <T extends ZodType>(schema: T, description: string) => ({
  description,
  content: {
    "application/json": {
      schema: resolver(schema),
    },
  },
});

/**
 * Helper to define image response for OpenAPI documentation.
 *
 * @param description - Human-readable description of the response
 * @returns OpenAPI response object with image/webp content type
 */
export const imageResponse = (description: string) => ({
  description,
  content: {
    "image/webp": {
      schema: { type: "string" as const, format: "binary" },
    },
  },
});

// ==========================
// OpenAPI Specification
// ==========================

/**
 * OpenAPI spec metadata for the API documentation.
 * Includes info, tags, and security schemes.
 */
export const openApiMeta: Partial<GenerateSpecOptions> = {
  documentation: {
    info: {
      title: `${getSync<string>("app.name") || "App"} API`,
      version: "0.0.1",
      description: "IPA Management Tool API",
    },
    servers: [{ url: "/api", description: "API Server" }],
    tags: [
      {
        name: "Auth",
        description: "Authentication endpoints (login, logout, refresh)",
      },
      { name: "Users", description: "User listing and search (admin)" },
      { name: "Groups", description: "Group listing and search (admin)" },
    ],
    components: {
      securitySchemes: {
        cookieAuth: {
          type: "apiKey",
          in: "cookie",
          name: "session_token",
          description: "Session cookie (automatically set after login)",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Bearer token in Authorization header",
        },
      },
    },
  },
};

// ==========================
// Security Requirements
// ==========================

/**
 * Security requirement for routes that need authentication.
 * Accepts either cookie or bearer token.
 */
export const requiresAuth = {
  security: [{ cookieAuth: [] as string[], bearerAuth: [] as string[] }],
};

/**
 * Security requirement for routes that need admin role.
 * Accepts either cookie or bearer token.
 */
export const requiresAdmin = {
  security: [{ cookieAuth: [] as string[], bearerAuth: [] as string[] }],
};

/**
 * Security requirement for routes that need IPA realm (ipa or ipa-limited).
 * Accepts either cookie or bearer token.
 */
export const requiresIpa = {
  security: [{ cookieAuth: [] as string[], bearerAuth: [] as string[] }],
};
