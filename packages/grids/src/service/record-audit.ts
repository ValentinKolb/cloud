import { err, fail, ok, type Result } from "@valentinkolb/stdlib";
import type { AuditQuestion, RecordAuditContext, RecordMutationAudit, TableAuditPolicy } from "../contracts";
import { RecordMutationAuditSchema, TableAuditPolicySchema } from "../contracts";
import { type RecordAuditOperation, recordAuditRequirementFor } from "../record-audit-policy";
import type { SqlClient } from "./audit";

export const loadTableAuditPolicy = async (client: SqlClient, tableId: string): Promise<Result<TableAuditPolicy>> => {
  const [row] = await client<Array<{ audit_policy: unknown }>>`
    SELECT t.audit_policy
    FROM grids.tables t
    JOIN grids.bases b ON b.id = t.base_id AND b.deleted_at IS NULL
    WHERE t.id = ${tableId}::uuid AND t.deleted_at IS NULL
    FOR SHARE OF t
  `;
  if (!row) return fail(err.notFound("Table"));
  const parsed = TableAuditPolicySchema.safeParse(row.audit_policy ?? {});
  return parsed.success ? ok(parsed.data) : fail(err.internal("Stored table audit policy is invalid"));
};

const answerForQuestion = (question: AuditQuestion, rawValue: string | undefined): Result<RecordAuditContext["answers"][number] | null> => {
  const value = rawValue?.trim() ?? "";
  if (!value) {
    return question.required ? fail(err.badInput(`Audit answer "${question.label}" is required`)) : ok(null);
  }

  if (question.type === "select") {
    const option = question.options.find((candidate) => candidate.id === value);
    if (!option) return fail(err.badInput(`Audit answer "${question.label}" is not a valid option`));
    return ok({
      questionId: question.id,
      label: question.label,
      type: question.type,
      required: question.required,
      value,
      optionLabel: option.label,
    });
  }

  return ok({
    questionId: question.id,
    label: question.label,
    type: question.type,
    required: question.required,
    value,
  });
};

/**
 * Validates operation metadata against the table policy and returns the
 * immutable, display-ready snapshot written to the audit log.
 */
export const buildRecordAuditContext = (
  policy: TableAuditPolicy,
  operation: RecordAuditOperation,
  changedFieldIds: string[],
  audit?: RecordMutationAudit,
): Result<RecordAuditContext | null> => {
  const requirement = recordAuditRequirementFor(policy, operation, changedFieldIds);
  const parsedAudit = RecordMutationAuditSchema.safeParse(audit ?? {});
  if (!parsedAudit.success) {
    return fail(err.badInput(parsedAudit.error.issues[0]?.message ?? "Invalid audit answers"));
  }
  const suppliedAnswers = parsedAudit.data.answers;

  if (!requirement) {
    return Object.keys(suppliedAnswers).length === 0
      ? ok(null)
      : fail(err.badInput(`Audit answers are not expected for this ${operation} operation`));
  }

  const questionIds = new Set(requirement.questions.map((question) => question.id));
  const unknownQuestionId = Object.keys(suppliedAnswers).find((questionId) => !questionIds.has(questionId));
  if (unknownQuestionId) return fail(err.badInput(`Unknown audit question "${unknownQuestionId}"`));

  const answers: RecordAuditContext["answers"] = [];
  for (const question of requirement.questions) {
    const answer = answerForQuestion(question, suppliedAnswers[question.id]);
    if (!answer.ok) return answer;
    if (answer.data) answers.push(answer.data);
  }

  return ok({ version: 1, operation, questions: requirement.questions, answers });
};
