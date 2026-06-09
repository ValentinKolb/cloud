import { Layout } from "@valentinkolb/cloud/ssr";
import type { AuthContext } from "@valentinkolb/cloud/server";
import { ssr } from "../../config";
import { pulseService } from "../../service";
import PulseWorkspace from "../PulseWorkspace.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);
  const baseId = c.req.param("baseId") ?? "";
  const [basesResult, baseResult, capabilitiesResult] = await Promise.all([
    pulseService.base.list(user),
    pulseService.base.get(baseId, user),
    pulseService.capabilities(),
  ]);
  const bases = basesResult.ok ? basesResult.data : [];
  const capabilities = capabilitiesResult.ok ? capabilitiesResult.data : null;

  if (!baseResult.ok) {
    return () => (
      <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Pulse", href: "/app/pulse" }, { title: "Base not found" }]}>
        <div class="mx-auto flex max-w-4xl flex-col items-center gap-4 py-12">
          <p class="flex items-center gap-1.5 text-xs text-dimmed">
            <i class="ti ti-alert-circle text-sm" />
            {baseResult.error.message}
          </p>
          <a href="/app/pulse" class="btn-primary btn-sm">
            Back to Pulse
          </a>
        </div>
      </Layout>
    );
  }

  return () => (
    <Layout
      c={c}
      fullWidth
      title={[{ title: "Start", href: "/" }, { title: "Pulse", href: "/app/pulse" }, { title: baseResult.data.name }]}
    >
      <PulseWorkspace
        initialBases={bases}
        initialCapabilities={capabilities}
        initialBaseId={baseResult.data.id}
        initialPath={url.pathname}
      />
    </Layout>
  );
});
