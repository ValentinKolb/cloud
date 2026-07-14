import { createMemo, createSignal, Match, Show, Switch } from "solid-js";
// stdlib's qr module is no longer barrel-exported (v0.3.0+) because it
// depends on the optional peer `lean-qr`. Use the subpath import; this
// app declares lean-qr as a direct dep so it's installed in the container.
import { qr } from "@valentinkolb/stdlib/qr";
import { ColorInput, CopyButton, DateTimePicker, Select, Slider, SwitchInput, TextInput } from "@valentinkolb/cloud/ui";

type Mode = "text" | "wifi" | "email" | "tel" | "vcard" | "event";

const MODE_INFO: Record<Mode, string> = {
  text: "Encode any text or URL into a QR code.",
  wifi: "Scan to connect to a WiFi network automatically.",
  email: "Scan to open a pre-filled email draft.",
  tel: "Scan to dial a phone number.",
  vcard: "Scan to save a digital business card.",
  event: "Scan to add a calendar event.",
};

export default function QrCodeGenerator() {
  // === Mode ===
  const [mode, setMode] = createSignal<Mode>("text");

  // === Text/URL ===
  const [text, setText] = createSignal("https://example.com");

  // === WiFi ===
  const [wifiSsid, setWifiSsid] = createSignal("");
  const [wifiPassword, setWifiPassword] = createSignal("");
  const [wifiEncryption, setWifiEncryption] = createSignal("WPA");
  const [wifiHidden, setWifiHidden] = createSignal(false);

  // === Email ===
  const [emailTo, setEmailTo] = createSignal("");
  const [emailSubject, setEmailSubject] = createSignal("");
  const [emailBody, setEmailBody] = createSignal("");

  // === Phone ===
  const [telNumber, setTelNumber] = createSignal("");

  // === vCard ===
  const [vcFirstName, setVcFirstName] = createSignal("");
  const [vcLastName, setVcLastName] = createSignal("");
  const [vcOrg, setVcOrg] = createSignal("");
  const [vcTitle, setVcTitle] = createSignal("");
  const [vcPhone, setVcPhone] = createSignal("");
  const [vcEmail, setVcEmail] = createSignal("");
  const [vcWebsite, setVcWebsite] = createSignal("");
  const [vcStreet, setVcStreet] = createSignal("");
  const [vcCity, setVcCity] = createSignal("");
  const [vcZip, setVcZip] = createSignal("");
  const [vcCountry, setVcCountry] = createSignal("");

  // === Event ===
  const [evTitle, setEvTitle] = createSignal("");
  const [evLocation, setEvLocation] = createSignal("");
  const [evStart, setEvStart] = createSignal("");
  const [evEnd, setEvEnd] = createSignal("");
  const [evDescription, setEvDescription] = createSignal("");

  // === Display settings (shared) ===
  const [ecLevel, setEcLevel] = createSignal("M");
  const [size, setSize] = createSignal(300);
  const [fgColor, setFgColor] = createSignal("#000000");
  const [bgColor, setBgColor] = createSignal("#ffffff");
  const [transparentBg, setTransparentBg] = createSignal(false);

  // === Computed payload ===
  const payload = createMemo(() => {
    switch (mode()) {
      case "text":
        return text().trim();
      case "wifi":
        return wifiSsid().trim()
          ? qr.wifi({
              ssid: wifiSsid(),
              password: wifiPassword(),
              encryption: wifiEncryption() as "WPA" | "WEP" | "nopass",
              hidden: wifiHidden(),
            })
          : "";
      case "email":
        return emailTo().trim()
          ? qr.email({
              to: emailTo(),
              subject: emailSubject(),
              body: emailBody(),
            })
          : "";
      case "tel":
        return telNumber().trim() ? qr.tel({ number: telNumber() }) : "";
      case "vcard":
        return vcFirstName().trim()
          ? qr.vcard({
              firstName: vcFirstName(),
              lastName: vcLastName(),
              organization: vcOrg(),
              title: vcTitle(),
              phone: vcPhone(),
              email: vcEmail(),
              website: vcWebsite(),
              street: vcStreet(),
              city: vcCity(),
              zip: vcZip(),
              country: vcCountry(),
            })
          : "";
      case "event":
        return evTitle().trim()
          ? qr.event({
              title: evTitle(),
              location: evLocation(),
              start: evStart(),
              end: evEnd(),
              description: evDescription(),
            })
          : "";
      default:
        return "";
    }
  });

  // === QR rendering ===
  const qrSvg = createMemo(() => {
    const p = payload();
    if (!p) return "";
    try {
      return qr.toSvg(p, {
        on: fgColor(),
        off: transparentBg() ? "transparent" : bgColor(),
        correctionLevel: ecLevel() as "L" | "M" | "Q" | "H",
      });
    } catch {
      return "";
    }
  });

  const svgDataUrl = createMemo(() => {
    const svg = qrSvg();
    if (!svg) return "";
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });

  const downloadSvg = () => {
    const svg = qrSvg();
    if (!svg) return;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qr-code.svg";
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPng = () => {
    const url = svgDataUrl();
    if (!url) return;
    const im = new Image();
    im.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = size();
      canvas.height = size();
      const ctx = canvas.getContext("2d")!;
      if (!transparentBg()) {
        ctx.fillStyle = bgColor();
        ctx.fillRect(0, 0, size(), size());
      }
      ctx.drawImage(im, 0, 0, size(), size());
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        const downloadUrl = URL.createObjectURL(blob);
        a.href = downloadUrl;
        a.download = "qr-code.png";
        a.click();
        URL.revokeObjectURL(downloadUrl);
      }, "image/png");
    };
    im.src = url;
  };

  return (
    <div class="tools-qr-root flex flex-col gap-2">
      <div class="tools-qr-workbench">
        <section class="paper tools-qr-input flex flex-col gap-4 p-4">
          <header>
            <h2 class="text-sm font-semibold text-primary">Content</h2>
            <p class="text-xs text-dimmed">{MODE_INFO[mode()]}</p>
          </header>

          <Select
            label="Content type"
            icon="ti ti-qrcode"
            value={mode}
            onChange={(value) => setMode(value as Mode)}
            options={[
              { id: "text", label: "Text or URL", icon: "ti ti-link" },
              { id: "wifi", label: "WiFi network", icon: "ti ti-wifi" },
              { id: "email", label: "Email", icon: "ti ti-mail" },
              { id: "tel", label: "Phone number", icon: "ti ti-phone" },
              { id: "vcard", label: "Contact card", icon: "ti ti-address-book" },
              { id: "event", label: "Calendar event", icon: "ti ti-calendar-event" },
            ]}
          />

          <div class="flex flex-col gap-3">
            <Switch>
              <Match when={mode() === "text"}>
                <TextInput
                  label="Link or text"
                  description="The preview updates while you type."
                  placeholder="URL or text to encode..."
                  icon="ti ti-link"
                  multiline
                  lines={4}
                  value={text}
                  onInput={setText}
                />
              </Match>

              <Match when={mode() === "wifi"}>
                <TextInput
                  label="Network name (SSID)"
                  description="The name of the WiFi network."
                  placeholder="MyNetwork"
                  icon="ti ti-wifi"
                  value={wifiSsid}
                  onInput={setWifiSsid}
                  required
                />
                <TextInput
                  label="Password"
                  description="Leave empty for open networks."
                  placeholder="Network password"
                  icon="ti ti-lock"
                  value={wifiPassword}
                  onInput={setWifiPassword}
                  password
                />
                <div class="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
                  <Select
                    label="Encryption"
                    icon="ti ti-shield-lock"
                    value={wifiEncryption}
                    onChange={setWifiEncryption}
                    options={[
                      { id: "WPA", label: "WPA / WPA2" },
                      { id: "WEP", label: "WEP" },
                      { id: "nopass", label: "None (open)" },
                    ]}
                  />
                  <div class="flex h-9.5 items-center">
                    <SwitchInput label="Hidden network" value={wifiHidden} onChange={setWifiHidden} />
                  </div>
                </div>
              </Match>

              <Match when={mode() === "email"}>
                <TextInput
                  label="To"
                  description="Recipient email address."
                  placeholder="recipient@example.com"
                  icon="ti ti-mail"
                  value={emailTo}
                  onInput={setEmailTo}
                  required
                />
                <TextInput
                  label="Subject"
                  placeholder="Email subject"
                  icon="ti ti-text-caption"
                  value={emailSubject}
                  onInput={setEmailSubject}
                />
                <TextInput
                  label="Body"
                  placeholder="Email body text..."
                  icon="ti ti-align-left"
                  multiline
                  value={emailBody}
                  onInput={setEmailBody}
                />
              </Match>

              <Match when={mode() === "tel"}>
                <TextInput
                  label="Phone number"
                  description="Include the country code for international numbers."
                  placeholder="+49 123 456 7890"
                  icon="ti ti-phone"
                  value={telNumber}
                  onInput={setTelNumber}
                  required
                />
              </Match>

              <Match when={mode() === "vcard"}>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextInput
                    label="First name"
                    placeholder="Jane"
                    icon="ti ti-user"
                    value={vcFirstName}
                    onInput={setVcFirstName}
                    required
                  />
                  <TextInput label="Last name" placeholder="Doe" value={vcLastName} onInput={setVcLastName} />
                </div>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextInput label="Organization" placeholder="Acme Inc." icon="ti ti-building" value={vcOrg} onInput={setVcOrg} />
                  <TextInput label="Title" placeholder="Software Engineer" icon="ti ti-briefcase" value={vcTitle} onInput={setVcTitle} />
                </div>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextInput label="Phone" placeholder="+49 123 456 7890" icon="ti ti-phone" value={vcPhone} onInput={setVcPhone} />
                  <TextInput label="Email" placeholder="jane@example.com" icon="ti ti-mail" value={vcEmail} onInput={setVcEmail} />
                </div>
                <TextInput label="Website" placeholder="https://example.com" icon="ti ti-world" value={vcWebsite} onInput={setVcWebsite} />
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextInput label="Street" placeholder="123 Main St" icon="ti ti-map-pin" value={vcStreet} onInput={setVcStreet} />
                  <TextInput label="City" placeholder="Berlin" value={vcCity} onInput={setVcCity} />
                </div>
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <TextInput label="ZIP code" placeholder="10115" value={vcZip} onInput={setVcZip} />
                  <TextInput label="Country" placeholder="Germany" value={vcCountry} onInput={setVcCountry} />
                </div>
              </Match>

              <Match when={mode() === "event"}>
                <TextInput
                  label="Event title"
                  placeholder="Team meeting"
                  icon="ti ti-calendar-event"
                  value={evTitle}
                  onInput={setEvTitle}
                  required
                />
                <TextInput
                  label="Location"
                  description="Physical address or meeting link."
                  placeholder="Room 42 or https://meet.example.com"
                  icon="ti ti-map-pin"
                  value={evLocation}
                  onInput={setEvLocation}
                />
                <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <DateTimePicker label="Start" value={() => evStart() || null} onChange={(value) => setEvStart(value ?? "")} clearable />
                  <DateTimePicker label="End" value={() => evEnd() || null} onChange={(value) => setEvEnd(value ?? "")} clearable />
                </div>
                <TextInput
                  label="Description"
                  placeholder="Event details..."
                  icon="ti ti-align-left"
                  multiline
                  value={evDescription}
                  onInput={setEvDescription}
                />
              </Match>
            </Switch>
          </div>
        </section>

        <section class="paper tools-qr-preview flex flex-col gap-4 p-4" aria-live="polite">
          <header class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 class="text-sm font-semibold text-primary">Preview</h2>
              <p class="text-xs text-dimmed">Updates automatically as you edit.</p>
            </div>
            <span class="shrink-0 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface)] px-2 py-1 text-xs tabular-nums text-dimmed">
              {size()} px
            </span>
          </header>

          <div class="tools-qr-preview-frame">
            <Show
              when={qrSvg()}
              fallback={
                <div class="max-w-64 text-center">
                  <div class="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-[var(--ui-radius-control)] border border-[var(--ui-state-icon-border)] bg-[var(--ui-state-icon-surface)] text-dimmed">
                    <i class={`ti ${payload() ? "ti-alert-circle" : "ti-qrcode-off"} text-lg`} />
                  </div>
                  <p class="text-sm font-medium text-primary">{payload() ? "Preview unavailable" : "Add content to create a QR code"}</p>
                  <p class="mt-0.5 text-xs text-dimmed">
                    {payload() ? "Shorten the content or adjust its format." : "The result will appear here automatically."}
                  </p>
                </div>
              }
            >
              <img src={svgDataUrl()} alt="Generated QR code preview" class="tools-qr-image" />
            </Show>
          </div>

          <Show when={qrSvg()}>
            <div class="flex flex-wrap items-center justify-center gap-2">
              <button type="button" class="btn-primary btn-sm" onClick={downloadSvg}>
                <i class="ti ti-download" />
                Download SVG
              </button>
              <button type="button" class="btn-secondary btn-sm" onClick={downloadPng}>
                <i class="ti ti-photo-down" />
                PNG
              </button>
              <CopyButton text={payload()} label="Copy content" class="btn-secondary btn-sm" />
            </div>
          </Show>
        </section>

        <details class="paper tools-qr-advanced group p-4" open>
          <summary class="focus-ui flex cursor-pointer list-none items-center justify-between gap-3 rounded-[var(--ui-radius-control)]">
            <span>
              <span class="block text-sm font-semibold text-primary">Export and resilience</span>
              <span class="block text-xs font-normal text-dimmed">Colors, error correction, and PNG size.</span>
            </span>
            <i class="ti ti-chevron-down shrink-0 text-sm text-dimmed transition-transform group-open:rotate-180" />
          </summary>

          <div class="mt-4 flex flex-col gap-3">
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Select
                label="Error correction"
                description="Higher levels remain readable after more damage."
                icon="ti ti-shield-check"
                value={ecLevel}
                onChange={setEcLevel}
                options={[
                  { id: "L", label: "Low (~7%)" },
                  { id: "M", label: "Medium (~15%)" },
                  { id: "Q", label: "Quartile (~25%)" },
                  { id: "H", label: "High (~30%)" },
                ]}
              />
              <ColorInput label="Foreground" description="QR module color." value={fgColor} onChange={setFgColor} />
              <ColorInput
                label="Background"
                description="Color behind the QR code."
                value={bgColor}
                onChange={setBgColor}
                transparent
                isTransparent={transparentBg}
                onTransparentChange={setTransparentBg}
              />
            </div>
            <Slider
              label="PNG export size"
              description="Resolution used for PNG downloads."
              value={size}
              onChange={setSize}
              min={100}
              max={1000}
              step={50}
              showValue
            />
          </div>
        </details>
      </div>

      <p class="tools-local-note">
        <i class="ti ti-device-laptop" />
        QR content is processed on this device.
      </p>
    </div>
  );
}
