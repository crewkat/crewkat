// AI prompts (0098, first AI hookup, Danny 2026-11-01): every prompt
// Crewkat sends to the AI provider lives in this one module, in EN +
// ES variants (EN/ES parity is Crewkat's wedge). The privileged
// aiComplete op is a dumb transport (system + user in, text out); all
// wording decisions live here.
//
// HARD RULES baked into both system prompts:
//   - Use ONLY facts the user supplied (their brief / their draft).
//     Never invent discounts, prices, dates, deadlines, ratings,
//     review counts, guarantees, licenses, or services.
//   - An offer stated in the brief may be featured exactly as stated —
//     numbers and terms never change.
//   - Summaries: same work items, same order — cleaner prose only.
//     Nothing added, nothing dropped.
//   - Voice: professional, plain, contractor-friendly. No hype.

export type AiLang = "en" | "es";
export type AiAudience = "individual" | "never_closed" | "all";

const AUDIENCE_TEXT: Record<AiLang, Record<AiAudience, string>> = {
  en: {
    individual: "a hand-picked list of the company's past clients",
    never_closed: "past clients who received an estimate from this company but never booked the work — this is a friendly win-back message",
    all: "the company's past clients",
  },
  es: {
    individual: "una lista de clientes anteriores de la empresa, elegidos a mano",
    never_closed: "clientes anteriores que recibieron un estimado de esta empresa pero nunca contrataron el trabajo — es un mensaje amable para recuperarlos",
    all: "los clientes anteriores de la empresa",
  },
};

const PROMO_SYSTEM: Record<AiLang, string> = {
  en: [
    "You write marketing emails for a small local contractor (home remodeling and construction services).",
    "Rules you must follow:",
    "- Use ONLY the facts in the contractor's brief and the company details provided. Never invent discounts, prices, dates, deadlines, ratings, review counts, guarantees, licenses, or services that are not stated.",
    "- If the brief states an offer (for example a percentage off, or financing), feature it exactly as stated — do not change the numbers and do not add conditions.",
    "- Write in a professional, plain, friendly tone. No hype, no pressure tactics, no exclamation spam.",
    "- Write in English.",
    "- Return ONLY a JSON object with exactly these keys: \"subject\", \"headline\", \"body\". No markdown fences, no extra text.",
    "- The body is plain text, 120 to 220 words, paragraphs separated by blank lines.",
  ].join("\n"),
  es: [
    "Redactas correos de marketing para un contratista local pequeño (remodelación y construcción de viviendas).",
    "Reglas que debes seguir:",
    "- Usa SOLO los datos del texto del contratista y los datos de la empresa indicados. Nunca inventes descuentos, precios, fechas, plazos, calificaciones, cantidades de reseñas, garantías, licencias ni servicios que no estén indicados.",
    "- Si el texto indica una oferta (por ejemplo un porcentaje de descuento o financiamiento), preséntala exactamente como está escrita — no cambies los números ni agregues condiciones.",
    "- Escribe con un tono profesional, sencillo y amable. Sin exageraciones, sin tácticas de presión, sin exceso de signos de exclamación.",
    "- Escribe en español, con un español comercial natural y correcto.",
    "- Devuelve SOLO un objeto JSON con exactamente estas claves: \"subject\", \"headline\", \"body\". Sin bloques de código markdown, sin texto adicional.",
    "- El cuerpo es texto plano, de 120 a 220 palabras, con párrafos separados por líneas en blanco.",
  ].join("\n"),
};

export function buildPromoAiPrompt(args: {
  lang: AiLang;
  type: "promotion" | "blog";
  brief: string;
  audience: AiAudience;
  companyName: string;
  phone: string;
  website: string;
  serviceArea: string;
}): { system: string; user: string } {
  const company = args.companyName.trim() || (args.lang === "es" ? "la empresa" : "the company");
  const details = [
    `${args.lang === "es" ? "Empresa" : "Company"}: ${company}`,
    args.serviceArea.trim() ? `${args.lang === "es" ? "Área de servicio" : "Service area"}: ${args.serviceArea.trim()}` : "",
    args.phone.trim() ? `${args.lang === "es" ? "Teléfono" : "Phone"}: ${args.phone.trim()}` : "",
    args.website.trim() ? `${args.lang === "es" ? "Sitio web" : "Website"}: ${args.website.trim()}` : "",
  ].filter(Boolean).join("\n");
  const user = args.lang === "es"
    ? [
        `Tipo de campaña: ${args.type === "blog" ? "artículo informativo (blog)" : "promoción"}`,
        `Audiencia: ${AUDIENCE_TEXT.es[args.audience]}`,
        details,
        "",
        "Texto del contratista (la única fuente de ofertas y datos):",
        `"""${args.brief.trim()}"""`,
        "",
        "Escribe el correo ahora.",
      ].join("\n")
    : [
        `Campaign type: ${args.type === "blog" ? "blog-style update" : "promotion"}`,
        `Audience: ${AUDIENCE_TEXT.en[args.audience]}`,
        details,
        "",
        "The contractor's brief (the only source of offers and facts):",
        `"""${args.brief.trim()}"""`,
        "",
        "Write the email now.",
      ].join("\n");
  return { system: PROMO_SYSTEM[args.lang], user };
}

