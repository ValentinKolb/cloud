import { Button, Placeholder, prompts, TextInput, toast } from "@k2b/ui";
import { createResource, createSignal, For, Show } from "solid-js";
import type { AssistantChatTask, AssistantChatTaskOccurrence } from "../chat-tasks-contracts";

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/assistant${path}`, init);
  const body = (await response.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.message || "Scheduled task request failed");
  return body;
};

const idempotencyKey = () => crypto.randomUUID().replaceAll("-", "");

function AssistantTasksDialog(props: { chatId: string }) {
  const [tasks, { refetch }] = createResource(
    () => props.chatId,
    (chatId) => request<AssistantChatTask[]>(`/tasks?chatId=${chatId}&limit=100`),
  );
  const [timezone] = createResource(() => request<{ timezone: string }>("/tasks/status"));
  const [prompt, setPrompt] = createSignal("");
  const [kind, setKind] = createSignal<"once" | "cron">("once");
  const [localAt, setLocalAt] = createSignal("");
  const [cron, setCron] = createSignal("0 9 * * 1-5");
  const [editing, setEditing] = createSignal<AssistantChatTask | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [occurrences, setOccurrences] = createSignal<AssistantChatTaskOccurrence[]>([]);

  const reset = () => {
    setEditing(null);
    setPrompt("");
    setKind("once");
    setLocalAt("");
    setCron("0 9 * * 1-5");
  };
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (!prompt().trim() || (!editing() && (kind() === "once" ? !localAt() : !cron().trim()))) return;
    setBusy(true);
    try {
      const schedule = kind() === "once" ? { kind: "once" as const, localAt: localAt() } : { kind: "cron" as const, cron: cron().trim() };
      const current = editing();
      await request(current ? `/tasks/${current.id}` : "/tasks", {
        method: current ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", ...(current ? {} : { "Idempotency-Key": idempotencyKey() }) },
        body: JSON.stringify(
          current
            ? { prompt: prompt().trim(), ...(kind() === "cron" || localAt() ? { schedule } : {}) }
            : { chatId: props.chatId, prompt: prompt().trim(), schedule },
        ),
      });
      reset();
      await refetch();
      toast.success(current ? "Task updated" : "Task scheduled");
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Could not save task");
    } finally {
      setBusy(false);
    }
  };
  const action = async (task: AssistantChatTask, name: "pause" | "resume" | "run" | "delete") => {
    if (name === "delete" && !(await prompts.confirm(`Delete scheduled task “${task.prompt.slice(0, 80)}”?`))) return;
    try {
      await request(`/tasks/${task.id}${name === "delete" ? "" : `/${name}`}`, {
        method: name === "delete" ? "DELETE" : "POST",
        headers: name === "run" ? { "Idempotency-Key": idempotencyKey() } : undefined,
      });
      await refetch();
    } catch (error) {
      await prompts.error(error instanceof Error ? error.message : "Could not update task");
    }
  };
  const showHistory = async (task: AssistantChatTask) => {
    const detail = await request<{ task: AssistantChatTask; occurrences: AssistantChatTaskOccurrence[] }>(`/tasks/${task.id}`);
    setOccurrences(detail.occurrences);
  };

  return (
    <div class="flex flex-col gap-6">
      <form class="flex flex-col gap-3 rounded-xl bg-[var(--ui-surface-subtle)] p-4" onSubmit={save}>
        <h2 class="font-semibold text-primary">{editing() ? "Edit task" : "Schedule a task"}</h2>
        <TextInput
          aria-label="Task prompt"
          multiline
          lines={3}
          value={prompt}
          onValueChange={setPrompt}
          placeholder="What should Assistant do?"
          maxLength={10_000}
        />
        <label class="flex flex-col gap-1 text-sm text-secondary">
          Schedule
          <select
            class="rounded-md border bg-transparent px-2 py-2"
            value={kind()}
            onChange={(event) => setKind(event.currentTarget.value as "once" | "cron")}
          >
            <option value="once">Once</option>
            <option value="cron">Recurring</option>
          </select>
        </label>
        <Show when={kind() === "once"} fallback={<TextInput aria-label="Cron expression" value={cron} onValueChange={setCron} />}>
          <input
            aria-label="Local date and time"
            type="datetime-local"
            class="rounded-md border bg-transparent px-2 py-2"
            value={localAt()}
            onInput={(event) => setLocalAt(event.currentTarget.value)}
          />
        </Show>
        <p class="text-xs text-dimmed">Times use {timezone()?.timezone ?? "app.timezone"}.</p>
        <div class="flex justify-end gap-2">
          <Show when={editing()}>
            <Button type="button" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </Show>
          <Button type="submit" loading={busy()}>
            {editing() ? "Save task" : "Schedule task"}
          </Button>
        </div>
      </form>
      <Show
        when={tasks()}
        fallback={<Placeholder state={tasks.error ? "error" : "loading"} title={tasks.error ? "Could not load tasks" : "Loading tasks"} />}
      >
        <div class="flex flex-col gap-2">
          <For each={tasks()}>
            {(task) => (
              <article class="rounded-lg px-2 py-2 hover:bg-[var(--ui-surface-subtle)]">
                <p class="text-sm font-medium text-primary">{task.prompt}</p>
                <p class="text-xs text-dimmed">
                  {task.schedule.kind === "once" ? new Date(task.schedule.runAt).toLocaleString() : task.schedule.cron} · {task.state}
                </p>
                <div class="mt-2 flex flex-wrap gap-1">
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      setEditing(task);
                      setPrompt(task.prompt);
                      setKind(task.schedule.kind);
                      if (task.schedule.kind === "cron") setCron(task.schedule.cron);
                    }}
                  >
                    Edit
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => void action(task, task.state === "paused" ? "resume" : "pause")}>
                    {task.state === "paused" ? "Resume" : "Pause"}
                  </Button>
                  <Button size="xs" variant="ghost" disabled={task.state !== "active"} onClick={() => void action(task, "run")}>
                    Run now
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => void showHistory(task)}>
                    History
                  </Button>
                  <Button size="xs" variant="ghost" onClick={() => void action(task, "delete")}>
                    Delete
                  </Button>
                </div>
              </article>
            )}
          </For>
        </div>
      </Show>
      <Show when={occurrences().length}>
        <section>
          <h2 class="font-semibold text-primary">Occurrence history</h2>
          <ul class="mt-2 flex flex-col gap-1">
            <For each={occurrences()}>
              {(item) => (
                <li class="text-xs text-secondary">
                  {new Date(item.scheduledFor).toLocaleString()} · {item.state}
                  {item.error ? ` · ${item.error}` : ""}
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </div>
  );
}

export const openAssistantTasksDialog = (chatId: string) =>
  prompts.dialog<void>(() => <AssistantTasksDialog chatId={chatId} />, {
    title: "Scheduled tasks",
    icon: "ti ti-calendar-time",
    size: "large",
  });
