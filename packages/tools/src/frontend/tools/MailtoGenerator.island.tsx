import { createSignal, createMemo } from "solid-js";
import { TextInput } from "@valentinkolb/cloud/ui";
import { TagsInput } from "@valentinkolb/cloud/ui";
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

  const [copiedField, setCopiedField] = createSignal<string | null>(null);

  const copy = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const CopyBtn = (props: { value: string; field: string; label: string }) => (
    <button class="btn-secondary btn-sm" onClick={() => copy(props.value, props.field)}>
      <i class={`ti ${copiedField() === props.field ? "ti-check" : "ti-copy"}`} />
      {copiedField() === props.field ? "Copied" : props.label}
    </button>
  );

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
          onInput={setTo}
          required
        />
        <TagsInput
          label="CC"
          description="Carbon copy — visible to all recipients. Press Enter to add."
          placeholder="Add CC address..."
          icon="ti ti-users"
          value={cc}
          onChange={setCc}
        />
        <TagsInput
          label="BCC"
          description="Blind carbon copy — hidden from other recipients."
          placeholder="Add BCC address..."
          icon="ti ti-user-off"
          value={bcc}
          onChange={setBcc}
        />
        <TextInput
          label="Subject"
          description="Pre-filled subject line for the email."
          placeholder="Email subject"
          icon="ti ti-text-caption"
          value={subject}
          onInput={setSubject}
        />
        <TextInput
          label="Body"
          description="Pre-filled body text. Line breaks are preserved."
          placeholder="Email body text..."
          multiline
          value={body}
          onInput={setBody}
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
            <CopyBtn value={mailto()} field="mailto" label="Copy Link" />
            <CopyBtn value={markdownLink()} field="markdown" label="Copy Markdown" />
            <CopyBtn value={htmlLink()} field="html" label="Copy HTML" />
            <a href={mailto()} class="btn-primary btn-sm inline-flex items-center gap-1">
              <i class="ti ti-external-link" />
              Open in Mail Client
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
