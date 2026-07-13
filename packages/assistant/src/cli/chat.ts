import { basename } from "node:path";
import {
  arg,
  command,
  confirmFlag,
  flag,
  readCliInput,
  type CloudCliContext,
} from "@valentinkolb/cloud/cli";
import {
  type AiConversation,
  type AiConversationTimelineEntry,
  type AiFileStat,
  type AiPendingTurnAction,
  type AiPublicModelProfile,
  type AiStoredMessage,
  type AiTurnContentPart,
  type AiUserPrefs,
  guessAiMediaType,
} from "@valentinkolb/cloud/ai";
import { streamAssistantTurn } from "./stream";
import {
  ASSISTANT_API,
  jsonRequest,
  parseJson,
  printRows,
  printValue,
  queryString,
  readApi,
  requireConfirmation,
  shortId,
} from "./shared";

type ConversationDetail = {
  conversation: AiConversation;
  messages: AiStoredMessage[];
  hasMoreMessages: boolean;
  activeTurn: { turnId: string; status: string } | null;
  timeline: AiConversationTimelineEntry[];
};

type TurnSubmission = { turn: { id: string; status: string; modelProfileId: string | null }; message?: AiStoredMessage };
type FileList = { files: AiFileStat[]; totalBytes: number };

const conversationPath = (conversationId: string, suffix = ""): string =>
  `/conversations/${encodeURIComponent(conversationId)}${suffix}`;

const isSupportedImageType = (mediaType: string): mediaType is "image/gif" | "image/jpeg" | "image/png" | "image/webp" | "image/jpg" =>
  ["image/gif", "image/jpeg", "image/png", "image/webp", "image/jpg"].includes(mediaType);

const readPrompt = async (args: string[], input: Parameters<typeof readCliInput>[0]): Promise<string> => {
  const positional = args.join(" ").trim();
  const supplied = await readCliInput(input, { label: "message", trimFinalNewline: true });
  if (positional && supplied !== undefined) throw new Error("Pass the message either as arguments or with --message/--message-file/--stdin.");
  const message = (supplied ?? positional).trim();
  if (!message) throw new Error("Missing message.");
  return message;
};

const uploadAttachment = async (ctx: CloudCliContext, conversationId: string, localPath: string): Promise<AiTurnContentPart> => {
  const file = Bun.file(localPath);
  if (!(await file.exists())) throw new Error(`Attachment not found: ${localPath}`);
  const mediaType = file.type || guessAiMediaType(localPath);
  if (isSupportedImageType(mediaType)) {
    return { type: "file", data: Buffer.from(await file.arrayBuffer()).toString("base64"), mediaType };
  }
  const form = new FormData();
  form.set("file", new File([await file.arrayBuffer()], basename(localPath), { type: mediaType }));
  form.set("dir", "/input");
  const uploaded = await ctx.readJson<{ file: AiFileStat }>(
    await ctx.fetch(`${ASSISTANT_API}${conversationPath(conversationId, "/files")}`, { method: "POST", body: form }),
  );
  return { type: "attachment", path: uploaded.file.path, mediaType: uploaded.file.mediaType, size: uploaded.file.size };
};

const submitAndMaybeWatch = async (input: {
  ctx: CloudCliContext;
  conversationId: string;
  path: string;
  body: unknown;
  watch: boolean;
  approveTools?: readonly string[];
}): Promise<number> => {
  const streamResponse = input.watch
    ? await input.ctx.fetch(`${ASSISTANT_API}${conversationPath(input.conversationId, "/stream")}`, {
        headers: { Accept: "text/event-stream" },
      })
    : undefined;
  if (streamResponse && (!streamResponse.ok || !streamResponse.body)) await input.ctx.readJson(streamResponse);
  let submitted: TurnSubmission;
  try {
    submitted = await readApi<TurnSubmission>(input.ctx, input.path, jsonRequest("POST", input.body));
  } catch (error) {
    await streamResponse?.body?.cancel().catch(() => undefined);
    throw error;
  }
  if (!input.watch) {
    printValue(input.ctx, submitted, submitted.turn.id);
    return 0;
  }
  const result = await streamAssistantTurn({
    ctx: input.ctx,
    conversationId: input.conversationId,
    turnId: submitted.turn.id,
    initialResponse: streamResponse,
    approveTools: input.approveTools,
  });
  if (input.ctx.options.output === "json") input.ctx.json(result);
  if (result.status === "failed") throw new Error(result.error || "Assistant turn failed.");
  if (result.status === "needs_attention") {
    if (input.ctx.options.output === "text") {
      input.ctx.error(`Turn ${result.turnId} needs attention. Run \`cld assistant actions list ${input.conversationId} ${result.turnId}\`.`);
    }
    return 2;
  }
  return result.status === "aborted" ? 130 : 0;
};

