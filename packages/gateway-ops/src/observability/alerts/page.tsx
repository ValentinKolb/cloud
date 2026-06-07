import { type AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../../config";
import HealthWebhooksPanel from "../../frontend/HealthWebhooksButton.island";

export default ssr<AuthContext>(async (c) => {
  return () => (
    <AdminLayout c={c} title="Webhooks" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <HealthWebhooksPanel />
        </div>
      </div>
    </AdminLayout>
  );
});
