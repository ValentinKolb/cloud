import { EditorView, lineNumbers } from "@codemirror/view";
import { encoding } from "@valentinkolb/stdlib";
import { clipboard, files } from "@valentinkolb/stdlib/browser";
import { editor } from "../../../lib/editor";
import { getNotebookPresenceColor } from "../../../lib/yjs";
import { yjs } from "../../../lib/yjs";
import { prompts } from "@valentinkolb/cloud/ui";
import { createCodeMirror } from "solid-codemirror";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { yCollab } from "y-codemirror.next";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { refreshCurrentPath } from "@valentinkolb/cloud/ui";
import {
  EDITOR_COPY_EVENT,
  EDITOR_DOWNLOAD_EVENT,
  PRESENCE_EVENT,
  RICH_MODE_CHANGED_EVENT,
  TOC_SCROLL_EVENT,
  TOC_UPDATE_EVENT,
  TOGGLE_RICH_MODE_EVENT,
} from "../detail/events";
import { extractTocFromMarkdown } from "../detail/toc";
import { writeSettings } from "../settings/NotebookSettingsStore";
import EditorToolbar, { formattingKeymap } from "./EditorToolbar";
import { slashCommandsExtension } from "./slash-commands";

const TOC_DEBOUNCE_MS = 300;

type Props = {
  noteId: string;
  noteTitle: string;
  notebookId: string;
  appUrl: string;
  sessionToken: string;
  userId: string;
  displayName: string;
  initialSnapshot: string | null;
  initialPanelOpen: boolean;
};

const CURSOR_IDLE_TIMEOUT_MS = 8_000;

export default function NoteEditor(props: Props) {
  const [connected, setConnected] = createSignal(false);
  const [isDark, setIsDark] = createSignal(document.documentElement.classList.contains("dark"));
  const [richMode, setRichMode] = createSignal(true);

  const doc = new Y.Doc({ gc: true });
  if (props.initialSnapshot) {
    const bytes = encoding.fromBase64(props.initialSnapshot);
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
  addExtension(formattingKeymap({ notebookId: props.notebookId }));
  addExtension(slashCommandsExtension({ notebookId: props.notebookId, noteId: props.noteId }));
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
    // Forwards every presence update to the OnlineSection island via a
    // window event — the editor itself doesn't need to track participants
    // anymore now that the toolbar no longer renders them.
    onPresenceChange: (next) => {
      window.dispatchEvent(new CustomEvent(PRESENCE_EVENT, { detail: next }));
    },
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
  let tocDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  const emitToc = () => {
    const items = extractTocFromMarkdown(ytext.toString());
    window.dispatchEvent(new CustomEvent(TOC_UPDATE_EVENT, { detail: items }));
  };

  const scheduleTocEmit = () => {
    if (tocDebounceTimer) clearTimeout(tocDebounceTimer);
    tocDebounceTimer = setTimeout(emitToc, TOC_DEBOUNCE_MS);
  };

  const onTextUpdate = () => scheduleTocEmit();
  ytext.observe(onTextUpdate);

  const onToggleRich = () => setRichMode((value) => !value);

  // Broadcast richMode whenever it changes so the detail panel's "Markdown
  // source" / "Rich text mode" label can flip accordingly. Fires once on
  // hydration with the initial value, then on every toggle.
  createEffect(() => {
    window.dispatchEvent(new CustomEvent(RICH_MODE_CHANGED_EVENT, { detail: { isRich: richMode() } }));
  });

  const onCopy = () => void clipboard.copy(ytext.toString());

  const onDownload = () => {
    const filename = `${(props.noteTitle || "note").trim() || "note"}.md`;
    files.downloadFileFromContent(ytext.toString(), filename, "text/markdown");
  };

  const onScrollToHeading = (event: Event) => {
    const detail = (event as CustomEvent<{ id: string }>).detail;
    if (!detail?.id) return;
    const view = editorView();
    if (!view) return;

    // Re-extract from the current doc and match by id (slug). This stays
    // correct even if the user has edited since the TOC was last emitted.
    const items = extractTocFromMarkdown(ytext.toString());
    const target = items.find((item) => item.id === detail.id);
    if (!target) return;

    // Find the heading line by linear scan of the doc — slug ordering matches
    // document order, so we count how many headings precede our target and
    // pick the Nth heading-line in the doc.
    const targetIndex = items.indexOf(target);
    let seenHeadings = 0;
    let lineNumber = 1;
    const totalLines = view.state.doc.lines;
    for (let i = 1; i <= totalLines; i++) {
      const text = view.state.doc.line(i).text;
      if (/^#{1,6}\s+/.test(text)) {
        if (seenHeadings === targetIndex) {
          lineNumber = i;
          break;
        }
        seenHeadings++;
      }
    }
    const lineFrom = view.state.doc.line(lineNumber).from;
    view.dispatch({ selection: { anchor: lineFrom }, scrollIntoView: true });
  };

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
    // First emit so the panel reflects the current doc immediately on mount,
    // not only after the first keystroke.
    emitToc();

    window.addEventListener(TOC_SCROLL_EVENT, onScrollToHeading);
    window.addEventListener(TOGGLE_RICH_MODE_EVENT, onToggleRich);
    window.addEventListener(EDITOR_COPY_EVENT, onCopy);
    window.addEventListener(EDITOR_DOWNLOAD_EVENT, onDownload);

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
    if (tocDebounceTimer) {
      clearTimeout(tocDebounceTimer);
    }
    ytext.unobserve(onTextUpdate);
    window.removeEventListener(TOC_SCROLL_EVENT, onScrollToHeading);
    window.removeEventListener(TOGGLE_RICH_MODE_EVENT, onToggleRich);
    window.removeEventListener(EDITOR_COPY_EVENT, onCopy);
    window.removeEventListener(EDITOR_DOWNLOAD_EVENT, onDownload);
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
        editorView={editorView()}
        notebookId={props.notebookId}
        initialPanelOpen={props.initialPanelOpen}
      />
    </div>
  );
}
