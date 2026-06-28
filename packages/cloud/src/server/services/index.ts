// Cloud-specific server services

export type {
  AccessEntry,
  AccessSubject,
  AccessUser,
  AccessUserSource,
  PermissionLevel,
  Principal,
  PrincipalType,
  ResourceAccessAdapter,
} from "./access";
export {
  createAccess,
  deleteAccess,
  getAccess,
  getEffectivePermission,
  hasPermission,
  listUsersWithAccess,
  PERMISSION_LEVELS,
  resolveDisplayNames,
  updateAccess,
} from "./access";
export { freeipa } from "./freeipa";
export type { GeoPlace, GeoService } from "./geo";

export { geo, geoService } from "./geo";
export { paginateItems } from "./pagination";
export { services } from "./services";

// Re-export from stdlib for backward compatibility
// Prefer importing directly from @valentinkolb/stdlib
import { password as _password, svg as _svg } from "@valentinkolb/stdlib";

export type { PageParams, Paginated, Result, ServiceError, ServiceErrorCode } from "@valentinkolb/stdlib";
export { crypto, err, fail, isServiceError, ok, okMany, paginate, password, svg, tryCatch, unwrap } from "@valentinkolb/stdlib";

// Compat aliases for old API names
export const images = { generateFallback: _svg.generateAvatar, parseWebpDataUrl: _svg.parseWebpDataUrl };
export const generatePassword = _password.random;
