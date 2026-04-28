export { api, respond } from "./api";
export { api as apiClient } from "./api-client";
export type { CreateApiClientConfig } from "./api-client";

export {
  middleware,
  auth,
  jsonResponse,
  imageResponse,
  openApiMeta,
  requiresAuth,
  requiresAdmin,
  requiresIpa,
  requiresIpaUser,
  requiresUser,
  rateLimit,
  requestLogger,
  validator,
  v,
} from "./middleware";
export type { AuthContext, RateLimitConfig, RateLimitRouteOverride } from "./middleware";
export type { AppContext } from "./app-context";

export {
  services,
  freeipa,
  images,
  password,
  generatePassword,
  geo,
  geoService,
  PERMISSION_LEVELS,
  hasPermission,
  createAccess,
  getAccess,
  updateAccess,
  deleteAccess,
  getEffectivePermission,
  resolveDisplayNames,
  ok,
  okMany,
  fail,
  err,
  unwrap,
  paginate,
  tryCatch,
  isServiceError,
} from "./services";
export type {
  AccessEntry,
  PermissionLevel,
  PrincipalType,
  Principal,
  ResourceAccessAdapter,
  GeoService,
  GeoPlace,
  Result,
  Paginated,
  PageParams,
  ServiceError,
  ServiceErrorCode,
} from "./services";
