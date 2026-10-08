import './Policy.css'

export default function TermsConditionsPage() {
  return (
    <main className="policy-page">
      <div className="policy-page__inner">
        <h1>Terms &amp; Conditions</h1>
        <p className="policy-page__updated">Last updated: {new Date().toLocaleDateString()}</p>

        <section>
          <h2>Acceptance</h2>
          <p>
            By accessing or using CLIRevenue, you agree to be bound by these terms. If you do not
            agree, please do not use the service.
          </p>
        </section>

        <section>
          <h2>Account Responsibilities</h2>
          <ul>
            <li>You are responsible for maintaining the confidentiality of your account credentials.</li>
            <li>You are responsible for all activity under your account.</li>
            <li>You must provide accurate account information and keep it up to date.</li>
            <li>You must notify us immediately of any unauthorized access or security breach.</li>
          </ul>
        </section>

        <section>
          <h2>Acceptable Use</h2>
          <p>You agree to use CLIRevenue only for lawful purposes and in accordance with these terms.</p>
          <ul>
            <li>Comply with all applicable laws and regulations.</li>
            <li>Respect the rights and dignity of others.</li>
            <li>Use the service in good faith and without abuse.</li>
          </ul>
        </section>

        <section>
          <h2>Prohibited Activities</h2>
          <p>The following activities are prohibited:</p>
          <ul>
            <li>Attempting to gain unauthorized access to any portion of the service.</li>
            <li>Interfering with or disrupting the integrity or performance of the service.</li>
            <li>Using the service to transmit malicious code, spam, or harmful content.</li>
            <li>Reverse engineering, scraping, or extracting data without authorization.</li>
            <li>Impersonating any person or entity, or falsely representing your affiliation.</li>
            <li>Violating the privacy or legal rights of others.</li>
          </ul>
        </section>

        <section>
          <h2>Security and Abuse</h2>
          <p>
            We take reasonable steps to protect the service from abuse. Accounts that violate
            these terms may be suspended or terminated without notice.
          </p>
        </section>

        <section>
          <h2>Publisher and Ad Functionality</h2>
          <p>
            CLIRevenue provides an advertising slot integration for CLI tools. Delivery is subject
            to inventory availability, campaign eligibility, and placement configuration.
            We do not guarantee continuous ad availability or specific revenue outcomes.
          </p>
        </section>

        <section>
          <h2>Intellectual Property</h2>
          <p>
            CLIRevenue and its original content, features, and functionality are owned by CLIRevenue
            and are protected by international copyright, trademark, and other intellectual property laws.
            Advertiser content is the property of its respective owners.
          </p>
        </section>

        <section>
          <h2>Third-Party Services</h2>
          <p>
            The service may rely on third-party infrastructure, including Supabase. We are not
            responsible for the availability, accuracy, or practices of third-party services.
          </p>
        </section>

        <section>
          <h2>Availability</h2>
          <p>
            We strive for high availability but do not guarantee uninterrupted access. The service
            is provided on an as-available basis. We may modify, suspend, or discontinue any part
            of the service at any time.
          </p>
        </section>

        <section>
          <h2>Suspension and Termination</h2>
          <p>
            We reserve the right to suspend or terminate accounts that violate these terms, pose a
            security risk, or for any other reason deemed necessary to protect the service or its users.
            Termination may result in loss of access to data associated with the account.
          </p>
        </section>

        <section>
          <h2>Disclaimer</h2>
          <p>
            THE SERVICE IS PROVIDED ON AN "AS-IS" AND "AS-AVAILABLE" BASIS. TO THE MAXIMUM EXTENT
            PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING BUT NOT
            LIMITED TO MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </p>
        </section>

        <section>
          <h2>Limitation of Liability</h2>
          <p>
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, CLIREVENUE SHALL NOT BE LIABLE FOR ANY INDIRECT,
            INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR EXEMPLARY DAMAGES, INCLUDING BUT NOT LIMITED TO
            LOSS OF PROFITS, DATA, OR GOODWILL, ARISING FROM YOUR USE OF THE SERVICE.
          </p>
        </section>

        <section>
          <h2>Indemnification</h2>
          <p>
            You agree to indemnify and hold harmless CLIRevenue from any claims, damages, losses,
            and expenses arising from your use of the service or violation of these terms.
          </p>
        </section>

        <section>
          <h2>Changes</h2>
          <p>
            We may update these terms periodically. Continued use after changes constitutes acceptance
            of the updated terms.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            For questions about these terms, contact clirevenue@gmail.com.
          </p>
        </section>
      </div>
    </main>
  )
}
