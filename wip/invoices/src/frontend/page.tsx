import { ssr } from "../config";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppOverview } from "@valentinkolb/cloud/ui";

export default ssr<AuthContext>((c) => {
  return () => (
    <Layout c={c} fullWidth title={[{ title: "Start", href: "/" }, { title: "Invoices" }]}>
      <AppOverview
        title="Invoices"
        subtitle="Create structured invoices from reusable bases."
        icon="ti ti-file-invoice"
      >
        <AppOverview.Main title="Invoice workspaces" description="Set up a workspace before creating invoices.">
          <AppOverview.EmptyState
            title="Invoices are not set up yet"
            description="The next slice adds workspaces, issuer profiles, numbering sequences, and templates."
            icon="ti ti-file-invoice"
          />
        </AppOverview.Main>

        <AppOverview.Aside title="Next foundation" description="The app shell is ready for the invoice domain schema.">
          <div class="space-y-3 text-sm text-muted-foreground">
            <p>V1 starts with legal issuer data, immutable template versions, and atomic invoice numbering.</p>
            <p>Contacts will stay optional; manual recipient entry remains available.</p>
          </div>
        </AppOverview.Aside>
      </AppOverview>
    </Layout>
  );
});
