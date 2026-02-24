import type { Extension } from "@codemirror/state";
import { markdown as markdownExt, markdownLanguage } from "@codemirror/lang-markdown";
import { LanguageDescription } from "@codemirror/language";

// Static imports — ensures these land in the bundle
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { php } from "@codemirror/lang-php";

const codeLanguages = [
  LanguageDescription.of({
    name: "JavaScript",
    alias: ["js", "jsx", "ts", "tsx", "typescript"],
    load: async () => javascript({ jsx: true, typescript: true }),
  }),
  LanguageDescription.of({
    name: "Python",
    alias: ["py"],
    load: async () => python(),
  }),
  LanguageDescription.of({
    name: "SQL",
    load: async () => sql(),
  }),
  LanguageDescription.of({
    name: "HTML",
    alias: ["htm"],
    load: async () => html(),
  }),
  LanguageDescription.of({
    name: "CSS",
    load: async () => css(),
  }),
  LanguageDescription.of({
    name: "JSON",
    load: async () => json(),
  }),
  LanguageDescription.of({
    name: "Go",
    alias: ["golang"],
    load: async () => go(),
  }),
  LanguageDescription.of({
    name: "Java",
    load: async () => java(),
  }),
  LanguageDescription.of({
    name: "XML",
    alias: ["svg"],
    load: async () => xml(),
  }),
  LanguageDescription.of({
    name: "YAML",
    alias: ["yml"],
    load: async () => yaml(),
  }),
  LanguageDescription.of({
    name: "Rust",
    alias: ["rs"],
    load: async () => rust(),
  }),
  LanguageDescription.of({
    name: "C++",
    alias: ["cpp", "c", "h", "hpp"],
    load: async () => cpp(),
  }),
  LanguageDescription.of({
    name: "PHP",
    load: async () => php(),
  }),
];

export const markdownExtension: () => Extension = () =>
  markdownExt({
    base: markdownLanguage,
    codeLanguages,
  });
