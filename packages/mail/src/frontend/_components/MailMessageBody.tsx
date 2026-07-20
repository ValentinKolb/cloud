import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { normalizeContentId, referencedContentIds, rewriteCidSources, splitPlainMessageSegments } from "./mail-message-presentation";

const MAX_INLINE_IMAGE_COUNT = 32;
const MAX_INLINE_IMAGE_BYTES = 25 * 1024 * 1024;

const buildMessageDocument = (html: string, channel: string): string => {
  const channelLiteral = JSON.stringify(channel).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; object-src 'none'">
  <meta name="referrer" content="no-referrer">
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; color: inherit; font: 14px/1.55 system-ui, sans-serif; overflow-wrap: anywhere; }
    body { padding: 1px; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; border-collapse: collapse; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    a { color: #1677c8; }
    details.mail-quoted-history { margin-top: 12px; color: color-mix(in srgb, currentColor 65%, transparent); }
    details.mail-quoted-history > summary { cursor: pointer; user-select: none; font-size: 12px; font-weight: 600; }
    details.mail-quoted-history > blockquote,
    details.mail-quoted-history > div { margin: 8px 0 0; padding-left: 12px; border-left: 2px solid color-mix(in srgb, currentColor 25%, transparent); }
  </style>
</head>
<body>${html}
  <script>
    (() => {
      "use strict";
      const channel = ${channelLiteral};
      const post = (type, value) => parent.postMessage({ source: "cloud-mail-message", channel, type, value }, "*");
      const quoteSelectors = 'blockquote[type="cite"], .gmail_quote, .yahoo_quoted';
      const candidates = [...document.querySelectorAll(quoteSelectors)].filter((node) => !node.parentElement?.closest("details.mail-quoted-history"));
      for (const node of candidates) {
        if (node.parentElement?.closest(quoteSelectors)) continue;
        const details = document.createElement("details");
        details.className = "mail-quoted-history";
        const summary = document.createElement("summary");
        summary.textContent = "Show quoted history";
        node.replaceWith(details);
        details.append(summary, node);
      }
      for (const link of document.querySelectorAll("a[href]")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      let selectionTimer = 0;
      document.addEventListener("selectionchange", () => {
        clearTimeout(selectionTimer);
        selectionTimer = setTimeout(() => post("selection", String(getSelection()?.toString() || "").trim().slice(0, 10000)), 25);
      });
      const reportHeight = () => post("height", Math.ceil(document.documentElement.scrollHeight));
      new ResizeObserver(reportHeight).observe(document.body);
      reportHeight();
    })();
  </script>
</body>
</html>`;
};

export default function MailMessageBody(props: {
  mailboxId: string;
  messageId: string;
  html: string | null;
  plainText: string | null;
  attachments: Array<{ id: string; contentId: string | null; contentType: string; sizeBytes: number }>;
  onSelectionChange: (value: string) => void;
}) {
  const channel = crypto.randomUUID();
  const [height, setHeight] = createSignal(160);
  const [cidUrls, setCidUrls] = createSignal(new Map<string, string>());
  let frame: HTMLIFrameElement | undefined;
  const plainSegments = createMemo(() => splitPlainMessageSegments(props.plainText ?? ""));
  const documentSource = createMemo(() => buildMessageDocument(rewriteCidSources(props.html ?? "", cidUrls()), channel));

  const receiveMessage = (event: MessageEvent) => {
    if (!frame || event.source !== frame.contentWindow || !event.data || typeof event.data !== "object") return;
    const data = event.data as { source?: unknown; channel?: unknown; type?: unknown; value?: unknown };
    if (data.source !== "cloud-mail-message" || data.channel !== channel) return;
    if (data.type === "height" && typeof data.value === "number" && Number.isFinite(data.value)) {
      setHeight(Math.min(Math.max(Math.ceil(data.value) + 2, 80), 100_000));
    }
    if (data.type === "selection" && typeof data.value === "string") {
      props.onSelectionChange(data.value.slice(0, 10_000));
    }
  };

  onMount(() => {
    window.addEventListener("message", receiveMessage);
    const controller = new AbortController();
    let disposed = false;
    const objectUrls: string[] = [];
    const loadCidImages = async () => {
      const referenced = new Set(referencedContentIds(props.html ?? ""));
      let selectedBytes = 0;
      const selected = props.attachments
        .filter((attachment) => {
          if (!attachment.contentId || !attachment.contentType.toLowerCase().startsWith("image/")) return false;
          if (!referenced.has(normalizeContentId(attachment.contentId))) return false;
          if (!Number.isSafeInteger(attachment.sizeBytes) || attachment.sizeBytes < 0) return false;
          if (selectedBytes + attachment.sizeBytes > MAX_INLINE_IMAGE_BYTES) return false;
          selectedBytes += attachment.sizeBytes;
          return true;
        })
        .slice(0, MAX_INLINE_IMAGE_COUNT);
      const entries: Array<[string, string]> = [];
      for (const attachment of selected) {
        const response = await fetch(
          `/api/mail/mailboxes/${props.mailboxId}/messages/${props.messageId}/attachments/${attachment.id}?inline=true`,
          { credentials: "same-origin", signal: controller.signal },
        );
        if (!response.ok) continue;
        const objectUrl = URL.createObjectURL(await response.blob());
        objectUrls.push(objectUrl);
        entries.push([normalizeContentId(attachment.contentId!), objectUrl]);
      }
      if (!disposed) setCidUrls(new Map(entries));
    };
    void loadCidImages().catch((error) => {
      if (!controller.signal.aborted) console.warn("Could not load inline email image", error);
    });
    onCleanup(() => {
      disposed = true;
      controller.abort();
      for (const url of objectUrls) URL.revokeObjectURL(url);
    });
  });
  onCleanup(() => {
    window.removeEventListener("message", receiveMessage);
    props.onSelectionChange("");
  });

  return (
    <Show
      when={props.html}
      fallback={
        <Show when={props.plainText}>
          <div class="flex flex-col gap-2">
            <For each={plainSegments()}>
              {(segment) =>
                segment.kind === "quote" ? (
                  <details class="text-secondary">
                    <summary class="cursor-pointer select-none text-xs font-medium">Show quoted history</summary>
                    <pre class="mt-2 whitespace-pre-wrap break-words border-l-2 border-default pl-3 font-sans text-sm">{segment.text}</pre>
                  </details>
                ) : (
                  <pre class="whitespace-pre-wrap break-words font-sans text-sm">{segment.text}</pre>
                )
              }
            </For>
          </div>
        </Show>
      }
    >
      <iframe
        ref={frame}
        title="Email message content"
        class="block w-full border-0 bg-transparent"
        style={{ height: `${height()}px` }}
        sandbox="allow-scripts allow-popups"
        referrerpolicy="no-referrer"
        srcdoc={documentSource()}
      />
    </Show>
  );
}
