import { EditorView, lineNumbers } from "@codemirror/view";
import type { NotebookPresenceParticipant } from "@valentinkolb/cloud/contracts/shared";
import { editor } from "../../../lib/editor";
import { getNotebookPresenceColor } from "../../../lib/yjs";
import { yjs } from "../../../lib/yjs";
import { prompts } from "@valentinkolb/cloud/lib/ui";
import { createCodeMirror } from "solid-codemirror";
import { createSignal, onCleanup, onMount } from "solid-js";
import { yCollab } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { refreshCurrentPath } from "../../../lib/navigation";
import { writeSettings } from "../settings/NotebookSettingsStore";
import EditorToolbar, { formattingKeymap } from "./EditorToolbar";

type Props = {
  noteId: string;
  noteTitle: string;
  notebookId: string;
  appUrl: string;
  sessionToken: string;
  userId: string;
  displayName: string;
  initialSnapshot: string | null;
};

const CURSOR_IDLE_TIMEOUT_MS = 8_000;

export default function NoteEditor(props: Props) {
  const [connected, setConnected] = createSignal(false);
  const [isDark, setIsDark] = createSignal(document.documentElement.classList.contains("dark"));
  const [richMode, setRichMode] = createSignal(true);
  const [participants, setParticipants] = createSignal<NotebookPresenceParticipant[]>([]);

  const doc = new Y.Doc({ gc: true });
  if (props.initialSnapshot) {
    const bytes = Uint8Array.from(atob(props.initialSnapshot), (char) => char.charCodeAt(0));
    if (bytes.length) Y.applyUpdate(doc, bytes, "initial");
  }

  const ytext = doc.getText("codemirror");
  const awareness = new Awareness(doc);

  const color = getNotebookPresenceColor(props.userId);
  awareness.setLocalStateField("user", { name: props.displayName, color });

  const {
    ref: editorRef,
    createExtension: addExtension,
    editorView,
  } = createCodeMirror({
    value: ytext.toString(),
  });

  const undoManager = new Y.UndoManager(ytext);
  addExtension(() => yCollab(ytext, awareness, { undoManager }));

  let cursorIdleTimer: ReturnType<typeof setTimeout> | undefined;
  let cursorHiddenByIdle = false;
  let fatalPromptOpen = false;

  const publishCurrentCursor = (view: EditorView) => {
    const selection = view.state.selection.main;
    awareness.setLocalStateField("cursor", {
      anchor: Y.createRelativePositionFromTypeIndex(ytext, selection.anchor),
      head: Y.createRelativePositionFromTypeIndex(ytext, selection.head),
    });
    cursorHiddenByIdle = false;
  };

  const hideCursorForIdle = () => {
    awareness.setLocalStateField("cursor", null);
    cursorHiddenByIdle = true;
  };

  const scheduleCursorIdleHide = () => {
    if (cursorIdleTimer) {
      clearTimeout(cursorIdleTimer);
    }
    cursorIdleTimer = setTimeout(() => {
      hideCursorForIdle();
    }, CURSOR_IDLE_TIMEOUT_MS);
  };

  const markCursorActivity = (view?: EditorView) => {
    scheduleCursorIdleHide();
    if (cursorHiddenByIdle && view) {
      publishCurrentCursor(view);
    }
  };

  addExtension(
    EditorView.updateListener.of((update) => {
      if (!update.view.hasFocus) return;
      if (update.docChanged || update.selectionSet) {
        markCursorActivity(update.view);
      }
    }),
  );

  addExtension(editor.basicExtensions());
  addExtension(formattingKeymap());
  addExtension(editor.markdownExtension());
  addExtension(editor.searchTheme());

  addExtension(() => {
    if (richMode()) return isDark() ? editor.customDarkInit() : editor.customLightInit();
    return isDark() ? editor.rawDarkInit() : editor.rawLightInit();
  });

  addExtension(
    EditorView.theme({
      ".cm-editor": { minHeight: "100%" },
      ".cm-scroller": { width: "100%", minHeight: "100%", padding: "1rem" },
    }),
  );

  addExtension(() => (richMode() ? [] : lineNumbers()));

  addExtension(() =>
    richMode()
      ? [
          editor.tablesExtension(),
          editor.imageExtension(),
          editor.listsExtension(),
          editor.infoBlocksExtension(),
          editor.linksExtension(),
          editor.markupExtension(),
          editor.mermaidExtension(),
          editor.katexExtension(),
        ]
      : [],
  );

  const provider = yjs.createYjsProvider({
    doc,
    awareness,
    noteId: props.noteId,
    appUrl: props.appUrl,
    sessionToken: props.sessionToken,
    onConnectionChange: setConnected,
    onPresenceChange: setParticipants,
    onFatal: (error) => {
      if (fatalPromptOpen) return;
      fatalPromptOpen = true;
      const isLocked = error.code === "NOTE_LOCKED";
      const isMissing = error.code === "NOTE_NOT_FOUND";
      const isRevoked = error.code === "ACCESS_REVOKED" || error.code === "ACCESS_DENIED";
      const isSession = error.code === "SESSION_EXPIRED" || error.code === "LOGIN_REQUIRED";

      const title = isLocked
        ? "Note Locked"
        : isMissing
          ? "Note Not Found"
          : isRevoked
            ? "Access Changed"
            : isSession
              ? "Session Expired"
              : "Connection Closed";

      const icon = isLocked
        ? "ti ti-lock"
        : isMissing
          ? "ti ti-file-x"
          : isRevoked
            ? "ti ti-shield-off"
            : isSession
              ? "ti ti-login-2"
              : "ti ti-alert-triangle";

      const message = isMissing ? "Note not found. It may have been deleted." : error.message || "The collaboration connection was closed.";

      void prompts
        .alert(`${message} The note view will now reload.`, {
          title,
          icon,
        })
        .finally(() => {
          refreshCurrentPath();
        });
    },
  });

  let themeObserver: MutationObserver | undefined;

  const focusEditor = (attempts = 0): boolean => {
    const view = editorView();
    if (!view) {
      if (attempts < 8) {
        requestAnimationFrame(() => {
          focusEditor(attempts + 1);
        });
      }
      return false;
    }

    const at = view.state.doc.length;
    view.dispatch({
      selection: { anchor: at },
      scrollIntoView: true,
    });
    view.focus();
    return true;
  };

  onMount(() => {
    writeSettings(props.notebookId, { lastNoteId: props.noteId });
    provider.connect();
    focusEditor();
    scheduleCursorIdleHide();

    themeObserver = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });

    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  });

  onCleanup(() => {
    if (cursorIdleTimer) {
      clearTimeout(cursorIdleTimer);
    }
    themeObserver?.disconnect();
    provider.dispose();
    undoManager.destroy();
    awareness.destroy();
    doc.destroy();
  });

  return (
    <div class="flex-1 min-w-0 flex flex-col overflow-hidden">
      <div
        class="paper flex-1 min-h-0 overflow-y-auto bg-white dark:bg-zinc-950 cursor-text"
        onMouseDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (target?.closest(".cm-editor")) return;
          event.preventDefault();
          if (focusEditor()) {
            const view = editorView();
            if (view) {
              markCursorActivity(view);
            }
          }
        }}
        onMouseMove={() => {
          const view = editorView();
          if (view?.hasFocus) {
            scheduleCursorIdleHide();
          }
        }}
        onKeyDown={() => {
          const view = editorView();
          if (view?.hasFocus) {
            scheduleCursorIdleHide();
          }
        }}
        role="textbox"
        tabIndex={-1}
        aria-label="Note editor surface"
      >
        <div ref={editorRef} />
      </div>
      <EditorToolbar
        connected={connected()}
        participants={participants()}
        editorView={editorView()}
        richMode={richMode()}
        onToggleRichMode={() => setRichMode((value) => !value)}
        notebookId={props.notebookId}
        noteId={props.noteId}
      />
    </div>
  );
}
