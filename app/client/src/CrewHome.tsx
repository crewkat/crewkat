// Tier 2: the crew-shaped phone home. When the signed-in account is a
// CREW LOGIN (company code + PIN, credentialType "crew_pin"), App()
// renders this shell instead of the full CrewkatApplication: a simple,
// big-button field surface — today's jobs, photos, messages, daily
// log, schedule — with no money, documents, marketplace, or settings
// chrome. Visibility is still enforced server-side (role map + the
// member's access switches shape every payload this screen reads);
// this component is only the shape of the surface.
//
// Strings are EN/ES like the rest of the app; the language follows the
// auth-screen preference key the sign-in flow already persists.

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { compressImageFile } from "./imageCompress";

type AuthUser = ApiResponse<typeof api, "login">["user"];
type Appointment = ApiResponse<typeof api, "listAppointments">["appointments"][number];
type Job = ApiResponse<typeof api, "listJobs">["jobs"][number];

type Lang = "en" | "es";

const STRINGS = {
  en: {
    today: "Today", schedule: "Schedule", signOut: "Sign out",
    todaysJobs: "Today's jobs", noJobsToday: "Nothing scheduled for today. Check Schedule for what's coming up.",
    upcoming: "Coming up", noUpcoming: "Nothing else scheduled.",
    photos: "Photos", messages: "Messages", dailyLog: "Daily log", call: "Call",
    addPhoto: "Add photo", uploading: "Uploading…",
    writeMessage: "Write a message…", send: "Send",
    crew: "Crew", hours: "Hours", notes: "Notes", blockers: "Blockers (optional)",
    saveLog: "Save log", saved: "Saved ✓", saving: "Saving…",
    back: "← Back", loading: "Loading…", loadFailed: "Couldn't load. Pull to retry from the top.",
    sendFailed: "Couldn't send — check your connection and try again.",
  },
  es: {
    today: "Hoy", schedule: "Agenda", signOut: "Salir",
    todaysJobs: "Trabajos de hoy", noJobsToday: "Nada programado para hoy. Revisa Agenda para lo que viene.",
    upcoming: "Lo que viene", noUpcoming: "Nada más programado.",
    photos: "Fotos", messages: "Mensajes", dailyLog: "Registro diario", call: "Llamar",
    addPhoto: "Agregar foto", uploading: "Subiendo…",
    writeMessage: "Escribe un mensaje…", send: "Enviar",
    crew: "Equipo", hours: "Horas", notes: "Notas", blockers: "Bloqueos (opcional)",
    saveLog: "Guardar registro", saved: "Guardado ✓", saving: "Guardando…",
    back: "← Volver", loading: "Cargando…", loadFailed: "No se pudo cargar. Inténtalo de nuevo.",
    sendFailed: "No se pudo enviar — revisa tu conexión e inténtalo de nuevo.",
  },
} as const;

function crewLang(): Lang {
  try {
    const saved = window.localStorage.getItem("crewkat-auth-lang") ?? window.localStorage.getItem("crewkat-public-lang");
    if (saved === "es" || saved === "en") return saved;
  } catch { /* storage unavailable */ }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("es") ? "es" : "en";
}

function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function appointmentDay(startsAt: string): string {
  const parsed = new Date(startsAt);
  if (!Number.isNaN(parsed.getTime())) return localDateKey(parsed);
  return startsAt.slice(0, 10);
}

