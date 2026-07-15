import { describe, expect, test } from "bun:test";
import { compileWorkflow } from "@valentinkolb/cloud/workflows/language";
import { bindMailWorkflow } from "./binder";
import { buildMailWorkflowCatalog, type MailWorkflowCatalog, snapshotMailWorkflowCatalog } from "./catalog";
import { mailWorkflowManifest } from "./manifest";

const ids = {
  inbox: "11111111-1111-4111-8111-111111111111",
  invoices: "22222222-2222-4222-8222-222222222222",
  alice: "33333333-3333-4333-8333-333333333333",
  bob: "44444444-4444-4444-8444-444444444444",
} as const;

const catalog = (reverse = false): MailWorkflowCatalog => {
  const folders = [
    { id: ids.inbox, name: "Inbox" },
    { id: ids.invoices, name: "Invoices" },
  ];
  const assignableUsers = [
    { id: ids.alice, name: "Alice Example" },
    { id: ids.bob, name: "Bob Example" },
  ];
  return buildMailWorkflowCatalog({
    folders: reverse ? folders.reverse() : folders,
    assignableUsers: reverse ? assignableUsers.reverse() : assignableUsers,
  });
};

const compile = async (source: string) => {
  const result = await compileWorkflow(source, mailWorkflowManifest);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  return result.ir;
};

describe("Mail workflow manifest", () => {
  test("exposes only the canonical Mail vocabulary", () => {
    expect(mailWorkflowManifest.triggers.map(({ kind }) => kind)).toEqual(["messageReceived", "schedule"]);
    expect(mailWorkflowManifest.actions.map(({ kind }) => kind)).toEqual([
      "addKeyword",
      "removeKeyword",
      "moveMessage",
      "assignConversation",
      "setConversationStatus",
      "setVariable",
      "succeed",
      "fail",
    ]);
    expect(JSON.parse(JSON.stringify(mailWorkflowManifest))).toEqual(mailWorkflowManifest);
    expect(mailWorkflowManifest).not.toHaveProperty("name");
    expect(mailWorkflowManifest).not.toHaveProperty("priority");
    expect(mailWorkflowManifest).not.toHaveProperty("effectBudget");
    expect(mailWorkflowManifest.inputs.every((input) => Object.keys(input.config.properties).every((key) => key === "required"))).toBe(
      true,
    );
  });

  test("classifies provider, collaboration, and terminal effects", () => {
    expect(Object.fromEntries(mailWorkflowManifest.actions.map((action) => [action.kind, action.effect]))).toEqual({
      addKeyword: "durable-intent",
      removeKeyword: "durable-intent",
      moveMessage: "durable-intent",
      assignConversation: "transactional",
      setConversationStatus: "transactional",
      setVariable: "pure",
      succeed: "pure",
      fail: "pure",
    });
  });
});

describe("Mail workflow catalog", () => {
  test("snapshots permission-filtered entries deterministically", () => {
    expect(snapshotMailWorkflowCatalog(catalog(true))).toEqual(snapshotMailWorkflowCatalog(catalog(false)));
    expect(snapshotMailWorkflowCatalog(catalog()).folders.map(({ id }) => id)).toEqual([ids.inbox, ids.invoices]);
  });
});

