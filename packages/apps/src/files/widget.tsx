import type { Context } from "hono";
import type { SessionUser } from "@/files/contracts";
import { hasRole } from "@/files/contracts";
import { filesService } from "./service";
import type { Widget } from "@valentinkolb/cloud/contracts/app"; /** * Create files widget. * Only shown for IPA users (who have file access). */
export async function createFilesWidget(c: Context, user?: SessionUser): Promise<Widget> {
  if (!user || !hasRole(user, "ipa")) return null;
  const bases = await filesService.base.listResolved({ user });
  const groupBases = bases.filter((b) => b.type === "group");
  return {
    id: "files",
    title: "Files",
    icon: "folders",
    content: (
      <div class="flex flex-col gap-2 flex-1 min-h-0 text-sm">
        <div class="flex flex-col gap-2 flex-1 min-h-0 overflow-y-auto">
          {/* Home */}
          <a href="/app/files/home" class="flex items-center gap-2 p-2 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors">
            <i class="ti ti-home text-blue-500" /> <span class="text-secondary">Home</span>
          </a>

          {/* Group folders */}
          {groupBases.length > 0 && (
            <div class="border-t border-zinc-200 dark:border-zinc-700 pt-2">
              <div class="text-xs text-dimmed mb-1">Groups</div>
              <div class="flex flex-col gap-1">
                {groupBases.map((base) => (
                  <a
                    href={`/app/files/group/${base.name}`}
                    class="flex items-center gap-2 p-1.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-sm"
                  >
                    <i class="ti ti-folder text-blue-400" /> <span class="text-secondary truncate">{base.name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Link to files */}
        <a href="/app/files" class="text-xs text-dimmed hover:text-primary transition-colors flex items-center gap-1 mt-1">
          <i class="ti ti-arrow-right text-[10px]" /> Open file manager
        </a>
      </div>
    ),
  };
}
