export const focusMailComposerEditorAtStart = (element: HTMLTextAreaElement): void => {
  element.focus();
  element.setSelectionRange(0, 0);
};
