export type TerminalReader = {
  read(prompt: string): Promise<string | null>;
};

export type NumberedChoice<T> = {
  value: T;
  label: string;
  description?: string;
  current?: boolean;
};

type TerminalOutput = {
  print(value?: string): void;
  error(value: string): void;
};

export const terminalSafeText = (value: string): string =>
  value.replace(
    /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g,
    (character) => `\\u${character.codePointAt(0)!.toString(16).padStart(4, "0")}`,
  );

const terminalLabel = (value: string): string => terminalSafeText(value).replaceAll(/\s+/g, " ").trim();

const choiceLine = <T>(index: number, choice: NumberedChoice<T>): string => {
  const description = choice.description ? ` · ${terminalLabel(choice.description)}` : "";
  return `  ${index}. ${terminalLabel(choice.label)}${description}${choice.current ? " [current]" : ""}`;
};

export const selectNumberedChoice = async <T>(input: {
  output: TerminalOutput;
  reader: TerminalReader;
  title: string;
  prompt: string;
  choices: readonly NumberedChoice<T>[];
  zeroChoice?: NumberedChoice<T>;
  emptyMessage?: string;
}): Promise<T | undefined> => {
  if (input.choices.length === 0 && !input.zeroChoice) {
    input.output.print(input.emptyMessage ?? "No choices available.");
    return undefined;
  }

  input.output.print(input.title);
  if (input.choices.length === 0 && input.emptyMessage) input.output.print(`  ${input.emptyMessage}`);
  if (input.zeroChoice) input.output.print(choiceLine(0, input.zeroChoice));
  input.choices.forEach((choice, index) => input.output.print(choiceLine(index + 1, choice)));

  while (true) {
    const answer = await input.reader.read(input.prompt);
    if (answer === null || answer.trim() === "") return undefined;
    const trimmed = answer.trim();
    const index = /^\d+$/.test(trimmed) ? Number(trimmed) : -1;
    if (index === 0 && input.zeroChoice) return input.zeroChoice.value;
    const choice = input.choices[index - 1];
    if (choice) return choice.value;
    const range = input.zeroChoice ? `0-${input.choices.length}` : `1-${input.choices.length}`;
    input.output.error(`Enter a number from ${range}, or press Enter to cancel.`);
  }
};