describe("Mail workflow binder", () => {
  test("binds literal catalog references and preserves expressions", async () => {
    const source = `inputs:
  message:
    type: mailMessage
    required: true
  conversation:
    type: mailConversation
    required: true
triggers:
  messageReceived:
    with:
      message: "\${{ trigger.message }}"
      conversation: "\${{ trigger.conversation }}"
steps:
  - if:
      all:
        - contains:
            - "\${{ inputs.message.subject }}"
            - invoice
        - not:
            equals:
              - "\${{ inputs.conversation.status }}"
              - done
    then:
      - moveMessage:
          message: inputs.message
          folder: Invoices
      - assignConversation:
          conversation: inputs.conversation
          user: Alice Example
      - setConversationStatus:
          conversation: "\${{ inputs.conversation }}"
          status: waiting
  - succeed:
      message: "Processed \${{ inputs.message.id }}"
`;
    const ir = await compile(source);
    const result = await bindMailWorkflow(ir, catalog());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.bindings).toEqual({
      "steps.0.then.0.moveMessage.folder": ids.invoices,
      "steps.0.then.1.assignConversation.user": ids.alice,
    });
    expect(result.plan.steps).toEqual(ir.steps);
    expect(result.plan.steps[0]).toEqual(expect.objectContaining({ kind: "if" }));
    expect(await bindMailWorkflow(ir, catalog(true))).toEqual(result);
  });

  test("binds shared variables into the Mail reference scope", async () => {
    const result = await bindMailWorkflow(
      await compile(`inputs:
  message:
    type: mailMessage
steps:
  - setVariable:
      name: subject
      value: "\${{ inputs.message.subject }}"
  - succeed:
      message: "Subject: \${{ subject }}"
  - setVariable:
      name: subject
      value: duplicate
`),
      catalog(),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "scope.duplicate", path: ["steps", 2, "setVariable", "name"] }),
    );
    expect(result.diagnostics).not.toContainEqual(expect.objectContaining({ code: "reference.unknown" }));
  });

  test("reports inaccessible and ambiguous catalog entries at source positions", async () => {
    const source = `inputs:
  message:
    type: mailMessage
  conversation:
    type: mailConversation
steps:
  - moveMessage:
      message: inputs.message
      folder: Hidden
  - assignConversation:
      conversation: inputs.conversation
      user: Duplicate
`;
    const duplicateCatalog = buildMailWorkflowCatalog({
      folders: [],
      assignableUsers: [
        { id: ids.alice, name: "Duplicate" },
        { id: ids.bob, name: "Duplicate" },
      ],
    });
    const result = await bindMailWorkflow(await compile(source), duplicateCatalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "binding.unknown", path: ["steps", 0, "moveMessage", "folder"] },
      { code: "binding.ambiguous", path: ["steps", 1, "assignConversation", "user"] },
    ]);
    expect(result.diagnostics[0]?.message).toContain("Unknown or inaccessible folder");
    expect(result.diagnostics[0]?.location).toEqual({ offset: source.indexOf("folder: Hidden"), line: 9, column: 7 });
    expect(result.diagnostics[1]?.location).toEqual({ offset: source.indexOf("user: Duplicate"), line: 12, column: 7 });
  });

  test("validates message, conversation, trigger, and context references", async () => {
    const source = `inputs:
  message:
    type: mailMessage
    required: true
triggers:
  schedule:
    cron: "0 8 * * *"
    with:
      message: "\${{ trigger.message }}"
steps:
  - addKeyword:
      message: context.mailboxId
      keyword: "\${{ inputs.message.missing }}"
  - setConversationStatus:
      conversation: inputs.message
      status: open
  - succeed:
      message: "Message \${{ context.message.id }}"
`;
    const result = await bindMailWorkflow(await compile(source), catalog());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual(
      expect.arrayContaining([
        { code: "reference.unknown", path: ["triggers", "schedule", "with", "message"] },
        { code: "reference.type", path: ["steps", 0, "addKeyword", "message"] },
        { code: "reference.path", path: ["steps", 0, "addKeyword", "keyword"] },
        { code: "reference.type", path: ["steps", 1, "setConversationStatus", "conversation"] },
        { code: "reference.path", path: ["steps", 2, "succeed", "message", "expression", 0] },
      ]),
    );
  });

  test("rejects statically known non-text operands for text conditions", async () => {
    const source = `inputs:
  message:
    type: mailMessage
steps:
  - if:
      contains:
        - "\${{ inputs.message.hasAttachments }}"
        - attachment
    then:
      - succeed:
          message: contains
  - if:
      startsWith:
        - 42
        - "4"
    then:
      - succeed:
          message: starts
  - if:
      endsWith:
        - "\${{ inputs.message }}"
        - message
    then:
      - succeed:
          message: ends
`;
    const result = await bindMailWorkflow(await compile(source), catalog());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, message, path }) => ({ code, message, path }))).toEqual([
      {
        code: "condition.type",
        message: "contains operand 1 resolves to core.boolean, expected core.text",
        path: ["steps", 0, "if", "contains", 0],
      },
      {
        code: "condition.type",
        message: "startsWith operand 1 resolves to core.number, expected core.text",
        path: ["steps", 1, "if", "startsWith", 0],
      },
      {
        code: "condition.type",
        message: "endsWith operand 1 resolves to mail.message, expected core.text",
        path: ["steps", 2, "if", "endsWith", 0],
      },
    ]);
    expect(result.diagnostics[0]?.location).toEqual({
      offset: source.indexOf('"${{ inputs.message.hasAttachments }}"'),
      line: 7,
      column: 11,
    });
  });

  test("rejects every forEach with the same direct unsupported diagnostic", async () => {
    const source = `inputs:
  message:
    type: mailMessage
steps:
  - forEach: inputs.message
    as: item
    do:
      - succeed:
          message: known
  - forEach: inputs.missing
    as: item
    do:
      - succeed:
          message: unknown
`;
    const result = await bindMailWorkflow(await compile(source), catalog());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, message, path }) => ({ code, message, path }))).toEqual([
      {
        code: "step.unsupported",
        message: "forEach is not supported by the Mail workflow vocabulary",
        path: ["steps", 0, "forEach"],
      },
      {
        code: "step.unsupported",
        message: "forEach is not supported by the Mail workflow vocabulary",
        path: ["steps", 1, "forEach"],
      },
    ]);
  });

  test("binds literal catalog IDs and rejects dynamic folder and user expressions", async () => {
    const literalSource = `inputs:
  message:
    type: mailMessage
  conversation:
    type: mailConversation
steps:
  - moveMessage:
      message: inputs.message
      folder: ${ids.inbox}
  - assignConversation:
      conversation: inputs.conversation
      user: null
`;
    const literal = await bindMailWorkflow(await compile(literalSource), catalog());
    expect(literal.ok).toBe(true);
    if (literal.ok) expect(literal.plan.bindings).toEqual({ "steps.0.moveMessage.folder": ids.inbox });

    const dynamicSource = `inputs:
  message:
    type: mailMessage
  conversation:
    type: mailConversation
steps:
  - moveMessage:
      message: inputs.message
      folder: "\${{ inputs.message.folderId }}"
  - assignConversation:
      conversation: inputs.conversation
      user: "\${{ inputs.conversation.assigneeUserId }}"
`;
    const result = await bindMailWorkflow(await compile(dynamicSource), catalog());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: "binding.dynamic", path: ["steps", 0, "moveMessage", "folder"] },
      { code: "binding.dynamic", path: ["steps", 1, "assignConversation", "user"] },
    ]);
  });

  test("accepts complete object and array paths and rejects invalid continuations", async () => {
    const accepted = await bindMailWorkflow(
      await compile(`inputs:
  message:
    type: mailMessage
steps:
  - setVariable:
      name: sender
      value: "\${{ inputs.message.sender.0.email }}"
  - setVariable:
      name: keyword
      value: "\${{ inputs.message.keywords.0 }}"
  - setVariable:
      name: attachment
      value: "\${{ inputs.message.attachments.0.filename }}"
  - succeed:
      message: "Actor \${{ context.actor.userId }}"
`),
      catalog(),
    );
    expect(accepted.ok).toBe(true);

    const rejected = await bindMailWorkflow(
      await compile(`inputs:
  message:
    type: mailMessage
steps:
  - setVariable:
      name: second
      value: "\${{ inputs.message.attachments.01.filename }}"
  - setVariable:
      name: third
      value: "\${{ inputs.message.attachments.0.filename.extra }}"
  - setVariable:
      name: fourth
      value: "\${{ inputs.message.sender.0.constructor }}"
`),
      catalog(),
    );
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
        { code: "reference.path", path: ["steps", 0, "setVariable", "value"] },
        { code: "reference.path", path: ["steps", 1, "setVariable", "value"] },
        { code: "reference.path", path: ["steps", 2, "setVariable", "value"] },
      ]);
    }
  });

  test("reserves runtime roots for variables", async () => {
    const result = await bindMailWorkflow(
      await compile(`steps:
  - setVariable: { name: bindings, value: one }
  - setVariable: { name: context, value: two }
`),
      catalog(),
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
        { code: "scope.duplicate", path: ["steps", 0, "setVariable", "name"] },
        { code: "scope.duplicate", path: ["steps", 1, "setVariable", "name"] },
      ]);
    }
  });

  test("rejects repeated same-message provider mutations on reachable paths only", async () => {
    const repeated = await bindMailWorkflow(
      await compile(`inputs:
  message:
    type: mailMessage
steps:
  - setVariable: { name: selected, value: "\${{ inputs.message }}" }
  - addKeyword: { message: selected, keyword: first }
  - moveMessage: { message: inputs.message, folder: Inbox }
`),
      catalog(),
    );
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) {
      expect(repeated.diagnostics).toContainEqual(expect.objectContaining({ code: "action.sequence", path: ["steps", 2, "moveMessage"] }));
    }

    const exclusiveIf = await bindMailWorkflow(
      await compile(`inputs:
  message:
    type: mailMessage
steps:
  - if: { equals: [one, one] }
    then:
      - addKeyword: { message: inputs.message, keyword: branch }
    else:
      - moveMessage: { message: inputs.message, folder: Inbox }
`),
      catalog(),
    );
    expect(exclusiveIf.ok).toBe(true);

    const exclusiveSwitch = await bindMailWorkflow(
      await compile(`inputs:
  message:
    type: mailMessage
steps:
  - switch: one
    cases:
      - when: one
        do:
          - addKeyword: { message: inputs.message, keyword: case }
    default:
      - moveMessage: { message: inputs.message, folder: Inbox }
`),
      catalog(),
    );
    expect(exclusiveSwitch.ok).toBe(true);

    const afterBranch = await bindMailWorkflow(
      await compile(`inputs:
  message:
    type: mailMessage
steps:
  - if: { equals: [one, one] }
    then:
      - addKeyword: { message: inputs.message, keyword: branch }
  - moveMessage: { message: inputs.message, folder: Inbox }
`),
      catalog(),
    );
    expect(afterBranch.ok).toBe(false);
    if (!afterBranch.ok) {
      expect(afterBranch.diagnostics).toContainEqual(
        expect.objectContaining({ code: "action.sequence", path: ["steps", 1, "moveMessage"] }),
      );
    }
  });
});
