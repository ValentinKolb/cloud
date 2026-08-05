import { basename } from "node:path";
import { type AiConversation, type AiFileStat, type AiTurnBlock, type AiTurnContentPart, guessAiMediaType } from "@valentinkolb/cloud/ai";
import type { CloudCliContext } from "@valentinkolb/cloud/cli";
import { ASSISTANT_API, jsonRequest, printValue, readApi } from "./shared";
import { type AssistantTurnStreamResult, streamAssistantTurn } from "./stream";

export type ConversationDetail = {
  conversation: AiConversation;
  activeTurn: { turnId: string; status: string } | null;
};

type TurnSubmission = { turn: { id: string; status: string; modelProfileId: string | null } };

export const conversationPath = (conversationId: string, suffix = ""): string =>
  `/conversations/${encodeURIComponent(conversationId)}${suffix}`;

export const readConversationDetail = (ctx: CloudCliContext, conversationId: string): Promise<ConversationDetail> =>
  readApi<ConversationDetail>(ctx, conversationPath(conversationId));

const isSupportedImageType = (mediaType: string): mediaType is "image/gif" | "image/jpeg" | "image/png" | "image/webp" | "image/jpg" =>
  ["image/gif", "image/jpeg", "image/png", "image/webp", "image/jpg"].includes(mediaType);

export const resolveConversation = async (
  ctx: CloudCliContext,
  input: { conversationId?: string; title?: string },
): Promise<AiConversation> =>
  input.conversationId
    ? readConversationDetail(ctx, input.conversationId).then((detail) => detail.conversation)
    : readApi<AiConversation>(ctx, "/conversations", jsonRequest("POST", input.title ? { title: input.title } : {}));

export const uploadAttachment = async (ctx: CloudCliContext, conversationId: string, localPath: string): Promise<AiTurnContentPart> => {
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

export const submitAssistantTurn = async (input: {
  ctx: CloudCliContext;
  conversationId: string;
  path: string;
  body: unknown;
  watch: boolean;
  approveTools?: readonly string[];
  signal?: AbortSignal;
  onToolBlock?: (block: Extract<AiTurnBlock, { kind: "tool" }>) => void;
}): Promise<{ submitted: TurnSubmission; result?: AssistantTurnStreamResult }> => {
  const streamResponse = input.watch
    ? await input.ctx.fetch(`${ASSISTANT_API}${conversationPath(input.conversationId, "/stream")}`, {
        headers: { Accept: "text/event-stream" },
        signal: input.signal,
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
  if (!input.watch) return { submitted };
  return {
    submitted,
    result: await streamAssistantTurn({
      ctx: input.ctx,
      conversationId: input.conversationId,
      turnId: submitted.turn.id,
      initialResponse: streamResponse,
      approveTools: input.approveTools,
      signal: input.signal,
      onToolBlock: input.onToolBlock,
    }),
  };
};

export const submitAndMaybeWatch = async (input: {
  ctx: CloudCliContext;
  conversationId: string;
  path: string;
  body: unknown;
  watch: boolean;
  approveTools?: readonly string[];
}): Promise<number> => {
  const { submitted, result } = await submitAssistantTurn(input);
  if (!result) {
    printValue(input.ctx, submitted, submitted.turn.id);
    return 0;
  }
  if (input.ctx.options.output === "json") input.ctx.json(result);
  if (result.status === "failed") throw new Error(result.error || "Assistant turn failed.");
  if (result.status === "needs_attention") {
    if (input.ctx.options.output === "text") {
      input.ctx.error(
        `Turn ${result.turnId} needs attention. Run \`cld assistant actions list ${input.conversationId} ${result.turnId}\`.`,
      );
    }
    return 2;
  }
  return result.status === "aborted" ? 130 : 0;
};
