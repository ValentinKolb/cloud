import { auth } from "./auth";
import { imageResponse, jsonResponse, openApiMeta, requiresAdmin, requiresAuth, requiresIpa, requiresIpaUser, requiresUser } from "./openapi";
import { rateLimit } from "./rate-limit";
import { requestLogger } from "./request-logger";
import { validator, v } from "./validator";

export const middleware = {
  get auth() {
    return auth;
  },
  get jsonResponse() {
    return jsonResponse;
  },
  get imageResponse() {
    return imageResponse;
  },
  get openApiMeta() {
    return openApiMeta;
  },
  get requiresAuth() {
    return requiresAuth;
  },
  get requiresAdmin() {
    return requiresAdmin;
  },
  get requiresIpa() {
    return requiresIpa;
  },
  get requiresIpaUser() {
    return requiresIpaUser;
  },
  get requiresUser() {
    return requiresUser;
  },
  get rateLimit() {
    return rateLimit;
  },
  get requestLogger() {
    return requestLogger;
  },
  get validator() {
    return validator;
  },
  get v() {
    return v;
  },
} as const;
