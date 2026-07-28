import { highlight } from "@k2b/stdlib";
import { For, type JSX, Show } from "solid-js";
import { CopyButton } from "../actions";

export type DocsProps = {
  navigation?: JSX.Element;
  children: JSX.Element;
  aside?: JSX.Element;
  navigationLabel?: string;
  asideLabel?: string;
  class?: string;
};

export function Docs(props: DocsProps): JSX.Element {
  return (
    <div class={`k2b-docs ${props.class ?? ""}`}>
      <Show when={props.navigation}>
        <nav class="k2b-docs__navigation" aria-label={props.navigationLabel ?? "Documentation navigation"}>{props.navigation}</nav>
      </Show>
      <main class="k2b-docs__content">{props.children}</main>
      <Show when={props.aside}>
        <aside class="k2b-docs__aside" aria-label={props.asideLabel ?? "On this page"}>{props.aside}</aside>
      </Show>
    </div>
  );
}

export const DocPage = (props: { children: JSX.Element; class?: string }): JSX.Element => (
  <article class={`k2b-doc-page ${props.class ?? ""}`}>{props.children}</article>
);

export const DocLead = (props: { children: JSX.Element }): JSX.Element => <p class="k2b-doc-lead">{props.children}</p>;

export const DocSection = (props: { title: string; eyebrow?: string; children: JSX.Element; id?: string }): JSX.Element => (
  <section class="k2b-doc-section" id={props.id}>
    <Show when={props.eyebrow}><p class="k2b-doc-eyebrow">{props.eyebrow}</p></Show>
    <h2>{props.title}</h2>
    {props.children}
  </section>
);

export const DocInlineCode = (props: { children: JSX.Element }): JSX.Element => <code class="k2b-doc-inline-code">{props.children}</code>;

export type DocCodeProps = {
  code: string;
  language?: "text" | "code" | "sql" | "shell";
  title?: string;
  copy?: boolean;
};

export function DocCode(props: DocCodeProps): JSX.Element {
  const rendered = () => {
    if (props.language === "sql") return highlight.presets.sql(props.code);
    if (props.language === "shell") return highlight.presets.shell(props.code);
    if (props.language === "code") return highlight.presets.code(props.code);
    return highlight.escape(props.code);
  };
  return (
    <figure class="k2b-doc-code">
      <Show when={props.title || props.copy !== false}>
        <figcaption>
          <span>{props.title}</span>
          <Show when={props.copy !== false}><CopyButton value={props.code} label="Copy code" /></Show>
        </figcaption>
      </Show>
      <pre><code innerHTML={rendered()} /></pre>
    </figure>
  );
}

export type DocConcept = { title: string; description: JSX.Element; icon?: string };
export function DocConceptGrid(props: { items: readonly DocConcept[] }): JSX.Element {
  return (
    <div class="k2b-doc-concepts">
      <For each={props.items}>{(item) => (
        <article>
          <Show when={item.icon}><i class={item.icon} aria-hidden="true" /></Show>
          <h3>{item.title}</h3>
          <div>{item.description}</div>
        </article>
      )}</For>
    </div>
  );
}

export type DocRow = { label: string; value: JSX.Element; description?: JSX.Element };
export function DocRows(props: { items: readonly DocRow[] }): JSX.Element {
  return (
    <dl class="k2b-doc-rows">
      <For each={props.items}>{(item) => (
        <div>
          <dt>{item.label}</dt>
          <dd>{item.value}<Show when={item.description}><small>{item.description}</small></Show></dd>
        </div>
      )}</For>
    </dl>
  );
}

export type DocNoteVariant = "info" | "tip" | "warning";
export function DocNote(props: { title: string; variant?: DocNoteVariant; children: JSX.Element }): JSX.Element {
  return (
    <aside class="k2b-doc-note" data-variant={props.variant ?? "info"}>
      <strong>{props.title}</strong>
      <div>{props.children}</div>
    </aside>
  );
}
