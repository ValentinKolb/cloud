import Layout from "@/ssr/Layout";
import { ssr } from "@config";
import { getSync } from "@valentinkolb/cloud-core/services/settings";

export default ssr(async (c) => {
  const appName = getSync<string>("app.name") || "My App";
  const privacyEmail = getSync<string>("app.privacy_email");
  const orgDescription = getSync<string>("app.organization_description");

  return (
    <Layout c={c} title="Datenschutzerklärung">
      <div class="container max-w-3xl p-4 sm:p-8">
        <article class="prose">
          <h1>Datenschutzerklärung</h1>

          <h2>1. Verantwortlicher</h2>
          {orgDescription ? (
            <p>Verantwortlich für die Datenverarbeitung auf dieser Website: {orgDescription}</p>
          ) : (
            <p>Verantwortlich für die Datenverarbeitung auf dieser Website ist der Betreiber von {appName}.</p>
          )}
          {privacyEmail && (
            <p>
              Bei Fragen zum Datenschutz wenden Sie sich bitte an:
              <br />
              E-Mail: <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>
            </p>
          )}

          <h2>2. Zweck der Anwendung</h2>
          <p>
            Diese Webanwendung ({appName}) dient der Verwaltung von Benutzerkonten und Zugriffsberechtigungen (Identity & Access
            Management). Sie ermöglicht:
          </p>
          <ul>
            <li>Die Anmeldung und Authentifizierung von Nutzern</li>
            <li>Die Verwaltung von Benutzerprofilen</li>
            <li>Die Verwaltung von Gruppenmitgliedschaften</li>
            <li>Die Beantragung von Benutzerkonten</li>
          </ul>

          <h2>3. Erhobene Daten</h2>

          <h3>3.1 Benutzerkonten</h3>
          <p>Bei der Nutzung dieser Anwendung werden folgende personenbezogene Daten verarbeitet:</p>
          <ul>
            <li>
              <strong>IPA-Nutzer:</strong> Benutzername (UID), Vorname, Nachname, Anzeigename, E-Mail-Adresse, Telefonnummer (optional),
              Gruppenmitgliedschaften
            </li>
            <li>
              <strong>Gast-Nutzer:</strong> E-Mail-Adresse, Anzeigename (optional)
            </li>
          </ul>
          <p>
            Die Daten von IPA-Nutzern werden aus dem zentralen FreeIPA-Verzeichnisdienst synchronisiert. Die Rechtsgrundlage ist die
            Erfüllung der Nutzungsvereinbarung gemäß der Benutzungsordnung (Art. 6 Abs. 1 lit. b DSGVO).
          </p>

          <h3>3.2 Account-Anfragen</h3>
          <p>
            Gast-Nutzer können ein Benutzerkonto beantragen. Dabei werden zusätzlich zu den vorhandenen Daten folgende Informationen
            erhoben:
          </p>
          <ul>
            <li>Vorname, Nachname</li>
            <li>Anzeigename, Telefonnummer (optional)</li>
            <li>Begründung für den Account-Antrag</li>
            <li>Zustimmung zur Benutzungsordnung</li>
          </ul>

          <h3>3.3 Technische Daten</h3>
          <p>Bei der Nutzung der Anwendung werden automatisch folgende technische Daten erfasst:</p>
          <ul>
            <li>IP-Adresse (für Sicherheitszwecke und Fehleranalyse)</li>
            <li>Zeitpunkt der Zugriffe</li>
            <li>Anmeldezeitpunkte</li>
          </ul>

          <h2>4. Cookies</h2>
          <p>Diese Anwendung verwendet ausschließlich technisch notwendige Cookies, wie unter anderem:</p>
          <ul>
            <li>
              <strong>session_token:</strong> Authentifizierungs-Cookie für die Anmeldung. Enthält eine Session-ID zur Identifizierung des
              angemeldeten Nutzers. Wird beim Abmelden oder nach Ablauf der Session automatisch gelöscht.
            </li>
            <li>
              <strong>theme:</strong> Speichert die Präferenz für das Hell/Dunkel-Design (optional, nur wenn manuell geändert).
            </li>
          </ul>
          <p>
            Es werden <strong>keine</strong> Tracking-Cookies, Werbe-Cookies oder Cookies von Drittanbietern verwendet.
          </p>

          <h2>5. E-Mail-Versand</h2>
          <p>Die Anwendung versendet E-Mails in folgenden Fällen:</p>
          <ul>
            <li>
              <strong>Login-Token:</strong> Bei der Anmeldung als Gast-Nutzer wird ein einmaliger Login-Link per E-Mail versendet.
            </li>
            <li>
              <strong>Account-Erstellung:</strong> Bei Erstellung eines neuen Benutzerkontos werden die Zugangsdaten per E-Mail versendet.
            </li>
            <li>
              <strong>Benachrichtigungen:</strong> Administratoren können System-Benachrichtigungen versenden.
            </li>
          </ul>

          <h2>6. Datenspeicherung</h2>
          <p>
            <strong>Session-Daten:</strong> Werden in Redis gespeichert und nach Ablauf der Session (konfigurierbare Dauer, standardmäßig
            einige Stunden) automatisch gelöscht.
          </p>
          <p>
            <strong>Benutzerdaten:</strong> Werden in einer PostgreSQL-Datenbank gespeichert. IPA-Nutzerdaten werden regelmäßig mit dem
            FreeIPA-Server synchronisiert.
          </p>
          <p>
            <strong>Löschung:</strong> Gemäß der Benutzungsordnung werden personenbezogene Daten nach Erlöschen der Nutzungsberechtigung
            anonymisiert oder gelöscht.
          </p>

          <h2>7. Externe Dienste</h2>
          <p>
            Diese Anwendung verwendet <strong>keine</strong> externen Tracking-Dienste, Analytics-Tools, Social Media Plugins oder
            Werbenetzwerke. Alle Ressourcen (Schriftarten, Icons, Stylesheets) werden lokal bereitgestellt.
          </p>
          <p>Die einzige externe Verbindung besteht zum FreeIPA-Server für die Authentifizierung und Synchronisation von Nutzerdaten.</p>

          <h2>8. Ihre Rechte</h2>
          <p>Sie haben folgende Rechte bezüglich Ihrer personenbezogenen Daten:</p>
          <ul>
            <li>
              <strong>Auskunft (Art. 15 DSGVO):</strong> Sie können Auskunft über die zu Ihrer Person gespeicherten Daten verlangen.
            </li>
            <li>
              <strong>Berichtigung (Art. 16 DSGVO):</strong> Sie können die Berichtigung unrichtiger Daten verlangen. Profildaten können Sie
              teilweise selbst in der Anwendung ändern.
            </li>
            <li>
              <strong>Löschung (Art. 17 DSGVO):</strong> Sie können die Löschung Ihrer Daten verlangen, sofern keine gesetzlichen
              Aufbewahrungspflichten entgegenstehen.
            </li>
            <li>
              <strong>Einschränkung (Art. 18 DSGVO):</strong> Sie können die Einschränkung der Verarbeitung verlangen.
            </li>
            <li>
              <strong>Widerspruch (Art. 21 DSGVO):</strong> Sie können der Verarbeitung Ihrer Daten widersprechen.
            </li>
            <li>
              <strong>Datenübertragbarkeit (Art. 20 DSGVO):</strong> Sie können die Herausgabe Ihrer Daten in einem maschinenlesbaren Format
              verlangen.
            </li>
          </ul>
          {privacyEmail && (
            <p>
              Zur Ausübung dieser Rechte wenden Sie sich bitte an <a href={`mailto:${privacyEmail}`}>{privacyEmail}</a>.
            </p>
          )}
          <p>Sie haben zudem das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren.</p>

          <h2>9. Sicherheit</h2>
          <p>
            Diese Anwendung verwendet eine SSL/TLS-Verschlüsselung zum Schutz der Datenübertragung. Passwörter werden niemals im Klartext
            gespeichert. Session-Tokens werden kryptographisch sicher generiert.
          </p>

          <h2>10. Änderungen</h2>
          <p>
            Wir behalten uns vor, diese Datenschutzerklärung bei Bedarf anzupassen, um sie an geänderte Rechtslagen oder Funktionen der
            Anwendung anzupassen.
          </p>

          <hr class="my-8" />

          <h2>Weitere rechtliche Informationen</h2>
          <p>
            <a href="/impressum">Impressum</a>
            <br />
            <a href="/legal/agb">Benutzungsordnung</a>
          </p>
        </article>
      </div>
    </Layout>
  );
});
