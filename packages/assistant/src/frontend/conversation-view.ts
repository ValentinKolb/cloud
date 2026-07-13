import type { AiConversation } from "@valentinkolb/cloud/ai";

export type ConversationGroup = {
  title: string;
  items: AiConversation[];
};

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

export const groupRecentConversations = (conversations: AiConversation[], now = new Date()): ConversationGroup[] => {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = startOfToday.getDay();
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() + (day === 0 ? -6 : 1 - day));
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const groups: ConversationGroup[] = [
    { title: "Pinned", items: [] },
    { title: "Today", items: [] },
    { title: "This Week", items: [] },
    { title: "This Month", items: [] },
  ];

  for (const conversation of conversations) {
    if (conversation.pinnedAt) {
      groups[0]!.items.push(conversation);
      continue;
    }
    const updatedAt = new Date(conversation.updatedAt);
    if (updatedAt >= startOfToday) groups[1]!.items.push(conversation);
    else if (updatedAt >= startOfWeek) groups[2]!.items.push(conversation);
    else if (updatedAt >= startOfMonth) groups[3]!.items.push(conversation);
  }

  return groups.filter((group) => group.items.length > 0);
};
