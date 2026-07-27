import { describe, expect, test } from "bun:test";
import { filterKnownDiagnostics, typecheckFailed } from "./run-typecheck";

const knownDiagnostic = [
  "../node_modules/@valentinkolb/ssr/src/adapter/hono.ts(179,77): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.",
  "  Type 'undefined' is not assignable to type 'string'.",
].join("\n");

describe("typecheck diagnostics", () => {
  test("filters only the exact acknowledged SSR diagnostic", () => {
    expect(filterKnownDiagnostics(knownDiagnostic)).toEqual({
      ignored: 1,
      remaining: "",
    });
  });

  test("filters the same diagnostic from the container-relative path", () => {
    expect(filterKnownDiagnostics(knownDiagnostic.replace("../node_modules", "node_modules"))).toEqual({
      ignored: 1,
      remaining: "",
    });
  });

  test("keeps all other TypeScript errors", () => {
    const ownError = "examples/example.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.";
    expect(filterKnownDiagnostics(`${knownDiagnostic}\n${ownError}`)).toEqual({
      ignored: 1,
      remaining: ownError,
    });
  });

  test("keeps compiler failures without diagnostics", () => {
    expect(filterKnownDiagnostics("TypeScript crashed")).toEqual({
      ignored: 0,
      remaining: "TypeScript crashed",
    });
  });

  test("fails on output even when the compiler exits zero", () => {
    expect(
      typecheckFailed(0, {
        ignored: 0,
        remaining: "unexpected compiler output",
      }),
    ).toBe(true);
  });

  test("accepts only the acknowledged diagnostic", () => {
    expect(typecheckFailed(1, { ignored: 1, remaining: "" })).toBe(false);
  });
});
