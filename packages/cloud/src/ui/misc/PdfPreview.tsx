import { createSignal, onCleanup, Show } from "solid-js";

export type PdfPreviewRequest = () => Promise<Response | Blob>;

export type PdfPreviewProps = {
  request: PdfPreviewRequest;
  disabled?: () => boolean;
  title?: string;
  buttonLabel?: string;
  openButtonLabel?: string;
  emptyText?: string;
  class?: string;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const data = (await response.json()) as unknown;
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string") return data.message;
  } catch {
    // Fall through to the HTTP status fallback.
  }
  return `PDF preview failed with HTTP ${response.status}`;
};

export default function PdfPreview(props: PdfPreviewProps) {
  const [url, setUrl] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [opening, setOpening] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const revokeCurrent = () => {
    const current = url();
    if (current) URL.revokeObjectURL(current);
    setUrl(null);
  };

  onCleanup(revokeCurrent);

  const readPdfBlob = async () => {
    const response = await props.request();
    const blob = response instanceof Response ? (response.ok ? await response.blob() : null) : response;
    if (!blob) throw new Error(await readErrorMessage(response as Response));
    if (blob.type && blob.type !== "application/pdf") throw new Error(`PDF preview returned ${blob.type} instead of application/pdf`);
    return blob;
  };

  const load = async () => {
    if (loading() || opening() || props.disabled?.()) return;
    setLoading(true);
    setError(null);
    revokeCurrent();
    try {
      const blob = await readPdfBlob();
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF preview failed");
    } finally {
      setLoading(false);
    }
  };

  const openInNewTab = async () => {
    if (loading() || opening() || props.disabled?.()) return;
    const tab = window.open("", "_blank");
    if (!tab) {
      setError("Browser blocked the preview tab");
      return;
    }
    tab.opener = null;
    tab.document.title = props.title ?? "PDF preview";
    tab.document.body.textContent = "Rendering PDF preview...";
    setOpening(true);
    setError(null);
    try {
      const blob = await readPdfBlob();
      const objectUrl = URL.createObjectURL(blob);
      tab.location.href = objectUrl;
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (e) {
      tab.close();
      setError(e instanceof Error ? e.message : "PDF preview failed");
    } finally {
      setOpening(false);
    }
  };

  return (
    <section class={`paper flex min-h-0 flex-col overflow-hidden ${props.class ?? ""}`}>
      <div class="flex items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <div class="min-w-0">
          <Show when={props.title}>
            <h3 class="truncate text-sm font-semibold text-primary">{props.title}</h3>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="btn-input btn-sm"
            onClick={() => void openInNewTab()}
            disabled={loading() || opening() || props.disabled?.()}
          >
            <i class={opening() ? "ti ti-loader-2 animate-spin" : "ti ti-external-link"} />
            {props.openButtonLabel ?? "Open preview"}
          </button>
          <button
            type="button"
            class="btn-input btn-sm"
            onClick={() => void load()}
            disabled={loading() || opening() || props.disabled?.()}
          >
            <i class={loading() ? "ti ti-loader-2 animate-spin" : "ti ti-file-type-pdf"} />
            {props.buttonLabel ?? "Preview PDF"}
          </button>
        </div>
      </div>

      <Show
        when={url()}
        fallback={
          <div class="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-dimmed">
            <Show when={error()} fallback={<span>{props.emptyText ?? "Render a PDF preview to see the final output."}</span>}>
              {(message) => (
                <div class="max-w-md rounded-md border border-red-200 bg-red-50 px-3 py-2 text-left text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                  {message()}
                </div>
              )}
            </Show>
          </div>
        }
      >
        {(currentUrl) => <iframe class="min-h-0 flex-1 bg-white" src={currentUrl()} title={props.title ?? "PDF preview"} />}
      </Show>
    </section>
  );
}
