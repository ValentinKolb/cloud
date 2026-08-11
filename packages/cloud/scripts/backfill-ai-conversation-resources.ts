import type { Message } from "@k2b/nessi";
import { sql } from "bun";
import { aiConversationStore, migrateCloudAi } from "../src/ai";
import { collectConversationResourceObservations } from "../src/ai/resource-refs";

type MessageRow = { conversation_id: string; turn_id: string | null; message: unknown };
type ProjectReferenceRow = { conversation_id: string; resource_type: string; resource_id: string; label: string };

const parseMessage = (value: unknown): Message | null => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || !("role" in parsed)) return null;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.role === "assistant" && Array.isArray(candidate.content)) return parsed as Message;
    if (candidate.role === "tool_result" && typeof candidate.callId === "string" && "result" in candidate) return parsed as Message;
    return null;
  } catch {
    return null;
  }
};

await migrateCloudAi();

let observations = 0;
const projectReferences = await sql<ProjectReferenceRow[]>`
  SELECT conversation.id AS conversation_id, reference.resource_type, reference.resource_id, reference.label
  FROM ai.conversations conversation
  JOIN ai.project_references reference ON reference.project_id = conversation.project_id
`;
for (const reference of projectReferences) {
  await aiConversationStore.indexConversationResources({
    conversationId: reference.conversation_id,
    resources: [{ ref: { type: reference.resource_type, id: reference.resource_id }, title: reference.label || undefined }],
  });
  observations += 1;
}

const messages = await sql<MessageRow[]>`
  SELECT message.conversation_id, turn.id AS turn_id, message.message
  FROM ai.messages message
  LEFT JOIN ai.turns turn ON turn.id::text = message.loop_id
  WHERE message.role IN ('assistant', 'tool_result')
  ORDER BY message.conversation_id, message.seq, message.created_at, message.id
`;
for (const row of messages) {
  const message = parseMessage(row.message);
  if (!message) continue;
  if (message.role === "tool_result") {
    const resources = collectConversationResourceObservations(message.result);
    if (!resources.length) continue;
    await aiConversationStore.indexConversationResources({
      conversationId: row.conversation_id,
      turnId: row.turn_id ?? undefined,
      callId: message.callId,
      resources,
    });
    observations += resources.length;
    continue;
  }
  for (const part of message.content) {
    if (typeof part === "string" || part.type !== "tool_call") continue;
    const resources = collectConversationResourceObservations(part.args);
    if (!resources.length) continue;
    await aiConversationStore.indexConversationResources({
      conversationId: row.conversation_id,
      turnId: row.turn_id ?? undefined,
      callId: part.id,
      resources,
    });
    observations += resources.length;
  }
}

console.log(`Indexed ${observations} structured Assistant resource observation${observations === 1 ? "" : "s"}.`);
console.log("Backfill complete. Only schema-valid structured refs were indexed; prose was not scanned.");
