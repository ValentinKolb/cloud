import { ssr } from "../../../../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { listLegalLinks } from "@valentinkolb/cloud";
import { gridsService } from "../../../../service";
import PublicFormSubmit from "../../../_components/PublicFormSubmit.island";

/**
 * Public form rendering page. Anonymous, no auth required.
 * URL: /share/grids/forms/:token
 *
 * Bare layout — NO `<Layout>` chrome (no header / nav / sidebar). The
 * form page is a single self-contained surface optimised for mobile,
 * with a small legal-links footer to satisfy the imprint requirement.
 *
 * SSR fetches the form by its public token + the parent table's fields,
 * then hands both to the inline-submit island. The island POSTs the user
 * payload to /api/grids/forms/public/:token/submit (which is also gated
 * by token, so a 404 + an authoritative form-config-aware filter run
 * on the server).
 */
export default ssr<AuthContext>(async (c) => {
  const token = c.req.param("token");

  // Theme: anonymous users have no cookies normally, but if they do
  // (returning logged-in user opening a public form) honour it.
  const cookie = c.req.raw.headers.get("Cookie") ?? "";
  const themeMatch = cookie.match(/theme=([^;]+)/);
  c.get("page").theme = themeMatch?.[1] === "dark" ? "dark" : "light";

  const legalLinks = await listLegalLinks();

  const form = await gridsService.form.getByPublicToken(token);
  if (!form || !form.isActive) {
    c.get("page").title = "Form not found";
    return () => (
      <PublicShell legalLinks={legalLinks}>
        <div class="paper p-8 text-center text-sm text-dimmed">
          <i class="ti ti-alert-circle text-base mb-2 block" />
          This form is no longer available.
        </div>
      </PublicShell>
    );
  }

  // Only ship field metadata for fields the form actually exposes
  // AND only for user_input entries. form_value entries' fieldIds are
  // server-applied — the anonymous HTML must not contain their target
  // field metadata (would leak schema details, even if values are
  // applied server-side).
  //
  // Prefer the form's frozen fieldSnapshot when present (v3 Slice 6) —
  // editing the live field after publishing the form must not mutate
  // what the form renders. Fall back to live fields when the snapshot
  // is empty (default form, or pre-Slice-6 forms).
  const userInputIds = new Set(
    form.config.fields
      .filter((e) => e.kind === "user_input")
      .map((e) => e.fieldId),
  );
  const sourceFields = form.fieldSnapshot.length > 0
    ? form.fieldSnapshot
    : await gridsService.field.listByTable(form.tableId);
  const fields = sourceFields.filter((f) => userInputIds.has(f.id));

  c.get("page").title = form.config.title ?? form.name;
  c.get("page").description = form.config.description ?? undefined;

  // Sanitize the form object before hydration: strip form_value entries
  // (their `value` is server-only), drop fieldSnapshot / ownerUserId /
  // publicToken / timestamps. Mirrors the public DTO returned from
  // /api/grids/forms/public/:token. Without this, the hydration payload
  // leaks server-managed values into anonymous HTML.
  const safeForm = {
    ...form,
    config: {
      ...form.config,
      fields: form.config.fields.filter((e) => e.kind === "user_input"),
    },
    fieldSnapshot: [],
    ownerUserId: null,
    publicToken: null,
  };

  return () => (
    <PublicShell legalLinks={legalLinks}>
      <PublicFormSubmit publicToken={token} form={safeForm} fields={fields} />
    </PublicShell>
  );
});

// =============================================================================
// PublicShell — minimal page chrome shared by the form + the not-found state
// =============================================================================

type LegalLink = { label: string; href: string; icon?: string };

function PublicShell(props: { legalLinks: LegalLink[]; children: any }) {
  return (
    <div class="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950">
      <main class="flex-1 w-full max-w-2xl mx-auto px-4 py-6 sm:py-10">
        {props.children}
      </main>
      <footer class="shrink-0 w-full px-4 py-3 flex items-center justify-center flex-wrap gap-x-4 gap-y-1 text-xs text-dimmed">
        {props.legalLinks.map((link) => (
          <a href={link.href} class="hover:text-primary transition-colors flex items-center gap-1">
            {link.icon && <i class={`${link.icon} text-xs`} />}
            {link.label}
          </a>
        ))}
      </footer>
    </div>
  );
}
