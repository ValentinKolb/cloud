import type { AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { loadCapabilityApp, type SelectedCapability } from "../catalog";
import { ssr } from "../config";
import { type CapabilityKind, capabilityHref } from "../routes";
import CapabilitiesWorkspace from "./CapabilitiesWorkspace.island";
import type { CapabilitySearchEntry } from "./CapabilitySearchButton.island";

export default ssr<AuthContext>(async (c) => {
  const appId = c.req.param("appId");
  const capabilityId = c.req.param("capabilityId");
  const kind = c.req.param("kind") as CapabilityKind | undefined;
  if (!appId || !capabilityId || (kind !== "query" && kind !== "action")) return c.notFound();

  const loaded = await loadCapabilityApp(appId);
  if (loaded.kind !== "ready") return c.notFound();
  let selection: SelectedCapability;
  if (kind === "query") {
    const operation = loaded.manifest.queries.find((candidate) => candidate.localId === capabilityId);
    if (!operation) return c.notFound();
    selection = { app: loaded.app, manifest: loaded.manifest, kind, operation };
  } else {
    const operation = loaded.manifest.actions.find((candidate) => candidate.localId === capabilityId);
    if (!operation) return c.notFound();
    selection = { app: loaded.app, manifest: loaded.manifest, kind, operation };
  }
  const searchEntries: CapabilitySearchEntry[] = [
    ...loaded.manifest.queries.map((query) => ({
      href: capabilityHref({ appId, kind: "query", capabilityId: query.localId }),
      label: query.title,
      description: `Query · ${query.description}`,
      icon: "ti ti-search",
    })),
    ...loaded.manifest.actions.map((action) => ({
      href: capabilityHref({ appId, kind: "action", capabilityId: action.localId }),
      label: action.title,
      description: `Action · ${action.description}`,
      icon: "ti ti-bolt",
    })),
  ];

  c.get("page").title = selection.operation.title;
  return () => (
    <Layout
      c={c}
      fullWidth
      fullPage
      title={[
        { title: "Capabilities", href: capabilityHref({}) },
        { title: loaded.app.name, href: capabilityHref({ appId }) },
        { title: selection.operation.title },
      ]}
    >
      <div class="k2b-ui min-h-0 min-w-0 flex-1 overflow-hidden">
        <CapabilitiesWorkspace selection={selection} searchEntries={searchEntries} initialAttemptKey={crypto.randomUUID()} />
      </div>
    </Layout>
  );
});
