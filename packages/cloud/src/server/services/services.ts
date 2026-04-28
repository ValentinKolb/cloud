import * as access from "./access";
import { freeipa } from "./freeipa";
import { geo } from "./geo";
import { svg, password, ok, okMany, fail, err, unwrap, paginate, tryCatch, isServiceError } from "@valentinkolb/stdlib";

export const services = {
  access,
  freeipa,
  geo,
  images: { generateFallback: svg.generateAvatar, parseWebpDataUrl: svg.parseWebpDataUrl },
  password,
  result: { ok, okMany, fail, err, unwrap, paginate, tryCatch, isServiceError },
} as const;
