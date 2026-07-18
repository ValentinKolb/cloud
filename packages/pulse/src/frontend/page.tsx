import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import { pulseHelp } from "../help";
import { pulseService } from "../service";
import PulseLayoutHelp from "./PulseLayoutHelp.island";
import PulseOverview from "./PulseOverview.island";

export default ssr<AuthContext>(async (c) => {
  const user = c.get("user");
  const url = new URL(c.req.raw.url);
  const [basesResult, capabilitiesResult] = await Promise.all([pulseService.base.list(user), pulseService.capabilities()]);
  const bases = basesResult.ok ? basesResult.data : [];
  const capabilities = capabilitiesResult.ok ? capabilitiesResult.data : null;

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Pulse" }]}>
      <PulseLayoutHelp documents={pulseHelp.manifest} />
      <PulseOverview bases={bases} capabilities={capabilities} initialQuery={url.searchParams.get("q")?.trim() ?? ""} />
    </Layout>
  );
});
