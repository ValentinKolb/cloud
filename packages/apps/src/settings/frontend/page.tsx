import { ssr } from "@valentinkolb/cloud/core/config";
import { type AuthContext } from "@valentinkolb/cloud/lib/server";
import { AdminLayout } from "@valentinkolb/cloud/core/ssr";
import SettingsForm from "./SettingsForm.island";

export default ssr<AuthContext>(async (c) => {
  return (
    <AdminLayout c={c} title="Settings">
      <div class="max-w-6xl mx-auto flex flex-col gap-6">
        <h1 class="text-xl font-bold text-primary">General Settings</h1>

        <div class="info-block-info p-4 text-xs flex items-start gap-2">
          <i class="ti ti-info-circle shrink-0 mt-0.5" />
          <div class="flex flex-col gap-2">
            <p>
              <strong>Application:</strong> Configure the public-facing identity of your app. Name, logo, and favicon appear in the browser
              tab and login page. Contact and legal information is shown in the footer and legal pages.
            </p>
            <p>
              <strong>User Management:</strong> The abbreviation length controls the length of randomly generated usernames for new
              accounts. Account expiry can be set as a fixed number of days, or to a specific date each year (useful for semester-based
              access). The buffer prevents new accounts from expiring immediately when created close to the fixed date. Email templates use
              Mustache syntax ({"{{VAR}}"} for variables, {"{{#VAR}}...{{/VAR}}"} for conditionals).
            </p>
            <p>
              <strong>Email (SMTP):</strong> Required for sending welcome emails, magic link logins, and notifications. All SMTP fields must
              be configured for email to work.
            </p>
            <p>
              <strong>Security:</strong> Rate limiting protects against brute-force attacks. The limit applies per IP address.
            </p>
          </div>
        </div>

        <SettingsForm groups={["app", "user", "email", "security"]} />
      </div>
    </AdminLayout>
  );
});
