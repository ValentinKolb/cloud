import { ssr } from "../config";
import { type AuthContext } from "@valentinkolb/cloud/server";
import { Layout } from "@valentinkolb/cloud/ssr";
import { LinkCard } from "@valentinkolb/cloud/ui";
import { ToolsWorkspace } from "./ToolsWorkspace";
import { categoryOrder, categories, tools } from "./tools/registry";

export default ssr<AuthContext>(async (c) => {
  return () => (
    <Layout c={c} fullPage title={[{ title: "Start", href: "/" }, { title: "Tools" }]}>
      <ToolsWorkspace>
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-4">
          <header class="flex flex-col gap-1">
            <h1 class="text-xl font-semibold">Tools</h1>
            <p class="text-sm text-dimmed">Small utilities for testing, encoding, generating, and inspecting data.</p>
          </header>

          <div class="info-block-info flex items-start gap-2">
            <i class="ti ti-info-circle mt-0.5 shrink-0" />
            <span>
              Most tools run locally in your browser. Network tools may call the server when they need a stable endpoint or CORS-free
              requests.
            </span>
          </div>

          {categoryOrder.map((category) => {
            const items = tools.filter((tool) => tool.category === category);
            if (items.length === 0) return null;
            return (
              <section class="flex flex-col gap-2">
                <div class="flex items-center gap-2">
                  <i class={`${categories[category].icon} text-dimmed`} />
                  <h2 class="text-sm font-semibold">{categories[category].label}</h2>
                </div>
                <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {items.map((tool) => (
                    <LinkCard
                      href={`/tools/${tool.id}`}
                      title={tool.name}
                      description={tool.description}
                      icon={tool.icon}
                      color={tool.color}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </ToolsWorkspace>
    </Layout>
  );
});
