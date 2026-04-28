import { createSignal, createMemo, Switch, Match } from "solid-js";
// stdlib's qr module is no longer barrel-exported (v0.3.0+) because it
// depends on the optional peer `lean-qr`. Use the subpath import; this
// app declares lean-qr as a direct dep so it's installed in the container.
import { qr } from "@valentinkolb/stdlib/qr";
import { TextInput } from "@valentinkolb/cloud/ui";
import { Select } from "@valentinkolb/cloud/ui";
import { Slider } from "@valentinkolb/cloud/ui";
import { ColorInput } from "@valentinkolb/cloud/ui";
import { DateTimeInput } from "@valentinkolb/cloud/ui";
import { SwitchInput } from "@valentinkolb/cloud/ui";

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
        a.href = URL.createObjectURL(blob);
        a.download = "qr-code.png";
        a.click();
      }, "image/png");
    };
    im.src = url;
  };

  return (
    <div class="flex flex-col gap-4">
      {/* Mode selector */}
      <div class="paper p-4">
        <Select
          label="QR Code Type"
          description={MODE_INFO[mode()]}
          icon="ti ti-qrcode"
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          options={[
            { id: "text", label: "Text / URL", icon: "ti ti-link" },
            { id: "wifi", label: "WiFi", icon: "ti ti-wifi" },
            { id: "email", label: "Email", icon: "ti ti-mail" },
            { id: "tel", label: "Phone", icon: "ti ti-phone" },
            { id: "vcard", label: "Contact Card", icon: "ti ti-address-book" },
            {
              id: "event",
              label: "Calendar Event",
              icon: "ti ti-calendar-event",
            },
          ]}
        />
      </div>

      {/* Mode-specific inputs */}
      <div class="paper p-4 flex flex-col gap-3">
        <Switch>
          <Match when={mode() === "text"}>
            <TextInput
              label="Data"
              description="URL, text, or any data to encode"
              placeholder="URL or text to encode..."
              icon="ti ti-link"
              multiline
              value={text}
              onInput={setText}
            />
          </Match>

          <Match when={mode() === "wifi"}>
            <TextInput
              label="Network Name (SSID)"
              description="The name of the WiFi network"
              placeholder="MyNetwork"
              icon="ti ti-wifi"
              value={wifiSsid}
              onInput={setWifiSsid}
              required
            />
            <TextInput
              label="Password"
              description="Leave empty for open networks"
              placeholder="Network password"
              icon="ti ti-lock"
              value={wifiPassword}
              onInput={setWifiPassword}
              password
            />
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
              <Select
                label="Encryption"
                icon="ti ti-shield-lock"
                value={wifiEncryption}
                onChange={setWifiEncryption}
                options={[
                  { id: "WPA", label: "WPA / WPA2" },
                  { id: "WEP", label: "WEP" },
                  { id: "nopass", label: "None (Open)" },
                ]}
              />
              <div class="flex items-center h-9.5">
                <SwitchInput label="Hidden Network" value={wifiHidden} onChange={setWifiHidden} />
              </div>
            </div>
          </Match>

          <Match when={mode() === "email"}>
            <TextInput
              label="To"
              description="Recipient email address"
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
              label="Phone Number"
              description="Include country code for international numbers"
              placeholder="+49 123 456 7890"
              icon="ti ti-phone"
              value={telNumber}
              onInput={setTelNumber}
              required
            />
          </Match>

          <Match when={mode() === "vcard"}>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput label="First Name" placeholder="Jane" icon="ti ti-user" value={vcFirstName} onInput={setVcFirstName} required />
              <TextInput label="Last Name" placeholder="Doe" value={vcLastName} onInput={setVcLastName} />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput label="Organization" placeholder="Acme Inc." icon="ti ti-building" value={vcOrg} onInput={setVcOrg} />
              <TextInput label="Title" placeholder="Software Engineer" icon="ti ti-briefcase" value={vcTitle} onInput={setVcTitle} />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput label="Phone" placeholder="+49 123 456 7890" icon="ti ti-phone" value={vcPhone} onInput={setVcPhone} />
              <TextInput label="Email" placeholder="jane@example.com" icon="ti ti-mail" value={vcEmail} onInput={setVcEmail} />
            </div>
            <TextInput label="Website" placeholder="https://example.com" icon="ti ti-world" value={vcWebsite} onInput={setVcWebsite} />
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput label="Street" placeholder="123 Main St" icon="ti ti-map-pin" value={vcStreet} onInput={setVcStreet} />
              <TextInput label="City" placeholder="Berlin" value={vcCity} onInput={setVcCity} />
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <TextInput label="ZIP Code" placeholder="10115" value={vcZip} onInput={setVcZip} />
              <TextInput label="Country" placeholder="Germany" value={vcCountry} onInput={setVcCountry} />
            </div>
          </Match>

          <Match when={mode() === "event"}>
            <TextInput
              label="Event Title"
              placeholder="Team Meeting"
              icon="ti ti-calendar-event"
              value={evTitle}
              onInput={setEvTitle}
              required
            />
            <TextInput
              label="Location"
              description="Physical address or meeting link"
              placeholder="Room 42 or https://meet.example.com"
              icon="ti ti-map-pin"
              value={evLocation}
              onInput={setEvLocation}
            />
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DateTimeInput label="Start" value={evStart} onChange={setEvStart} />
              <DateTimeInput label="End" value={evEnd} onChange={setEvEnd} />
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

      {/* QR display settings */}
      <div class="paper p-4 flex flex-col gap-3">
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select
            label="Error Correction"
            description="Higher = more resilient, less capacity"
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
          <ColorInput label="Foreground" description="Color of the QR modules" value={fgColor} onChange={setFgColor} />
          <ColorInput
            label="Background"
            description="Color behind the QR code"
            value={bgColor}
            onChange={setBgColor}
            transparent
            isTransparent={transparentBg}
            onTransparentChange={setTransparentBg}
          />
        </div>
        <Slider
          label="Export Size (px)"
          description="Resolution for PNG export"
          value={size}
          onChange={setSize}
          min={100}
          max={1000}
          step={50}
          showValue
        />
      </div>

      {/* QR preview + download */}
      {qrSvg() && (
        <div class="paper p-4 flex flex-col items-center gap-4">
          <div class="thumbnail border border-zinc-200 dark:border-zinc-700" style={{ "max-width": "400px", width: "100%" }}>
            <img src={svgDataUrl()} alt="Generated QR code preview" class="block w-full h-auto" loading="lazy" />
          </div>
          <div class="flex items-center gap-2">
            <button class="btn-primary btn-sm" onClick={downloadSvg}>
              <i class="ti ti-download" /> SVG
            </button>
            <button class="btn-secondary btn-sm" onClick={downloadPng}>
              <i class="ti ti-download" /> PNG
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
