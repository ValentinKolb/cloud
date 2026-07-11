/**
 * AI skills management UI — one implementation for all three surfaces:
 * - user modal (own skills, workspace catalog, shared offers with consent toggle)
 * - admin settings (workspace skills, code review queue, audit log)
 * - review flow (file browser in read mode + approve/revoke actions)
 *
 * Talks to the platform API at /api/ai/skills (see ai/skills-routes.ts).
 */
import { createZip, downloadFileFromContent, extractZip } from "@valentinkolb/stdlib/browser";
import { mutation } from "@valentinkolb/stdlib/solid";
import { createMemo, createResource, createSignal, For, Match, Show, Switch as SolidSwitch } from "solid-js";
import type { AiSkill, AiSkillEvent, AiSkillFileStat, AiSkillUserView } from "../../ai/skills-store";
import type { AccessEntry, PermissionLevel, Principal } from "../../contracts/shared";
import { dialogCore } from "../dialog-core";
import { Switch, TextInput } from "../input";
import { prompts } from "../prompts";
import { toast } from "../toast";
import { type FileSource, FileBrowserPanel } from "./FileBrowser";
import PanelDialog, { panelDialogOptions } from "./PanelDialog";
import PermissionEditor from "./PermissionEditor";
import Placeholder from "./Placeholder";

// ── API client ─────────────────────────────────────────────────────────────

const BASE = "/api/ai/skills";

const readError = async (response: Response, fallback: string): Promise<string> => {
  const body = await response.json().catch(() => null);
  return body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : fallback;
};

const req = async <T,>(path: string, init?: RequestInit & { fallback?: string }): Promise<T> => {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init?.headers } : init?.headers,
  });
  if (!response.ok) throw new Error(await readError(response, init?.fallback ?? "Request failed"));
  return (await response.json()) as T;
};

type SkillFileContent = { path: string; mediaType: string; size: number; encoding: "utf8" | "base64"; content: string };
type SkillDetail = { skill: AiSkillUserView | AiSkill; files: AiSkillFileStat[]; canManage: boolean };

export const aiSkillsApi = {
  list: () => req<{ skills: AiSkillUserView[] }>("", { fallback: "Failed to load skills" }),
  create: (input: { slug: string; description?: string; workspace?: boolean }) =>
    req<{ skill: AiSkill }>("", { method: "POST", body: JSON.stringify(input), fallback: "Failed to create skill" }),
  detail: (skillId: string) => req<SkillDetail>(`/${skillId}`, { fallback: "Failed to load skill" }),
  update: (skillId: string, input: { enabled?: boolean }) =>
    req<{ skill: AiSkill }>(`/${skillId}`, { method: "PATCH", body: JSON.stringify(input), fallback: "Failed to save skill" }),
  remove: (skillId: string) => req<{ deleted: boolean }>(`/${skillId}`, { method: "DELETE", fallback: "Failed to delete skill" }),
  readFile: (skillId: string, path: string) =>
    req<SkillFileContent>(`/${skillId}/file?path=${encodeURIComponent(path)}`, { fallback: "Failed to load file" }),
  writeFile: (skillId: string, input: { path: string; content: string; encoding?: "utf8" | "base64"; mediaType?: string }) =>
    req<{ files: AiSkillFileStat[] }>(`/${skillId}/file`, { method: "PUT", body: JSON.stringify(input), fallback: "Failed to save file" }),
  deleteFile: (skillId: string, path: string) =>
    req<{ files: AiSkillFileStat[] }>(`/${skillId}/file?path=${encodeURIComponent(path)}`, {
      method: "DELETE",
      fallback: "Failed to delete file",
    }),
  setState: (skillId: string, state: "enabled" | "disabled") =>
    req<{ state: string }>(`/${skillId}/state`, { method: "PUT", body: JSON.stringify({ state }), fallback: "Failed to update skill" }),
  listAccess: (skillId: string) => req<{ entries: AccessEntry[] }>(`/${skillId}/access`, { fallback: "Failed to load sharing" }),
  grantAccess: (skillId: string, principal: Principal, permission: PermissionLevel) =>
    req<{ entry: AccessEntry }>(`/${skillId}/access`, {
      method: "POST",
      body: JSON.stringify({ principal, permission }),
      fallback: "Failed to share skill",
    }),
  updateAccess: (skillId: string, accessId: string, permission: PermissionLevel) =>
    req<{ updated: boolean }>(`/${skillId}/access/${accessId}`, {
      method: "PATCH",
      body: JSON.stringify({ permission }),
      fallback: "Failed to update sharing",
    }),
  revokeAccess: (skillId: string, accessId: string) =>
    req<{ revoked: boolean }>(`/${skillId}/access/${accessId}`, { method: "DELETE", fallback: "Failed to remove sharing" }),
  requestCodeReview: (skillId: string) =>
    req<{ requested: boolean }>(`/${skillId}/code-review`, { method: "POST", fallback: "Failed to request review" }),
  approveCode: (skillId: string) => req<{ skill: AiSkill }>(`/${skillId}/code-approve`, { method: "POST", fallback: "Approval failed" }),
  revokeCode: (skillId: string) => req<{ revoked: boolean }>(`/${skillId}/code-revoke`, { method: "POST", fallback: "Revoke failed" }),
  events: (skillId: string, options?: { before?: AiSkillEventCursor }) =>
    req<AiSkillEventPage>(`/${skillId}/events${eventCursorQuery(options?.before)}`, { fallback: "Failed to load history" }),
  adminAll: (options?: { q?: string; afterSlug?: string; limit?: number; workspaceOnly?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.q) params.set("q", options.q);
    if (options?.afterSlug) params.set("afterSlug", options.afterSlug);
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.workspaceOnly) params.set("workspaceOnly", "true");
    const query = params.toString();
    return req<{ skills: AiSkill[]; nextCursor: string | null }>(`/admin/all${query ? `?${query}` : ""}`, {
      fallback: "Failed to load skills",
    });
  },
  adminReviewQueue: () => req<{ skills: AiSkill[] }>("/admin/review-queue", { fallback: "Failed to load review queue" }),
  adminEvents: (options?: { before?: AiSkillEventCursor }) =>
    req<AiSkillEventPage>(`/admin/events${eventCursorQuery(options?.before, { limit: "50" })}`, { fallback: "Failed to load audit log" }),
};

