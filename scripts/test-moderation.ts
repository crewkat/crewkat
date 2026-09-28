// Unit test for scanListingText — run with: bun scripts/test-moderation.ts
import { scanListingText } from "../app/server/src/moderation";

const CLEAN: Array<[string, { title: string; description: string; companyName: string; serviceArea: string }]> = [
  ["kitchen remodel", { title: "Kitchen remodel", description: "Kitchen remodel with new screws, nails, and caulk. Licensed and insured.", companyName: "Stallions Construction", serviceArea: "Tampa Bay" }],
  ["nail gun and drill work", { title: "Framing crew", description: "Nail gun and drill work, screwdriver sets on every truck.", companyName: "Pro Framing LLC", serviceArea: "Pasco County" }],
  ["blowtorch and pipe", { title: "Plumbing repairs", description: "We sweat copper pipe with a blowtorch and pressure-test every joint.", companyName: "FlowRight Plumbing", serviceArea: "Clearwater" }],
  ["concrete crack repair", { title: "Concrete crack repair", description: "We fix cracked driveways and seal expansion joints.", companyName: "Solid Slab Co", serviceArea: "Dunedin" }],
  ["weed-adjacent landscaping", { title: "Lawn care", description: "Weekly mowing, weed removal, and hedge trimming.", companyName: "GreenCut", serviceArea: "Trinity" }],
];

const FLAGGED: Array<[string, { title: string; description: string; companyName: string; serviceArea: string }, string[]]> = [
  ["explicit escort", { title: "Companionship", description: "Discreet escort services available nightly, call now.", companyName: "Night Moves", serviceArea: "Tampa" }, ["Explicit or adult content"]],
  ["drug sale", { title: "Cheap supplies", description: "Cocaine and xanax for sale, bulk discounts.", companyName: "Quick Supply", serviceArea: "Tampa" }, ["Illegal goods or services"]],
  ["weapons", { title: "Protection", description: "Ghost gun and pistol sales, no questions asked.", companyName: "Second Amendment", serviceArea: "Florida" }, ["Illegal goods or services"]],
  ["money flipping scam", { title: "Invest with me", description: "Money flipping — double your money in 24 hours guaranteed!", companyName: "Fast Cash", serviceArea: "Online" }, ["Illegal goods or services"]],
  ["threat", { title: "Roofing", description: "Pay up or I will kill you. Best prices in town.", companyName: "Tough Roofers", serviceArea: "Tampa" }, ["Threats or hate speech"]],
  ["xxx", { title: "XXX videos", description: "Kitchen remodels done right.", companyName: "Remodel Pro", serviceArea: "Tampa" }, ["Explicit or adult content"]],
];

let failures = 0;
for (const [name, input] of CLEAN) {
  const result = scanListingText(input);
  if (!result.clean) { console.error(`FAIL (should be clean): ${name} -> ${result.reasons.join("; ")}`); failures++; }
  else console.log(`ok (clean): ${name}`);
}
for (const [name, input, expected] of FLAGGED) {
  const result = scanListingText(input);
  const missing = expected.filter((r) => !result.reasons.includes(r));
  if (result.clean || missing.length) { console.error(`FAIL (should flag): ${name} -> clean=${result.clean} reasons=[${result.reasons.join("; ")}]`); failures++; }
  else console.log(`ok (flagged): ${name} -> ${result.reasons.join("; ")}`);
}
if (failures) { console.error(`${failures} FAILURES`); process.exit(1); }
console.log("All moderation tests passed.");
