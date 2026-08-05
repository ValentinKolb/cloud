import { defineCliCommands } from "@valentinkolb/cloud/cli";
import { assistantChatCommands, assistantManagementCommands } from "./cli/chat";
import { assistantRootCommand } from "./cli/interactive";
import { assistantSkillCommands } from "./cli/skills";

const module = defineCliCommands({
  name: "assistant",
  summary: "Chat with the Cloud Assistant and manage chats, files, preferences, and skills.",
  groupSummaries: {
    actions: "Review and resolve pending turn actions",
    chats: "Create, inspect, and manage Assistant chats",
    files: "Manage files in Assistant chats",
    messages: "Inspect, retry, and fork Assistant messages",
    prefs: "View and update Assistant preferences",
    skills: "Manage personal and workspace Assistant skills",
    turns: "Watch, steer, and stop Assistant turns",
  },
  commands: [assistantRootCommand, ...assistantChatCommands, ...assistantManagementCommands, ...assistantSkillCommands],
});

export default module;
