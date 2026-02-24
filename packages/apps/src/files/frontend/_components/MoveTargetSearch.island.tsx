import { createSignal, Show, For, createMemo, onMount } from "solid-js";
import { timing } from "@valentinkolb/cloud/lib/browser";
import { mutation as mutations } from "@valentinkolb/cloud/lib/browser";
import { apiClient } from "@/files/client";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { parseSelectionKey, type SelectionKey } from "./context";
import type { FileBaseInfo } from "@/files/contracts";
type MoveTargetSearchProps = {
  sourceBaseType: string;
  sourceBaseId: string;
  sourcePaths: string[];
  bases: FileBaseInfo[] /** For multi-base copy: all source selection keys */;
  allSourceKeys?: SelectionKey[] /** For multi-base copy: force copy mode */;
  isMultiBaseCopy?: boolean;
  onComplete: (target: { baseType: string; baseId: string; path: string; movedFiles: string[] }) => void;
  close: () => void;
};
type DirectoryResult = { path: string; name: string };
type DirectorySearchResponse = { directories: DirectoryResult[]; total: number };
type TransferResponse = { moved: boolean; transferred: number; errors: { path: string; error: string }[] };
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
const getErrorMessage = (value: unknown, fallback: string): string => {
  if (!isObject(value)) return fallback;
  const message = value["message"];
  return typeof message === "string" ? message : fallback;
};
const isDirectorySearchResponse = (value: unknown): value is DirectorySearchResponse => {
  if (!isObject(value)) return false;
  return Array.isArray(value["directories"]);
};
const isTransferResponse = (value: unknown): value is TransferResponse => {
  if (!isObject(value)) return false;
  return typeof value["moved"] === "boolean" && typeof value["transferred"] === "number" && Array.isArray(value["errors"]);
};
const formatDisplayPath = (path: string, baseName: string): string => {
  if (path === "/") return `/ (${baseName})`;
  const segments = path.split("/").filter(Boolean);
  if (segments.length <= 3) return path;
  return `/${segments[0]}/.../${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
};
export default function MoveTargetSearch(props: MoveTargetSearchProps) {
  const [selectedBase, setSelectedBase] = createSignal<FileBaseInfo>(
    props.bases.find((b) => b.type === props.sourceBaseType && b.id === props.sourceBaseId) ?? props.bases[0]!,
  );
  const [searchQuery, setSearchQuery] = createSignal("");
  const [directories, setDirectories] = createSignal<DirectoryResult[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [transferringPath, setTransferringPath] = createSignal<string | null>(null);
  const isSameBase = createMemo(() => {
    if (props.isMultiBaseCopy) return false;
    const base = selectedBase();
    return base.type === props.sourceBaseType && base.id === props.sourceBaseId;
  });
  const actionLabel = createMemo(() => (props.isMultiBaseCopy ? "Copy" : isSameBase() ? "Move" : "Copy"));
  const doSearch = async (query: string, base: FileBaseInfo) => {
    setLoading(true);
    try {
      const res = await apiClient[":baseType"][":baseId"].directories.$get({
        param: { baseType: props.sourceBaseType, baseId: props.sourceBaseId },
        query: { query, targetBaseType: base.type, targetBaseId: base.id, limit: "20" },
      });
      if (!res.ok) {
        setDirectories([]);
        return;
      }
      const data = await res.json();
      setDirectories(isDirectorySearchResponse(data) ? data.directories : []);
    } catch {
      setDirectories([]);
    } finally {
      setLoading(false);
    }
  };
  const { debouncedFn: debouncedSearch } = timing.debounce(doSearch, 300);
  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    debouncedSearch(value, selectedBase());
  };
  const handleBaseChange = (base: FileBaseInfo) => {
    setSelectedBase(base);
    setDirectories([]);
    doSearch(searchQuery(), base);
  };
  const transferMutation = mutations.create<
    { moved: boolean; transferred: number; errors: { path: string; error: string }[]; targetPath: string },
    { targetPath: string }
  >({
    mutation: async ({ targetPath }) => {
      const base = selectedBase();
      if (props.isMultiBaseCopy && props.allSourceKeys) {
        const byBase = new Map<string, { baseType: string; baseId: string; paths: string[] }>();
        for (const key of props.allSourceKeys) {
          const parsed = parseSelectionKey(key);
          if (!parsed) continue;
          const baseKey = `${parsed.baseType}:${parsed.baseId}`;
          if (!byBase.has(baseKey)) {
            byBase.set(baseKey, { baseType: parsed.baseType, baseId: parsed.baseId, paths: [] });
          }
          byBase.get(baseKey)!.paths.push(parsed.path);
        }
        let totalTransferred = 0;
        const allErrors: { path: string; error: string }[] = [];
        for (const source of byBase.values()) {
          const res = await apiClient[":baseType"][":baseId"].transfer.$post({
            param: { baseType: source.baseType, baseId: source.baseId },
            json: { paths: source.paths, targetBaseType: base.type, targetBaseId: base.id, targetPath },
          });
          if (res.ok) {
            const data = await res.json();
            if (isTransferResponse(data)) {
              totalTransferred += data.transferred;
              allErrors.push(...data.errors);
            } else {
              for (const path of source.paths) {
                allErrors.push({ path, error: "Transfer failed" });
              }
            }
          } else {
            for (const path of source.paths) {
              allErrors.push({ path, error: "Transfer failed" });
            }
          }
        }
        return { moved: false, transferred: totalTransferred, errors: allErrors, targetPath };
      }
      const res = await apiClient[":baseType"][":baseId"].transfer.$post({
        param: { baseType: props.sourceBaseType, baseId: props.sourceBaseId },
        json: { paths: props.sourcePaths, targetBaseType: base.type, targetBaseId: base.id, targetPath },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(getErrorMessage(data, "Transfer failed"));
      }
      const data = await res.json();
      if (!isTransferResponse(data)) throw new Error("Transfer failed");
      return { ...data, targetPath };
    },
    onSuccess: async (data) => {
      const base = selectedBase();
      if (data.errors.length > 0) {
        await prompts.alert(
          `Transferred ${data.transferred} item(s), but ${data.errors.length} failed:\n\n${data.errors.map((e) => `${e.path}: ${e.error}`).join("\n")}`,
          { title: "Partial Success", icon: "ti ti-alert-triangle" },
        );
      }
      props.close();
      const movedFiles =
        props.isMultiBaseCopy && props.allSourceKeys
          ? props.allSourceKeys.map((key) => key.split("/").pop() || "")
          : props.sourcePaths.map((p) => p.split("/").pop() || "");
      props.onComplete({ baseType: base.type, baseId: base.id, path: data.targetPath, movedFiles });
    },
    onError: (err) => {
      prompts.error(err.message);
      setTransferringPath(null);
    },
  });
  const handleTransfer = async (targetPath: string) => {
    setTransferringPath(targetPath);
    await transferMutation.mutate({ targetPath });
  };
  onMount(() => doSearch("", selectedBase()));
  return (
    <div class="flex flex-col gap-4">
      {/* Info */}
      <Show
        when={!props.isMultiBaseCopy}
        fallback={
          <div class="flex items-center gap-2 text-xs text-dimmed">
            <i class="ti ti-copy" /> <span>Files from multiple locations will be copied.</span>
          </div>
        }
      >
        <div class="flex flex-col gap-1 text-xs text-dimmed">
          <div class="flex items-center gap-2">
            <i class="ti ti-arrow-move-right" />
            <span>
              <strong>Same location:</strong> Files are moved.
            </span>
          </div>
          <div class="flex items-center gap-2">
            <i class="ti ti-copy" />
            <span>
              <strong>Different location:</strong> Files are copied.
            </span>
          </div>
        </div>
      </Show>
      {/* Base chips */}
      <div class="flex flex-wrap gap-1.5">
        <For each={props.bases}>
          {(base) => {
            const isSelected = () => selectedBase().type === base.type && selectedBase().id === base.id;
            const isCurrent = base.type === props.sourceBaseType && base.id === props.sourceBaseId;
            return (
              <button
                type="button"
                onClick={() => handleBaseChange(base)}
                class={`chip ${isSelected() ? "bg-zinc-200 dark:bg-zinc-700 text-primary font-medium" : "text-secondary hover:bg-zinc-100 dark:hover:bg-zinc-800"}`}
              >
                <i class={`ti ${base.type === "home" ? "ti-home" : "ti-users-group"}`} /> {base.name}
                <Show when={isCurrent}>
                  <span class="opacity-60">(current)</span>
                </Show>
              </button>
            );
          }}
        </For>
      </div>
      {/* Search */}
      <div class="group relative flex">
        <div class="absolute left-3 inset-y-0 flex items-center pointer-events-none text-zinc-400 dark:text-zinc-500">
          <i class="ti ti-search group-focus-within:hidden" /> <i class="ti ti-pencil hidden text-blue-500 group-focus-within:block" />
        </div>
        <input
          type="text"
          class="input-subtle w-full pl-9"
          placeholder="Search folders..."
          value={searchQuery()}
          onInput={(e) => handleSearchInput(e.currentTarget.value)}
          autofocus
        />
      </div>
      {/* Results */}
      <div class="h-48 overflow-y-auto">
        <Show when={loading()}>
          <div class="flex items-center justify-center py-8 text-dimmed">
            <i class="ti ti-loader-2 animate-spin text-xl" />
          </div>
        </Show>
        <Show when={!loading() && directories().length === 0}>
          <div class="flex items-center gap-2 text-xs text-dimmed py-4 px-3">
            <i class="ti ti-folder-off" /> <span>No folders found</span>
          </div>
        </Show>
        <Show when={!loading() && directories().length > 0}>
          <div class="flex flex-col app-divider">
            <For each={directories()}>
              {(dir) => (
                <div class="flex items-center gap-3 px-2 py-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <div class="flex shrink-0 items-center justify-center thumbnail bg-zinc-100 dark:bg-zinc-800 text-dimmed h-8 w-8">
                    <i class="ti ti-folder text-sm" />
                  </div>
                  <div class="flex-1 min-w-0 text-sm truncate">{formatDisplayPath(dir.path, selectedBase().name)}</div>
                  <button
                    type="button"
                    onClick={() => handleTransfer(dir.path)}
                    disabled={transferringPath() !== null}
                    class="btn-primary btn-sm disabled:opacity-50"
                  >
                    <Show
                      when={transferringPath() === dir.path}
                      fallback={
                        <>
                          {actionLabel()} <i class="ti ti-arrow-right" />
                        </>
                      }
                    >
                      <i class="ti ti-loader-2 animate-spin" />
                    </Show>
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
