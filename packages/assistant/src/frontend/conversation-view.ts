import type { AiConversation } from "@valentinkolb/cloud/ai";

export const conversationStatusPresentation = (conversation: AiConversation) => {
  if (conversation.runStatus === "needs_attention") {
    return { label: "Needs attention", icon: "ti ti-hand-stop", class: "text-amber-600 dark:text-amber-300" };
  }
  if (conversation.runStatus === "running" || conversation.runStatus === "queued") {
    return {
      label: conversation.runStatus === "queued" ? "Queued" : "Running",
      icon: "ti ti-loader-2 animate-spin",
      class: "text-cyan-600 dark:text-cyan-300",
    };
  }
  if (conversation.runStatus === "failed") {
    return { label: "Failed", icon: "ti ti-alert-circle", class: "text-red-600 dark:text-red-400" };
  }
  if (conversation.unreadCompletion) {
    return { label: "New response", icon: "ti ti-circle-filled", class: "text-cyan-600 dark:text-cyan-300" };
  }
  return null;
};
