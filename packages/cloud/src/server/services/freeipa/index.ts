import * as client from "./client";
import * as session from "./session";
import * as util from "./util";

export const freeipa = {
  client,
  session,
  util,
} as const;
