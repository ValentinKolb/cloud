import { err, fail, isServiceError, ok, okMany, paginate, password, svg, tryCatch, unwrap } from "@valentinkolb/stdlib";
import * as access from "./access";
import { freeipa } from "./freeipa";
import { geo } from "./geo";

export const services = {
  access,
  freeipa,
  geo,
  images: { generateFallback: svg.generateAvatar, parseWebpDataUrl: svg.parseWebpDataUrl },
  password,
  result: { ok, okMany, fail, err, unwrap, paginate, tryCatch, isServiceError },
} as const;
