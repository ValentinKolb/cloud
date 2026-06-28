import { createSignal, Show } from "solid-js";
import { CopyButton, prompts } from "@valentinkolb/cloud/ui";

type Props = {
  displayName: string;
  uid: string;
  mail?: string | null;
  previousProvider?: string | null;
  previousProfile?: string | null;
  reason: string;
  deletedAt: string;
  metadata: Record<string, unknown> | null;
};

export default function DeletedAccountDetails(props: Props) {
  const open = async () => {
    await prompts.dialog<void>(
      (close) => (
        <div class="flex flex-col gap-4">
          <div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
            <span class="text-dimmed">Account</span>
            <span class="text-primary">{props.displayName}</span>
            <span class="text-dimmed">UID</span>
            <span class="text-primary">{props.uid}</span>
            <span class="text-dimmed">Email</span>
            <span class="text-primary">{props.mail || "-"}</span>
            <span class="text-dimmed">Provider</span>
            <span class="text-primary">{props.previousProvider || "-"}</span>
            <span class="text-dimmed">Profile</span>
            <span class="text-primary">{props.previousProfile || "-"}</span>
            <span class="text-dimmed">Reason</span>
            <span class="text-primary">{props.reason}</span>
            <span class="text-dimmed">Deleted</span>
            <span class="text-primary">{props.deletedAt}</span>
          </div>
          <MetadataDetail metadata={props.metadata} />
          <div class="flex justify-end">
            <button type="button" class="btn-secondary btn-sm" onClick={() => close()}>
              Close
            </button>
          </div>
        </div>
      ),
      { title: props.displayName, icon: "ti ti-history-toggle", size: "large" },
    );
  };

  return (
    <button type="button" class="btn-simple btn-sm" onClick={open}>
      <i class="ti ti-eye text-xs" />
      <span class="sr-only">Show details</span>
    </button>
  );
}

function MetadataDetail(props: { metadata: Record<string, unknown> | null }) {
  const [showRaw, setShowRaw] = createSignal(false);
  const entries: Array<[string, unknown]> = props.metadata ? Object.entries(props.metadata) : [];
  const jsonRaw = JSON.stringify(props.metadata ?? {}, null, 2);

  return (
    <div class="flex flex-col gap-2">
      <span class="text-[10px] uppercase tracking-wider text-dimmed">Metadata</span>
      <Show
        when={!showRaw()}
        fallback={
          <div class="relative rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
            <pre class="max-h-64 overflow-y-auto whitespace-pre-wrap break-all pr-16 text-[11px] text-secondary">{jsonRaw}</pre>
            <div class="absolute right-2 top-2">
              <CopyButton text={jsonRaw} label="Copy" />
            </div>
          </div>
        }
      >
        <div class="rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
          {props.metadata ? (
            <div class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              {entries.map(([key, value]) => {
                const isComplex = typeof value === "object" && value !== null;
                const display = isComplex ? JSON.stringify(value) : String(value ?? "null");
                return (
                  <>
                    <span class="shrink-0 font-medium text-dimmed">{key}</span>
                    <span class={`break-all text-secondary ${isComplex ? "font-mono text-[11px]" : ""}`}>{display}</span>
                  </>
                );
              })}
            </div>
          ) : (
            <div class="text-xs text-secondary">No metadata</div>
          )}
        </div>
      </Show>
      <button
        type="button"
        class="self-start text-[10px] text-dimmed transition-colors hover:text-secondary"
        onClick={() => setShowRaw(!showRaw())}
      >
        {showRaw() ? "View formatted" : "View raw"}
      </button>
    </div>
  );
}
