import { Paper } from "@k2b/ui";
import type { JSX } from "solid-js";

export function AssistantChatContextSurface(props: { children: JSX.Element }) {
  return (
    <Paper
      role="complementary"
      class="m-4 ml-0 hidden max-h-[calc(100%-2rem)] w-72 shrink-0 flex-col gap-4 self-start overflow-auto p-4 lg:flex"
      aria-label="Chat context"
      data-assistant-context="compact"
    >
      {props.children}
    </Paper>
  );
}