/** Parse the model's promo reply. The prompt asks for a JSON object;
 * parsing is defensive — a malformed reply degrades to subject = first
 * line, body = the rest, never a throw. */
export function parseAiPromoContent(text: string): { subject: string; headline: string; bodyText: string } {
  const trimmed = text.trim();
  const jsonStart = trimmed.indexOf("{");
  const jsonEnd = trimmed.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1)) as { subject?: unknown; headline?: unknown; body?: unknown };
      const subject = typeof parsed.subject === "string" ? parsed.subject.trim() : "";
      const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "";
      const bodyText = typeof parsed.body === "string" ? parsed.body.trim() : "";
      if (subject || bodyText) return { subject, headline, bodyText };
    } catch { /* fall through to the plain-text shape */ }
  }
  const lines = trimmed.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const subject = lines[0] ?? "";
  return { subject, headline: subject, bodyText: lines.slice(1).join("\n\n") || trimmed };
}

const SUMMARY_SYSTEM: Record<AiLang, string> = {
  en: [
    "You polish work summaries that a contractor sends to their client about a job in progress.",
    "Rules you must follow:",
    "- Rewrite the draft into clean, client-friendly prose with the SAME facts and the SAME work items, in the same order. Never add work, materials, dates, people, or results that are not in the draft, and never drop any work item.",
    "- Fix spelling, grammar and rambling run-ons. Keep it factual and concise — plain professional tone, no marketing hype.",
    "- Keep the paragraph structure of the draft (one paragraph per day or note), paragraphs separated by blank lines.",
    "- Write in English.",
    "- Return ONLY the polished text — no preamble, no quotes, no notes about the edit.",
  ].join("\n"),
  es: [
    "Pules resúmenes de trabajo que un contratista envía a su cliente sobre una obra en curso.",
    "Reglas que debes seguir:",
    "- Reescribe el borrador en una prosa limpia y clara para el cliente, con los MISMOS datos y las MISMAS partidas de trabajo, en el mismo orden. Nunca agregues trabajos, materiales, fechas, personas ni resultados que no estén en el borrador, y nunca omitas ninguna partida.",
    "- Corrige la ortografía, la gramática y las frases largas o confusas. Mantén un tono factual y conciso — profesional y sencillo, sin exageraciones de marketing.",
    "- Conserva la estructura de párrafos del borrador (un párrafo por día o nota), con párrafos separados por líneas en blanco.",
    "- Escribe en español, con un español comercial natural y correcto.",
    "- Devuelve SOLO el texto pulido — sin introducción, sin comillas, sin notas sobre la edición.",
  ].join("\n"),
};

export function buildSummaryPolishAiPrompt(args: {
  lang: AiLang;
  jobType: string;
  clientName: string;
  rangeStart: string;
  rangeEnd: string;
  text: string;
}): { system: string; user: string } {
  const range = args.rangeStart && args.rangeEnd
    ? (args.lang === "es" ? ` (${args.rangeStart} a ${args.rangeEnd})` : ` (${args.rangeStart} to ${args.rangeEnd})`)
    : "";
  const user = args.lang === "es"
    ? [
        `Trabajo: ${args.jobType || "Proyecto"}${args.clientName ? ` para ${args.clientName}` : ""}${range}`,
        "",
        "Borrador:",
        `"""${args.text.trim()}"""`,
        "",
        "Devuelve el texto pulido ahora.",
      ].join("\n")
    : [
        `Job: ${args.jobType || "Project"}${args.clientName ? ` for ${args.clientName}` : ""}${range}`,
        "",
        "Draft:",
        `"""${args.text.trim()}"""`,
        "",
        "Return the polished text now.",
      ].join("\n");
  return { system: SUMMARY_SYSTEM[args.lang], user };
}

// ---------------------------------------------------------------------------
// Weekly client update (Batch 5 #7 — Buildertrend's AI Client Updates
// shape: one week back, one week forward). The TEMPLATE below is the
// feature: it assembles the draft from the job's real week with no AI
// involved. When the AI hookup is live, the prompt at the bottom asks
// the provider to polish the template — same facts, same order, same
// two-part structure, cleaner prose only (the summary rules above).
// ---------------------------------------------------------------------------

