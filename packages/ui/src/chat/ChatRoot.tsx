import type { JSX } from "solid-js";

export type ChatRootProps = {
  children: JSX.Element;
  class?: string;
  label?: string;
};

export function ChatRoot(props: ChatRootProps): JSX.Element {
  return (
    <section class={`k2b-chat ${props.class ?? ""}`} aria-label={props.label ?? "Chat"}>
      {props.children}
    </section>
  );
}
