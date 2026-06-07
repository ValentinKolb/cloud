/**
 * Generic public page handler for the three legal documents
 * (Terms / Privacy / Imprint), driven by the `legal.<kind>.*` settings.
 *
 * mode = "local"    → render markdown from `legal.<kind>.content`
 * mode = "external" → 302-redirect to `legal.<kind>.url`
 *
 * One small helper, three mounts in `gateway-ops/src/index.ts` — KISS.
 */

import { ssr } from "../../config";
import { coreSettings } from "@valentinkolb/cloud/services";
import { Layout } from "@valentinkolb/cloud/ssr";
import { MarkdownView } from "@valentinkolb/cloud/ui";
import { markdown } from "@valentinkolb/cloud/shared";

export type LegalKind = "terms" | "privacy" | "imprint";

type LegalMode = "local" | "external";

const TITLE_BY_KIND: Record<LegalKind, string> = {
  terms: "Terms of Service",
  privacy: "Privacy Policy",
  imprint: "Imprint",
};

export const makeLegalPage = (kind: LegalKind) =>
  ssr(async (c) => {
    const title = TITLE_BY_KIND[kind];
    const [rawMode, url, content] = await Promise.all([
      coreSettings.get<string>(`legal.${kind}.mode`),
      coreSettings.get<string>(`legal.${kind}.url`),
      coreSettings.get<string>(`legal.${kind}.content`),
    ]);
    const mode: LegalMode = rawMode === "external" ? "external" : "local";

    // External mode + URL set → redirect. Only valid escape from this handler.
    if (mode === "external" && url && url.trim().length > 0) {
      return c.redirect(url, 302);
    }

    const trimmedContent = (content ?? "").trim();
    const html = trimmedContent ? markdown.render(trimmedContent) : null;

    return () => (
      <Layout c={c} title={title}>
        <div class="container max-w-3xl p-4 sm:p-8">
          <h1 class="text-xl font-bold mb-4">{title}</h1>
          {html ? (
            <MarkdownView html={html} />
          ) : (
            <div class="paper p-6 text-center text-sm text-dimmed">
              {title} not configured. An administrator can set this in{" "}
              <a href="/admin/settings?tab=legal" class="underline">/admin/settings</a>.
            </div>
          )}
        </div>
      </Layout>
    );
  });