export type WeeklyUpdateFacts = {
  lang: AiLang;
  clientName: string;
  jobType: string;
  companyName: string;
  /** Work lines from the past 7 days (daily logs + sent updates). */
  doneLines: string[];
  /** Progress photos added in the past 7 days. */
  photoCount: number;
  /** Upcoming appointments in the next 7 days, pre-formatted lines. */
  upcomingLines: string[];
};

export function buildWeeklyUpdateTemplate(facts: WeeklyUpdateFacts): string {
  const es = facts.lang === "es";
  const lines: string[] = [];
  lines.push(es ? `Hola ${facts.clientName || "qué tal"},` : `Hi ${facts.clientName || "there"},`);
  lines.push("");
  lines.push(es
    ? `Aquí está el resumen semanal de su proyecto (${facts.jobType || "su trabajo"}):`
    : `Here's your weekly update on the ${facts.jobType || "project"}:`);
  lines.push("");
  lines.push(es ? "Esta semana:" : "This past week:");
  if (facts.doneLines.length) {
    for (const line of facts.doneLines.slice(0, 8)) lines.push(`• ${line}`);
  } else {
    lines.push(es ? "• El trabajo continuó en el proyecto." : "• Work continued on the project.");
  }
  if (facts.photoCount > 0) {
    lines.push(es
      ? `• Se agregaron ${facts.photoCount} ${facts.photoCount === 1 ? "foto nueva" : "fotos nuevas"} del progreso.`
      : `• ${facts.photoCount} new progress ${facts.photoCount === 1 ? "photo was" : "photos were"} added.`);
  }
  lines.push("");
  lines.push(es ? "La próxima semana:" : "Coming up next week:");
  if (facts.upcomingLines.length) {
    for (const line of facts.upcomingLines.slice(0, 5)) lines.push(`• ${line}`);
  } else {
    lines.push(es ? "• Confirmaremos el horario de la próxima semana muy pronto." : "• We'll confirm next week's schedule shortly.");
  }
  lines.push("");
  lines.push(es ? "¿Preguntas? Responda a este mensaje cuando quiera." : "Questions? Just reply to this message anytime.");
  lines.push("");
  lines.push(es ? "Gracias," : "Thanks,");
  lines.push(facts.companyName);
  return lines.join("\n");
}

const WEEKLY_SYSTEM: Record<AiLang, string> = {
  en: [
    "You polish a contractor's weekly progress update to a homeowner.",
    "Rules you must follow:",
    "- Use ONLY the facts in the draft. Never invent work performed, dates, prices, deadlines, or promises that are not stated.",
    "- Keep the two-part structure (this past week / coming up next week), the same items in the same order. Cleaner prose only — nothing added, nothing dropped.",
    "- Write in a professional, plain, friendly tone. No hype.",
    "- Write in English. Return ONLY the polished update text, no subject line, no markdown.",
  ].join("\n"),
  es: [
    "Pules el resumen semanal de progreso que un contratista envía al dueño de la vivienda.",
    "Reglas que debes seguir:",
    "- Usa SOLO los datos del borrador. Nunca inventes trabajo realizado, fechas, precios, plazos ni promesas que no estén indicados.",
    "- Mantén la estructura en dos partes (esta semana / la próxima semana), los mismos puntos en el mismo orden. Solo prosa más limpia — nada agregado, nada eliminado.",
    "- Escribe con un tono profesional, sencillo y amable. Sin exageraciones.",
    "- Escribe en español. Devuelve SOLO el texto pulido del resumen, sin asunto y sin markdown.",
  ].join("\n"),
};

export function buildWeeklyUpdateAiPrompt(args: {
  lang: AiLang;
  jobType: string;
  clientName: string;
  template: string;
}): { system: string; user: string } {
  const user = args.lang === "es"
    ? [
        `Trabajo: ${args.jobType || "Proyecto"}${args.clientName ? ` para ${args.clientName}` : ""}`,
        "",
        "Borrador:",
        `"""${args.template.trim()}"""`,
        "",
        "Devuelve el resumen pulido ahora.",
      ].join("\n")
    : [
        `Job: ${args.jobType || "Project"}${args.clientName ? ` for ${args.clientName}` : ""}`,
        "",
        "Draft:",
        `"""${args.template.trim()}"""`,
        "",
        "Return the polished update now.",
      ].join("\n");
  return { system: WEEKLY_SYSTEM[args.lang], user };
}
