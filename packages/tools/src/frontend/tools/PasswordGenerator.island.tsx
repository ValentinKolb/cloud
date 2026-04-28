import { createEffect, createMemo, createSignal, For, type JSX } from "solid-js";
import { password as pwdGen } from "@valentinkolb/stdlib";
import { clipboard } from "@valentinkolb/stdlib/browser";
import { SegmentedControl, Switch } from "@valentinkolb/cloud/ui";

type PasswordMode = "random" | "memorable" | "pin";

const randomCharTone = (char: string): string => {
  if (/\d/.test(char)) return "text-blue-600 dark:text-blue-300";
  if (/[^A-Za-z0-9]/.test(char)) return "text-amber-600 dark:text-amber-300";
  return "text-primary";
};

const memorableCharTone = (char: string): string => {
  if (/\d/.test(char)) return "text-blue-600 dark:text-blue-300";
  if (char === "-") return "text-red-500 dark:text-red-300";
  if (/[^A-Za-z0-9]/.test(char)) return "text-amber-600 dark:text-amber-300";
  return "text-primary";
};

const pinCharTone = (): string => "text-blue-600 dark:text-blue-300";

const sliderTrackBackground = (value: number, min: number, max: number): string => {
  const percent = ((value - min) / (max - min)) * 100;
  return `linear-gradient(to right, rgb(59 130 246) 0%, rgb(59 130 246) ${percent}%, rgb(161 161 170) ${percent}%, rgb(161 161 170) 100%)`;
};

