import './Policy.css'

export default function PrivacyPolicyPage() {
  return (
    <main className="policy-page">
      <div className="policy-page__inner">
        <h1>Privacy Policy</h1>
        <p className="policy-page__updated">Last updated: {new Date().toLocaleDateString()}</p>

        <section>
          <h2>Information We Collect</h2>
          <p>
            CLIRevenue collects information necessary to provide, secure, maintain, and improve the service.
            This includes:
          </p>
          <ul>
            <li><strong>Account information.</strong> Email, role, and profile fields you provide during signup.</li>
            <li><strong>Authentication data.</strong> Session tokens managed through Supabase Auth.</li>
            <li><strong>Publisher and placement data.</strong> Information required to configure ad delivery.</li>
            <li><strong>Ad delivery logs.</strong> Impression, click, and serve events needed for measurement and fraud prevention.</li>
            <li><strong>Contact submissions.</strong> Messages sent through the public contact form.</li>
            <li><strong>Usage data.</strong> SDK version, placement identifiers, and delivery outcomes.</li>
          </ul>
        </section>

        <section>
          <h2>How We Use Information</h2>
          <ul>
            <li>Provide and operate the advertising platform.</li>
            <li>Authenticate users and enforce role-based access.</li>
            <li>Measure impressions, clicks, and conversions.</li>
            <li>Detect and prevent abuse, fraud, and security incidents.</li>
            <li>Improve delivery reliability and SDK performance.</li>
            <li>Respond to support requests and contact submissions.</li>
          </ul>
        </section>

        <section>
          <h2>Data Minimization</h2>
          <p>
            CLIRevenue is designed to minimize the information it collects and retains. We seek to process
            only information reasonably necessary to provide, secure, maintain, and improve the service.
            Where possible, identifiers are scoped to specific functions and retained only as long as needed
            for operational and legal purposes.
          </p>
        </section>

        <section>
          <h2>Authentication and Sessions</h2>
          <p>
            CLIRevenue uses Supabase Auth for authentication. Sessions are managed via secure tokens.
            No passwords or secret credentials are stored in the browser bundle.
          </p>
        </section>

        <section>
          <h2>Security and Logging</h2>
          <p>
            We implement reasonable technical measures to protect data. Server-side logs may record
            request metadata, error conditions, and operational events necessary for debugging and
            security. These logs are not designed to collect personal information beyond what is
            required for operation.
          </p>
        </section>

        <section>
          <h2>Third-Party Infrastructure</h2>
          <p>
            CLIRevenue relies on Supabase for authentication, database, and edge function hosting.
            Data processed by these providers is subject to their respective privacy and security
            policies.
          </p>
        </section>

        <section>
          <h2>Data Retention</h2>
          <p>
            Retention periods vary by data type. Operational logs are retained for a period necessary
            to maintain service integrity and comply with legal obligations. Account data persists
            until deletion is requested or the account is removed.
          </p>
        </section>

        <section>
          <h2>Your Rights and Choices</h2>
          <ul>
            <li>You may update account information through your dashboard.</li>
            <li>You may request account deletion by contacting clirevenue@gmail.com.</li>
            <li>You may decline to provide optional profile fields.</li>
          </ul>
        </section>

        <section>
          <h2>Children's Privacy</h2>
          <p>
            CLIRevenue is not directed at children under the age of 13. We do not knowingly collect
            personal information from children.
          </p>
        </section>

        <section>
          <h2>Changes to This Policy</h2>
          <p>
            We may update this policy from time to time. Continued use of the service following
            changes constitutes acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            For privacy inquiries, contact clirevenue@gmail.com.
          </p>
        </section>
      </div>
    </main>
  )
}
