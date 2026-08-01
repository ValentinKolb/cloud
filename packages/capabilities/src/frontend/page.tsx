import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { loadCapabilityCatalog } from "../catalog";
import { ssr } from "../config";
import CapabilitiesWorkspace from "./CapabilitiesWorkspace.island";

export default ssr<AuthContext>(async (c) => {
  const catalog = await loadCapabilityCatalog(new URL(c.req.url));
  c.get("page").title = "Capabilities";

  return () => (
    <Layout c={c} fullWidth fullPage title={[{ title: "Start", href: "/" }, { title: "Capabilities" }]}>
      <div class="k2b-ui min-h-0 min-w-0 flex-1 overflow-hidden">
        <CapabilitiesWorkspace catalog={catalog} initialAttemptKey={crypto.randomUUID()} />
      </div>
    </Layout>
  );
});