export type AiSkillEventCursor = { createdAt: string; id: string };
export type AiSkillEventPage = { events: AiSkillEvent[]; nextCursor: AiSkillEventCursor | null };

const eventCursorQuery = (before?: AiSkillEventCursor, extra?: Record<string, string>): string => {
  const params = new URLSearchParams(extra);
  if (before) {
    params.set("beforeCreatedAt", before.createdAt);
    params.set("beforeId", before.id);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
};

// ── Shared bits ────────────────────────────────────────────────────────────

const originBadge = (origin: AiSkillUserView["origin"]): { label: string; class: string } => {
  if (origin === "own") return { label: "Yours", class: "bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300" };
  if (origin === "workspace") return { label: "Workspace", class: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400" };
  return { label: "Shared with you", class: "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" };
};

function CodeStatusBadge(props: { skill: AiSkill }) {
  return (
    <SolidSwitch>
      <Match when={props.skill.allowCode}>
        <span class="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          <i class="ti ti-shield-check text-xs" aria-hidden="true" />
          Code approved
        </span>
      </Match>
      <Match when={props.skill.codeReviewRequestedAt}>
        <span class="inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <i class="ti ti-clock text-xs" aria-hidden="true" />
          Review pending
        </span>
      </Match>
    </SolidSwitch>
  );
}

const formatDateTime = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

const EVENT_LABELS: Record<string, string> = {
  created: "created",
  updated: "updated",
  deleted: "deleted",
  enabled: "enabled",
  disabled: "disabled",
  shared: "shared",
  unshared: "sharing removed",
  code_review_requested: "code review requested",
  code_approved: "code approved",
  code_revoked: "code approval revoked",
};

function EventList(props: { events: AiSkillEvent[]; showSlug?: boolean }) {
  return (
    <Show when={props.events.length > 0} fallback={<p class="text-sm text-dimmed">No events yet.</p>}>
      <ul class="flex flex-col gap-1 text-xs">
        <For each={props.events}>
          {(event) => (
            <li class="flex items-baseline gap-2 rounded-md bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900/60">
              <span class="shrink-0 tabular-nums text-dimmed">{formatDateTime(event.createdAt)}</span>
              <span class="min-w-0 flex-1 truncate text-secondary">
                <Show when={props.showSlug}>
                  <span class="font-medium text-primary">{event.skillSlug}</span>{" "}
                </Show>
                {EVENT_LABELS[event.event] ?? event.event}
                {/* Audit answers "who": resolved name, or platform for seeded/system events. */}
                <span class="text-dimmed"> · {event.actorDisplayName ?? (event.actorUserId ? "deleted account" : "platform")}</span>
                <Show when={event.meta && Object.keys(event.meta).length > 0}>
                  <span class="text-dimmed"> · {JSON.stringify(event.meta)}</span>
                </Show>
              </span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

/** Keyset-paged event log: accumulates pages, "Load more" until the cursor runs dry. */
function PagedEventList(props: { load: (before?: AiSkillEventCursor) => Promise<AiSkillEventPage>; showSlug?: boolean }) {
  const [events, setEvents] = createSignal<AiSkillEvent[]>([]);
  const [cursor, setCursor] = createSignal<AiSkillEventCursor | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [initialized, setInitialized] = createSignal(false);

  const loadMore = async () => {
    if (loading()) return;
    setLoading(true);
    try {
      const page = await props.load(cursor() ?? undefined);
      setEvents((previous) => [...previous, ...page.events]);
      setCursor(page.nextCursor);
    } catch (error) {
      void prompts.error(error instanceof Error ? error.message : "Failed to load events");
    } finally {
      setLoading(false);
      setInitialized(true);
    }
  };
  void loadMore();

  return (
    <Show when={initialized()} fallback={<Placeholder icon="ti ti-loader-2" title="Loading history…" />}>
      <div class="flex flex-col gap-2">
        <EventList events={events()} showSlug={props.showSlug} />
        <Show when={cursor()}>
          <div>
            <button type="button" class="btn-secondary btn-sm" disabled={loading()} onClick={() => void loadMore()}>
              <i class={loading() ? "ti ti-loader-2 animate-spin" : "ti ti-chevron-down"} aria-hidden="true" />
              Load more
            </button>
          </div>
        </Show>
      </div>
    </Show>
  );
}

// ── Skill files (FileBrowser over the skill's tree) ─────────────────────────

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
};

const fromBase64 = (content: string): Uint8Array => Uint8Array.from(atob(content), (char) => char.charCodeAt(0));

/** FileSource over one skill's files; write/remove only when the viewer can manage the skill. */
const skillFileSource = (skillId: string, options: { canEdit: boolean; onChanged: () => void }): FileSource => {
  return {
    async list() {
      const detail = await aiSkillsApi.detail(skillId);
      return detail.files.map((file) => ({ path: file.path, size: file.size, mediaType: file.mediaType, updatedAt: file.updatedAt }));
    },
    async read(path) {
      const file = await aiSkillsApi.readFile(skillId, path);
      return { encoding: file.encoding, content: file.content, mediaType: file.mediaType };
    },
    ...(options.canEdit
      ? {
          write: async (path: string, content: string, encoding?: "utf8" | "base64") => {
            await aiSkillsApi.writeFile(skillId, { path, content, encoding });
            options.onChanged();
          },
          remove: async (path: string) => {
            if (path === "/SKILL.md") throw new Error("SKILL.md is the skill's entry point and cannot be deleted.");
            await aiSkillsApi.deleteFile(skillId, path);
            options.onChanged();
          },
          upload: async (dirPath: string, files: File[]) => {
            for (const file of files) {
              const bytes = new Uint8Array(await file.arrayBuffer());
              await aiSkillsApi.writeFile(skillId, {
                path: `${dirPath === "/" ? "" : dirPath}/${file.name}`,
                content: toBase64(bytes),
                encoding: "base64",
                mediaType: file.type || undefined,
              });
            }
            options.onChanged();
          },
        }
      : {}),
  };
};

// ── Skill detail dialog ────────────────────────────────────────────────────

function SkillDetailDialog(props: { skillId: string; isAdmin: boolean; close: () => void; onChanged: () => void }) {
  const [detail, { refetch }] = createResource(() => props.skillId, (skillId) => aiSkillsApi.detail(skillId));
  const [tab, setTab] = createSignal<"files" | "settings" | "sharing" | "history">("files");
  const skill = () => detail()?.skill ?? null;
  const canManage = () => detail()?.canManage ?? false;
  const view = () => {
    const value = skill();
    return value && "origin" in value ? (value as AiSkillUserView) : null;
  };
  const isWorkspaceSkill = () => skill()?.ownerUserId === null;

  const [accessEntries] = createResource(
    () => (canManage() && tab() === "sharing" ? props.skillId : null),
    async (skillId) => (await aiSkillsApi.listAccess(skillId)).entries,
  );

  const notifyAndRefetch = () => {
    props.onChanged();
    void refetch();
  };

  const toggleEnabled = async (enabled: boolean) => {
    try {
      await aiSkillsApi.update(props.skillId, { enabled });
      notifyAndRefetch();
    } catch (error) {
      void prompts.error(error instanceof Error ? error.message : "Failed to update skill");
    }
  };

  const deleteSkill = async () => {
    const current = skill();
    if (!current) return;
    const confirmed = await prompts.confirm(`Delete the skill "${current.slug}" and all of its files?`, {
      title: "Delete skill",
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await aiSkillsApi.remove(props.skillId);
      props.onChanged();
      props.close();
    } catch (error) {
      void prompts.error(error instanceof Error ? error.message : "Failed to delete skill");
    }
  };

  const codeAction = async (action: "request" | "approve" | "revoke") => {
    try {
      if (action === "request") await aiSkillsApi.requestCodeReview(props.skillId);
      if (action === "approve") await aiSkillsApi.approveCode(props.skillId);
      if (action === "revoke") await aiSkillsApi.revokeCode(props.skillId);
      toast.success(action === "request" ? "Review requested" : action === "approve" ? "Code approved" : "Approval revoked");
      notifyAndRefetch();
    } catch (error) {
      void prompts.error(error instanceof Error ? error.message : "Action failed");
    }
  };

  return (
    <PanelDialog>
      <PanelDialog.Header
        title={skill()?.slug ?? "Skill"}
        subtitle={skill()?.description}
        icon="ti ti-wand"
        close={props.close}
      />
      <PanelDialog.Body>
        <Show when={skill()} fallback={<Placeholder icon="ti ti-loader-2" title="Loading skill…" />}>
          {(current) => (
            <div class="flex min-h-0 flex-col gap-3">
              <div class="flex items-center gap-3">
                <PanelDialog.Tabs
                  ariaLabel="Skill sections"
                  options={[
                    { value: "files", label: "Files", icon: "ti ti-folder" },
                    { value: "settings", label: "Advanced", icon: "ti ti-adjustments" },
                    ...(canManage() ? [{ value: "sharing" as const, label: "Sharing", icon: "ti ti-share" }] : []),
                    ...(canManage() ? [{ value: "history" as const, label: "History", icon: "ti ti-history" }] : []),
                  ]}
                  value={tab}
                  onChange={setTab}
                />
                <span class="flex-1" />
                <button
                  type="button"
                  class="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-dimmed transition-colors hover:bg-zinc-100 hover:text-primary dark:hover:bg-zinc-900"
                  title="Download skill as ZIP"
                  onClick={() => {
                    const current = skill();
                    if (current) {
                      void downloadSkillAsZip(current.id, current.slug).catch((error) =>
                        prompts.error(error instanceof Error ? error.message : "Download failed"),
                      );
                    }
                  }}
                >
                  <i class="ti ti-file-zip text-sm" aria-hidden="true" />
                  <span class="sr-only">Download skill as ZIP</span>
                </button>
                {/* ONE toggle, context-sensitive: admins govern the global switch
                    (off = gone for everyone), users their personal consent. */}
                <Show
                  when={props.isAdmin && isWorkspaceSkill()}
                  fallback={
                    <Show when={view()}>
                      {(userView) => (
                        <span class="flex shrink-0 items-center gap-2" title="Whether the assistant may use this skill in your chats">
                          <span class="text-xs text-dimmed">Active</span>
                          <Switch
                            value={() => userView().userState === "enabled"}
                            onChange={(state) => {
                              void aiSkillsApi
                                .setState(props.skillId, state ? "enabled" : "disabled")
                                .then(notifyAndRefetch)
                                .catch((error) => prompts.error(error instanceof Error ? error.message : "Failed to update skill"));
                            }}
                          />
                        </span>
                      )}
                    </Show>
                  }
                >
                  <span class="flex shrink-0 items-center gap-2" title="Disabled skills disappear from everyone's catalog">
                    <span class="text-xs text-dimmed">Enabled</span>
                    <Switch value={() => current().enabled} onChange={(enabled) => void toggleEnabled(enabled)} />
                  </span>
                </Show>
              </div>

              {/* Fixed-height content region: switching tabs must never resize the dialog. */}
              <div class="flex h-[min(55vh,30rem)] min-h-0 flex-col overflow-y-auto">
              <SolidSwitch>
                <Match when={tab() === "files"}>
                  {/* Content changes revoke code approval server-side — refetch keeps the badge honest. */}
                  <FileBrowserPanel
                    source={skillFileSource(props.skillId, { canEdit: canManage(), onChanged: notifyAndRefetch })}
                    initialPath="/SKILL.md"
                    class="h-full"
                  />
                </Match>

                <Match when={tab() === "settings"}>
                  <div class="flex flex-col gap-4">
                    <Show when={view()}>
                      {(userView) => (
                        <p class="text-xs leading-5 text-dimmed">
                          {userView().origin === "shared"
                            ? "Shared skills stay off until you turn them on — nothing enters your chats without your consent."
                            : "The Active toggle above controls whether the assistant sees this skill in your chats."}
                        </p>
                      )}
                    </Show>


                    <div class="flex flex-col gap-2 rounded-lg bg-zinc-50 p-3 [box-shadow:var(--theme-recess)] dark:bg-zinc-900/60">
                      <p class="text-sm font-medium text-primary">Executable code</p>
                      <Show
                        when={isWorkspaceSkill()}
                        fallback={
                          <p class="text-xs leading-5 text-dimmed">
                            Personal skills are content-only: markdown, references, and assets. Scripts inside personal skills are never
                            executed — only workspace skills can run code, after an admin review.
                          </p>
                        }
                      >
                        <p class="text-xs leading-5 text-dimmed">
                          Scripts in this skill run inside the sandboxed JavaScript runtime once an admin approves the exact file contents.
                          Any file change revokes the approval automatically.
                        </p>
                        <div class="flex flex-wrap items-center gap-2">
                          <CodeStatusBadge skill={current()} />
                          <span class="flex-1" />
                          <Show when={canManage() && !current().allowCode && !current().codeReviewRequestedAt}>
                            <button type="button" class="btn-input btn-input-sm" onClick={() => void codeAction("request")}>
                              <i class="ti ti-shield-question" aria-hidden="true" />
                              Request code review
                            </button>
                          </Show>
                          <Show when={props.isAdmin && !current().allowCode && current().codeReviewRequestedAt}>
                            <button type="button" class="btn-primary btn-sm" onClick={() => void codeAction("approve")}>
                              <i class="ti ti-shield-check" aria-hidden="true" />
                              Approve code
                            </button>
                          </Show>
                          <Show when={props.isAdmin && current().allowCode}>
                            <button type="button" class="btn-input btn-input-sm" onClick={() => void codeAction("revoke")}>
                              <i class="ti ti-shield-off" aria-hidden="true" />
                              Revoke approval
                            </button>
                          </Show>
                        </div>
                      </Show>
                    </div>

                    <Show when={canManage()}>
                      <div class="flex justify-end">
                        <button type="button" class="btn-danger btn-sm" onClick={() => void deleteSkill()}>
                          <i class="ti ti-trash" aria-hidden="true" />
                          Delete skill
                        </button>
                      </div>
                    </Show>
                  </div>
                </Match>

                <Match when={tab() === "sharing"}>
                  <div class="flex flex-col gap-2">
                    <p class="text-xs leading-5 text-dimmed">
                      Sharing offers this skill to other people — it shows up in their catalog but stays inactive until they enable it
                      themselves.
                    </p>
                    <Show when={accessEntries()} fallback={<Placeholder icon="ti ti-loader-2" title="Loading sharing…" />}>
                      {(entries) => (
                        <PermissionEditor
                          initialEntries={entries()}
                          canEdit
                          allowedLevels={[{ level: "read", label: "Use", icon: "ti-wand" }]}
                          grantAccess={async (principal, permission) => (await aiSkillsApi.grantAccess(props.skillId, principal, permission)).entry}
                          updateAccess={async (accessId, permission) => {
                            await aiSkillsApi.updateAccess(props.skillId, accessId, permission);
                          }}
                          revokeAccess={async (accessId) => {
                            await aiSkillsApi.revokeAccess(props.skillId, accessId);
                          }}
                        />
                      )}
                    </Show>
                  </div>
                </Match>

                <Match when={tab() === "history"}>
                  <PagedEventList load={(before) => aiSkillsApi.events(props.skillId, { before })} />
                </Match>
              </SolidSwitch>
              </div>
            </div>
          )}
        </Show>
      </PanelDialog.Body>
    </PanelDialog>
  );
}

// ── Skill import (ZIP with a full tree, or a single SKILL.md) ───────────────

const SKILL_SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const slugFromName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\.(zip|md|markdown)$/i, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

/** Import a skill from a .zip (full tree, common root folder stripped) or a bare SKILL.md. */
const importSkillFromFile = async (
  file: File,
  options: { workspace: boolean; onProgress?: (progress: { done: number; total: number }) => void },
): Promise<AiSkill | null> => {
  let files: { path: string; bytes: Uint8Array }[];
  let suggestedSlug: string;

  if (file.name.toLowerCase().endsWith(".zip")) {
    const entries = (await extractZip(new Uint8Array(await file.arrayBuffer()))).filter((entry) => !entry.filename.endsWith("/"));
    if (entries.length === 0) throw new Error("The ZIP archive is empty.");
    const roots = new Set(entries.map((entry) => entry.filename.split("/")[0] ?? ""));
    const commonRoot = roots.size === 1 && entries.every((entry) => entry.filename.includes("/")) ? [...roots][0]! : null;
    files = entries.map((entry) => ({
      path: `/${commonRoot ? entry.filename.slice(commonRoot.length + 1) : entry.filename}`,
      bytes: entry.data,
    }));
    if (!files.some((entry) => entry.path.toLowerCase() === "/skill.md")) {
      throw new Error("The ZIP must contain a SKILL.md at its root.");
    }
    suggestedSlug = slugFromName(commonRoot ?? file.name);
  } else {
    const bytes = new Uint8Array(await file.arrayBuffer());
    files = [{ path: "/SKILL.md", bytes }];
    const frontmatterName = /^---\r?\n[\s\S]*?\bname\s*:\s*([^\r\n]+)[\s\S]*?\r?\n---/.exec(new TextDecoder().decode(bytes))?.[1];
    suggestedSlug = slugFromName(frontmatterName?.trim() || file.name);
  }

  const slugInput = await prompts.prompt("Skill name (folder under /skills):", suggestedSlug, { title: "Import skill" });
  if (!slugInput || typeof slugInput !== "string") return null;
  const slug = slugInput.trim();
  if (!SKILL_SLUG_RE.test(slug)) throw new Error("Invalid name — use lowercase letters, digits and hyphens.");

  const created = (await aiSkillsApi.create({ slug, workspace: options.workspace })).skill;
  try {
    let done = 0;
    options.onProgress?.({ done, total: files.length });
    for (const entry of files) {
      await aiSkillsApi.writeFile(created.id, { path: entry.path, content: toBase64(entry.bytes), encoding: "base64" });
      done += 1;
      options.onProgress?.({ done, total: files.length });
    }
  } catch (error) {
    // Don't leave a half-imported skill behind.
    await aiSkillsApi.remove(created.id).catch(() => undefined);
    throw error;
  }
  return created;
};

/** Download a skill's whole tree as <slug>.zip. */
const downloadSkillAsZip = async (skillId: string, slug: string): Promise<void> => {
  const detail = await aiSkillsApi.detail(skillId);
  const zipEntries = await Promise.all(
    detail.files.map(async (file) => {
      const content = await aiSkillsApi.readFile(skillId, file.path);
      return { filename: `${slug}${file.path}`, source: content.encoding === "utf8" ? content.content : fromBase64(content.content) };
    }),
  );
  downloadFileFromContent(await createZip(zipEntries), `${slug}.zip`, "application/zip");
};

// ── Create skill dialog ────────────────────────────────────────────────────

function CreateSkillDialog(props: { isAdmin: boolean; close: (created?: AiSkill) => void }) {
  const [slug, setSlug] = createSignal("");
  const [description, setDescription] = createSignal("");
  // From the admin surface, workspace skills are the point of creating one.
  const [workspace, setWorkspace] = createSignal(props.isAdmin);

  const create = mutation.create<AiSkill, void>({
    mutation: async () =>
      (await aiSkillsApi.create({ slug: slug().trim(), description: description().trim() || undefined, workspace: workspace() })).skill,
    onSuccess: (skill) => {
      toast.success(`Skill "${skill.slug}" created`);
      props.close(skill);
    },
    onError: (error) => prompts.error(error.message),
  });

  return (
    <PanelDialog>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void create.mutate(undefined);
        }}
      >
        <PanelDialog.Header title="New skill" subtitle="A folder of instructions the assistant reads on demand." icon="ti ti-wand" close={() => props.close()} />
        <PanelDialog.Body>
          <TextInput
            label="Name"
            description="Lowercase letters, digits and hyphens — becomes the folder name under /skills."
            value={slug}
            onInput={(next) => setSlug(next.toLowerCase())}
            required
            maxLength={64}
            placeholder="meeting-notes"
          />
          <TextInput
            label="Description (optional)"
            description="One line that tells the assistant when to use this skill — lands in the SKILL.md frontmatter, edit it there anytime."
            value={description}
            onInput={setDescription}
            maxLength={500}
            placeholder="Formats meeting notes: decisions, action items, open questions."
          />
          <Show when={props.isAdmin}>
            <div class="flex flex-col gap-1">
              <Switch label="Workspace skill" value={workspace} onChange={setWorkspace} />
              <p class="text-xs text-dimmed">
                Owned by the workspace and managed by admins; visible to everyone and eligible for code approval.
              </p>
            </div>
          </Show>
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <span />
          <div class="flex items-center gap-2">
            <button type="button" class="btn-secondary btn-sm" disabled={create.loading()} onClick={() => props.close()}>
              Cancel
            </button>
            <button type="submit" class="btn-primary btn-sm" disabled={create.loading() || !slug().trim()}>
              <i class={create.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-plus"} aria-hidden="true" />
              Create skill
            </button>
          </div>
        </PanelDialog.Footer>
      </form>
    </PanelDialog>
  );
}

// ── Catalog / manager (shared by the user dialog and the admin page) ────────

function SkillRow(props: {
  skill: AiSkill & Partial<Pick<AiSkillUserView, "origin" | "userState">>;
  /** consent = the user's per-person toggle; admin = the global enable switch. */
  mode: "consent" | "admin";
  onOpen: () => void;
  onToggle: (state: boolean) => Promise<void>;
}) {
  const badge = () => (props.skill.origin ? originBadge(props.skill.origin) : null);
  return (
    <li class="flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 [box-shadow:var(--theme-bevel)] dark:bg-zinc-900">
      <button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={props.onOpen}>
        <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-zinc-100 text-secondary dark:bg-zinc-800">
          <i class="ti ti-wand text-lg" aria-hidden="true" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="flex items-center gap-2 truncate text-sm font-medium text-primary">
            {props.skill.slug}
            <Show when={badge()}>{(value) => <span class={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${value().class}`}>{value().label}</span>}</Show>
            <CodeStatusBadge skill={props.skill} />
          </p>
          <p class="truncate text-xs text-dimmed">{props.skill.description}</p>
        </div>
      </button>
      <span title={props.mode === "admin" ? "Disabled skills disappear from everyone's catalog" : "Whether the assistant may use this skill in your chats"}>
        <Switch
          value={() => (props.mode === "admin" ? props.skill.enabled : props.skill.userState === "enabled")}
          onChange={(state) => void props.onToggle(state)}
        />
      </span>
    </li>
  );
}

export type AiSkillsManagerBodyProps = {
  /** Admin mode: manages the WORKSPACE catalog (incl. disabled skills), review queue, and audit log. */
  isAdmin: boolean;
  /** Fix the content height (dialog use) — omit on pages where the layout scrolls. */
  fixedHeight?: boolean;
};

export function AiSkillsManagerBody(props: AiSkillsManagerBodyProps) {
  const [query, setQuery] = createSignal("");

  // User catalog: one bounded fetch (own + workspace + shared), searched client-side.
  const [userSkills, { refetch: refetchUser }] = createResource(async () => {
    if (props.isAdmin) return [];
    return (await aiSkillsApi.list()).skills;
  });

  // Admin catalog: the whole registry can grow unbounded — slug-keyset pages
  // with server-side search. Admins govern the workspace catalog; their
  // personal skills stay in the assistant modal.
  const [adminSkills, setAdminSkills] = createSignal<AiSkill[]>([]);
  const [adminCursor, setAdminCursor] = createSignal<string | null>(null);
  const [adminLoading, setAdminLoading] = createSignal(false);
  const [adminInitialized, setAdminInitialized] = createSignal(false);

  const loadAdmin = async (reset: boolean) => {
    if (!props.isAdmin || adminLoading()) return;
    setAdminLoading(true);
    try {
      const page = await aiSkillsApi.adminAll({
        q: query().trim() || undefined,
        afterSlug: reset ? undefined : (adminCursor() ?? undefined),
        workspaceOnly: true,
      });
      setAdminSkills((previous) => (reset ? page.skills : [...previous, ...page.skills]));
      setAdminCursor(page.nextCursor);
    } catch (error) {
      void prompts.error(error instanceof Error ? error.message : "Failed to load skills");
    } finally {
      setAdminLoading(false);
      setAdminInitialized(true);
    }
  };
  if (props.isAdmin) void loadAdmin(true);

  // Debounced server-side search in admin mode.
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  const onQueryInput = (value: string) => {
    setQuery(value);
    if (!props.isAdmin) return;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadAdmin(true), 250);
  };

  const reload = () => {
    if (props.isAdmin) void loadAdmin(true);
    else void refetchUser();
  };

  const [tab, setTab] = createSignal<"catalog" | "review" | "audit">("catalog");
  const [reviewQueue, { refetch: refetchQueue }] = createResource(
    () => (props.isAdmin && tab() === "review" ? "queue" : null),
    async () => (await aiSkillsApi.adminReviewQueue()).skills,
  );

  const matchesQuery = (skill: AiSkill) => {
    const needle = query().trim().toLowerCase();
    if (!needle) return true;
    return skill.slug.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle);
  };

  const groups = createMemo(() => {
    if (props.isAdmin) {
      const list = adminSkills();
      return list.length > 0 ? [{ title: "Workspace skills", skills: list }] : [];
    }
    const views = ((userSkills() ?? []) as AiSkillUserView[]).filter(matchesQuery);
    return [
      { title: "Your skills", skills: views.filter((skill) => skill.origin === "own") },
      { title: "Workspace skills", skills: views.filter((skill) => skill.origin === "workspace") },
      { title: "Shared with you", skills: views.filter((skill) => skill.origin === "shared") },
    ].filter((group) => group.skills.length > 0);
  });

  const openDetail = (skillId: string) => {
    void dialogCore
      .open<void>(
        (close) => <SkillDetailDialog skillId={skillId} isAdmin={props.isAdmin} close={() => close()} onChanged={reload} />,
        panelDialogOptions,
      )
      .then(reload);
  };

  const openCreate = () => {
    void dialogCore.open<AiSkill | undefined>(
      (close) => <CreateSkillDialog isAdmin={props.isAdmin} close={(created) => close(created)} />,
      panelDialogOptions,
    ).then((created) => {
      reload();
      if (created) openDetail(created.id);
    });
  };

  const toggle = async (skill: AiSkill, state: boolean) => {
    try {
      if (props.isAdmin) await aiSkillsApi.update(skill.id, { enabled: state });
      else await aiSkillsApi.setState(skill.id, state ? "enabled" : "disabled");
      reload();
    } catch (error) {
      void prompts.error(error instanceof Error ? error.message : "Failed to update skill");
    }
  };

  let importInputRef: HTMLInputElement | undefined;
  const [importProgress, setImportProgress] = createSignal<{ done: number; total: number } | null>(null);
  const importSkill = async (file: File) => {
    try {
      const created = await importSkillFromFile(file, { workspace: props.isAdmin, onProgress: setImportProgress });
      if (!created) return;
      toast.success(`Skill "${created.slug}" imported`);
      reload();
      openDetail(created.id);
    } catch (error) {
      void prompts.error(error instanceof Error ? error.message : "Skill import failed");
    } finally {
      setImportProgress(null);
    }
  };

  return (
    <>
      <Show when={props.isAdmin}>
        <PanelDialog.Tabs
          ariaLabel="Skill management sections"
          options={[
            { value: "catalog", label: "Catalog", icon: "ti ti-list" },
            { value: "review", label: "Code review", icon: "ti ti-shield-question" },
            { value: "audit", label: "Audit log", icon: "ti ti-history" },
          ]}
          value={tab}
          onChange={setTab}
        />
      </Show>

      <div class={props.fixedHeight ? "flex h-[min(60vh,32rem)] min-h-0 flex-col overflow-y-auto" : "flex min-h-0 flex-col"}>
        <SolidSwitch>
          <Match when={tab() === "catalog"}>
            <div class="flex flex-col gap-4">
              <TextInput
                icon="ti ti-search"
                placeholder="Search skills…"
                value={query}
                onInput={onQueryInput}
                aria-label="Search skills"
              />
              <Show
                when={groups().length > 0}
                fallback={
                  <Show
                    when={!props.isAdmin || adminInitialized()}
                    fallback={<Placeholder icon="ti ti-loader-2" title="Loading skills…" />}
                  >
                    <Show
                      when={query().trim()}
                      fallback={
                        <Placeholder
                          icon="ti ti-wand"
                          title="No skills yet"
                          description="Create a skill to teach the assistant a repeatable task — it reads the skill's instructions whenever they match."
                        />
                      }
                    >
                      <Placeholder icon="ti ti-search-off" title="No matches" description={`No skill matches "${query().trim()}".`} />
                    </Show>
                  </Show>
                }
              >
                <For each={groups()}>
                  {(group) => (
                    <div class="flex flex-col gap-1.5">
                      <p class="text-[10px] font-medium uppercase tracking-wide text-dimmed">{group.title}</p>
                      <ul class="flex flex-col gap-1.5">
                        <For each={group.skills}>
                          {(skill) => (
                            <SkillRow
                              skill={skill}
                              mode={props.isAdmin ? "admin" : "consent"}
                              onOpen={() => openDetail(skill.id)}
                              onToggle={(state) => toggle(skill, state)}
                            />
                          )}
                        </For>
                      </ul>
                    </div>
                  )}
                </For>
              </Show>
              <Show when={props.isAdmin && adminCursor()}>
                <div>
                  <button type="button" class="btn-secondary btn-sm" disabled={adminLoading()} onClick={() => void loadAdmin(false)}>
                    <i class={adminLoading() ? "ti ti-loader-2 animate-spin" : "ti ti-chevron-down"} aria-hidden="true" />
                    Load more
                  </button>
                </div>
              </Show>
              <div class="flex items-center gap-2">
                <button type="button" class="btn-primary btn-sm" onClick={openCreate}>
                  <i class="ti ti-plus" aria-hidden="true" />
                  New skill
                </button>
                <button type="button" class="btn-secondary btn-sm" disabled={Boolean(importProgress())} onClick={() => importInputRef?.click()}>
                  <i class={importProgress() ? "ti ti-loader-2 animate-spin" : "ti ti-upload"} aria-hidden="true" />
                  <Show when={importProgress()} fallback={<>Import</>}>
                    {(progress) => (
                      <>
                        Importing {progress().done}/{progress().total}…
                      </>
                    )}
                  </Show>
                </button>
                <input
                  ref={importInputRef}
                  type="file"
                  accept=".zip,.md,.markdown"
                  class="hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void importSkill(file);
                  }}
                />
              </div>
            </div>
          </Match>

          <Match when={tab() === "review"}>
            <Show
              when={(reviewQueue() ?? []).length > 0}
              fallback={<Placeholder icon="ti ti-shield-check" title="Nothing to review" description="No skill is waiting for a code review." />}
            >
              <ul class="flex flex-col gap-1.5">
                <For each={reviewQueue()}>
                  {(skill) => (
                    <li class="flex items-center gap-3 rounded-lg bg-white px-3 py-2.5 [box-shadow:var(--theme-bevel)] dark:bg-zinc-900">
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium text-primary">{skill.slug}</p>
                        <p class="truncate text-xs text-dimmed">
                          Review requested {skill.codeReviewRequestedAt ? formatDateTime(skill.codeReviewRequestedAt) : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        class="btn-input btn-input-sm"
                        onClick={() => {
                          void dialogCore
                            .open<void>(
                              (close) => (
                                <SkillDetailDialog skillId={skill.id} isAdmin close={() => close()} onChanged={() => void refetchQueue()} />
                              ),
                              panelDialogOptions,
                            )
                            .then(() => void refetchQueue());
                        }}
                      >
                        <i class="ti ti-eye" aria-hidden="true" />
                        Review
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Match>

          <Match when={tab() === "audit"}>
            <PagedEventList load={(before) => aiSkillsApi.adminEvents({ before })} showSlug />
          </Match>
        </SolidSwitch>
      </div>
    </>
  );
}

function SkillsManagerDialog(props: { isAdmin: boolean; close: () => void }) {
  return (
    <PanelDialog>
      <PanelDialog.Header
        title="Skills"
        subtitle="Reusable instructions and resources the assistant pulls in when they match the task."
        icon="ti ti-wand"
        close={props.close}
      />
      <PanelDialog.Body>
        <AiSkillsManagerBody isAdmin={props.isAdmin} fixedHeight={props.isAdmin} />
      </PanelDialog.Body>
    </PanelDialog>
  );
}

/** Open the skills manager. `isAdmin` unlocks workspace skills, the review queue, and the audit log. */
export const openAiSkillsManager = (options?: { isAdmin?: boolean }): Promise<void> =>
  dialogCore.open<void>((close) => <SkillsManagerDialog isAdmin={options?.isAdmin ?? false} close={() => close()} />, panelDialogOptions);

export { SkillsManagerDialog as AiSkillsManagerDialog, SkillDetailDialog as AiSkillDetailDialog };
