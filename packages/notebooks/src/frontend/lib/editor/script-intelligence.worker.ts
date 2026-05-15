import { createScriptIntelligenceService } from "./script-intelligence-service";
import type { ScriptWorkerRequest, ScriptWorkerResponse } from "./script-intelligence-protocol";
import { typeFiles } from "notebooks-script-intelligence/type-files";

let servicePromise: ReturnType<typeof createScriptIntelligenceService> | null = null;

const getService = () => {
  servicePromise ??= createScriptIntelligenceService(typeFiles);
  return servicePromise;
};

self.onmessage = async (event: MessageEvent<ScriptWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "complete") return;

  const response: ScriptWorkerResponse = {
    id: request.id,
    type: "complete",
    options: null,
  };

  try {
    const service = await getService();
    response.options = service.complete(request.code, request.pos);
  } catch (error) {
    console.warn("[notebooks] script intelligence worker failed", error);
  }

  self.postMessage(response);
};
