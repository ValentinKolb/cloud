import { createLiveWebSocket } from "@valentinkolb/cloud/browser/live";
import { currentPathWithQuery } from "@valentinkolb/ssr/nav";
import { retry } from "@valentinkolb/sync/browser";
import { onCleanup, onMount } from "solid-js";
import {
  CONTACTS_LIVE_WS_TYPE,
  type ContactLiveClientMessage,
  type ContactLiveScope,
  type ContactLiveServerMessage,
  type ContactServiceEvent,
  parseContactLiveServerMessage,
} from "../../live-events";
import { dispatchContactsLiveInvalidation, requiresContactsShellRefresh } from "./contacts-live";

type Props = {
  scope: ContactLiveScope;
  initialCursor: string;
};

const ACTIVE_EDITOR_SELECTOR = '[data-contacts-editor="true"]';

const waitForEditorsToClose = (signal: AbortSignal): Promise<void> => {
  if (!document.querySelector(ACTIVE_EDITOR_SELECTOR)) return Promise.resolve();
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      if (document.querySelector(ACTIVE_EDITOR_SELECTOR)) return;
      observer.disconnect();
      signal.removeEventListener("abort", abort);
      resolve();
    });
    const abort = () => {
      observer.disconnect();
      resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-contacts-editor"] });
  });
};

export default function ContactsLiveEvents(props: Props) {
  onMount(() => {
    const lifecycle = new AbortController();
    let reloading = false;
    let applyQueue = Promise.resolve();

    const replaceCurrentPage = () => {
      if (reloading || lifecycle.signal.aborted) return;
      reloading = true;
      lifecycle.abort();
      window.location.replace(currentPathWithQuery());
    };

    const enqueueEvent = (
      event: ContactServiceEvent,
      cursor: string,
      controls: { markApplied: (cursor: string) => void; terminate: (error: { code: string; message: string }) => void },
    ) => {
      applyQueue = applyQueue
        .then(async () => {
          if (reloading || lifecycle.signal.aborted) return;
          if (requiresContactsShellRefresh(event)) {
            controls.terminate({ code: "shell_changed", message: "Contact book metadata changed" });
            await waitForEditorsToClose(lifecycle.signal);
            replaceCurrentPage();
            return;
          }
          await retry({
            signal: lifecycle.signal,
            run: () => dispatchContactsLiveInvalidation(event),
            after: ({ ctx }) => {
              if (ctx.error && ctx.attempt < 3) ctx.reschedule({ delayMs: ctx.expBackoff({ baseMs: 150, maxMs: 1_000 }) });
            },
          });
          controls.markApplied(cursor);
        })
        .catch(async () => {
          controls.terminate({ code: "refresh_failed", message: "Could not apply a Contacts update" });
          await waitForEditorsToClose(lifecycle.signal);
          replaceCurrentPage();
        });
    };

    const connection = createLiveWebSocket<ContactLiveServerMessage>({
      url: "/api/contacts/ws",
      initialCursor: props.initialCursor,
      activity: "visible",
      subscribe: (cursor) =>
        ({
          type: CONTACTS_LIVE_WS_TYPE.subscribe,
          payload: { scope: props.scope, fromCursor: cursor },
        }) satisfies ContactLiveClientMessage,
      parse: parseContactLiveServerMessage,
      classifyClose: ({ code, reason }) =>
        code === 1008 ? { code: reason || "access_denied", message: "Live access changed or expired." } : null,
      onMessage: (message, controls) => {
        if (message.type === CONTACTS_LIVE_WS_TYPE.ready) {
          controls.markApplied(message.payload.cursor);
          return;
        }
        if (message.type === CONTACTS_LIVE_WS_TYPE.scopeChanged) {
          controls.terminate({ code: "scope_changed", message: "Contact book access changed" });
          if (message.payload.change === "gained") {
            void waitForEditorsToClose(lifecycle.signal).then(replaceCurrentPage);
          } else {
            replaceCurrentPage();
          }
          return;
        }
        if (message.type === CONTACTS_LIVE_WS_TYPE.event) {
          enqueueEvent(message.payload.event, message.payload.cursor, controls);
          return;
        }
        if (message.type === CONTACTS_LIVE_WS_TYPE.revoked) {
          controls.terminate({ code: message.payload.code, message: message.payload.message });
          replaceCurrentPage();
        }
      },
    });

    connection.connect();
    onCleanup(() => {
      lifecycle.abort();
      connection.dispose();
    });
  });

  return null;
}
