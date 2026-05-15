export type ScriptCompletionOption = {
  label: string;
  type: string;
  detail?: string;
};

export type ScriptCompletionRequest = {
  id: number;
  type: "complete";
  code: string;
  pos: number;
};

export type ScriptCompletionResponse = {
  id: number;
  type: "complete";
  options: ScriptCompletionOption[] | null;
};

export type ScriptWorkerRequest = ScriptCompletionRequest;
export type ScriptWorkerResponse = ScriptCompletionResponse;

export type ScriptTypeFile = {
  path: string;
  text: string;
};
