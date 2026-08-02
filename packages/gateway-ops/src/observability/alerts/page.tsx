import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import HealthWebhooksPanel from "../../frontend/HealthWebhooksButton.island";

export default ssr<AuthContext>(async (c) => {
  return () => (
    <AdminLayout c={c} title="Webhooks">
      <div class="app-rows">
        <HealthWebhooksPanel />
      </div>
    </AdminLayout>
  );
});
