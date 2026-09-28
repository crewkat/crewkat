// Marketplace Terms of Use — single source of truth shared by the server
// (sign-up acceptance, version checks) and the client (sign-up checkbox,
// acceptance gate, and the in-app Marketplace Terms page). This file has no
// runtime dependencies so it is safe to bundle into the client.
export const MARKETPLACE_TERMS_VERSION = "1.0";
export const MARKETPLACE_TERMS_EFFECTIVE_DATE = "September 28, 2026";

export interface MarketplaceTermsSection {
  heading: string;
  paragraphs: string[];
}

export const MARKETPLACE_TERMS_SECTIONS: MarketplaceTermsSection[] = [
  {
    heading: "1. What the Marketplace is",
    paragraphs: [
      "The Crewkat Marketplace lets trade businesses post and respond to listings for work, services, equipment, rentals, and related business needs. Crewkat provides the platform only. Crewkat is not a party to any agreement, job, sale, or hire arranged between Marketplace users.",
      "We do not guarantee any user's identity, qualifications, licensing, insurance, availability, pricing, workmanship, payment, or performance. You are responsible for evaluating the people you do business with: confirm credentials and insurance, agree on terms in writing, and follow all applicable laws before starting work or sending money.",
    ],
  },
  {
    heading: "2. Prohibited content",
    paragraphs: [
      "You may not post, send, or solicit any of the following in listings or Marketplace messages:",
      "Sexually explicit material or offers of sexual services.",
      "Illegal goods or services, including drugs, weapons, counterfeit goods, and stolen property.",
      "Fraud or scam schemes, including money flipping, advance-fee offers, phishing, fake checks, and impersonation of another person or business.",
      "Threats, hate speech, harassment, or content that targets someone with abuse.",
      "Spam or duplicate listings posted to flood search results or inboxes.",
      "Materially misleading listings, including fake or stolen photos, false credentials or licenses, bait pricing that changes after contact, and work you are not qualified or licensed to perform.",
    ],
  },
  {
    heading: "3. Posting rules",
    paragraphs: [
      "List only your own business, services, equipment, or genuine business needs. Do not post on behalf of someone else without their clear permission.",
      "Titles, descriptions, pricing, availability, and service areas must be accurate and kept up to date. If details change, update or remove the listing.",
      "Do not harvest other users' names, phone numbers, or email addresses from listings or messages for marketing, spam, or resale.",
      "Keep message threads on-topic and professional. Negotiate honestly and honor the terms you agree to.",
    ],
  },
  {
    heading: "4. Screening and reporting",
    paragraphs: [
      "Listings and messages may be automatically screened for prohibited content. Screening is automated and imperfect: a clean scan does not mean content is safe or lawful, and a flagged listing is not a legal judgment.",
      "Any user can report a listing they believe violates these terms. Reports are reviewed by the Crewkat team. Filing false or abusive reports is itself a violation.",
    ],
  },
  {
    heading: "5. Consequences",
    paragraphs: [
      "Violations are handled on an escalating basis:",
      "Automated rejection: listings caught by screening are rejected and hidden from the public Marketplace until reviewed.",
      "Removal: listings found in violation after review are removed.",
      "Temporary suspension: accounts may be suspended for serious or repeated violations.",
      "Permanent revocation: repeat offenders, or severe single violations such as fraud, threats, or illegal goods, will have their account access permanently revoked.",
      "Illegal content or conduct may be reported to law enforcement.",
    ],
  },
  {
    heading: "6. Changes to these terms",
    paragraphs: [
      "These terms carry a version number. If the terms change materially, the version number will increase and you will be asked to accept the new version before continuing to use Crewkat. Continued use after accepting a new version means you agree to it.",
    ],
  },
];

export const MARKETPLACE_TERMS_TEXT: string = MARKETPLACE_TERMS_SECTIONS.map(
  (section) => `${section.heading}\n${section.paragraphs.join("\n")}`,
).join("\n\n");
