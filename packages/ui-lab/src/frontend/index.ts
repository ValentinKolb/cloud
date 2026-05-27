import { Hono } from "hono";
import { auth, type AuthContext } from "@valentinkolb/cloud/server";
import docsPage from "./docs/page";
import { defaultDocPage, docHref, uiLabDocs } from "./docs/registry";

export default new Hono<AuthContext>()
  .get("/", auth.requireRole("*"), (c) => c.redirect(docHref(defaultDocPage)))
  .get("/:section", auth.requireRole("*"), (c) => {
    const section = uiLabDocs.find((entry) => entry.id === c.req.param("section"));
    const firstPage = section?.pages[0];
    return firstPage ? c.redirect(docHref(firstPage)) : c.notFound();
  })
  .get("/:section/:slug", auth.requireRole("*"), ...docsPage);
