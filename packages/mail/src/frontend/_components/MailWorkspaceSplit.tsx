import { type JSX, onCleanup } from "solid-js";
import { MAIL_LIST_MAX_WIDTH, MAIL_LIST_MIN_WIDTH } from "./mail-workspace-preferences";

export default function MailWorkspaceSplit(props: {
  collapsed: boolean;
  hasSelection: boolean;
  listWidth: number;
  list: JSX.Element;
  reader: JSX.Element;
  onListWidthChange: (width: number) => void;
}) {
  let stopResize: (() => void) | null = null;
  const setWidth = (width: number) => props.onListWidthChange(Math.min(MAIL_LIST_MAX_WIDTH, Math.max(MAIL_LIST_MIN_WIDTH, width)));

  const beginResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = props.listWidth;
    const move = (moveEvent: PointerEvent) => setWidth(startWidth + moveEvent.clientX - startX);
    const finish = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      document.documentElement.removeAttribute("data-mail-resize-active");
      stopResize = null;
    };
    stopResize?.();
    stopResize = finish;
    document.documentElement.setAttribute("data-mail-resize-active", "true");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  };

  onCleanup(() => stopResize?.());

  const resizeWithKeyboard = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key === "ArrowLeft") setWidth(props.listWidth - step);
    else if (event.key === "ArrowRight") setWidth(props.listWidth + step);
    else if (event.key === "Home") setWidth(MAIL_LIST_MIN_WIDTH);
    else if (event.key === "End") setWidth(MAIL_LIST_MAX_WIDTH);
    else return;
    event.preventDefault();
  };

  return (
    <div
      class="mail-workspace-split"
      classList={{ "mail-workspace-list-collapsed": props.collapsed, "mail-has-selection": props.hasSelection }}
      style={{ "--mail-list-width": `${props.listWidth}px` }}
    >
      <section class="mail-conversation-pane" aria-label="Conversation list">
        {props.list}
      </section>
      <button
        type="button"
        class="mail-pane-resizer"
        aria-label="Resize conversation list"
        aria-orientation="vertical"
        aria-valuemin={MAIL_LIST_MIN_WIDTH}
        aria-valuemax={MAIL_LIST_MAX_WIDTH}
        aria-valuenow={Math.round(props.listWidth)}
        role="separator"
        tabIndex={props.collapsed ? -1 : 0}
        onPointerDown={beginResize}
        onKeyDown={resizeWithKeyboard}
      >
        <span aria-hidden="true" />
      </button>
      <section class="mail-reader-pane" aria-label="Conversation reader">
        {props.reader}
      </section>
    </div>
  );
}
