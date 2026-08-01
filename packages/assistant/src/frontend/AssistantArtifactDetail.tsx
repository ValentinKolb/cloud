import { FileBrowserPanel, IconButton, prompts, Tooltip } from "@k2b/ui";
import { conversationFileSource } from "@valentinkolb/cloud/ai/solid";
import type { Accessor } from "solid-js";

type AssistantFilesDialogProps = {
  conversationId: string;
  initialPath?: string;
  refreshKey: Accessor<string>;
  close: () => void;
};

function AssistantFilesDialog(props: AssistantFilesDialogProps) {
  const source = conversationFileSource("/api/assistant", props.conversationId);

  return (
    <div class="dialog-fixed-frame relative flex min-h-0 flex-col overflow-hidden rounded-[var(--ui-radius-frame)] bg-[var(--k2b-surface)] [box-shadow:var(--ui-shadow-float)]">
      <Tooltip content="Close files" class="absolute right-3 top-3 z-20">
        <IconButton label="Close files" onClick={props.close}>
          <i class="ti ti-x" aria-hidden="true" />
        </IconButton>
      </Tooltip>
      <FileBrowserPanel
        source={source}
        readOnly
        refreshKey={props.refreshKey()}
        initialPath={props.initialPath === "/" ? undefined : props.initialPath}
        class="min-h-0 flex-1 p-4 pr-14"
      />
    </div>
  );
}

export const openAssistantFilesDialog = (options: {
  conversationId: string;
  initialPath?: string;
  refreshKey: Accessor<string>;
}): Promise<void> =>
  prompts.dialog<void>((close) => <AssistantFilesDialog {...options} close={() => close()} />, {
    surface: "bare",
    header: false,
    size: "wide",
  });
