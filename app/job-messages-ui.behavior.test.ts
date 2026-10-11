// Danny 2026-10-11: the per-job Messages tab is for the CREW and the JOB LOG,
// not client chat (client comms = regular texting). This suite locks in the
// pivot: "Crew Log" tab label (EN+ES), a "Crew chat & job log" header with a
// team-only purpose line (EN+ES), composer pinned to the bottom, sender labels
// (You/Tú for the crew, client name tagged "via portal" for portal messages),
// and a crew-framed empty state.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const APP = readFileSync(join(import.meta.dir, "client/src/App.tsx"), "utf8");
const CSS = readFileSync(join(import.meta.dir, "client/src/theme.css"), "utf8");

describe("Crew Log tab label", () => {
  test("workspace tab reads Crew Log / Bitácora (id stays 'messages')", () => {
    expect(APP).toContain('{ id: "messages", en: "Crew Log", es: "Bitácora" }');
  });

  test("no Messages/Mensajes label remains on the job workspace tab", () => {
    expect(APP).not.toContain('{ id: "messages", en: "Messages", es: "Mensajes" }');
  });
});

describe("JobMessagesThread crew framing", () => {
  test("still accepts the client name as a prop (for portal-message labels)", () => {
    expect(APP).toContain("clientName }: { lang: Lang; jobId: number; clientName: string }");
  });

  test("header frames the thread as crew chat & job log (EN+ES)", () => {
    expect(APP).toContain("Crew chat & job log");
    expect(APP).toContain("Chat del equipo y registro del trabajo");
  });

  test("purpose line states only the team sees it (EN+ES)", () => {
    expect(APP).toContain("Only your team sees this");
    expect(APP).toContain("Solo tu equipo ve esto");
  });

  test("no client-conversation framing remains", () => {
    expect(APP).not.toContain("Messages with ${clientName}");
    expect(APP).not.toContain("Mensajes con ${clientName}");
    expect(APP).not.toContain("Conversation between you and ${clientName}");
  });

  test("thread-context header block renders above the message list", () => {
    const section = APP.match(/<section[\s\S]*?className="job-thread"[\s\S]*?<\/section>/);
    expect(section).not.toBeNull();
    const html = section![0];
    expect(html.indexOf("thread-context")).toBeLessThan(html.indexOf("thread-scroll"));
  });

  test("section aria-label uses the crew-log framing (EN+ES)", () => {
    expect(APP).toContain('"Bitácora del equipo"');
    expect(APP).toContain('"Crew log"');
  });
});

describe("JobMessagesThread message polish", () => {
  test("bubbles carry a sender label — You/Tú for the crew", () => {
    expect(APP).toContain("bubble-sender");
    expect(APP).toContain('lang === "es" ? "Tú" : "You"');
  });

  test("portal client messages stay in the thread but are clearly tagged", () => {
    expect(APP).toContain('"via portal"');
    expect(APP).toContain('"por el portal"');
  });

  test("empty state is crew-framed (EN+ES)", () => {
    expect(APP).toContain("No crew messages yet");
    expect(APP).toContain("Aún no hay mensajes del equipo");
  });

  test("thread auto-scrolls to the latest message", () => {
    expect(APP).toContain("el.scrollTop = el.scrollHeight");
  });
});

describe("JobMessagesThread bottom composer layout", () => {
  test("thread fills the viewport height so the composer sits at the bottom", () => {
    const m = CSS.match(/\.job-thread \{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("min-height:calc(100dvh - 250px)");
  });

  test("message list flexes to fill, replacing the old 52vh cap", () => {
    const m = CSS.match(/\.job-thread \.thread-scroll \{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("flex:1 1 auto");
    expect(m![0]).toContain("max-height:none");
  });

  test("composer is sticky at the bottom with a solid background", () => {
    const m = CSS.match(/\.job-thread \.thread-composer \{[^}]*\}/);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("position:sticky");
    expect(m![0]).toContain("bottom:0");
    expect(m![0]).toContain("background:var(--bg)");
  });

  test("portal thread styles are untouched by the rework", () => {
    expect(CSS).toContain(".thread-scroll.portal-thread { max-height:40vh; }");
  });
});
