import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { Layout } from "@valentinkolb/cloud/core/ssr";
import { LinkCard } from "@valentinkolb/cloud/lib/ui";
import { tools } from "./tools/registry";

const featured = tools.filter((t) => t.featured);
const more = tools.filter((t) => !t.featured);

export default ssr<AuthContext>(async (c) => {
  return (
    <Layout c={c} title={[{ title: "Start", href: "/" }, { title: "Tools" }]}>
      <div class="max-w-4xl mx-auto">
        {/* Hero */}
        <div class="p-6 mb-4 text-center">
          <div class="flex items-center justify-center gap-3 mb-2">
            <div class="w-12 h-12 thumbnail bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
              <i class="ti ti-tools text-2xl text-zinc-600 dark:text-zinc-400" />
            </div>
          </div>
          <h1 class="text-xl font-semibold mb-1">Tools</h1>
          <p class="text-sm text-dimmed">IT utilities &mdash; everything runs locally in your browser</p>
        </div>

        {/* Privacy notice */}
        <div class="info-block-info mb-6 flex items-center gap-2">
          <i class="ti ti-shield-check shrink-0" />
          <span>All data stays on your device. Nothing is sent to a server.</span>
        </div>

        {/* Featured tools */}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
          {featured.map((tool) => (
            <LinkCard href={`/tools/${tool.id}`} title={tool.name} description={tool.description} icon={tool.icon} color={tool.color} />
          ))}
        </div>

        {/* More tools (collapsible) */}
        {more.length > 0 && (
          <details class="group">
            <summary class="flex items-center gap-2 cursor-pointer select-none px-1 py-2 text-dimmed hover:text-secondary transition-colors">
              <i class="ti ti-chevron-right text-sm transition-transform group-open:rotate-90" />
              <span class="text-xs font-semibold uppercase tracking-wider">More Tools ({more.length})</span>
            </summary>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              {more.map((tool) => (
                <LinkCard href={`/tools/${tool.id}`} title={tool.name} description={tool.description} icon={tool.icon} color={tool.color} />
              ))}
            </div>
          </details>
        )}
      </div>
    </Layout>
  );
});
