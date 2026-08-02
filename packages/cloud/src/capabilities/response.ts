import type { z } from "zod";
import { CapabilityErrorSchema } from "../contracts/capabilities";
import type { CapabilityResultState } from "./types";

export const readCapabilityResponse = async <T>(response: Response, schema: z.ZodType<T>): Promise<CapabilityResultState<T>> => {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = CapabilityErrorSchema.safeParse(body);
    return {
      ok: false,
      error: error.success
        ? { ...error.data, status: response.status }
        : { code: "INVALID_APP_RESPONSE", message: "Cloud returned an invalid capability error", status: response.status },
    };
  }
  const result = schema.safeParse(body);
  return result.success
    ? { ok: true, data: result.data }
    : {
        ok: false,
        error: { code: "INVALID_APP_RESPONSE", message: "Cloud returned an invalid capability result", status: 502 },
      };
};
