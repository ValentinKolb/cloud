export const canEditAiSkillInSurface = (input: { canManage: boolean; isAdminSurface: boolean; ownerUserId: string | null }): boolean =>
  input.canManage && (input.isAdminSurface || input.ownerUserId !== null);
