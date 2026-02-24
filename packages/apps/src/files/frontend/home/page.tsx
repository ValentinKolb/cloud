import { ssr } from "@valentinkolb/cloud/core/config";
import type { Context } from "hono";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { decodeHomeSegments, filePageUrl } from "../url";
import { renderFilesBasePage } from "../[baseType]/[baseId]/page";

const getHomePathFromRequest = (c: Context<AuthContext>, userUid: string): { path: string; isLegacyUidPath: boolean } => {
  const queryPath = c.req.query("path");
  if (queryPath) return { path: queryPath, isLegacyUidPath: false };

  const pathname = new URL(c.req.url).pathname;
  const marker = "/app/files/home";
  let rest = pathname.startsWith(marker) ? pathname.slice(marker.length) : "";
  rest = rest.replace(/^\/+/, "");
  if (!rest) return { path: "/", isLegacyUidPath: false };

  const decoded = decodeHomeSegments(rest.split("/").filter(Boolean)).split("/").filter(Boolean);

  // Compatibility for old URLs: /app/files/home/:uid[/...]
  let isLegacyUidPath = false;
  if (decoded[0] === userUid) {
    isLegacyUidPath = true;
    decoded.shift();
  }

  return {
    path: decoded.length > 0 ? `/${decoded.join("/")}` : "/",
    isLegacyUidPath,
  };
};

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const { path, isLegacyUidPath } = getHomePathFromRequest(c, user.uid);

  if (isLegacyUidPath) {
    return c.redirect(filePageUrl("home", user.uid, path), 302);
  }

  return renderFilesBasePage(c, {
    baseType: "home",
    baseId: user.uid,
    path,
  });
});
