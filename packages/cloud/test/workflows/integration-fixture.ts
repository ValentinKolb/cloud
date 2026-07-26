import { afterAll } from "bun:test";
import { deleteWorkflowScope } from "../../src/workflows/store/definitions";

type WorkflowTestScope = { appId: string; scopeId: string };

/**
 * Gives one integration-test module isolated scopes and removes them when its
 * tests finish. Cleanup uses the production scope contract so tests exercise
 * the same lifecycle an app relies on.
 */
export const createWorkflowIntegrationFixture = () => {
  const suiteId = `workflow-test-${crypto.randomUUID()}`;
  const scopes = new Map<string, WorkflowTestScope>();
  let sequence = 0;

  const track = (appId: string, scopeId: string): string => {
    scopes.set(`${appId}\0${scopeId}`, { appId, scopeId });
    return scopeId;
  };

  const scope = (appId = "probe"): string => {
    sequence += 1;
    return track(appId, `${suiteId}-${sequence}`);
  };

  const cleanup = async (): Promise<void> => {
    for (const entry of scopes.values()) await deleteWorkflowScope(entry);
    scopes.clear();
  };

  afterAll(cleanup);

  return { scope };
};
