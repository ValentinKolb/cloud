import type { Widget } from "@valentinkolb/cloud/contracts/app";
import { tools } from "./frontend/tools/registry";

const featured = tools.filter((t) => t.featured);

export function createToolsWidget(): Widget {
  return {
    id: "tools",
    title: "Tools",
    icon: "tools",
    content: (
      <div class="flex flex-col gap-2 flex-1 text-sm overflow-y-auto">
        <div class="flex flex-col gap-1 flex-1">
          {featured.map((tool) => (
            <a
              href={`/tools/${tool.id}`}
              class="flex items-center gap-2 p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm"
            >
              <i class={`${tool.icon} text-blue-400`} />
              <span class="text-secondary truncate">{tool.name}</span>
            </a>
          ))}
        </div>
        <a href="/tools" class="text-xs text-dimmed hover:text-primary transition-colors flex items-center gap-1 mt-1">
          <i class="ti ti-arrow-right text-[10px]" />
          All Tools ({tools.length})
        </a>
      </div>
    ),
  };
}
