import { type AuthContext, auth } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import docsPage from "./docs/page";
import { defaultDocPage, docHref, uiLabDocs } from "./docs/registry";
import helpPage from "./help/page";

export default new Hono<AuthContext>()
  .get("/help", auth.requireRole("*"), ...helpPage)
  .get("/help/:topic", auth.requireRole("*"), ...helpPage)
  .get("/", auth.requireRole("*"), (c) => c.redirect(docHref(defaultDocPage)))
  .get("/:section", auth.requireRole("*"), (c) => {
    const section = uiLabDocs.find((entry) => entry.id === c.req.param("section"));
    const firstPage = section?.pages[0];
    return firstPage ? c.redirect(docHref(firstPage)) : c.notFound();
  })
  .get("/:section/:slug", auth.requireRole("*"), ...docsPage);
