import { createSignal, createMemo } from "solid-js";
import { encoding } from "@valentinkolb/stdlib";
import { TextInput, SegmentedControl } from "@valentinkolb/cloud/ui";

type Direction = "encode" | "decode";
type Format = "base64" | "hex" | "base32";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};

export default function EncodingTool() {
  const [direction, setDirection] = createSignal<Direction>("encode");
  const [format, setFormat] = createSignal<Format>("base64");
  const [input, setInput] = createSignal("");
  const [error, setError] = createSignal<string | undefined>();

  const output = createMemo(() => {
    const text = input();
    if (!text) {
      setError(undefined);
      return "";
    }

    try {
      setError(undefined);
      if (direction() === "encode") {
        const bytes = encoder.encode(text);
        switch (format()) {
          case "base64":
            return encoding.toBase64(bytes);
          case "hex":
            return encoding.toHex(bytes);
          case "base32":
            return encoding.toBase32(bytes);
        }
      } else {
        let bytes: Uint8Array;
        switch (format()) {
          case "base64":
            bytes = encoding.fromBase64(text);
            break;
          case "hex":
            bytes = encoding.fromHex(text);
            break;
          case "base32":
            bytes = encoding.fromBase32(text);
            break;
        }
        return decoder.decode(bytes);
      }
    } catch (error) {
      setError(getErrorMessage(error, "Invalid input"));
      return "";
    }
  });

  const [copied, setCopied] = createSignal(false);
  const copy = async () => {
    const val = output();
    if (!val) return;
    await navigator.clipboard.writeText(val);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div class="flex flex-col gap-4">
      <div class="paper p-4 flex flex-col gap-3">
        {/* Direction */}
        <SegmentedControl
          options={[
            {
              value: "encode" as Direction,
              label: "Encode",
              icon: "ti ti-arrow-right",
            },
            {
              value: "decode" as Direction,
              label: "Decode",
              icon: "ti ti-arrow-left",
            },
          ]}
          value={direction}
          onChange={setDirection}
        />

        {/* Format */}
        <SegmentedControl
          options={[
            { value: "base64" as Format, label: "Base64" },
            { value: "hex" as Format, label: "Hex" },
            { value: "base32" as Format, label: "Base32" },
          ]}
          value={format}
          onChange={setFormat}
        />

        <TextInput
          label={direction() === "encode" ? "Input Text" : `${format().charAt(0).toUpperCase() + format().slice(1)} Input`}
          description={
            direction() === "encode"
              ? "Plain text that will be converted to the selected format."
              : `Paste ${format()} encoded data to decode back to plain text.`
          }
          placeholder={direction() === "encode" ? "Text to encode..." : "Encoded data to decode..."}
          multiline
          value={input}
          onInput={setInput}
          error={error}
        />
      </div>

      {output() && (
        <div class="paper p-4 flex flex-col gap-3">
          <p class="text-xs font-medium text-dimmed">
            {direction() === "encode" ? `${format().charAt(0).toUpperCase() + format().slice(1)} Output` : "Decoded Text"}
          </p>
          <div class="text-xs break-all bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-3 font-mono select-all whitespace-pre-wrap">
            {output()}
          </div>
          <button class="btn-primary btn-sm self-start" onClick={copy}>
            <i class={`ti ${copied() ? "ti-check" : "ti-copy"}`} />
            {copied() ? "Copied" : "Copy"}
          </button>
        </div>
      )}
    </div>
  );
}
