import { defineCliCommands } from "@valentinkolb/cloud/cli";
import { assistantChatCommands, assistantManagementCommands } from "./cli/chat";
import { assistantRootCommand } from "./cli/interactive";
import { assistantProjectCommands } from "./cli/projects";

const module = defineCliCommands({
  name: "assistant",
  summary: "Chat with the Cloud Assistant and manage chats, files, preferences, and Projects.",
  groupSummaries: {
    actions: "Review and resolve pending turn actions",
    chats: "Create, inspect, and manage Assistant chats",
    files: "Manage files in Assistant chats",
    messages: "Inspect, retry, and fork Assistant messages",
    prefs: "View and update Assistant preferences",
    projects: "Manage shared Assistant Projects",
    turns: "Watch, steer, and stop Assistant turns",
  },
  commands: [assistantRootCommand, ...assistantChatCommands, ...assistantManagementCommands, ...assistantProjectCommands],
});

export default module;
