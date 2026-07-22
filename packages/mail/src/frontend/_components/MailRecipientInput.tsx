import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { z } from "zod";
import { formatMailRecipient, parseMailRecipient, parseMailRecipients } from "./mail-recipient";

const searchResponseSchema = z.object({
  data: z.array(
    z.object({
      label: z.string().nullable(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      companyName: z.string().nullable(),
      emails: z.array(z.object({ email: z.email() })),
    }),
  ),
});

type RecipientSuggestion = { label: string; address: string };

const displayName = (contact: z.infer<typeof searchResponseSchema>["data"][number]): string =>
  contact.label ||
  [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
  contact.companyName ||
  contact.emails[0]?.email ||
  "Contact";

export default function MailRecipientInput(props: {
  value: () => string[];
  onChange: (value: string[]) => void;
  placeholder: string;
  disabled?: boolean;
}) {
  const errorId = `${props.placeholder.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}-recipient-error`;
  const [query, setQuery] = createSignal("");
  const [suggestions, setSuggestions] = createSignal<RecipientSuggestion[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [validationError, setValidationError] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;

  const add = (raw: string) => {
    const recipient = parseMailRecipient(raw);
    if (!recipient) {
      setValidationError("Enter a valid email address.");
      return;
    }
    const next = parseMailRecipients([...props.value(), formatMailRecipient(recipient)]).map(formatMailRecipient);
    props.onChange(next);
    setQuery("");
    setSuggestions([]);
    setValidationError(null);
  };

  const remove = (raw: string) => props.onChange(props.value().filter((value) => value !== raw));

  createEffect(() => {
    const value = query().trim();
    if (timer) clearTimeout(timer);
    controller?.abort();
    if (value.length < 2 || value.includes("@")) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    timer = setTimeout(async () => {
      const request = new AbortController();
      controller = request;
      try {
        const params = new URLSearchParams({ q: value, email: "yes", per_page: "8", page: "1" });
        const response = await fetch(`/api/contacts/search?${params}`, { signal: request.signal });
        if (!response.ok) throw new Error("Contacts unavailable");
        const result = searchResponseSchema.parse(await response.json());
        const seen = new Set<string>();
        setSuggestions(
          result.data.flatMap((contact) => {
            const label = displayName(contact);
            return contact.emails.flatMap(({ email }) => {
              const address = email.toLowerCase();
              if (seen.has(address)) return [];
              seen.add(address);
              return [{ label, address }];
            });
          }),
        );
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSuggestions([]);
      } finally {
        if (controller === request) {
          controller = null;
          setLoading(false);
        }
      }
    }, 180);
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
    controller?.abort();
  });

  return (
    <div class="relative min-w-0">
      <div class="input flex min-h-10 w-full flex-wrap items-center gap-1.5 px-2 py-1.5 focus-within:ring-2 focus-within:ring-blue-400">
        <i class="ti ti-at shrink-0 text-dimmed" aria-hidden="true" />
        <For each={props.value()}>
          {(recipient) => (
            <span class="chip max-w-56">
              <span class="truncate">{recipient}</span>
              <button
                type="button"
                class="icon-btn icon-btn-xs"
                aria-label={`Remove ${recipient}`}
                disabled={props.disabled}
                onClick={() => remove(recipient)}
              >
                <i class="ti ti-x" aria-hidden="true" />
              </button>
            </span>
          )}
        </For>
        <input
          class="min-w-32 flex-1 bg-transparent px-1 py-1 text-sm outline-none"
          value={query()}
          placeholder={props.value().length === 0 ? props.placeholder : "Add recipient"}
          disabled={props.disabled}
          aria-label={props.placeholder}
          aria-invalid={Boolean(validationError())}
          aria-describedby={validationError() ? errorId : undefined}
          autocomplete="off"
          onInput={(event) => {
            setQuery(event.currentTarget.value);
            setValidationError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              add(query().replace(/,$/, ""));
            } else if (event.key === "Backspace" && !query() && props.value().length > 0) {
              props.onChange(props.value().slice(0, -1));
            }
          }}
          onBlur={() => {
            if (query().includes("@")) add(query());
          }}
        />
        <Show when={loading()}>
          <i class="ti ti-loader-2 animate-spin text-dimmed" aria-hidden="true" />
        </Show>
      </div>
      <Show when={validationError()}>
        {(message) => (
          <p id={errorId} class="mt-1 text-xs text-red-600 dark:text-red-300">
            {message()}
          </p>
        )}
      </Show>
      <Show when={suggestions().length > 0}>
        <div class="dropdown-menu-surface absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto p-1" role="listbox">
          <For each={suggestions()}>
            {(suggestion) => (
              <button
                type="button"
                class="flex w-full min-w-0 items-center gap-2 rounded px-2 py-2 text-left hover:bg-[var(--ui-hover)]"
                role="option"
                aria-selected="false"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => add(`${suggestion.label} <${suggestion.address}>`)}
              >
                <i class="ti ti-user text-dimmed" aria-hidden="true" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-primary">{suggestion.label}</span>
                  <span class="block truncate text-xs text-dimmed">{suggestion.address}</span>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
