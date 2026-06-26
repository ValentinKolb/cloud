import * as settings from "../settings";

export type GotenbergRenderErrorCode =
  | "not_configured"
  | "html_too_large"
  | "pdf_too_large"
  | "request_failed"
  | "bad_response"
  | "timeout";

export class GotenbergRenderError extends Error {
  constructor(
    readonly code: GotenbergRenderErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GotenbergRenderError";
  }
}

export type GotenbergConfig = {
  url: string;
  username?: string;
  password?: string;
  timeoutMs: number;
  maxHtmlBytes: number;
  maxPdfBytes: number;
};

export type RenderHtmlToPdfInput = {
  html: string;
  filename?: string;
};

export type RenderHtmlToPdfResult = {
  pdf: Uint8Array;
  contentType: string;
};

export type GotenbergFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type RenderHtmlToPdfOptions = {
  fetch?: GotenbergFetch;
};

const DEFAULT_PDF_CONTENT_TYPE = "application/pdf";
const TEST_HTML = "<!doctype html><html><body><h1>Cloud PDF renderer test</h1></body></html>";

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const normalizeBaseUrl = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new GotenbergRenderError("not_configured", "Gotenberg URL is not configured.");
  }

  try {
    const parsed = new URL(trimmed);
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw new GotenbergRenderError("not_configured", "Gotenberg URL is invalid.");
  }
};

const basicAuthHeader = (config: GotenbergConfig): string | null => {
  const username = config.username?.trim() ?? "";
  const password = config.password ?? "";
  if (!username && !password) return null;
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
};

const abortSignal = (timeoutMs: number): AbortSignal => {
  if (timeoutMs <= 0) {
    throw new GotenbergRenderError("not_configured", "Gotenberg timeout must be greater than 0 ms.");
  }
  return AbortSignal.timeout(timeoutMs);
};

const sanitizeFetchError = (error: unknown): GotenbergRenderError => {
  if (error instanceof GotenbergRenderError) return error;
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new GotenbergRenderError("timeout", "Gotenberg request timed out.");
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new GotenbergRenderError("timeout", "Gotenberg request timed out.");
  }
  return new GotenbergRenderError("request_failed", "Gotenberg request failed.");
};

export const renderHtmlToPdfWithConfig = async (
  input: RenderHtmlToPdfInput,
  config: GotenbergConfig,
  options: RenderHtmlToPdfOptions = {},
): Promise<RenderHtmlToPdfResult> => {
  const htmlBytes = byteLength(input.html);
  if (htmlBytes > config.maxHtmlBytes) {
    throw new GotenbergRenderError("html_too_large", `HTML input is too large (${htmlBytes} bytes, limit ${config.maxHtmlBytes} bytes).`);
  }

  const baseUrl = normalizeBaseUrl(config.url);
  const form = new FormData();
  form.append("files", new Blob([input.html], { type: "text/html" }), "index.html");

  const headers = new Headers();
  const authHeader = basicAuthHeader(config);
  if (authHeader) headers.set("Authorization", authHeader);

  const transport = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await transport(`${baseUrl}/forms/chromium/convert/html`, {
      method: "POST",
      headers,
      body: form,
      signal: abortSignal(config.timeoutMs),
    });
  } catch (error) {
    throw sanitizeFetchError(error);
  }

  if (!response.ok) {
    throw new GotenbergRenderError("bad_response", `Gotenberg returned HTTP ${response.status}.`, response.status);
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > config.maxPdfBytes) {
    throw new GotenbergRenderError(
      "pdf_too_large",
      `PDF output is too large (${buffer.byteLength} bytes, limit ${config.maxPdfBytes} bytes).`,
    );
  }

  return {
    pdf: new Uint8Array(buffer),
    contentType: response.headers.get("content-type") || DEFAULT_PDF_CONTENT_TYPE,
  };
};

export const getGotenbergConfig = async (): Promise<GotenbergConfig> => ({
  url: await settings.get<string>("gotenberg.url"),
  username: await settings.get<string>("gotenberg.username"),
  password: await settings.get<string>("gotenberg.password"),
  timeoutMs: await settings.get<number>("gotenberg.timeout_ms"),
  maxHtmlBytes: await settings.get<number>("gotenberg.max_html_bytes"),
  maxPdfBytes: await settings.get<number>("gotenberg.max_pdf_bytes"),
});

export const renderHtmlToPdf = async (input: RenderHtmlToPdfInput, options: RenderHtmlToPdfOptions = {}): Promise<RenderHtmlToPdfResult> =>
  renderHtmlToPdfWithConfig(input, await getGotenbergConfig(), options);

export const testGotenberg = async (options: RenderHtmlToPdfOptions = {}): Promise<{ bytes: number; contentType: string }> => {
  const result = await renderHtmlToPdf({ html: TEST_HTML, filename: "index.html" }, options);
  return { bytes: result.pdf.byteLength, contentType: result.contentType };
};