function appointmentTime(startsAt: string): string {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function CrewHome({ user, onSignOut }: { user: AuthUser; onSignOut: () => void }) {
  const t = STRINGS[crewLang()];
  const [section, setSection] = useState<"today" | "schedule">("today");
  const [openJobId, setOpenJobId] = useState<number | null>(null);

  const appointmentsQuery = useQuery({ queryKey: ["crew", "appointments"], queryFn: () => api.listAppointments({}) });
  const jobsQuery = useQuery({ queryKey: ["crew", "jobs"], queryFn: () => api.listJobs({ search: "" }) });

  const jobsById = useMemo(() => {
    const map = new Map<number, Job>();
    for (const job of jobsQuery.data?.jobs ?? []) map.set(job.id, job);
    return map;
  }, [jobsQuery.data]);

  const todayKey = localDateKey(new Date());
  const appointments = appointmentsQuery.data?.appointments ?? [];
  const todays = appointments.filter((a) => appointmentDay(a.startsAt) === todayKey && a.status !== "cancelled");
  const upcoming = appointments.filter((a) => appointmentDay(a.startsAt) > todayKey && a.status !== "cancelled");

  const jobFor = (a: Appointment): Job | null => (a.jobId != null ? jobsById.get(a.jobId) ?? null : null);

  const renderCard = (a: Appointment) => {
    const job = jobFor(a);
    const title = job?.jobType || a.clientName || "Job";
    const address = job?.jobAddress ?? "";
    return (
      <button key={a.id} type="button" className="crew-job-card" onClick={() => job && setOpenJobId(job.id)} disabled={!job}>
        <span className="crew-job-time">{appointmentTime(a.startsAt)}</span>
        <span className="crew-job-main">
          <strong>{title}</strong>
          <span>{a.clientName}</span>
          {address ? <span className="crew-job-address">{address}</span> : null}
        </span>
        <span className="crew-job-chevron" aria-hidden="true">›</span>
      </button>
    );
  };

  return (
    <div className="crew-shell">
      <header className="crew-header">
        <div>
          <strong className="crew-hello">{user.name}</strong>
          <span className="crew-header-sub">Crewkat</span>
        </div>
        <button type="button" className="crew-signout" onClick={onSignOut}>{t.signOut}</button>
      </header>

      {openJobId != null && jobsById.get(openJobId) ? (
        <CrewJobPanel job={jobsById.get(openJobId)!} t={t} onBack={() => setOpenJobId(null)} />
      ) : (
        <main className="crew-main">
          <nav className="crew-tabs" aria-label="Crew sections">
            <button type="button" className={section === "today" ? "active" : ""} onClick={() => setSection("today")}>{t.today}</button>
            <button type="button" className={section === "schedule" ? "active" : ""} onClick={() => setSection("schedule")}>{t.schedule}</button>
          </nav>
          {(appointmentsQuery.isLoading || jobsQuery.isLoading) ? <p className="crew-note">{t.loading}</p> : null}
          {(appointmentsQuery.isError || jobsQuery.isError) ? <p className="crew-note error">{t.loadFailed}</p> : null}
          {section === "today" ? (
            <>
              <h2 className="crew-h2">{t.todaysJobs}</h2>
              {appointmentsQuery.data && todays.length === 0 ? <p className="crew-note">{t.noJobsToday}</p> : null}
              <div className="crew-cards">{todays.map(renderCard)}</div>
            </>
          ) : (
            <>
              <h2 className="crew-h2">{t.upcoming}</h2>
              {appointmentsQuery.data && upcoming.length === 0 ? <p className="crew-note">{t.noUpcoming}</p> : null}
              <div className="crew-cards">{upcoming.map(renderCard)}</div>
            </>
          )}
        </main>
      )}
    </div>
  );
}

type CrewStrings = { [K in keyof (typeof STRINGS)["en"]]: string };

function CrewJobPanel({ job, t, onBack }: { job: Job; t: CrewStrings; onBack: () => void }) {
  const [view, setView] = useState<"home" | "photos" | "messages" | "log">("home");
  return (
    <main className="crew-main">
      <button type="button" className="crew-back" onClick={onBack}>{t.back}</button>
      <div className="crew-job-head">
        <strong>{job.jobType || job.clientName}</strong>
        <span>{job.clientName}</span>
        {job.jobAddress ? <span>{job.jobAddress}</span> : null}
      </div>
      {view === "home" ? (
        <div className="crew-actions">
          <button type="button" className="crew-action" onClick={() => setView("photos")}>📷<span>{t.photos}</span></button>
          <button type="button" className="crew-action" onClick={() => setView("messages")}>💬<span>{t.messages}</span></button>
          <button type="button" className="crew-action" onClick={() => setView("log")}>📝<span>{t.dailyLog}</span></button>
          {job.clientPhone ? (
            <a className="crew-action" href={`tel:${job.clientPhone.replace(/[^0-9+]/g, "")}`}>📞<span>{t.call}</span></a>
          ) : null}
        </div>
      ) : null}
      {view !== "home" ? (
        <button type="button" className="crew-back" onClick={() => setView("home")}>{t.back}</button>
      ) : null}
      {view === "photos" ? <CrewPhotos jobId={job.id} t={t} /> : null}
      {view === "messages" ? <CrewMessages jobId={job.id} t={t} /> : null}
      {view === "log" ? <CrewLog jobId={job.id} t={t} /> : null}
    </main>
  );
}

function CrewPhotos({ jobId, t }: { jobId: number; t: CrewStrings }) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const jobQuery = useQuery({ queryKey: ["crew", "job", jobId], queryFn: () => api.getJob({ id: jobId }) });
  const photos = jobQuery.data?.photos ?? [];

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const compressed = await compressImageFile(file, "photo").catch(() => file);
      const dataUrl = await fileDataUrl(compressed);
      const dataBase64 = dataUrl.split(",")[1] ?? "";
      const contentType = (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(compressed.type) ? compressed.type : "image/jpeg") as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
      return api.addPhoto({
        jobId, stage: "during", caption: "", filename: compressed.name || "photo.jpg",
        contentType, capturedAt: new Date().toISOString(), dataBase64, annotatedFromId: null,
      });
    },
    onSuccess: () => { setError(""); void queryClient.invalidateQueries({ queryKey: ["crew", "job", jobId] }); },
    onError: () => setError(t.sendFailed),
  });

  return (
    <section className="crew-section">
      <div className="crew-photo-grid">
        {photos.map((photo) => (
          <figure key={photo.id} className="crew-photo">
            <img src={photo.url} alt={photo.caption || photo.stage} loading="lazy" />
            <figcaption>{photo.stage}</figcaption>
          </figure>
        ))}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file);
        }}
      />
      <button type="button" className="crew-big-button" disabled={upload.isPending} onClick={() => fileRef.current?.click()}>
        {upload.isPending ? t.uploading : `📷 ${t.addPhoto}`}
      </button>
      {error ? <p className="crew-note error">{error}</p> : null}
    </section>
  );
}

