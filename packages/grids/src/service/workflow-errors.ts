export const workflowConflict = (message: string) => ({
  code: "CONFLICT" as const,
  message,
  status: 409 as const,
});
