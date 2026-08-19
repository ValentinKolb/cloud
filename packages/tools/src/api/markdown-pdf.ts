import { type AuthContext, auth, jsonResponse, type RateLimitConfig, rateLimit, requiresAuth, v } from "@valentinkolb/cloud/server";
import {
  GotenbergRenderError,
  MARKDOWN_PDF_MAX_CUSTOM_CSS_BYTES,
  MARKDOWN_PDF_MAX_MARKDOWN_BYTES,
  MARKDOWN_PDF_TEMPLATE_IDS,
  MarkdownPdfError,
  renderMarkdownToPdf,
} from "@valentinkolb/cloud/services/pdf";
import { Hono, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { describeRoute } from "hono-openapi";
import { z } from "zod";

export const MARKDOWN_PDF_MAX_REQUEST_BYTES = 320 * 1024;
const MARKDOWN_PDF_MAX_ACTIVE_CONVERSIONS = 2;

export const MarkdownPdfRequestSchema = z
  .object({
    markdown: z.string().min(1),
    templateId: z.enum(MARKDOWN_PDF_TEMPLATE_IDS).optional(),
    customCss: z.string().optional(),
    filename: z.string().trim().min(1).max(255).default("document.pdf"),
  })
  .strict();

export const MarkdownPdfErrorSchema = z.object({
  code: z
    .enum([
      "bad_input",
      "markdown_too_large",
      "css_too_large",
      "invalid_css",
      "external_asset_unsupported",
      "html_too_large",
      "pdf_too_large",
      "renderer_not_configured",
      "renderer_busy",
      "renderer_timeout",
      "renderer_failed",
    ])
    .optional(),
  message: z.string(),
});

type RenderMarkdownPdf = typeof renderMarkdownToPdf;

type MarkdownPdfRouteDependencies = {
  authenticate?: MiddlewareHandler<AuthContext>;
  rateLimiter?: MiddlewareHandler<AuthContext>;
  render?: RenderMarkdownPdf;
};

const markdownPdfRateLimit: RateLimitConfig = {
  keyBy: "user",
  limitPerSecond: 4,
  windowSecs: 10,
};

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const noStore: MiddlewareHandler<AuthContext> = async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
};

const requestBodyLimit = bodyLimit({
  maxSize: MARKDOWN_PDF_MAX_REQUEST_BYTES,
  onError: (c) => c.json({ code: "bad_input" as const, message: "The request body exceeds the 320 KiB limit." }, 413),
});