function CrewMessages({ jobId, t }: { jobId: number; t: CrewStrings }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const messagesQuery = useQuery({ queryKey: ["crew", "messages", jobId], queryFn: () => api.listJobMessages({ jobId }) });
  const send = useMutation({
    mutationFn: () => api.sendJobMessage({
      jobId, body: draft.trim(), imageDataBase64: "", imageFilename: "", imageContentType: "image/jpeg",
      voiceDataBase64: "", voiceFilename: "", voiceDurationSeconds: 0,
    }),
    onSuccess: () => { setDraft(""); setError(""); void queryClient.invalidateQueries({ queryKey: ["crew", "messages", jobId] }); },
    onError: () => setError(t.sendFailed),
  });
  return (
    <section className="crew-section">
      <div className="crew-messages">
        {(messagesQuery.data?.messages ?? []).map((m) => (
          <div key={m.id} className={`crew-message ${m.sender}`}>
            {m.imageUrl ? <img src={m.imageUrl} alt="" loading="lazy" /> : null}
            {m.body ? <p>{m.body}</p> : null}
          </div>
        ))}
      </div>
      <form
        className="crew-message-form"
        onSubmit={(e) => { e.preventDefault(); if (draft.trim()) send.mutate(); }}
      >
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t.writeMessage} aria-label={t.writeMessage} />
        <button type="submit" className="crew-send" disabled={send.isPending || !draft.trim()}>{t.send}</button>
      </form>
      {error ? <p className="crew-note error">{error}</p> : null}
    </section>
  );
}

function CrewLog({ jobId, t }: { jobId: number; t: CrewStrings }) {
  const [crew, setCrew] = useState("");
  const [hours, setHours] = useState("");
  const [notes, setNotes] = useState("");
  const [blockers, setBlockers] = useState("");
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () => api.saveDailyLog({
      jobId, logDate: localDateKey(new Date()), crew: crew.trim(), hours: hours.trim(),
      photoIds: [], notes: notes.trim(), blockers: blockers.trim(), clientSummary: "", sharedWithClient: false,
    }),
    onError: () => setError(t.sendFailed),
  });
  return (
    <section className="crew-section">
      <form
        className="crew-log-form"
        onSubmit={(e) => { e.preventDefault(); setError(""); save.mutate(); }}
      >
        <label><span>{t.crew}</span><input value={crew} onChange={(e) => setCrew(e.target.value)} /></label>
        <label><span>{t.hours}</span><input value={hours} onChange={(e) => setHours(e.target.value)} inputMode="decimal" /></label>
        <label><span>{t.notes}</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} /></label>
        <label><span>{t.blockers}</span><textarea value={blockers} onChange={(e) => setBlockers(e.target.value)} rows={2} /></label>
        <button type="submit" className="crew-big-button" disabled={save.isPending}>
          {save.isPending ? t.saving : save.isSuccess ? t.saved : t.saveLog}
        </button>
        {error ? <p className="crew-note error">{error}</p> : null}
      </form>
    </section>
  );
}
