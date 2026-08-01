import { CapabilityErrorSchema, capabilityResultSchema } from "@valentinkolb/cloud/contracts";
import { z } from "zod";

const ResultSchema = capabilityResultSchema(z.unknown());

export type CapabilityInvocationOutcome =
  | {
      ok: true;
      status: number;
      durationMs: number;
      result: z.infer<typeof ResultSchema>;
    }
  | {
      ok: false;
      status: number;
      durationMs: number;
      error: { code: string; message: string; details?: Record<string, unknown> };
    };

const safeTextMessage = (text: string): string | undefined => {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact || compact.startsWith("<")) return undefined;
  return compact.slice(0, 500);
};

export async function readCapabilityOutcome(response: Response, durationMs: number): Promise<CapabilityInvocationOutcome> {
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (response.ok) {
    const result = ResultSchema.safeParse(body);
    if (result.success) return { ok: true, status: response.status, durationMs, result: result.data };
    return {
      ok: false,
      status: response.status,
      durationMs,
      error: { code: "INVALID_RESPONSE", message: "The app returned an invalid capability result." },
    };
  }

  const error = CapabilityErrorSchema.safeParse(body);
  if (error.success) return { ok: false, status: response.status, durationMs, error: error.data };
  return {
    ok: false,
    status: response.status,
    durationMs,
    error: {
      code: "REQUEST_FAILED",
      message: safeTextMessage(text) ?? `The capability request failed with HTTP ${response.status}.`,
    },
  };
}
