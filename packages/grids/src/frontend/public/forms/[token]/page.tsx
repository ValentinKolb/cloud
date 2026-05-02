import { ssr } from "../../../../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { gridsService } from "../../../../service";
import PublicFormSubmit from "../../../_components/PublicFormSubmit.island";

/**
 * Public form rendering page. Anonymous, no auth required.
 * URL: /public/grids/forms/:token
 *
 * SSR fetches the form by its public token + the parent table's fields,
 * then hands both to the inline-submit island. The island POSTs the user
 * payload to /api/grids/forms/public/:token/submit (which is also gated
 * by token, so a 404 + an authoritative form-config-aware filter run
 * on the server).
 */
export default ssr<AuthContext>(async (c) => {
  const token = c.req.param("token");

  const form = await gridsService.form.getByPublicToken(token);
  if (!form || !form.isActive) {
    return () => (
      <Layout c={c} title="Form not found">
        <div class="paper p-8 max-w-md mx-auto mt-16 text-center text-dimmed">
          <i class="ti ti-alert-circle text-sm" /> This form is no longer available.
        </div>
      </Layout>
    );
  }

  const fields = await gridsService.field.listByTable(form.tableId);

  return () => (
    <Layout c={c} title={form.config.title ?? form.name}>
      <PublicFormSubmit publicToken={token} form={form} fields={fields} />
    </Layout>
  );
});
