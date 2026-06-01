// Cloud-specific server services
export { services } from "./services";
export { freeipa } from "./freeipa";

export {
  PERMISSION_LEVELS,
  hasPermission,
  createAccess,
  getAccess,
  updateAccess,
  deleteAccess,
  getEffectivePermission,
  resolveDisplayNames,
} from "./access";
export type { AccessEntry, PermissionLevel, PrincipalType, Principal, ResourceAccessAdapter } from "./access";

export { geo, geoService } from "./geo";
export type { GeoService, GeoPlace } from "./geo";
export { paginateItems } from "./pagination";

// Re-export from stdlib for backward compatibility
// Prefer importing directly from @valentinkolb/stdlib
import { svg as _svg, password as _password } from "@valentinkolb/stdlib";
export { ok, okMany, fail, err, unwrap, paginate, tryCatch, isServiceError, crypto, svg, password } from "@valentinkolb/stdlib";
export type { Result, Paginated, PageParams, ServiceError, ServiceErrorCode } from "@valentinkolb/stdlib";

// Compat aliases for old API names
export const images = { generateFallback: _svg.generateAvatar, parseWebpDataUrl: _svg.parseWebpDataUrl };
export const generatePassword = _password.random;
