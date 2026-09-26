import type { ReactNode } from "react";

export type LegalDocumentKind = "terms" | "privacy";

const EFFECTIVE_DATE = "September 26, 2026";
const CONTACT_EMAIL = "stallionsconstructioncompany@gmail.com";

function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function TermsContent() {
  return (
    <>
      <LegalSection title="1. Agreement to these Terms">
        <p>These Terms of Service govern your access to and use of Crewkat, including its job-management, client, estimate, invoice, document, scheduling, and Marketplace features. By creating an account, accessing Crewkat, or using the service, you agree to these Terms. If you use Crewkat for a company, you confirm that you have authority to accept these Terms for that company.</p>
        <p>You must be at least 18 years old and legally able to enter into a binding agreement. If you do not agree to these Terms, do not use Crewkat.</p>
      </LegalSection>

      <LegalSection title="2. Accounts and security">
        <p>You must provide accurate account information, keep it current, and protect your login credentials and devices. You are responsible for activity under your account and for the people you authorize to use your workspace. Tell us promptly if you believe your account has been accessed without permission.</p>
        <p>Crewkat may keep you signed in using a session that renews while the service is used. You can end the session by signing out. We may require you to sign in again to protect your account or after a period of inactivity.</p>
      </LegalSection>

      <LegalSection title="3. The service">
        <p>Crewkat provides tools for contractors and trade businesses to organize work. Features may include jobs, clients, estimates, invoices, payments recorded by the user, photos, proof packets, schedules, leads, reminders, reports, and Marketplace listings. Features may change as the product develops.</p>
        <p>Crewkat is an organizational software service. It is not a licensed contractor, employer, staffing agency, payment processor, attorney, accountant, insurer, or project supervisor. You remain responsible for your work, licenses, permits, safety, taxes, contracts, pricing, records, and compliance with applicable laws.</p>
      </LegalSection>

      <LegalSection title="4. Free and Premium plans">
        <p>Crewkat may offer a free plan with limited features or usage and a Premium plan currently priced at $19 per month. The exact features, limits, and price shown at checkout control if they differ from this summary.</p>
        <p>Paid subscriptions renew automatically for the billing period shown at checkout until canceled. You authorize Crewkat and its payment processor to charge the selected payment method, including applicable taxes. You may cancel before the next renewal to avoid future charges; cancellation takes effect at the end of the paid period. Fees already paid are nonrefundable except where required by law or expressly stated at checkout. We will give reasonable notice of a material price change before it applies to a future renewal.</p>
      </LegalSection>

      <LegalSection title="5. Marketplace">
        <p>The Crewkat Marketplace lets users post or respond to listings for work, services, equipment, rentals, or related business needs. Crewkat provides the platform but is not a party to agreements between Marketplace users. We do not guarantee a user’s identity, qualifications, licensing, insurance, availability, pricing, workmanship, payment, or performance.</p>
        <p>You are responsible for evaluating other users, confirming credentials and insurance, agreeing on terms, and complying with laws before starting work or making a payment. Listings must be accurate, lawful, and relevant to the trades. We may remove or limit listings that violate these Terms or create risk for users or the service.</p>
      </LegalSection>

      <LegalSection title="6. Your content">
        <p>You retain ownership of information and content you submit, including customer information, job details, photos, documents, messages, and Marketplace listings (“User Content”). You grant Crewkat a nonexclusive, worldwide, royalty-free license to host, process, copy, display, and transmit User Content only as needed to operate, secure, improve, and support the service.</p>
        <p>You confirm that you have the rights and permissions needed to submit User Content and to share personal information about clients, workers, or others. You are responsible for obtaining required consent and for keeping your own copies of important business records.</p>
      </LegalSection>

      <LegalSection title="7. Acceptable use">
        <p>You may not use Crewkat to:</p>
        <ul>
          <li>break the law, violate another person’s rights, or facilitate unsafe or fraudulent work;</li>
          <li>post deceptive listings, impersonate another person or business, or misrepresent credentials;</li>
          <li>harass others or upload unlawful, infringing, malicious, or abusive content;</li>
          <li>probe, disrupt, overload, reverse engineer, or bypass security or access controls;</li>
          <li>scrape the service, send spam, or use automated means except as Crewkat expressly permits; or</li>
          <li>use another person’s account without authorization.</li>
        </ul>
      </LegalSection>

      <LegalSection title="8. Third-party services">
        <p>Crewkat may connect to or rely on third-party services such as hosting, email, payment, maps, device sharing, or app-store providers. Their services and terms are separate from ours. Crewkat is not responsible for third-party services, outages, or content.</p>
      </LegalSection>

      <LegalSection title="9. Availability, changes, and beta features">
        <p>We work to keep Crewkat available, but uninterrupted or error-free operation is not guaranteed. We may add, change, suspend, or discontinue features; impose reasonable limits; or perform maintenance. Preview, beta, or pre-release features may be incomplete and may change without notice.</p>
      </LegalSection>

      <LegalSection title="10. Suspension and termination">
        <p>You may stop using Crewkat at any time. We may suspend or terminate access if you materially violate these Terms, fail to pay applicable fees, create security or legal risk, or misuse the service. Where reasonable, we will provide notice and an opportunity to resolve the issue. Sections that by their nature should survive termination will remain in effect.</p>
      </LegalSection>

      <LegalSection title="11. Disclaimers">
        <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, CREWKAT IS PROVIDED “AS IS” AND “AS AVAILABLE.” WE DISCLAIM IMPLIED WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT. CREWKAT DOES NOT GUARANTEE BUSINESS RESULTS, CUSTOMER PAYMENT, MARKETPLACE TRANSACTIONS, OR THAT GENERATED DOCUMENTS OR RECORDS SATISFY LEGAL, TAX, ACCOUNTING, LICENSING, OR INSURANCE REQUIREMENTS.</p>
      </LegalSection>

      <LegalSection title="12. Limitation of liability">
        <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, CREWKAT AND ITS OPERATORS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA, GOODWILL, OR BUSINESS OPPORTUNITIES. OUR TOTAL LIABILITY FOR CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE GREATER OF $100 OR THE AMOUNT YOU PAID TO CREWKAT DURING THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM. Some jurisdictions do not allow certain limitations, so some of these limits may not apply to you.</p>
      </LegalSection>

      <LegalSection title="13. Indemnity">
        <p>To the extent permitted by law, you agree to defend and indemnify Crewkat and its operators from claims, losses, and expenses arising from your User Content, your work or Marketplace transactions, your violation of these Terms, or your violation of another person’s rights.</p>
      </LegalSection>

      <LegalSection title="14. Changes to these Terms">
        <p>We may update these Terms as the service changes. We will post the updated version with a new effective date and provide additional notice when required by law. Continued use after an update takes effect means you accept the revised Terms.</p>
      </LegalSection>

      <LegalSection title="15. Contact">
        <p>Questions about these Terms may be sent to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </LegalSection>
    </>
  );
}

