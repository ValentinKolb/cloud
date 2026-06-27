import { describe, expect, test } from "bun:test";
import type { SettingDef } from "../services/settings/defaults";
import { SETTINGS, validateSettingValue } from "../services/settings/defaults";
import { escapeTemplateOutput, migrateLegacyMustacheTemplate, renderLiquidTemplate, validateLiquidTemplate } from "./template-rendering";

const sampleValueFor = (name: string): string =>
  (
    ({
      ACCOUNT_KIND: "local",
      APP_NAME: "Cloud <Test>",
      CONTACT_EMAIL: "support@example.test",
      DISPLAY_NAME: "Ada Lovelace",
      EMAIL: "ada@example.test",
      EXPIRY: "2026-12-31",
      EXTEND_URL: "https://cloud.example.test/account/extend?x=1&y=2",
      FIRST_NAME: "Ada",
      LOGIN_URL: "https://cloud.example.test/auth/login?x=1&y=2",
      MAGIC_LINK: "https://cloud.example.test/auth/magic?token=abc&next=/app",
      PASSWORD: "Temp<Pass>&123",
      REASON: "Missing approval <pending>",
      RESET_LINK: "https://cloud.example.test/auth/reset?token=abc&next=/app",
      TOKEN: "123456",
      USERNAME: "ada",
    }) as Record<string, string>
  )[name] ?? `${name}_VALUE`;

const sampleDataFor = (variables: readonly string[], emptyOptional = false): Record<string, string> =>
  Object.fromEntries(
    variables.map((name) => [name, emptyOptional && ["CONTACT_EMAIL", "EXPIRY"].includes(name) ? "" : sampleValueFor(name)]),
  );

const isTemplateSetting = (setting: SettingDef): setting is SettingDef & { kind: "template"; default: string; templateVars?: string[] } =>
  setting.kind === "template";

describe("Liquid template rendering", () => {
  test("uses legacy-compatible HTML escaping", () => {
    expect(escapeTemplateOutput(`&\\<>"'\`=/`)).toBe("&amp;\\&lt;&gt;&quot;&#39;&#x60;&#x3D;&#x2F;");
    expect(renderLiquidTemplate(`<a href="{{ URL }}">{{ LABEL }}</a>`, { URL: "https://x.test/a?b=1&c=2", LABEL: "<Hi>" })).toBe(
      `<a href="https:&#x2F;&#x2F;x.test&#x2F;a?b&#x3D;1&amp;c&#x3D;2">&lt;Hi&gt;</a>`,
    );
  });

  test("migrates legacy Mustache sections to Liquid blank checks", () => {
    expect(migrateLegacyMustacheTemplate("{{#CONTACT_EMAIL}}mail{{/CONTACT_EMAIL}}{{^EXPIRY}}none{{/EXPIRY}}")).toBe(
      "{% if CONTACT_EMAIL != blank %}mail{% endif %}{% if EXPIRY == blank %}none{% endif %}",
    );
  });

  test("normalizes legacy template settings on validation", () => {
    const def = SETTINGS.find((setting) => setting.key === "mail.password_reset");
    expect(def).toBeDefined();
    const result = validateSettingValue(def!, "{{#CONTACT_EMAIL}}Hi {{CONTACT_EMAIL}}{{/CONTACT_EMAIL}}");
    expect(result).toEqual({ ok: true, value: "{% if CONTACT_EMAIL != blank %}Hi {{CONTACT_EMAIL}}{% endif %}" });
  });

  test("all default template settings are valid Liquid", () => {
    const templates = SETTINGS.filter(isTemplateSetting);
    expect(templates.length).toBeGreaterThan(0);

    for (const setting of templates) {
      expect(setting.default).not.toContain("{{#");
      expect(setting.default).not.toContain("{{^");
      expect(validateLiquidTemplate(setting.default)).toEqual({ ok: true });
      expect(() => renderLiquidTemplate(setting.default, sampleDataFor(setting.templateVars ?? []))).not.toThrow();
      expect(() => renderLiquidTemplate(setting.default, sampleDataFor(setting.templateVars ?? [], true))).not.toThrow();
    }
  });
});
