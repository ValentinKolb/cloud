import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

const StartTab = () => (
  <DocPage>
    <DocLead>
      Assistant is a personal AI chat app for writing, rewriting, summarizing, explaining, and planning. Chats are saved to your user
      account.
    </DocLead>

    <DocSection title="Overview" eyebrow="Start here">
      <DocConceptGrid
        items={[
          {
            title: "Chat",
            icon: "ti-message",
            text: "One conversation owned by your user account. Chats appear in the sidebar and on the All Chats page.",
          },
          {
            title: "Model",
            icon: "ti-cpu",
            text: "A selectable AI model profile with streaming support. The composer uses the default model unless you choose another one.",
          },
          {
            title: "Turn",
            icon: "ti-player-play",
            text: "One assistant run for a user message. Running turns can stream, reconnect, ask for actions, or be stopped.",
          },
          {
            title: "Chat metadata",
            icon: "ti-settings",
            text: "Each chat has a name, icon, and optional description that you can edit from the sidebar or All Chats list.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="First useful path">
      <DocRows
        items={[
          {
            title: "Start a chat",
            icon: "ti-message-plus",
            text: "Use New Chat or type a message in an empty Assistant view.",
          },
          {
            title: "Choose a model when needed",
            icon: "ti-adjustments",
            text: "Pick a model in the composer when more than one selectable streaming model is available.",
          },
          {
            title: "Send the request",
            icon: "ti-send",
            text: "Write the task clearly, attach files if the composer offers attachments, then send.",
          },
          {
            title: "Keep the useful thread",
            icon: "ti-device-floppy",
            text: "Rename the chat or add a description when the conversation should be easy to find later.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="When Assistant is unavailable" variant="info">
      If AI is disabled, misconfigured, or has no selectable streaming model, the composer is disabled and the page shows the current
      status error.
    </DocNote>
  </DocPage>
);

const WorkflowTab = () => (
  <DocPage>
    <DocLead>
      Assistant keeps recent chats in the sidebar and stores older chats on the All Chats page. Search is the fastest way back to a known
      conversation.
    </DocLead>

    <DocSection title="Chat navigation">
      <DocRows
        items={[
          {
            title: "Recent groups",
            icon: "ti-clock",
            text: "The sidebar groups recent chats into Today, This Week, and This Month.",
          },
          {
            title: "Search chats",
            icon: "ti-search",
            text: "Use the sidebar search button or the platform shortcut to search saved chats.",
          },
          {
            title: "All Chats",
            icon: "ti-messages",
            text: "Open All Chats for paginated chat history, server-side search, and edit actions.",
          },
          {
            title: "Edit or delete",
            icon: "ti-settings",
            text: "Use the settings action on a chat to change its name, icon, description, or delete it.",
          },
        ]}
      />
    </DocSection>

    <DocSection title="Message actions">
      <DocRows
        items={[
          {
            title: "Stop",
            icon: "ti-player-stop",
            text: "Stop aborts the running assistant turn for the open chat.",
          },
          {
            title: "Retry",
            icon: "ti-refresh",
            text: "Retry reruns a user message and replaces later messages in that chat branch.",
          },
          {
            title: "Fork",
            icon: "ti-git-branch",
            text: "Fork creates a new chat copied through the selected message.",
          },
          {
            title: "Compact",
            icon: "ti-package",
            text: "Use the /compact command to summarize the current chat context before continuing.",
          },
        ]}
      />
    </DocSection>

    <DocNote title="Approvals and client actions" variant="info">
      Some turns can request an approval or a frontend tool result. Answer those prompts in the message list to let the turn continue.
    </DocNote>
  </DocPage>
);

export default function AssistantLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="assistant-overview"
        title="Overview"
        icon="ti ti-sparkles"
        description="Chats, models, turns, and the first useful workflow."
        order={100}
      >
        <StartTab />
      </Layout.Help>
      <Layout.Help
        id="assistant-workflow"
        title="Chats & Actions"
        icon="ti ti-messages"
        description="Find chats, manage metadata, retry, fork, compact, stop, and handle actions."
        order={110}
      >
        <WorkflowTab />
      </Layout.Help>
    </>
  );
}