function PrivacyContent() {
  return (
    <>
      <LegalSection title="1. Scope">
        <p>This Privacy Policy explains how Crewkat collects, uses, shares, and protects information when you use the Crewkat app, website, accounts, job-management tools, and Marketplace. It applies to account holders and people who interact with content or links created through Crewkat.</p>
      </LegalSection>

      <LegalSection title="2. Information we collect">
        <h3>Information you provide</h3>
        <ul>
          <li>Account details, such as your name, email address, company, and login credentials.</li>
          <li>Business records you enter, such as client information, job details, estimates, invoices, payments, schedules, notes, expenses, and crew information.</li>
          <li>Content you upload or create, including photos, documents, signatures, messages, and Marketplace listings.</li>
          <li>Support requests, feedback, and other communications with Crewkat.</li>
          <li>Subscription and billing details. Payment card information may be collected directly by a payment processor rather than stored by Crewkat.</li>
        </ul>
        <h3>Information collected automatically</h3>
        <ul>
          <li>Device, browser, app version, and general technical information.</li>
          <li>Usage information, such as features used, actions taken, and approximate timestamps.</li>
          <li>Security and diagnostic information, including session activity, error logs, and abuse-prevention signals.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. How we use information">
        <p>We use information to provide and maintain Crewkat; authenticate accounts; save and organize your business records; create documents and links you request; operate Marketplace and messaging features; process subscriptions; provide support; prevent fraud and abuse; diagnose problems; improve the service; and comply with legal obligations.</p>
      </LegalSection>

      <LegalSection title="4. How information is shared">
        <p>We may share information:</p>
        <ul>
          <li>with people you direct us to share it with, including clients, crew members, or Marketplace users;</li>
          <li>with service providers that help us host, secure, support, email, analyze, or process payments for the service, subject to appropriate contractual obligations;</li>
          <li>to comply with law, legal process, or valid government requests;</li>
          <li>to protect users, Crewkat, or the public from fraud, abuse, security threats, or harm; or</li>
          <li>in connection with a merger, financing, acquisition, reorganization, or sale of assets, subject to applicable law.</li>
        </ul>
        <p>Marketplace listings and profile information you choose to publish may be visible to other users. Shared document or client links may be viewed by anyone who has the link until it expires or is revoked. Crewkat does not sell personal information.</p>
      </LegalSection>

      <LegalSection title="5. Data storage, security, and sessions">
        <p>Crewkat stores account and business information on systems used to operate the service. We use reasonable administrative, technical, and organizational safeguards designed to protect information. No storage or transmission method is completely secure, and we cannot guarantee absolute security.</p>
        <p>To keep you signed in, Crewkat may store a session token on your device. Sessions may remain active for about 30 days and renew while you use the app. Signing out removes the saved session from that device and revokes it on the service.</p>
      </LegalSection>

      <LegalSection title="6. Retention">
        <p>We retain information while your account is active and as reasonably necessary to provide the service, meet legal or accounting obligations, resolve disputes, enforce agreements, prevent abuse, and maintain backups. Retention periods vary by the type of information and why it is kept.</p>
      </LegalSection>

      <LegalSection title="7. Your choices and rights">
        <p>You may update many account and business details in Crewkat, remove content where the feature permits, sign out of devices, and cancel a paid plan. You may also contact us to request access, correction, deletion, or a copy of your personal information. We may need to verify your identity and may retain information when law or legitimate operational needs permit.</p>
        <p>Depending on where you live, you may have additional privacy rights, including the right to object to or limit certain processing and to appeal a privacy request decision. We will not discriminate against you for exercising applicable privacy rights.</p>
      </LegalSection>

      <LegalSection title="8. Children’s privacy">
        <p>Crewkat is intended for business users age 18 and older. We do not knowingly collect personal information from children under 13. If you believe a child provided personal information to Crewkat, contact us so we can review and delete it where appropriate.</p>
      </LegalSection>

      <LegalSection title="9. International use">
        <p>If you access Crewkat from outside the country where its systems or service providers operate, your information may be processed in another country with different data-protection laws. We apply this Policy to information covered by it regardless of processing location.</p>
      </LegalSection>

      <LegalSection title="10. Changes to this Policy">
        <p>We may update this Privacy Policy as Crewkat changes. We will post the revised version with a new effective date and provide additional notice when required by law.</p>
      </LegalSection>

      <LegalSection title="11. Contact">
        <p>Privacy questions or requests may be sent to <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </LegalSection>
    </>
  );
}

export function LegalDocumentPage({ kind, onBack }: { kind: LegalDocumentKind; onBack: () => void }) {
  const isTerms = kind === "terms";
  return (
    <main className="page legal-page">
      <header className="app-header legal-header">
        <div className="header-side">
          <button type="button" className="icon-button" onClick={onBack} aria-label="Back">
            <BackArrow />
          </button>
        </div>
        <h1>{isTerms ? "Terms of Service" : "Privacy Policy"}</h1>
        <div className="header-actions" />
      </header>
      <article className="legal-document">
        <p className="legal-effective"><strong>Effective:</strong> {EFFECTIVE_DATE}</p>
        <p className="legal-intro">{isTerms ? "Please read these terms carefully before using Crewkat." : "Your business records may include information about clients, workers, and projects. This policy explains how that information is handled."}</p>
        {isTerms ? <TermsContent /> : <PrivacyContent />}
      </article>
    </main>
  );
}
