import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { AppOverview } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import ToolsLayoutHelp from "./_components/help/ToolsLayoutHelp.island";
import ToolCatalog from "./ToolCatalog.island";
import { ToolsWorkspace } from "./ToolsWorkspace";

export default ssr<AuthContext>(async (c) => {
  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Tools" }]}>
      <ToolsLayoutHelp />
      <ToolsWorkspace>
        <AppOverview title="Tools" subtitle="Focused utilities for common data, media, security, and network tasks." icon="ti ti-tools">
          <AppOverview.Main title="Find a utility" description="Describe the task or browse the complete collection.">
            <ToolCatalog />
          </AppOverview.Main>
        </AppOverview>
      </ToolsWorkspace>
    </Layout>
  );
});
