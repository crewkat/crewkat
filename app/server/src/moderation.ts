// Automatic text moderation for Marketplace listings.
//
// Pure function: scans listing text against a curated, word-boundary blocklist
// in three categories (explicit content, illegal goods/services, threats/hate).
// The list is deliberately tight — legitimate trade vocabulary ("screwdriver",
// "nail gun", "drill", "screws", "nails", "caulk", "blowtorch", "pipe", ...)
// must never match, so every pattern uses \b boundaries and avoids terms that
// collide with trade language (e.g. "gun" alone is NOT blocked because of
// "nail gun"; "crack" is NOT blocked because of "concrete crack repair").

export interface ListingTextInput {
  title: string;
  description: string;
  companyName: string;
  serviceArea: string;
}

export interface ListingScanResult {
  clean: boolean;
  reasons: string[];
}

interface BlockedPattern {
  pattern: RegExp;
  reason: string;
}

const REASON_EXPLICIT = "Explicit or adult content";
const REASON_ILLEGAL = "Illegal goods or services";
const REASON_THREAT = "Threats or hate speech";

const BLOCKED: BlockedPattern[] = [
  // (a) Explicit sexual content
  { pattern: /\bporn\b/, reason: REASON_EXPLICIT },
  { pattern: /\bporno\b/, reason: REASON_EXPLICIT },
  { pattern: /\bxxx\b/, reason: REASON_EXPLICIT },
  { pattern: /\bescort\b/, reason: REASON_EXPLICIT },
  { pattern: /\bescorts\b/, reason: REASON_EXPLICIT },
  { pattern: /\bprostitute\b/, reason: REASON_EXPLICIT },
  { pattern: /\bprostitution\b/, reason: REASON_EXPLICIT },
  { pattern: /\bonlyfans\b/, reason: REASON_EXPLICIT },
  { pattern: /\badult entertainment\b/, reason: REASON_EXPLICIT },
  { pattern: /\badult services\b/, reason: REASON_EXPLICIT },
  { pattern: /\bsex chat\b/, reason: REASON_EXPLICIT },
  { pattern: /\bhappy ending\b/, reason: REASON_EXPLICIT },

  // (b) Illegal goods/services: drugs
  { pattern: /\bcocaine\b/, reason: REASON_ILLEGAL },
  { pattern: /\bcoke dealer\b/, reason: REASON_ILLEGAL },
  { pattern: /\bheroin\b/, reason: REASON_ILLEGAL },
  { pattern: /\bfentanyl\b/, reason: REASON_ILLEGAL },
  { pattern: /\bmethamphetamine\b/, reason: REASON_ILLEGAL },
  { pattern: /\bcrystal meth\b/, reason: REASON_ILLEGAL },
  { pattern: /\boxycodone\b/, reason: REASON_ILLEGAL },
  { pattern: /\bxanax\b/, reason: REASON_ILLEGAL },
  { pattern: /\becstasy\b/, reason: REASON_ILLEGAL },
  { pattern: /\blsd\b/, reason: REASON_ILLEGAL },

  // (b) Illegal goods/services: weapons (never bare "gun" — nail guns are legit)
  { pattern: /\bghost gun\b/, reason: REASON_ILLEGAL },
  { pattern: /\bpistol\b/, reason: REASON_ILLEGAL },
  { pattern: /\bhandgun\b/, reason: REASON_ILLEGAL },
  { pattern: /\brifle\b/, reason: REASON_ILLEGAL },
  { pattern: /\bshotgun\b/, reason: REASON_ILLEGAL },
  { pattern: /\bammunition\b/, reason: REASON_ILLEGAL },
  { pattern: /\bsilencer\b/, reason: REASON_ILLEGAL },

  // (b) Illegal goods/services: counterfeit, fraud, scams
  { pattern: /\bcounterfeit\b/, reason: REASON_ILLEGAL },
  { pattern: /\bfake id\b/, reason: REASON_ILLEGAL },
  { pattern: /\bfake passport\b/, reason: REASON_ILLEGAL },
  { pattern: /\bstolen goods\b/, reason: REASON_ILLEGAL },
  { pattern: /\bmoney flipping\b/, reason: REASON_ILLEGAL },
  { pattern: /\bflip money\b/, reason: REASON_ILLEGAL },
  { pattern: /\bcash flipping\b/, reason: REASON_ILLEGAL },
  { pattern: /\bdouble your money\b/, reason: REASON_ILLEGAL },
  { pattern: /\bpyramid scheme\b/, reason: REASON_ILLEGAL },
  { pattern: /\bponzi\b/, reason: REASON_ILLEGAL },

  // (c) Threats / hate (phrase-based to avoid false positives)
  { pattern: /\bkill you\b/, reason: REASON_THREAT },
  { pattern: /\bi will kill\b/, reason: REASON_THREAT },
  { pattern: /\bill kill you\b/, reason: REASON_THREAT },
  { pattern: /\bdeath threat\b/, reason: REASON_THREAT },
  { pattern: /\bbomb threat\b/, reason: REASON_THREAT },
  { pattern: /\bshoot you\b/, reason: REASON_THREAT },
  { pattern: /\bkill all\b/, reason: REASON_THREAT },
  { pattern: /\bwhite power\b/, reason: REASON_THREAT },
];

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function scanListingText(input: ListingTextInput): ListingScanResult {
  const haystack = normalizeText(
    [input.title, input.description, input.companyName, input.serviceArea].join("\n")
  );
  const reasons: string[] = [];
  for (const { pattern, reason } of BLOCKED) {
    if (pattern.test(haystack) && !reasons.includes(reason)) reasons.push(reason);
  }
  return { clean: reasons.length === 0, reasons };
}
