import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import HealthWebhooksPanel from "../../frontend/HealthWebhooksButton.island";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";

export default ssr<AuthContext>(async (c) => {
  return () => (
    <AdminLayout c={c} title="Webhooks" stretch>
      <GatewayOpsLayoutHelp />
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <HealthWebhooksPanel />
        </div>
      </div>
    </AdminLayout>
  );
});
