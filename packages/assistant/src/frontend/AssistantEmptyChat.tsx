import type { AiProject } from "@valentinkolb/cloud/ai";
import type { JSX } from "solid-js";

export type AssistantStarterAction = {
  label: string;
  prompt: string;
  icon: string;
};

export const assistantStarterActions: readonly AssistantStarterAction[] = [
  {
    label: "Follow up on mail",
    prompt: "Help me follow up on the mail about ",
    icon: "ti ti-mail-forward",
  },
  {
    label: "Set a daily schedule",
    prompt: "Set up a daily schedule that ",
    icon: "ti ti-calendar-repeat",
  },
  {
    label: "Find something in Cloud",
    prompt: "Find information in Cloud about ",
    icon: "ti ti-ai-gateway",
  },
  {
    label: "Turn notes into next steps",
    prompt: "Turn these notes into clear next steps:\n\n",
    icon: "ti ti-list-check",
  },
];

export default function AssistantEmptyChat(props: {
  composer: JSX.Element;
  notices?: JSX.Element;
  projects: readonly AiProject[];
  selectedProjectId: string | null;
  choosingProject?: boolean;
  onChooseProject: () => void;
  onStarter: (starter: AssistantStarterAction) => void;
}) {
  const selectedProject = () => props.projects.find((project) => project.id === props.selectedProjectId) ?? null;

  return (
    <section class="flex min-h-full items-center justify-center px-[var(--ui-space-section)] py-10" aria-labelledby="assistant-empty-title">
      <div class="w-full max-w-4xl -translate-y-[3vh] sm:-translate-y-[9vh]">
        <h1 id="assistant-empty-title" class="mb-8 text-center text-2xl font-semibold tracking-tight text-[var(--k2b-text)] sm:mb-12">
          What should we work on?
        </h1>

        {props.notices ? <div class="mb-2">{props.notices}</div> : null}
        <div class="relative">
          <div class="relative z-10">{props.composer}</div>
          <div class="mx-4 -mt-1 rounded-b-xl border border-t-0 border-[var(--k2b-border)] bg-[var(--k2b-surface)] px-1.5 pb-1 pt-2">
            <button
              type="button"
              class="flex min-h-7 w-full items-center justify-between gap-2 rounded-lg px-1.5 text-left text-[0.6875rem] text-[var(--k2b-text-muted)] transition-colors hover:text-[var(--k2b-ai-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--k2b-focus-ring)] disabled:cursor-wait disabled:opacity-60"
              aria-label="Choose a Project for this chat"
              disabled={props.choosingProject}
              onClick={props.onChooseProject}
            >
              <span class="flex min-w-0 items-center gap-1.5">
                <i
                  class={`${props.choosingProject ? "ti ti-loader-2 k2b-spin" : selectedProject() ? "ti ti-folder-open" : "ti ti-folder"} text-xs`}
                  aria-hidden="true"
                />
                <span class="truncate">{selectedProject()?.name ?? "No Project"}</span>
              </span>
              <i class="ti ti-chevron-down shrink-0 text-xs" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="mt-8 grid grid-cols-2 gap-2 sm:mt-12 sm:grid-cols-4" role="group" aria-label="Conversation starters">
          {assistantStarterActions.map((starter) => (
            <button
              type="button"
              class="group flex min-h-24 flex-col items-start justify-between gap-4 rounded-xl border border-[var(--k2b-border)] bg-[var(--k2b-surface)] p-4 text-left text-sm font-medium text-[var(--k2b-text-muted)] transition-colors hover:border-[var(--k2b-ai-border)] hover:text-[var(--k2b-ai-accent)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--k2b-focus-ring)]"
              onClick={() => props.onStarter(starter)}
            >
              <i
                class={`${starter.icon} text-base text-[var(--k2b-text-muted)] transition-colors group-hover:text-[var(--k2b-ai-accent)]`}
                aria-hidden="true"
              />
              <span>{starter.label}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