const RangeField = (props: {
  label: string;
  value: () => number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}) => (
  <div class="grid gap-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:items-center">
    <span class="text-sm text-secondary">
      {props.label} <span class="text-dimmed">({props.value()})</span>
    </span>
    <input
      type="range"
      min={props.min}
      max={props.max}
      step={props.step ?? 1}
      value={props.value()}
      onInput={(event) => props.onChange(Number(event.currentTarget.value))}
      class="h-1.5 w-full cursor-pointer appearance-none rounded-full
        [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:appearance-none
        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-zinc-400/70
        [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-sm
        [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full
        [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-zinc-400/70 [&::-moz-range-thumb]:bg-white"
      style={{ background: sliderTrackBackground(props.value(), props.min, props.max) }}
    />
  </div>
);

const ToggleRow = (props: { children: JSX.Element; columns?: string }) => (
  <div class={`grid gap-4 ${props.columns ?? "sm:grid-cols-2"}`}>{props.children}</div>
);

const InlineToggle = (props: { label: string; value: () => boolean; onChange: (value: boolean) => void }) => (
  <div class="flex items-center gap-3">
    <span class="text-sm text-secondary">{props.label}</span>
    <Switch value={props.value} onChange={props.onChange} />
  </div>
);

const OutputPreview = (props: { mode: () => PasswordMode; value: () => string }) => {
  const chars = () => props.value().split("");
  const tone = (char: string) => {
    if (props.mode() === "pin") return pinCharTone();
    if (props.mode() === "memorable") return memorableCharTone(char);
    return randomCharTone(char);
  };

  return (
    <div class="grid min-h-32 place-items-center py-1">
      <div class="grid min-h-[7rem] w-full place-items-center">
        <div class="w-full text-center font-mono text-2xl font-semibold leading-[1.15] tracking-[0.02em] whitespace-normal break-all [overflow-wrap:anywhere] sm:text-3xl">
          <For each={chars()}>{(char) => <span class={tone(char)}>{char}</span>}</For>
        </div>
      </div>
    </div>
  );
};

const MODE_INFO: Record<PasswordMode, { title: string; body: string }> = {
  random: {
    title: "Random passwords",
    body: "Use a longer random password for the strongest general-purpose protection. Add numbers and symbols when the password should be stronger and harder to guess.",
  },
  memorable: {
    title: "Memorable passwords",
    body: "Readable word-based passwords are easier to type and remember. You can still add a random number or symbol when password rules require extra variation.",
  },
  pin: {
    title: "PIN passwords",
    body: "Use a short numeric PIN when a device or lock screen only allows digits.",
  },
};

export default function PasswordGenerator() {
  const [mode, setMode] = createSignal<PasswordMode>("random");
  const [randomLength, setRandomLength] = createSignal(20);
  const [randomUppercase, setRandomUppercase] = createSignal(true);
  const [randomNumbers, setRandomNumbers] = createSignal(true);
  const [randomSymbols, setRandomSymbols] = createSignal(false);
  const [memorableWords, setMemorableWords] = createSignal(4);
  const [memorableCapitalize, setMemorableCapitalize] = createSignal(false);
  const [memorableFullWords, setMemorableFullWords] = createSignal(true);
  const [memorableNumber, setMemorableNumber] = createSignal(false);
  const [memorableSymbol, setMemorableSymbol] = createSignal(false);
  const [pinLength, setPinLength] = createSignal(6);
  const [nonce, setNonce] = createSignal(0);
  const [copied, setCopied] = createSignal(false);

  const password = createMemo(() => {
    nonce();
    switch (mode()) {
      case "memorable":
        return pwdGen.memorable({
          words: memorableWords(),
          capitalize: memorableCapitalize(),
          fullWords: memorableFullWords(),
          addNumber: memorableNumber(),
          addSymbol: memorableSymbol(),
        });
      case "pin":
        return pwdGen.pin({ length: pinLength() });
      default:
        return pwdGen.random({
          length: randomLength(),
          uppercase: randomUppercase(),
          numbers: randomNumbers(),
          symbols: randomSymbols(),
        });
    }
  });

  createEffect(() => {
    password();
    setCopied(false);
  });

  const refresh = () => setNonce((value) => value + 1);

  const setRandomCharset = (key: "uppercase" | "numbers" | "symbols", enabled: boolean) => {
    if (key === "uppercase") setRandomUppercase(enabled);
    if (key === "numbers") setRandomNumbers(enabled);
    if (key === "symbols") setRandomSymbols(enabled);
  };

  const copyPassword = async () => {
    await clipboard.copy(password());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div class="flex flex-col gap-5">
      <SegmentedControl
        value={mode}
        onChange={setMode}
        ariaLabel="Password type"
        options={[
          { value: "random", label: "Random", icon: "ti ti-arrows-shuffle" },
          { value: "memorable", label: "Memorable", icon: "ti ti-bulb" },
          { value: "pin", label: "PIN", icon: "ti ti-hash" },
        ]}
      />

      <div class="info-block-info flex items-start gap-2">
        <i class="ti ti-info-circle shrink-0 mt-0.5" />
        <div class="text-sm">
          <strong>{MODE_INFO[mode()].title}</strong> {MODE_INFO[mode()].body}
        </div>
      </div>

      <section class="paper p-4">
        <div class="flex flex-col gap-5">
          {mode() === "random" && (
            <>
              <RangeField label="Characters" value={randomLength} onChange={setRandomLength} min={8} max={64} />
              <ToggleRow columns="sm:grid-cols-2 xl:grid-cols-3">
                <InlineToggle label="Uppercase" value={randomUppercase} onChange={(value) => setRandomCharset("uppercase", value)} />
                <InlineToggle label="Numbers" value={randomNumbers} onChange={(value) => setRandomCharset("numbers", value)} />
                <InlineToggle label="Symbols" value={randomSymbols} onChange={(value) => setRandomCharset("symbols", value)} />
              </ToggleRow>
            </>
          )}

          {mode() === "memorable" && (
            <>
              <RangeField label="Words" value={memorableWords} onChange={setMemorableWords} min={3} max={8} />
              <ToggleRow columns="sm:grid-cols-2 xl:grid-cols-4">
                <InlineToggle label="Capitalize first letter" value={memorableCapitalize} onChange={setMemorableCapitalize} />
                <InlineToggle label="Use full words" value={memorableFullWords} onChange={setMemorableFullWords} />
                <InlineToggle label="Add number" value={memorableNumber} onChange={setMemorableNumber} />
                <InlineToggle label="Add symbol" value={memorableSymbol} onChange={setMemorableSymbol} />
              </ToggleRow>
            </>
          )}

          {mode() === "pin" && <RangeField label="Digits" value={pinLength} onChange={setPinLength} min={4} max={12} />}
        </div>
      </section>

      <section class="flex flex-col gap-3">
        <div>
          <h2 class="text-base font-semibold text-primary">Generated password</h2>
        </div>
        <div class="paper p-4">
          <OutputPreview mode={mode} value={password} />
        </div>
      </section>

      <div class="grid gap-3 sm:grid-cols-2">
        <button type="button" class="btn-primary btn-md justify-center" onClick={copyPassword}>
          <i class={`ti ${copied() ? "ti-check" : "ti-copy"}`} />
          {copied() ? "Copied" : "Copy password"}
        </button>
        <button type="button" class="btn-secondary btn-md justify-center" onClick={refresh}>
          <i class="ti ti-refresh" />
          Refresh password
        </button>
      </div>
    </div>
  );
}
