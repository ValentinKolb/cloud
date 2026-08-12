import type { AuthContext } from "@valentinkolb/cloud/server";
import { expectUserBackedActor } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { ssr } from "../config";
import { pulseService } from "../service";
import { projectBases } from "../service/public-resources";
import PulseOverview from "./PulseOverview.island";

export default ssr<AuthContext>(async (c) => {
  const user = expectUserBackedActor(c);
  const url = new URL(c.req.raw.url);
  const [basesResult, capabilitiesResult] = await Promise.all([pulseService.base.list(user), pulseService.capabilities()]);
  const bases = basesResult.ok ? await projectBases(basesResult.data) : [];
  const capabilities = capabilitiesResult.ok ? capabilitiesResult.data : null;

  return () => (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Pulse" }]}>
      <PulseOverview bases={bases} capabilities={capabilities} initialQuery={url.searchParams.get("q")?.trim() ?? ""} />
    </Layout>
  );
});
