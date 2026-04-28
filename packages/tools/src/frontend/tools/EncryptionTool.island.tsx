import { createSignal } from "solid-js";
import { crypto } from "@valentinkolb/stdlib";
import { TextInput } from "@valentinkolb/cloud/ui";
import { SegmentedControl } from "@valentinkolb/cloud/ui";
import { Switch } from "@valentinkolb/cloud/ui";
type Tab = "symmetric" | "asymmetric";
const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
};
export default function EncryptionTool() {
  const [tab, setTab] = createSignal<Tab>("symmetric");
  const [symPayload, setSymPayload] = createSignal("");
  const [symKey, setSymKey] = createSignal("");
  const [symStretched, setSymStretched] = createSignal(true);
  const [symOutput, setSymOutput] = createSignal("");
  const [symError, setSymError] = createSignal("");
  const [symLoading, setSymLoading] = createSignal(false);
  const [asymPubKey, setAsymPubKey] = createSignal("");
  const [asymPrivKey, setAsymPrivKey] = createSignal("");
  const [asymPayload, setAsymPayload] = createSignal("");
  const [asymOutput, setAsymOutput] = createSignal("");
  const [asymError, setAsymError] = createSignal("");
  const [asymLoading, setAsymLoading] = createSignal(false);
  const [copiedField, setCopiedField] = createSignal<string | null>(null);
  const copy = async (value: string, field: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };
  const symEncrypt = async () => {
    setSymError("");
    setSymOutput("");
    setSymLoading(true);
    try {
      const result = await crypto.symmetric.encrypt({ payload: symPayload(), key: symKey(), stretched: symStretched() });
      setSymOutput(result);
    } catch (error) {
      setSymError(getErrorMessage(error, "Encryption failed"));
    } finally {
      setSymLoading(false);
    }
  };
  const symDecrypt = async () => {
    setSymError("");
    setSymOutput("");
    setSymLoading(true);
    try {
      const result = await crypto.symmetric.decrypt({ payload: symPayload(), key: symKey() });
      setSymOutput(result);
    } catch (error) {
      setSymError(getErrorMessage(error, "Decryption failed — wrong key?"));
    } finally {
      setSymLoading(false);
    }
  };
  const generateKeys = async () => {
    setAsymError("");
    setAsymLoading(true);
    try {
      const keys = await crypto.asymmetric.generate();
      setAsymPubKey(keys.publicKey);
      setAsymPrivKey(keys.privateKey);
    } catch (error) {
      setAsymError(getErrorMessage(error, "Key generation failed"));
    } finally {
      setAsymLoading(false);
    }
  };
  const asymEncrypt = async () => {
    setAsymError("");
    setAsymOutput("");
    setAsymLoading(true);
    try {
      const result = await crypto.asymmetric.encrypt({ payload: asymPayload(), publicKey: asymPubKey() });
      setAsymOutput(result);
    } catch (error) {
      setAsymError(getErrorMessage(error, "Encryption failed"));
    } finally {
      setAsymLoading(false);
    }
  };
  const asymDecrypt = async () => {
    setAsymError("");
    setAsymOutput("");
    setAsymLoading(true);
    try {
      const result = await crypto.asymmetric.decrypt({ payload: asymPayload(), privateKey: asymPrivKey() });
      setAsymOutput(result);
    } catch (error) {
      setAsymError(getErrorMessage(error, "Decryption failed"));
    } finally {
      setAsymLoading(false);
    }
  };
  const CopyBtn = (props: { value: string; field: string }) => (
    <button class="icon-btn shrink-0" onClick={() => copy(props.value, props.field)} aria-label="Copy">
      {" "}
      <i class={`ti ${copiedField() === props.field ? "ti-check" : "ti-copy"} text-sm`} />{" "}
    </button>
  );
  const OutputBlock = (props: { label: string; value: string; field: string }) => (
    <div class="flex flex-col gap-1">
      {" "}
      <p class="text-xs font-medium text-dimmed">{props.label}</p>{" "}
      <div class="flex items-start gap-2">
        {" "}
        <code class="flex-1 text-xs bg-zinc-50 dark:bg-zinc-800/50 rounded-lg p-2 select-all break-all whitespace-pre-wrap max-h-40 overflow-y-auto">
          {" "}
          {props.value}{" "}
        </code>{" "}
        <CopyBtn value={props.value} field={props.field} />{" "}
      </div>{" "}
    </div>
  );
  return (
    <div class="flex flex-col gap-4">
      {" "}
      <SegmentedControl
        options={[
          { value: "symmetric" as Tab, label: "Symmetric", icon: "ti ti-key" },
          { value: "asymmetric" as Tab, label: "Asymmetric", icon: "ti ti-keys" },
        ]}
        value={tab}
        onChange={setTab}
      />{" "}
      {/* Symmetric */}{" "}
      {tab() === "symmetric" && (
        <div class="flex flex-col gap-4">
          {" "}
          <div class="info-block-info flex items-start gap-2">
            {" "}
            <i class="ti ti-info-circle shrink-0 mt-0.5" />{" "}
            <div class="text-sm">
              {" "}
              <strong>Symmetric encryption</strong> uses a single shared key for both encryption and decryption. Use{""}{" "}
              <strong>Stretched (PBKDF2)</strong> when your key is a password &mdash; it adds deliberate slowness to resist brute-force
              attacks. Use <strong>Fast (HKDF)</strong> for already high-entropy keys like API tokens.{" "}
            </div>{" "}
          </div>{" "}
          <div class="paper p-4 flex flex-col gap-3">
            {" "}
            <TextInput
              label="Payload"
              description="Enter text to encrypt, or paste ciphertext to decrypt."
              placeholder="Text or ciphertext..."
              multiline
              value={symPayload}
              onInput={setSymPayload}
            />{" "}
            <TextInput
              label="Key / Password"
              description="The shared secret used for both encryption and decryption."
              placeholder="Encryption key or password..."
              password
              icon="ti ti-key"
              value={symKey}
              onInput={setSymKey}
            />{" "}
            <div class="flex items-center gap-3">
              {" "}
              <Switch label="Stretched (PBKDF2)" value={symStretched} onChange={setSymStretched} />{" "}
              <span class="text-xs text-dimmed">{symStretched() ? "Slow, safe for passwords" : "Fast, for high-entropy keys"}</span>{" "}
            </div>{" "}
            <div class="flex items-center gap-2">
              {" "}
              <button class="btn-primary btn-sm" onClick={symEncrypt} disabled={symLoading() || !symPayload() || !symKey()}>
                {" "}
                <i class="ti ti-lock" /> Encrypt{" "}
              </button>{" "}
              <button class="btn-secondary btn-sm" onClick={symDecrypt} disabled={symLoading() || !symPayload() || !symKey()}>
                {" "}
                <i class="ti ti-lock-open" /> Decrypt{" "}
              </button>{" "}
            </div>{" "}
          </div>{" "}
          {symError() && (
            <div class="info-block-danger flex items-center gap-2">
              {" "}
              <i class="ti ti-alert-circle" /> {symError()}{" "}
            </div>
          )}{" "}
          {symOutput() && (
            <div class="paper p-4">
              {" "}
              <OutputBlock label="Output" value={symOutput()} field="sym-output" />{" "}
            </div>
          )}{" "}
        </div>
      )}{" "}
      {/* Asymmetric */}{" "}
      {tab() === "asymmetric" && (
        <div class="flex flex-col gap-4">
          {" "}
          <div class="info-block-info flex items-start gap-2">
            {" "}
            <i class="ti ti-info-circle shrink-0 mt-0.5" />{" "}
            <div class="text-sm flex flex-col gap-2">
              {" "}
              <div>
                {" "}
                <strong>Asymmetric encryption</strong> uses a key pair: a <strong>public key</strong> (shared freely) and a{""}{" "}
                <strong>private key</strong> (kept secret).{" "}
              </div>{" "}
              <div>
                {" "}
                <strong>Example:</strong> Alice wants to send Bob a secret message. Bob generates a key pair and shares his{""}{" "}
                <em>public key</em> with Alice. Alice encrypts her message using Bob's public key and sends the ciphertext &mdash; even
                publicly. Only Bob can decrypt it with his <em>private key</em>. Nobody else, not even Alice, can read it once encrypted.{" "}
              </div>{" "}
            </div>{" "}
          </div>{" "}
          <div class="paper p-4 flex flex-col gap-3">
            {" "}
            <div class="flex items-center justify-between">
              {" "}
              <p class="text-xs font-medium text-dimmed">Key Pair</p>{" "}
              <button class="btn-primary btn-sm" onClick={generateKeys} disabled={asymLoading()}>
                {" "}
                <i class="ti ti-refresh" /> Generate Keys{" "}
              </button>{" "}
            </div>{" "}
            <TextInput
              label="Public Key"
              description="Share this key with others so they can encrypt messages for you or verify your signatures."
              placeholder="Public key..."
              multiline
              value={asymPubKey}
              onInput={setAsymPubKey}
            />{" "}
            <TextInput
              label="Private Key"
              description="Keep this secret! Used to decrypt messages and sign data."
              placeholder="Private key..."
              multiline
              value={asymPrivKey}
              onInput={setAsymPrivKey}
            />{" "}
          </div>{" "}
          {/* Encrypt/Decrypt */}{" "}
          <div class="paper p-4 flex flex-col gap-3">
            {" "}
            <span class="section-label mb-1">Encrypt / Decrypt</span>{" "}
            <p class="text-xs text-dimmed">Encrypt with the recipient's public key. Only their private key can decrypt it.</p>{" "}
            <TextInput
              label="Payload"
              placeholder="Text to encrypt or ciphertext to decrypt..."
              multiline
              value={asymPayload}
              onInput={setAsymPayload}
            />{" "}
            <div class="flex items-center gap-2">
              {" "}
              <button class="btn-primary btn-sm" onClick={asymEncrypt} disabled={asymLoading() || !asymPayload() || !asymPubKey()}>
                {" "}
                <i class="ti ti-lock" /> Encrypt (Public Key){" "}
              </button>{" "}
              <button class="btn-secondary btn-sm" onClick={asymDecrypt} disabled={asymLoading() || !asymPayload() || !asymPrivKey()}>
                {" "}
                <i class="ti ti-lock-open" /> Decrypt (Private Key){" "}
              </button>{" "}
            </div>{" "}
          </div>{" "}
          {asymError() && (
            <div class="info-block-danger flex items-center gap-2">
              {" "}
              <i class="ti ti-alert-circle" /> {asymError()}{" "}
            </div>
          )}{" "}
          {asymOutput() && (
            <div class="paper p-4">
              {" "}
              <OutputBlock label="Output" value={asymOutput()} field="asym-output" />{" "}
            </div>
          )}{" "}
        </div>
      )}{" "}
    </div>
  );
}