const messagePreview = (stored: AiStoredMessage): string => {
  if (stored.kind === "summary") return "[summary]";
  const message = stored.message;
  if (message.role === "tool_result") return `${message.callId}: ${JSON.stringify(message.result).slice(0, 100)}`;
  return message.content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part.type === "text") return part.text;
      if (part.type === "thinking") return part.thinking;
      if (part.type === "tool_call") return `${part.name}(...)`;
      return "";
    })
    .join(" ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 140);
};

export const assistantChatCommands = [
  command("ask", {
    summary: "Send one message and stream the response",
    args: { prompt: arg.rest({ valueLabel: "message" }) },
    flags: {
      message: flag.input({ name: "message", fileName: "message-file", description: "Read the message from a value, file, or stdin" }),
      chat: flag.string({ description: "Continue an existing chat ID" }),
      title: flag.string({ description: "Title for a new chat" }),
      model: flag.string({ description: "Model profile ID" }),
      attach: flag.stringList({ description: "Attach a local file; repeat for multiple files" }),
      approve: flag.stringList({ description: "Approve this exact tool name for this turn; repeat as needed" }),
      detach: flag.boolean({ description: "Submit without waiting for the response" }),
    },
    examples: [
      'cld assistant ask "Summarize my open work"',
      'cld assistant ask --chat <id> --attach report.pdf "What matters here?"',
      'cld assistant ask --approve web_search "Check today\'s release notes"',
    ],
    async run({ ctx, args, flags }) {
      const message = await readPrompt(args.prompt, flags.message);
      const conversation = flags.chat
        ? await readApi<ConversationDetail>(ctx, conversationPath(flags.chat)).then((detail) => detail.conversation)
        : await readApi<AiConversation>(ctx, "/conversations", jsonRequest("POST", flags.title ? { title: flags.title } : {}));
      if (flags.attach.length > 11) throw new Error("At most 11 attachments can be sent with one message.");
      const content: AiTurnContentPart[] = [];
      for (const path of flags.attach) content.push(await uploadAttachment(ctx, conversation.id, path));
      const body = {
        message,
        ...(content.length > 0 ? { content } : {}),
        ...(flags.model ? { modelProfileId: flags.model } : {}),
      };
      return submitAndMaybeWatch({
        ctx,
        conversationId: conversation.id,
        path: conversationPath(conversation.id, "/turns"),
        body,
        watch: !flags.detach,
        approveTools: flags.approve,
      });
    },
  }),
  command("status", {
    summary: "Show Assistant availability and configuration status",
    async run({ ctx }) {
      const status = await readApi<Record<string, unknown>>(ctx, "/status");
      printValue(ctx, status);
    },
  }),
  command("models", {
    summary: "List selectable Assistant models",
    async run({ ctx }) {
      const models = await readApi<AiPublicModelProfile[]>(ctx, "/models");
      printRows(
        ctx,
        models,
        models.map((model) => ({
          id: model.id,
          label: model.label,
          provider: model.provider,
          model: model.model,
          context: model.contextWindow ?? "-",
          images: model.capabilities.includes("vision") ? "yes" : "no",
        })),
        [{ key: "id" }, { key: "label" }, { key: "provider" }, { key: "model" }, { key: "context" }, { key: "images" }],
      );
    },
  }),
  command("chats list", {
    summary: "List chats",
    flags: {
      search: flag.string({ aliases: ["q"], description: "Search title, description, and keywords" }),
      limit: flag.int({ default: 50, min: 1, max: 50 }),
      archived: flag.boolean(),
      status: flag.enum(["running", "needs_attention", "failed", "unread"] as const),
    },
    async run({ ctx, flags }) {
      const chats = await readApi<AiConversation[]>(
        ctx,
        `/conversations${queryString({ q: flags.search, limit: flags.limit, archived: flags.archived || undefined, status: flags.status })}`,
      );
      printRows(
        ctx,
        chats,
        chats.map((chat) => ({
          id: chat.id,
          title: chat.title,
          status: chat.runStatus,
          unread: chat.unreadCompletion ? "yes" : "",
          pinned: chat.pinnedAt ? "yes" : "",
          updated: chat.updatedAt,
        })),
        [{ key: "id" }, { key: "title" }, { key: "status" }, { key: "unread" }, { key: "pinned" }, { key: "updated" }],
      );
    },
  }),
  command("chats get", {
    summary: "Show one chat with its current state",
    args: { chat: arg.required({ valueLabel: "chat-id" }) },
    async run({ ctx, args }) {
      const detail = await readApi<ConversationDetail>(ctx, conversationPath(args.chat));
      printValue(ctx, detail);
    },
  }),
  command("chats create", {
    summary: "Create an empty chat",
    flags: { title: flag.string() },
    async run({ ctx, flags }) {
      const chat = await readApi<AiConversation>(ctx, "/conversations", jsonRequest("POST", flags.title ? { title: flags.title } : {}));
      printValue(ctx, chat, `${chat.id}\t${chat.title}`);
    },
  }),
  command("chats update", {
    summary: "Update chat metadata",
    args: { chat: arg.required({ valueLabel: "chat-id" }) },
    flags: { title: flag.string(), icon: flag.string(), description: flag.string() },
    async run({ ctx, args, flags }) {
      if (!flags.title && !flags.icon && flags.description === undefined) throw new Error("Pass --title, --icon, or --description.");
      const current = await readApi<ConversationDetail>(ctx, conversationPath(args.chat));
      const updated = await readApi<AiConversation>(
        ctx,
        conversationPath(args.chat),
        jsonRequest("PATCH", {
          title: flags.title ?? current.conversation.title,
          ...(flags.icon ? { icon: flags.icon } : {}),
          ...(flags.description !== undefined ? { description: flags.description } : {}),
        }),
      );
      printValue(ctx, updated, `${updated.id}\t${updated.title}`);
    },
  }),
  ...(["pin", "unpin", "archive", "restore", "mark-read"] as const).map((action) =>
    command(`chats ${action}`, {
      summary:
        action === "pin"
          ? "Pin a chat"
          : action === "unpin"
            ? "Unpin a chat"
            : action === "archive"
              ? "Archive a chat"
              : action === "restore"
                ? "Restore an archived chat"
                : "Mark a chat as viewed",
      args: { chat: arg.required({ valueLabel: "chat-id" }) },
      flags: action === "archive" ? { yes: confirmFlag("Confirm archiving the chat") } : undefined,
      async run({ ctx, args, flags }) {
        if (action === "archive") requireConfirmation((flags as { yes: boolean }).yes, "Archiving a chat");
        const method = action === "unpin" ? "DELETE" : "POST";
        const route = action === "mark-read" ? "viewed" : action;
        const result = await readApi<unknown>(ctx, conversationPath(args.chat, `/${route}`), { method });
        printValue(ctx, result, `${action}: ${args.chat}`);
      },
    }),
  ),
  command("chats timeline", {
    summary: "List user-message navigation points in a chat",
    args: { chat: arg.required({ valueLabel: "chat-id" }) },
    async run({ ctx, args }) {
      const timeline = await readApi<AiConversationTimelineEntry[]>(ctx, conversationPath(args.chat, "/timeline"));
      printRows(
        ctx,
        timeline,
        timeline.map((entry) => ({
          seq: entry.seq,
          id: entry.id,
          loop: shortId(entry.loopId),
          files: entry.inputFileCount,
          user: entry.userPreview,
          assistant: entry.assistantPreview,
        })),
        [{ key: "seq" }, { key: "id" }, { key: "loop" }, { key: "files" }, { key: "user" }, { key: "assistant" }],
      );
    },
  }),
  command("chats compact", {
    summary: "Compact an older chat history into a model summary",
    args: { chat: arg.required({ valueLabel: "chat-id" }) },
    flags: { model: flag.string(), detach: flag.boolean() },
    async run({ ctx, args, flags }) {
      return submitAndMaybeWatch({
        ctx,
        conversationId: args.chat,
        path: conversationPath(args.chat, "/compact"),
        body: flags.model ? { modelProfileId: flags.model } : {},
        watch: !flags.detach,
      });
    },
  }),
  command("chats reindex", {
    summary: "Queue title, description, and search enrichment",
    args: { chat: arg.required({ valueLabel: "chat-id" }) },
    async run({ ctx, args }) {
      const result = await readApi<unknown>(ctx, conversationPath(args.chat, "/reindex"), { method: "POST" });
      printValue(ctx, result, `Queued reindex for ${args.chat}.`);
    },
  }),
  command("chats index-status", {
    summary: "Show enrichment and indexing status",
    args: { chat: arg.required({ valueLabel: "chat-id" }) },
    async run({ ctx, args }) {
      printValue(ctx, await readApi<unknown>(ctx, conversationPath(args.chat, "/enrichment")));
    },
  }),
] as const;

