export const normalizeMessageBodyHeight = (value: number): number => (Number.isFinite(value) ? Math.max(Math.ceil(value), 32) : 32);

export const buildMessageDocument = (html: string, channel: string): string => {
  const channelLiteral = JSON.stringify(channel).replaceAll("<", "\\u003c");
  const scriptNonce = channel.replace(/[^a-zA-Z0-9]/gu, "") || "mailbridge";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; form-action 'none'; base-uri 'none'; object-src 'none'">
  <meta name="referrer" content="no-referrer">
  <style>
    :root { color-scheme: only light; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; color: #18181b; font: 14px/1.55 system-ui, sans-serif; overflow-wrap: anywhere; }
    body { padding: 1px; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; border-collapse: collapse; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    a { color: #1677c8; }
    details.mail-quoted-history { margin-top: 12px; color: color-mix(in srgb, currentColor 65%, transparent); }
    details.mail-quoted-history > summary { cursor: pointer; user-select: none; font-size: 12px; font-weight: 600; }
    details.mail-quoted-history > blockquote,
    details.mail-quoted-history > div { margin: 8px 0 0; padding-left: 12px; border-left: 2px solid color-mix(in srgb, currentColor 25%, transparent); }
    #mail-message-root { display: flow-root; min-height: 0; }
  </style>
</head>
<body><div id="mail-message-root">${html}</div>
  <script nonce="${scriptNonce}">
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
        summary.textContent = "Show quoted text";
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
      const root = document.getElementById("mail-message-root");
      const reportHeight = () => post("height", Math.ceil((root?.getBoundingClientRect().height || 0) + 2));
      if (root) new ResizeObserver(reportHeight).observe(root);
      reportHeight();
    })();
  </script>
</body>
</html>`;
};
