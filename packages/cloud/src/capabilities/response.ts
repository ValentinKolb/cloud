import type { z } from "zod";
import { CAPABILITY_FRAMEWORK_ERROR_CODES, CapabilityErrorSchema, CAPABILITY_MAX_RESULT_BYTES } from "../contracts/capabilities";
import { readBoundedJson } from "../_internal/bounded-json";
import type { CapabilityResultState } from "./types";

export const readCapabilityResponse = async <T>(response: Response, schema: z.ZodType<T>): Promise<CapabilityResultState<T>> => {
  const parsedBody = await readBoundedJson(response, CAPABILITY_MAX_RESULT_BYTES);
  if (!parsedBody.ok && parsedBody.reason === "too_large") {
    return {
      ok: false,
      error: {
        code: CAPABILITY_FRAMEWORK_ERROR_CODES.responseTooLarge,
        message: "Cloud returned an oversized capability response",
        status: 502,
      },
    };
  }
  const body = parsedBody.ok ? parsedBody.data : null;
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
