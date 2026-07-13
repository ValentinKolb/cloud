import { conversationFileSource } from "@valentinkolb/cloud/ai/solid";
import { FileBrowserPanel, prompts } from "@valentinkolb/cloud/ui";
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
    <div class="paper relative flex h-[86vh] min-h-0 flex-col overflow-hidden rounded-[var(--ui-radius-frame)] [box-shadow:var(--ui-shadow-float)]">
      <button type="button" class="icon-btn absolute right-3 top-3 z-20" onClick={props.close} title="Close files" aria-label="Close files">
        <i class="ti ti-x" aria-hidden="true" />
      </button>
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