export const assistantManagementCommands = [
  command("messages list", {
    summary: "List messages in a chat",
    args: { chat: arg.required({ valueLabel: "chat-id" }) },
    flags: { before: flag.int({ min: 1 }), limit: flag.int({ default: 50, min: 1, max: 200 }) },
    async run({ ctx, args, flags }) {
      const page = await readApi<{ messages: AiStoredMessage[]; hasMore: boolean }>(
        ctx,
        `${conversationPath(args.chat, "/messages")}${queryString({ before: flags.before, limit: flags.limit })}`,
      );
      printRows(
        ctx,
        page,
        page.messages.map((message) => ({
          seq: message.seq,
          id: message.id,
          role: message.kind === "summary" ? "summary" : message.message.role,
          loop: shortId(message.loopId),
          compacted: message.compactedAt ? "yes" : "",
          content: messagePreview(message),
        })),
        [{ key: "seq" }, { key: "id" }, { key: "role" }, { key: "loop" }, { key: "compacted" }, { key: "content" }],
      );
    },
  }),
  command("messages retry", {
    summary: "Retry from a user message",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      messageId: arg.required({ valueLabel: "message-id" }),
    },
    flags: {
      mode: flag.enum(["retry", "details", "concise"] as const, { default: "retry" }),
      model: flag.string(),
      replacement: flag.input({
        name: "message",
        fileName: "message-file",
        description: "Replace the original user message",
      }),
      detach: flag.boolean(),
    },
    async run({ ctx, args, flags }) {
      const replacement = await readCliInput(flags.replacement, { label: "replacement message", trimFinalNewline: true });
      const body = {
        mode: flags.mode,
        ...(flags.model ? { modelProfileId: flags.model } : {}),
        ...(replacement?.trim() ? { content: [{ type: "text", text: replacement.trim() }] } : {}),
      };
      return submitAndMaybeWatch({
        ctx,
        conversationId: args.chat,
        path: conversationPath(args.chat, `/messages/${encodeURIComponent(args.messageId)}/retry`),
        body,
        watch: !flags.detach,
      });
    },
  }),
  command("messages fork", {
    summary: "Fork a chat through one message",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      messageId: arg.required({ valueLabel: "message-id" }),
    },
    flags: { title: flag.string() },
    async run({ ctx, args, flags }) {
      const fork = await readApi<ConversationDetail>(
        ctx,
        conversationPath(args.chat, `/messages/${encodeURIComponent(args.messageId)}/fork`),
        jsonRequest("POST", flags.title ? { title: flags.title } : {}),
      );
      printValue(ctx, fork, `${fork.conversation.id}\t${fork.conversation.title}`);
    },
  }),
  command("turns watch", {
    summary: "Stream the active or selected turn",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      turn: arg.optional({ valueLabel: "turn-id" }),
    },
    flags: { approve: flag.stringList({ description: "Approve this exact tool name; repeat as needed" }) },
    async run({ ctx, args, flags }) {
      const result = await streamAssistantTurn({ ctx, conversationId: args.chat, turnId: args.turn, approveTools: flags.approve });
      if (ctx.options.output === "json") ctx.json(result);
      else if (ctx.options.output === "text" && result.status === "idle") ctx.print("No active turn.");
      return result.status === "needs_attention" ? 2 : result.status === "failed" ? 1 : 0;
    },
  }),
  command("turns steer", {
    summary: "Steer an active turn",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      turn: arg.required({ valueLabel: "turn-id" }),
      message: arg.rest({ valueLabel: "message", required: true }),
    },
    async run({ ctx, args }) {
      const result = await readApi<unknown>(
        ctx,
        conversationPath(args.chat, `/turns/${encodeURIComponent(args.turn)}/steer`),
        jsonRequest("POST", { message: args.message.join(" "), clientRequestId: crypto.randomUUID() }),
      );
      printValue(ctx, result, "Steer queued.");
    },
  }),
  command("turns stop", {
    summary: "Stop an active turn",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      turn: arg.required({ valueLabel: "turn-id" }),
    },
    async run({ ctx, args }) {
      const result = await readApi<unknown>(ctx, conversationPath(args.chat, `/turns/${encodeURIComponent(args.turn)}/abort`), {
        method: "POST",
      });
      printValue(ctx, result, `Stopped ${args.turn}.`);
    },
  }),
  command("actions list", {
    summary: "List pending approvals and client tool actions",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      turn: arg.required({ valueLabel: "turn-id" }),
    },
    async run({ ctx, args }) {
      const actions = await readApi<AiPendingTurnAction[]>(
        ctx,
        conversationPath(args.chat, `/pending-actions/${encodeURIComponent(args.turn)}`),
      );
      printRows(
        ctx,
        actions,
        actions.map((action) => ({
          call: action.callId,
          type: action.type,
          name: action.name,
          detail: action.type === "approval_request" ? (action.message ?? "") : action.mode,
        })),
        [{ key: "call" }, { key: "type" }, { key: "name" }, { key: "detail" }],
      );
    },
  }),
  ...(["approve", "reject"] as const).map((action) =>
    command(`actions ${action}`, {
      summary: action === "approve" ? "Approve one pending tool call" : "Reject one pending tool call",
      args: {
        chat: arg.required({ valueLabel: "chat-id" }),
        turn: arg.required({ valueLabel: "turn-id" }),
        call: arg.required({ valueLabel: "call-id" }),
      },
      flags: action === "approve" ? { always: flag.boolean({ description: "Remember this approval where supported" }) } : undefined,
      async run({ ctx, args, flags }) {
        const result = await readApi<unknown>(
          ctx,
          conversationPath(args.chat, `/turns/${encodeURIComponent(args.turn)}/actions/${encodeURIComponent(args.call)}`),
          jsonRequest("POST", {
            type: "approval_response",
            approved: action === "approve",
            ...(action === "approve" && (flags as { always: boolean }).always ? { remember: "always" } : {}),
          }),
        );
        printValue(ctx, result, `${action}: ${args.call}`);
      },
    }),
  ),
  command("actions submit", {
    summary: "Submit a result for a pending frontend tool",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      turn: arg.required({ valueLabel: "turn-id" }),
      call: arg.required({ valueLabel: "call-id" }),
    },
    flags: { result: flag.input({ required: true, description: "JSON tool result" }) },
    async run({ ctx, args, flags }) {
      const raw = await readCliInput(flags.result, { label: "tool result", required: true, trimFinalNewline: true });
      const result = await readApi<unknown>(
        ctx,
        conversationPath(args.chat, `/turns/${encodeURIComponent(args.turn)}/actions/${encodeURIComponent(args.call)}`),
        jsonRequest("POST", { type: "tool_result", result: parseJson(raw!, "tool result JSON") }),
      );
      printValue(ctx, result, `Submitted result for ${args.call}.`);
    },
  }),
  command("files list", {
    summary: "List files in a chat workspace",
    args: { chat: arg.required({ valueLabel: "chat-id" }) },
    flags: { prefix: flag.string({ default: "/" }) },
    async run({ ctx, args, flags }) {
      const result = await readApi<FileList>(ctx, `${conversationPath(args.chat, "/files")}${queryString({ prefix: flags.prefix })}`);
      printRows(ctx, result, result.files, [
        { key: "path" },
        { key: "size" },
        { key: "mediaType", label: "type" },
        { key: "updatedAt", label: "updated" },
      ]);
    },
  }),
  command("files upload", {
    summary: "Upload a local file to /input or /files",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      file: arg.required({ valueLabel: "local-file" }),
    },
    flags: { workspace: flag.boolean({ description: "Upload to editable /files instead of immutable /input" }) },
    async run({ ctx, args, flags }) {
      const local = Bun.file(args.file);
      if (!(await local.exists())) throw new Error(`File not found: ${args.file}`);
      const form = new FormData();
      form.set("file", new File([await local.arrayBuffer()], basename(args.file), { type: local.type || guessAiMediaType(args.file) }));
      form.set("dir", flags.workspace ? "/files" : "/input");
      const result = await ctx.readJson<{ file: AiFileStat }>(
        await ctx.fetch(`${ASSISTANT_API}${conversationPath(args.chat, "/files")}`, { method: "POST", body: form }),
      );
      printValue(ctx, result, result.file.path);
    },
  }),
  command("files download", {
    summary: "Download a chat file",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      path: arg.required({ valueLabel: "remote-path" }),
    },
    flags: { out: flag.string({ description: "Local output path; defaults to the remote file name" }) },
    async run({ ctx, args, flags }) {
      const response = await ctx.fetch(
        `${ASSISTANT_API}${conversationPath(args.chat, "/files/content")}${queryString({ path: args.path })}`,
      );
      if (!response.ok) await ctx.readJson(response);
      const out = flags.out ?? basename(args.path);
      await Bun.write(out, await response.arrayBuffer());
      printValue(ctx, { path: args.path, out }, out);
    },
  }),
  command("files write", {
    summary: "Write an editable file under /files",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      path: arg.required({ valueLabel: "/files/path" }),
    },
    flags: { content: flag.input({ required: true }) },
    async run({ ctx, args, flags }) {
      const content = await readCliInput(flags.content, { label: "file content", required: true });
      const result = await readApi<unknown>(
        ctx,
        conversationPath(args.chat, "/files/content"),
        jsonRequest("PUT", { path: args.path, content, encoding: "utf8" }),
      );
      printValue(ctx, result, args.path);
    },
  }),
  command("files rename", {
    summary: "Rename an editable file under /files",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      from: arg.required(),
      to: arg.required(),
    },
    async run({ ctx, args }) {
      const result = await readApi<unknown>(
        ctx,
        conversationPath(args.chat, "/files/rename"),
        jsonRequest("POST", { from: args.from, to: args.to }),
      );
      printValue(ctx, result, `${args.from} -> ${args.to}`);
    },
  }),
  command("files delete", {
    summary: "Delete one chat file",
    args: {
      chat: arg.required({ valueLabel: "chat-id" }),
      path: arg.required({ valueLabel: "remote-path" }),
    },
    flags: { yes: confirmFlag("Confirm deleting the file") },
    async run({ ctx, args, flags }) {
      requireConfirmation(flags.yes, "Deleting a file");
      const result = await readApi<unknown>(
        ctx,
        `${conversationPath(args.chat, "/files")}${queryString({ path: args.path })}`,
        { method: "DELETE" },
      );
      printValue(ctx, result, `Deleted ${args.path}.`);
    },
  }),
  command("prefs get", {
    summary: "Show Assistant instructions, memory, and last-used model",
    async run({ ctx }) {
      printValue(ctx, await readApi<AiUserPrefs>(ctx, "/prefs"));
    },
  }),
  command("prefs set", {
    summary: "Update Assistant instructions or memory",
    flags: {
      instructions: flag.input({ stdinName: false, description: "Instructions text or --instructions-file" }),
      memory: flag.input({ stdinName: false, description: "Memory text or --memory-file" }),
    },
    async run({ ctx, flags }) {
      const instructions = await readCliInput(flags.instructions, { label: "instructions" });
      const memory = await readCliInput(flags.memory, { label: "memory" });
      if (instructions === undefined && memory === undefined) throw new Error("Pass --instructions/--instructions-file or --memory/--memory-file.");
      const prefs = await readApi<AiUserPrefs>(ctx, "/prefs", jsonRequest("PUT", { instructions, memory }));
      printValue(ctx, prefs);
    },
  }),
  ...(["enable", "disable"] as const).map((action) =>
    command(`prefs memory ${action}`, {
      summary: `${action === "enable" ? "Enable" : "Disable"} Assistant memory`,
      async run({ ctx }) {
        const prefs = await readApi<AiUserPrefs>(ctx, "/prefs", jsonRequest("PUT", { memoryEnabled: action === "enable" }));
        printValue(ctx, prefs, `Memory ${action}d.`);
      },
    }),
  ),
  command("prefs system-prompt", {
    summary: "Preview the effective system prompt for a new chat",
    async run({ ctx }) {
      const result = await readApi<{ prompt: string; renderedAt: string }>(ctx, "/prefs/system-prompt");
      printValue(ctx, result, result.prompt);
    },
  }),
] as const;
