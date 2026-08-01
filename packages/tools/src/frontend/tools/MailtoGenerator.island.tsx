import { ButtonLink, CopyButton, TagsInput, TextInput } from "@k2b/ui";
import { createMemo, createSignal } from "solid-js";
import { ToolCodeBlock } from "./ToolOutput";

export default function MailtoGenerator() {
  const [to, setTo] = createSignal("");
  const [cc, setCc] = createSignal<string[]>([]);
  const [bcc, setBcc] = createSignal<string[]>([]);
  const [subject, setSubject] = createSignal("");
  const [body, setBody] = createSignal("");

  const mailto = createMemo(() => {
    const toAddr = to().trim();
    if (!toAddr) return "";

    const params: string[] = [];
    if (cc().length > 0) params.push(`cc=${encodeURIComponent(cc().join(","))}`);
    if (bcc().length > 0) params.push(`bcc=${encodeURIComponent(bcc().join(","))}`);
    if (subject().trim()) params.push(`subject=${encodeURIComponent(subject().trim())}`);
    if (body().trim()) params.push(`body=${encodeURIComponent(body().trim())}`);

    return `mailto:${encodeURIComponent(toAddr)}${params.length > 0 ? "?" + params.join("&") : ""}`;
  });

  const markdownLink = createMemo(() => {
    if (!mailto()) return "";
    const label = subject().trim() || `Email ${to().trim()}`;
    return `[${label}](${mailto()})`;
  });

  const htmlLink = createMemo(() => {
    if (!mailto()) return "";
    const label = subject().trim() || `Email ${to().trim()}`;
    return `<a href="${mailto()}">${label}</a>`;
  });

  return (
    <div class="flex flex-col gap-4">
      <div class="info-block-warning flex items-start gap-2">
        <i class="ti ti-alert-triangle shrink-0 mt-0.5" />
        <span>
          <code>mailto:</code> does not support a Reply-To field. The recipient will always reply to the sender address.
        </span>
      </div>

      <div class="paper p-4 flex flex-col gap-3">
        <TextInput
          label="To"
          description="Primary recipient email address."
          placeholder="recipient@example.com"
          icon="ti ti-mail"
          value={to}
          onValueChange={setTo}
          required
        />
        <TagsInput
          label="CC"
          description="Carbon copy — visible to all recipients. Press Enter to add."
          placeholder="Add CC address..."
          icon="ti ti-users"
          value={cc}
          onValueChange={setCc}
        />
        <TagsInput
          label="BCC"
          description="Blind carbon copy — hidden from other recipients."
          placeholder="Add BCC address..."
          icon="ti ti-user-off"
          value={bcc}
          onValueChange={setBcc}
        />
        <TextInput
          label="Subject"
          description="Pre-filled subject line for the email."
          placeholder="Email subject"
          icon="ti ti-text-caption"
          value={subject}
          onValueChange={setSubject}
        />
        <TextInput
          label="Body"
          description="Pre-filled body text. Line breaks are preserved."
          placeholder="Email body text..."
          multiline
          value={body}
          onValueChange={setBody}
        />
      </div>

      {mailto() && (
        <div class="paper p-4 flex flex-col gap-3">
          {/* Raw mailto link */}
          <div class="flex flex-col gap-1">
            <p class="text-xs font-medium text-dimmed">Mailto Link</p>
            <ToolCodeBlock>{mailto()}</ToolCodeBlock>
          </div>

          {/* Markdown */}
          <div class="flex flex-col gap-1">
            <p class="text-xs font-medium text-dimmed">Markdown</p>
            <ToolCodeBlock>{markdownLink()}</ToolCodeBlock>
          </div>

          {/* HTML */}
          <div class="flex flex-col gap-1">
            <p class="text-xs font-medium text-dimmed">HTML</p>
            <ToolCodeBlock>{htmlLink()}</ToolCodeBlock>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <CopyButton value={mailto()} label="Copy Link" variant="secondary" size="sm" />
            <CopyButton value={markdownLink()} label="Copy Markdown" variant="secondary" size="sm" />
            <CopyButton value={htmlLink()} label="Copy HTML" variant="secondary" size="sm" />
            <ButtonLink href={mailto()} size="sm">
              <i class="ti ti-external-link" />
              Open in Mail Client
            </ButtonLink>
          </div>
        </div>
      )}
    </div>
  );
}
