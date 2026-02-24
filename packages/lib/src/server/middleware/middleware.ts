import { auth } from "./auth";
import { imageResponse, jsonResponse, openApiMeta, requiresAdmin, requiresAuth, requiresIpa } from "./openapi";
import { rateLimit } from "./rate-limit";
import { requestLogger } from "./request-logger";
import { validator, v } from "./validator";

export const middleware = {
  auth,
  jsonResponse,
  imageResponse,
  openApiMeta,
  requiresAuth,
  requiresAdmin,
  requiresIpa,
  rateLimit,
  requestLogger,
  validator,
  v,
} as const;