const safePdfFilename = (filename: string): string => {
  const basename = filename.split(/[\\/]/u).at(-1)?.trim() || "document.pdf";
  const cleaned =
    basename
      .replace(/[\r\n/:*?"<>|\\]/gu, "-")
      .replace(/\s+/gu, " ")
      .trim() || "document.pdf";
  if (cleaned.toLowerCase() === ".pdf") return "document.pdf";
  return cleaned.toLowerCase().endsWith(".pdf") ? cleaned.slice(0, 255) : `${cleaned.slice(0, 251)}.pdf`;
};

const contentDisposition = (filename: string): string => {
  const safe = safePdfFilename(filename);
  const fallback =
    safe
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/gu, "")
      .replace(/[^\x20-\x7e]/gu, "_")
      .replace(/["\\]/gu, "_") || "document.pdf";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safe).replace(
    /['()*]/gu,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )}`;
};

const pdfResponse = (pdf: Uint8Array, filename: string): Response =>
  new Response(new Blob([pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer], { type: "application/pdf" }), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": contentDisposition(filename),
      "Content-Type": "application/pdf",
    },
  });

const renderError = (error: unknown): { code: string; message: string; status: 400 | 413 | 422 | 500 | 502 | 503 | 504 } => {
  if (error instanceof MarkdownPdfError) {
    return {
      code: error.code,
      message: error.message,
      status: error.code === "bad_input" ? 400 : 422,
    };
  }
  if (error instanceof GotenbergRenderError) {
    switch (error.code) {
      case "html_too_large":
      case "pdf_too_large":
        return { code: error.code, message: error.message, status: 413 };
      case "not_configured":
        return { code: "renderer_not_configured", message: "PDF rendering is not configured.", status: 503 };
      case "timeout":
        return { code: "renderer_timeout", message: "PDF rendering timed out.", status: 504 };
      case "bad_input":
        return { code: "bad_input", message: "The PDF render request is invalid.", status: 400 };
      case "bad_response":
      case "request_failed":
        return { code: "renderer_failed", message: "The PDF renderer could not complete the request.", status: 502 };
    }
  }
  return { code: "renderer_failed", message: "The PDF could not be generated.", status: 500 };
};

export const createMarkdownPdfRoutes = (dependencies: MarkdownPdfRouteDependencies = {}) => {
  const authenticate = dependencies.authenticate ?? auth.requireRole("authenticated");
  const rateLimiter = dependencies.rateLimiter ?? rateLimit(markdownPdfRateLimit);
  const render = dependencies.render ?? renderMarkdownToPdf;
  let activeConversions = 0;

  const rejectWhenBusy: MiddlewareHandler<AuthContext> = async (c, next) => {
    if (activeConversions >= MARKDOWN_PDF_MAX_ACTIVE_CONVERSIONS) {
      return c.json({ code: "renderer_busy" as const, message: "PDF rendering is busy. Try again in a moment." }, 503);
    }
    await next();
  };
  const reserveConversion: MiddlewareHandler<AuthContext> = async (c, next) => {
    if (activeConversions >= MARKDOWN_PDF_MAX_ACTIVE_CONVERSIONS) {
      return c.json({ code: "renderer_busy" as const, message: "PDF rendering is busy. Try again in a moment." }, 503);
    }
    activeConversions += 1;
    try {
      await next();
    } finally {
      activeConversions -= 1;
    }
  };

  return new Hono<AuthContext>().post(
    "/pdf",
    describeRoute({
      tags: ["Tools"],
      summary: "Convert Markdown to PDF",
      description:
        "Renders bounded untrusted Markdown with one code-owned print template or bounded custom CSS. Image references become links and are not fetched. The Markdown, CSS, and generated PDF are processed in memory and are not persisted.",
      ...requiresAuth,
      responses: {
        200: {
          description: "Generated PDF",
          content: { "application/pdf": { schema: { type: "string", format: "binary" } } },
        },
        400: jsonResponse(MarkdownPdfErrorSchema, "Invalid request"),
        401: jsonResponse(MarkdownPdfErrorSchema, "Authentication required"),
        413: jsonResponse(MarkdownPdfErrorSchema, "Input or output too large"),
        422: jsonResponse(MarkdownPdfErrorSchema, "Markdown or CSS cannot be rendered"),
        429: jsonResponse(MarkdownPdfErrorSchema, "Rate limit exceeded"),
        500: jsonResponse(MarkdownPdfErrorSchema, "Rendering failed"),
        502: jsonResponse(MarkdownPdfErrorSchema, "PDF renderer failed"),
        503: jsonResponse(MarkdownPdfErrorSchema, "PDF renderer unavailable or busy"),
        504: jsonResponse(MarkdownPdfErrorSchema, "PDF renderer timed out"),
      },
    }),
    authenticate,
    rateLimiter,
    noStore,
    rejectWhenBusy,
    requestBodyLimit,
    v("json", MarkdownPdfRequestSchema),
    reserveConversion,
    async (c) => {
      const input = c.req.valid("json");
      if (byteLength(input.markdown) > MARKDOWN_PDF_MAX_MARKDOWN_BYTES) {
        return c.json({ code: "markdown_too_large" as const, message: "Markdown exceeds the 256 KiB limit." }, 413);
      }
      if (input.customCss && byteLength(input.customCss) > MARKDOWN_PDF_MAX_CUSTOM_CSS_BYTES) {
        return c.json({ code: "css_too_large" as const, message: "Custom CSS exceeds the 32 KiB limit." }, 413);
      }
      try {
        const result = await render({ markdown: input.markdown, templateId: input.templateId, customCss: input.customCss });
        return pdfResponse(result.pdf, input.filename);
      } catch (cause) {
        const error = renderError(cause);
        return c.json({ code: error.code, message: error.message }, error.status);
      }
    },
  );
};

export default createMarkdownPdfRoutes();
