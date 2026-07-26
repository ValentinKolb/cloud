export const shouldApplyWorkflowValidation = (params: {
  requestId: number;
  latestRequestId: number;
  requestedSource: string;
  currentSource: string;
  aborted: boolean;
}): boolean => !params.aborted && params.requestId === params.latestRequestId && params.requestedSource === params.currentSource;
