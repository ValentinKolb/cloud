import { defineCliCommands } from "@valentinkolb/cloud/cli";
import { assistantChatCommands, assistantManagementCommands } from "./cli/chat";
import { assistantSkillCommands } from "./cli/skills";

const module = defineCliCommands({
  name: "assistant",
  summary: "Chat with the Cloud Assistant and manage chats, files, preferences, and skills.",
  commands: [...assistantChatCommands, ...assistantManagementCommands, ...assistantSkillCommands],
});

export default module;
