import { fileToBase64 } from "@hatch/space-sdk/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { api, type ApiResponse } from "./api";

type Lang = "en" | "es";
type Data = ApiResponse<typeof api, "getFieldIntelligence">;
type Equipment = Data["equipment"][number];
type PurchaseOrder = Data["purchaseOrders"][number];
type Credential = Data["credentials"][number];
type Tab = "purchasing" | "equipment" | "safety" | "credentials" | "payroll";
type ExpansionData = ApiResponse<typeof api, "getExpansionSuite">;
type Topic = "ladder" | "ppe" | "electrical" | "heat" | "silica" | "fall";

const usd = (value: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(String(value).replace(/[^0-9.-]/g, "")) || 0);
const dateLabel = (value: string, lang: Lang) => value ? new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { dateStyle: "medium" }).format(new Date(`${value.slice(0, 10)}T12:00:00`)) : "—";
const safeCsv = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
function BackIcon() { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>; }
function GearIcon() { return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19 12h3M2 12h3M12 2v3M12 19v3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>; }
function PageHeader({ title, back, openSettings, lang }: { title: string; back: () => void; openSettings: () => void; lang: Lang }) { return <header className="page-header"><button className="icon-button" onClick={back} aria-label={lang === "es" ? "Atrás" : "Back"}><BackIcon/></button><h1>{title}</h1><button className="icon-button master-settings-button" onClick={openSettings} aria-label={lang === "es" ? "Abrir configuración" : "Open settings"}><GearIcon/></button></header>; }
function Empty({ children }: { children: ReactNode }) { return <p className="detail-empty">{children}</p>; }

const talks: Record<Topic, { en: { title: string; items: string[] }; es: { title: string; items: string[] } }> = {
  ladder: { en: { title: "Ladder safety", items: ["Inspect rails, feet, and locks before use", "Keep three points of contact", "Set the ladder on a level, stable surface", "Never stand on the top step"] }, es: { title: "Seguridad con escaleras", items: ["Inspecciona rieles, patas y seguros antes de usar", "Mantén tres puntos de contacto", "Coloca la escalera en una superficie nivelada y estable", "Nunca te pares en el peldaño superior"] } },
  ppe: { en: { title: "Personal protective equipment", items: ["Match PPE to today’s hazards", "Inspect eye, hearing, hand, and foot protection", "Replace damaged PPE", "Confirm everyone knows when PPE is required"] }, es: { title: "Equipo de protección personal", items: ["Usa el EPP adecuado para los riesgos de hoy", "Inspecciona protección de ojos, oídos, manos y pies", "Reemplaza el EPP dañado", "Confirma cuándo es obligatorio usar EPP"] } },
  electrical: { en: { title: "Electrical safety", items: ["Inspect cords and GFCI protection", "De-energize before service", "Keep equipment away from water", "Tag damaged tools out of service"] }, es: { title: "Seguridad eléctrica", items: ["Inspecciona cables y protección GFCI", "Desenergiza antes del servicio", "Mantén el equipo lejos del agua", "Retira y etiqueta herramientas dañadas"] } },
  heat: { en: { title: "Heat illness", items: ["Start hydrated and schedule water breaks", "Use shade during recovery", "Watch for dizziness, confusion, or cramps", "Call for help when symptoms are severe"] }, es: { title: "Enfermedades por calor", items: ["Comienza hidratado y programa descansos para agua", "Usa sombra durante la recuperación", "Observa mareos, confusión o calambres", "Pide ayuda si los síntomas son graves"] } },
  silica: { en: { title: "Silica dust", items: ["Use wet cutting or approved dust collection", "Wear the required respirator", "Keep bystanders outside the work zone", "Never dry sweep silica dust"] }, es: { title: "Polvo de sílice", items: ["Usa corte húmedo o extracción de polvo aprobada", "Usa el respirador requerido", "Mantén a otras personas fuera del área", "Nunca barras en seco el polvo de sílice"] } },
  fall: { en: { title: "Fall protection", items: ["Inspect anchors, harnesses, and lanyards", "Protect edges and openings", "Use guardrails or approved fall arrest", "Plan rescue before elevated work"] }, es: { title: "Protección contra caídas", items: ["Inspecciona anclajes, arneses y líneas", "Protege bordes y aberturas", "Usa barandas o detención de caídas aprobada", "Planifica el rescate antes del trabajo elevado"] } },
};

export function FieldIntelligenceScreen({ lang, onBack, onOpenSettings, onOpenJob, initialTab }: { lang: Lang; onBack: () => void; onOpenSettings: () => void; onOpenJob: (id: number) => void; initialTab?: Tab }) {
  const today = new Date().toLocaleDateString("en-CA");
  const monthStart = `${today.slice(0, 8)}01`;
  const [period, setPeriod] = useState({ start: monthStart, end: today });
  const [tab] = useState<Tab>(initialTab ?? "purchasing");
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["field-intelligence", today, period.start, period.end], queryFn: () => api.getFieldIntelligence({ today, periodStart: period.start, periodEnd: period.end }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["field-intelligence"] });
  // Tools cleanup (2026-11-03): the supplier directory, upkeep plans, and
  // crew-hours report folded into these tabs; they read the expansion
  // suite payload.
  const expansionQuery = useQuery({ queryKey: ["expansion-suite", today], queryFn: () => api.getExpansionSuite({ today }), enabled: tab === "purchasing" || tab === "equipment" || tab === "payroll" });
  const expansion = expansionQuery.data;
  const refreshExpansion = () => { void qc.invalidateQueries({ queryKey: ["expansion-suite"] }); void qc.invalidateQueries({ queryKey: ["field-intelligence"] }); };
  const d = query.data;
  const labels: Record<Tab, string> = lang === "es" ? { purchasing: "Pedidos y proveedores", equipment: "Equipo", safety: "Seguridad e incidentes", credentials: "Licencias y certificados", payroll: "Tiempo y nómina" } : { purchasing: "Orders & suppliers", equipment: "Equipment", safety: "Safety & incidents", credentials: "Licenses & certificates", payroll: "Time & payroll" };
  return <main className="page intelligence-page"><PageHeader title={labels[tab]} back={onBack} openSettings={onOpenSettings} lang={lang}/>
    {!d ? <div className="loading-block"/> : <>
      {tab === "purchasing" && <><Purchasing lang={lang} data={d} refresh={refresh}/>{expansion && <SupplierManager lang={lang} data={expansion} refresh={refreshExpansion}/>}</>} 
      {tab === "equipment" && <><EquipmentPanel lang={lang} data={d} refresh={refresh}/>{expansion && <MaintenanceManager lang={lang} data={expansion} refresh={refreshExpansion}/>}</>} 
      {tab === "safety" && <SafetyPanel lang={lang} data={d} refresh={refresh} onOpenJob={onOpenJob}/>} 
      {tab === "credentials" && <CredentialsPanel lang={lang} data={d} refresh={refresh}/>} 
      {tab === "payroll" && <><CrewClockPanel lang={lang}/>{expansion && <CrewHoursReport lang={lang} rows={expansion.crewHours}/>}<PayrollPanel lang={lang} data={d} period={period} setPeriod={setPeriod} refresh={refresh}/></>} 
    </>}
  </main>;
}

function Purchasing({ lang, data, refresh }: { lang: Lang; data: Data; refresh: () => void }) {
  const [form, setForm] = useState({ supplierId: data.suppliers[0]?.id ?? 0, jobId: null as number | null, title: "", description: "", qty: "1", unitPrice: "" });
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!form.supplierId || !form.title || !form.description) return; await api.saveSupplierQuote({ supplierId: form.supplierId, jobId: form.jobId, title: form.title, lineItems: [{ description: form.description, qty: Math.max(0.01, Number(form.qty) || 1), unitPrice: form.unitPrice }] }); setForm({ ...form, title: "", description: "", qty: "1", unitPrice: "" }); refresh(); };
  return <section className="intelligence-section"><h2>{lang === "es" ? "Cotizaciones de proveedores" : "Supplier bids"}</h2>{data.suppliers.length === 0 ? <Empty>{lang === "es" ? "Agrega tu primer proveedor abajo antes de comparar ofertas." : "Add your first supplier below before comparing bids."}</Empty> : <form className="compact-form" onSubmit={submit}><div className="field-pair"><label><span>{lang === "es" ? "Proveedor" : "Supplier"}</span><select value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: Number(e.target.value) })}>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label><span>{lang === "es" ? "Trabajo" : "Job"}</span><select value={form.jobId ?? ""} onChange={(e) => setForm({ ...form, jobId: e.target.value ? Number(e.target.value) : null })}><option value="">{lang === "es" ? "Sin trabajo" : "No job"}</option>{data.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select></label></div><label><span>{lang === "es" ? "Nombre de la comparación" : "Bid group name"}</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={lang === "es" ? "Gabinetes de cocina" : "Kitchen cabinets"}/></label><div className="line-item"><input aria-label={lang === "es" ? "Artículo" : "Item"} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder={lang === "es" ? "Artículo" : "Item"}/><input aria-label={lang === "es" ? "Cantidad" : "Quantity"} inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })}/><input aria-label={lang === "es" ? "Precio unitario" : "Unit price"} inputMode="decimal" value={form.unitPrice} onChange={(e) => setForm({ ...form, unitPrice: e.target.value })}/></div><button className="primary-button">{lang === "es" ? "Guardar oferta" : "Save bid"}</button></form>}
    <div className="tool-records">{data.supplierQuotes.map((q) => <article className={q.selected ? "selected-bid" : ""} key={q.id}><div><strong>{q.title} · {q.supplierName}</strong><span>{usd(q.total)}</span><small>{q.lineItems.map((i) => `${i.description} × ${i.qty}`).join(" · ")}</small></div><button className="small-button" disabled={q.selected} onClick={async () => { await api.createPurchaseOrder({ supplierQuoteId: q.id }); refresh(); }}>{q.selected ? (lang === "es" ? "Seleccionada" : "Selected") : (lang === "es" ? "Elegir y crear PO" : "Choose & create PO")}</button></article>)}{data.supplierQuotes.length === 0 && <Empty>{lang === "es" ? "No hay ofertas guardadas." : "No supplier bids yet."}</Empty>}</div>
    <h2>{lang === "es" ? "Pedidos a proveedores" : "Supplier orders"}</h2><div className="tool-records">{data.purchaseOrders.map((po) => <PurchaseOrderRow key={po.id} po={po} lang={lang} refresh={refresh}/>)}{data.purchaseOrders.length === 0 && <Empty>{lang === "es" ? "Elige una oferta para crear un pedido." : "Choose a bid to create a supplier order."}</Empty>}</div>
  </section>;
}
function PurchaseOrderRow({ po, lang, refresh }: { po: PurchaseOrder; lang: Lang; refresh: () => void }) {
  const [received, setReceived] = useState(po.lineItems.map((i) => String(i.receivedQty)));
  const closed = po.status === "received" || po.status === "cancelled";
  return <article className="po-card"><div><strong>{po.number} · {po.supplierName}</strong><span>{usd(po.total)} · {po.status.replace("_", " ")}</span><small>{po.jobLabel ?? (lang === "es" ? "Sin trabajo" : "No job")}</small></div>{po.status === "draft" && <div className="row-actions"><button onClick={async () => { await api.updatePurchaseOrderStatus({ id: po.id, status: "sent" }); refresh(); }}>{lang === "es" ? "Marcar enviada" : "Mark sent"}</button><button onClick={async () => { await api.updatePurchaseOrderStatus({ id: po.id, status: "cancelled" }); refresh(); }}>{lang === "es" ? "Cancelar" : "Cancel"}</button></div>}<div className="receive-lines">{po.lineItems.map((item, index) => <label key={`${po.id}-${index}`}><span>{item.description}<small>{item.receivedQty}/{item.qty} {lang === "es" ? "recibido" : "received"}</small></span><input type="number" min="0" max={item.qty} step="any" value={received[index] ?? "0"} disabled={closed} onChange={(e) => setReceived(received.map((value, i) => i === index ? e.target.value : value))}/></label>)}</div>{!closed && <button className="primary-button" onClick={async () => { await api.receivePurchaseOrder({ id: po.id, received: po.lineItems.map((item, i) => Math.min(item.qty, Number(received[i]) || 0)) }); refresh(); }}>{lang === "es" ? "Registrar recepción y gasto" : "Receive & record expense"}</button>}</article>;
}

function EquipmentPanel({ lang, data, refresh }: { lang: Lang; data: Data; refresh: () => void }) {
  const today = new Date().toLocaleDateString("en-CA"); const [file, setFile] = useState<File | null>(null); const [form, setForm] = useState({ name: "", category: "", purchaseDate: today, cost: "", serialNumber: "", assignedTo: "shop", maintenanceTask: "", maintenanceEveryDays: 90, nextMaintenanceDate: today });
  const submit = async (e: FormEvent) => { e.preventDefault(); if (!form.name) return; const encoded = file ? await fileToBase64(file) : { dataBase64: "" }; await api.saveEquipment({ ...form, photoFilename: file?.name ?? "", photoContentType: (file?.type ?? "") as ""|"image/jpeg"|"image/png"|"image/webp", photoDataBase64: encoded.dataBase64 }); setForm({ name: "", category: "", purchaseDate: today, cost: "", serialNumber: "", assignedTo: "shop", maintenanceTask: "", maintenanceEveryDays: 90, nextMaintenanceDate: today }); setFile(null); refresh(); };
  return <section className="intelligence-section"><form className="compact-form" onSubmit={submit}><div className="field-pair"><label><span>{lang === "es" ? "Equipo" : "Equipment"}</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label><label><span>{lang === "es" ? "Categoría" : "Category"}</span><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}/></label></div><div className="field-pair"><label><span>{lang === "es" ? "Fecha de compra" : "Purchase date"}</span><input type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })}/></label><label><span>{lang === "es" ? "Costo" : "Cost"}</span><input inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })}/></label></div><label><span>{lang === "es" ? "Número de serie" : "Serial number"}</span><input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}/></label><label><span>{lang === "es" ? "Foto" : "Photo"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)}/></label><label><span>{lang === "es" ? "Tarea de mantenimiento" : "Maintenance task"}</span><input value={form.maintenanceTask} onChange={(e) => setForm({ ...form, maintenanceTask: e.target.value })}/></label><div className="field-pair"><label><span>{lang === "es" ? "Cada (días)" : "Every (days)"}</span><input type="number" min="1" value={form.maintenanceEveryDays} onChange={(e) => setForm({ ...form, maintenanceEveryDays: Number(e.target.value) || 1 })}/></label><label><span>{lang === "es" ? "Próximo mantenimiento" : "Next maintenance"}</span><input type="date" value={form.nextMaintenanceDate} onChange={(e) => setForm({ ...form, nextMaintenanceDate: e.target.value })}/></label></div><button className="primary-button">{lang === "es" ? "Agregar equipo" : "Add equipment"}</button></form><div className="equipment-grid">{data.equipment.map((item) => <EquipmentRow key={item.id} item={item} lang={lang} refresh={refresh}/>)}{data.equipment.length === 0 && <Empty>{lang === "es" ? "Aún no hay equipo registrado." : "No equipment tracked yet."}</Empty>}</div></section>;
}
function EquipmentRow({ item, lang, refresh }: { item: Equipment; lang: Lang; refresh: () => void }) { const [assignee, setAssignee] = useState(""); const out = Boolean(item.checkedOutAt && !item.returnedAt); return <article className={`equipment-card${item.maintenanceDue ? " maintenance-due" : ""}`}>{item.photoUrl && <img src={item.photoUrl} alt={item.name}/>}<div><strong>{item.name}</strong><span>{item.category} · {usd(item.cost)}</span><small>{item.serialNumber}</small><small>{lang === "es" ? "Cuidado del equipo" : "Equipment upkeep"}: {dateLabel(item.nextMaintenanceDate, lang)}{item.maintenanceDue ? ` · ${lang === "es" ? "Vencido" : "Due"}` : ""}</small><small>{lang === "es" ? "Ubicación" : "Assigned"}: {item.assignedTo}</small></div><div className="equipment-actions">{out ? <button onClick={async () => { await api.setEquipmentCheckout({ id: item.id, assignedTo: item.assignedTo, returned: true }); refresh(); }}>{lang === "es" ? "Devolver" : "Return"}</button> : <><input aria-label={lang === "es" ? `Asignar ${item.name}` : `Assign ${item.name}`} value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder={lang === "es" ? "Persona o trabajo" : "Person or job"}/><button disabled={!assignee.trim()} onClick={async () => { await api.setEquipmentCheckout({ id: item.id, assignedTo: assignee, returned: false }); setAssignee(""); refresh(); }}>{lang === "es" ? "Entregar" : "Check out"}</button></>}<button onClick={async () => { await api.completeEquipmentMaintenance({ id: item.id }); refresh(); }}>{lang === "es" ? "Cuidado completado" : "Upkeep done"}</button></div></article>; }

function SafetyPanel({ lang, data, refresh, onOpenJob }: { lang: Lang; data: Data; refresh: () => void; onOpenJob: (id: number) => void }) {
  const today = new Date().toLocaleDateString("en-CA"); const [topic, setTopic] = useState<Topic>("ladder"); const [talk, setTalk] = useState({ jobId: data.jobs[0]?.id ?? 0, talkDate: today, names: "" }); const [incident, setIncident] = useState({ jobId: data.jobs[0]?.id ?? 0, incidentDate: today, description: "", severity: "near_miss" as "near_miss"|"minor"|"serious", correctiveAction: "" }); const [photo, setPhoto] = useState<File | null>(null); const topicCopy = talks[topic][lang];
  return <section className="intelligence-section"><div className="metric-hero"><span>{lang === "es" ? "Racha de seguridad" : "Safety streak"}</span><strong>{data.safetyStreak}</strong><small>{lang === "es" ? "días desde el último incidente registrado" : "days since the last recorded incident"}</small></div><details className="action-details" open><summary>{lang === "es" ? "Charla de seguridad" : "Safety talk"}</summary><form className="compact-form" onSubmit={async (e) => { e.preventDefault(); const names = talk.names.split(",").map((n) => n.trim()).filter(Boolean); if (!talk.jobId || !names.length) return; await api.saveSafetyTalk({ jobId: talk.jobId, topicKey: topic, talkDate: talk.talkDate, checklist: topicCopy.items, acknowledgements: names }); setTalk({ ...talk, names: "" }); refresh(); }}><div className="field-pair"><label><span>{lang === "es" ? "Trabajo" : "Job"}</span><select value={talk.jobId} onChange={(e) => setTalk({ ...talk, jobId: Number(e.target.value) })}>{data.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select></label><label><span>{lang === "es" ? "Fecha" : "Date"}</span><input type="date" value={talk.talkDate} onChange={(e) => setTalk({ ...talk, talkDate: e.target.value })}/></label></div><label><span>{lang === "es" ? "Tema" : "Topic"}</span><select value={topic} onChange={(e) => setTopic(e.target.value as Topic)}>{(Object.keys(talks) as Topic[]).map((key) => <option key={key} value={key}>{talks[key][lang].title}</option>)}</select></label><ul className="safety-checklist">{topicCopy.items.map((item) => <li key={item}>{item}</li>)}</ul><label><span>{lang === "es" ? "Reconocimientos (nombres separados por coma)" : "Acknowledgements (comma-separated names)"}</span><input value={talk.names} onChange={(e) => setTalk({ ...talk, names: e.target.value })}/></label><button className="primary-button">{lang === "es" ? "Guardar charla" : "Save talk"}</button></form></details><details className="action-details"><summary>{lang === "es" ? "Reportar incidente" : "Report incident"}</summary><form className="compact-form" onSubmit={async (e) => { e.preventDefault(); if (!incident.jobId || !incident.description) return; const encoded = photo ? await fileToBase64(photo) : { dataBase64: "" }; await api.saveIncident({ ...incident, photoContentType: (photo?.type ?? "") as ""|"image/jpeg"|"image/png"|"image/webp", photoDataBase64: encoded.dataBase64 }); setIncident({ ...incident, description: "", correctiveAction: "" }); setPhoto(null); refresh(); }}><label><span>{lang === "es" ? "Trabajo" : "Job"}</span><select value={incident.jobId} onChange={(e) => setIncident({ ...incident, jobId: Number(e.target.value) })}>{data.jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</select></label><div className="field-pair"><label><span>{lang === "es" ? "Fecha" : "Date"}</span><input type="date" value={incident.incidentDate} onChange={(e) => setIncident({ ...incident, incidentDate: e.target.value })}/></label><label><span>{lang === "es" ? "Gravedad" : "Severity"}</span><select value={incident.severity} onChange={(e) => setIncident({ ...incident, severity: e.target.value as typeof incident.severity })}><option value="near_miss">{lang === "es" ? "Casi accidente" : "Near miss"}</option><option value="minor">{lang === "es" ? "Menor" : "Minor"}</option><option value="serious">{lang === "es" ? "Grave" : "Serious"}</option></select></label></div><label><span>{lang === "es" ? "Descripción" : "Description"}</span><textarea rows={3} value={incident.description} onChange={(e) => setIncident({ ...incident, description: e.target.value })}/></label><label><span>{lang === "es" ? "Acción correctiva" : "Corrective action"}</span><textarea rows={3} value={incident.correctiveAction} onChange={(e) => setIncident({ ...incident, correctiveAction: e.target.value })}/></label><label><span>{lang === "es" ? "Foto opcional" : "Optional photo"}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}/></label><button className="primary-button">{lang === "es" ? "Guardar incidente" : "Save incident"}</button></form></details><div className="safety-history"><h2>{lang === "es" ? "Historial" : "History"}</h2>{data.incidents.map((i) => <button type="button" key={`i-${i.id}`} className={`incident-link incident-${i.severity}`} onClick={() => onOpenJob(i.jobId)} aria-label={`${lang === "es" ? "Abrir trabajo" : "Open job"}: ${i.jobLabel}`}>{i.photoUrl && <img src={i.photoUrl} alt=""/>}<div><strong>{i.jobLabel}</strong><span>{dateLabel(i.incidentDate, lang)} · {i.severity.replace("_", " ")}</span><p>{i.description}</p><small>{i.correctiveAction}</small></div><BackIcon/></button>)}{data.safetyTalks.map((item) => <article key={`t-${item.id}`}><div><strong>{talks[item.topicKey as Topic]?.[lang].title ?? item.topicKey}</strong><span>{item.jobLabel} · {dateLabel(item.talkDate, lang)}</span><small>{item.acknowledgements.join(", ")}</small></div></article>)}{data.incidents.length + data.safetyTalks.length === 0 && <Empty>{lang === "es" ? "Aún no hay registros de seguridad." : "No safety records yet."}</Empty>}</div></section>;
}

function CredentialsPanel({ lang, data, refresh }: { lang: Lang; data: Data; refresh: () => void }) { const today = new Date().toLocaleDateString("en-CA"); const [form, setForm] = useState({ ownerType: "business" as "business"|"subcontractor", subcontractorId: null as number|null, kind: "", identifier: "", expiresOn: today }); return <section className="intelligence-section"><form className="compact-form" onSubmit={async (e) => { e.preventDefault(); if (!form.kind) return; await api.saveCredential(form); setForm({ ...form, kind: "", identifier: "" }); refresh(); }}><label><span>{lang === "es" ? "Titular" : "Owner"}</span><select value={form.ownerType} onChange={(e) => setForm({ ...form, ownerType: e.target.value as typeof form.ownerType, subcontractorId: null })}><option value="business">{lang === "es" ? "Empresa" : "Business"}</option><option value="subcontractor">{lang === "es" ? "Subcontratista" : "Subcontractor"}</option></select></label><div className="field-pair"><label><span>{lang === "es" ? "Tipo" : "Type"}</span><input value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} placeholder={lang === "es" ? "Licencia, seguro…" : "License, insurance…"}/></label><label><span>{lang === "es" ? "Número" : "Identifier"}</span><input value={form.identifier} onChange={(e) => setForm({ ...form, identifier: e.target.value })}/></label></div><label><span>{lang === "es" ? "Vence" : "Expires"}</span><input type="date" value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })}/></label><button className="primary-button">{lang === "es" ? "Agregar licencia o certificado" : "Add license or certificate"}</button></form><div className="credential-list">{data.credentials.map((item) => <CredentialRow key={item.id} item={item} lang={lang} refresh={refresh}/>)}{data.credentials.length === 0 && <Empty>{lang === "es" ? "No hay licencias o certificados guardados." : "No licenses or certificates saved."}</Empty>}</div></section>; }
function CredentialRow({ item, lang, refresh }: { item: Credential; lang: Lang; refresh: () => void }) { const [date, setDate] = useState(item.expiresOn); const level = item.daysRemaining < 0 ? "expired" : item.daysRemaining <= 7 ? "urgent" : item.daysRemaining <= 30 ? "soon" : item.daysRemaining <= 60 ? "watch" : "clear"; return <article className={`credential-row ${level}`}><div><strong>{item.kind} · {item.ownerLabel}</strong><span>{item.identifier}</span><small>{dateLabel(item.expiresOn, lang)} · {item.daysRemaining < 0 ? (lang === "es" ? "Vencida" : "Expired") : `${item.daysRemaining} ${lang === "es" ? "días" : "days"}`}</small></div><div className="renew-controls"><input aria-label={lang === "es" ? `Nueva fecha para ${item.kind}` : `New expiry for ${item.kind}`} type="date" value={date} onChange={(e) => setDate(e.target.value)}/><button disabled={date === item.expiresOn} onClick={async () => { await api.renewCredential({ id: item.id, expiresOn: date }); refresh(); }}>{lang === "es" ? "Renovar" : "Renew"}</button></div></article>; }

function PayrollPanel({ lang, data, period, setPeriod, refresh }: { lang: Lang; data: Data; period: { start: string; end: string }; setPeriod: (p: { start: string; end: string }) => void; refresh: () => void }) { const [rate, setRate] = useState({ crewMember: "", hourlyRate: "" }); const total = data.payroll.reduce((sum, row) => sum + Number(row.grossPay), 0); const download = () => { const csv = [["Period start", "Period end", "Crew member", "Hours", "Hourly rate", "Gross pay"].map(safeCsv).join(","), ...data.payroll.map((row) => [period.start, period.end, row.crewMember, row.hours.toFixed(2), Number(row.hourlyRate).toFixed(2), Number(row.grossPay).toFixed(2)].map(safeCsv).join(","))].join("\n"); const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `payroll-${period.start}-${period.end}.csv`; a.click(); URL.revokeObjectURL(a.href); };
  return <section className="intelligence-section"><div className="field-pair payroll-period"><label><span>{lang === "es" ? "Inicio" : "Start"}</span><input type="date" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })}/></label><label><span>{lang === "es" ? "Fin" : "End"}</span><input type="date" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })}/></label></div><form className="compact-form" onSubmit={async (e) => { e.preventDefault(); if (!rate.crewMember) return; await api.saveCrewPayRate(rate); setRate({ crewMember: "", hourlyRate: "" }); refresh(); }}><div className="field-pair"><label><span>{lang === "es" ? "Miembro del equipo" : "Crew member"}</span><input value={rate.crewMember} onChange={(e) => setRate({ ...rate, crewMember: e.target.value })}/></label><label><span>{lang === "es" ? "Tarifa por hora" : "Hourly rate"}</span><input inputMode="decimal" value={rate.hourlyRate} onChange={(e) => setRate({ ...rate, hourlyRate: e.target.value })}/></label></div><button className="primary-button">{lang === "es" ? "Guardar tarifa" : "Save rate"}</button></form><div className="payroll-total"><span>{lang === "es" ? "Nómina bruta" : "Gross payroll"}</span><strong>{usd(total)}</strong></div><div className="tool-records">{data.payroll.map((row) => <article key={row.crewMember}><div><strong>{row.crewMember}</strong><span>{row.hours.toFixed(2)}h × {usd(row.hourlyRate)}</span></div><strong>{usd(row.grossPay)}</strong></article>)}{data.payroll.length === 0 && <Empty>{lang === "es" ? "No hay horas registradas en este período." : "No time entries in this pay period."}</Empty>}</div><button className="secondary-button full-button" disabled={!data.payroll.length} onClick={download}>{lang === "es" ? "Descargar CSV" : "Download CSV"}</button></section>; }

// ---------------------------------------------------------------------------
// Tools cleanup (2026-11-03): components folded into these tabs from the
// old Tools catalog — the crew GPS clock + weekly crew-hours report (Time
// & payroll), the supplier directory (Orders & suppliers), and the upkeep
// plans (Equipment). They read/write the expansion-suite payload.
// ---------------------------------------------------------------------------

function CrewClockPanel({ lang }: { lang: Lang }) {
  const qc = useQueryClient();
  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api.listJobs({ search: "" }),
  });
  const status = useQuery({
    queryKey: ["crew-clock"],
    queryFn: () => api.getCrewClockStatus({}),
    refetchInterval: 60000,
  });
  const [name, setName] = useState(""),
    [jobId, setJobId] = useState(""),
    [coords, setCoords] = useState<{
      latitude: number;
      longitude: number;
    } | null>(null),
    [nearby, setNearby] = useState<
      { id: number; label: string; distanceMiles: number }[]
    >([]),
    [gpsMsg, setGpsMsg] = useState("");
  const locate = () =>
    navigator.geolocation
      ? navigator.geolocation.getCurrentPosition(
          async (p) => {
            const c = {
              latitude: p.coords.latitude,
              longitude: p.coords.longitude,
            };
            setCoords(c);
            setGpsMsg(lang === "es" ? "Ubicación lista." : "Location ready.");
            const r = await api.suggestJobsByLocation(c);
            setNearby(r.jobs);
            if (!jobId && r.jobs[0]) setJobId(String(r.jobs[0].id));
          },
          () =>
            setGpsMsg(
              lang === "es"
                ? "GPS no disponible. Seleccione el trabajo manualmente."
                : "GPS unavailable. Choose the job manually.",
            ),
          { enableHighAccuracy: true, timeout: 10000 },
        )
      : setGpsMsg(lang === "es" ? "GPS no disponible." : "GPS unavailable.");
  const refresh = () => qc.invalidateQueries({ queryKey: ["crew-clock"] });
  return (
    <details className="action-details crew-clock-panel">
      <summary>
        {lang === "es" ? "Reloj GPS del equipo" : "Crew GPS clock"}{" "}
        {status.data?.active.length ? `· ${status.data.active.length}` : ""}
      </summary>
      <div className="compact-form">
        <label>
          <span>{lang === "es" ? "Nombre del trabajador" : "Crew member"}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span>{lang === "es" ? "Trabajo" : "Job"}</span>
          <select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">{lang === "es" ? "Seleccione" : "Choose"}</option>
            {nearby.map((j) => (
              <option key={`n${j.id}`} value={j.id}>
                {j.label} · {j.distanceMiles} mi
              </option>
            ))}
            {jobs.data?.jobs
              .filter((j) => !nearby.some((n) => n.id === j.id))
              .map((j) => (
                <option key={j.id} value={j.id}>
                  {j.clientName} · {j.jobType}
                </option>
              ))}
          </select>
        </label>
        <div className="row-actions">
          <button onClick={locate}>
            {lang === "es" ? "Usar GPS" : "Use GPS"}
          </button>
          <button
            className="primary-button"
            disabled={!name || !jobId}
            onClick={async () => {
              await api.clockInCrew({
                jobId: Number(jobId),
                crewMember: name,
                latitude: coords?.latitude ?? null,
                longitude: coords?.longitude ?? null,
                note: "",
              });
              refresh();
            }}
          >
            {lang === "es" ? "Marcar entrada" : "Clock in"}
          </button>
          {coords && jobId && (
            <button
              onClick={async () => {
                await api.updateJobSiteLocation({
                  jobId: Number(jobId),
                  ...coords,
                });
                setGpsMsg(
                  lang === "es"
                    ? "Ubicación del sitio guardada."
                    : "Job-site location saved.",
                );
              }}
            >
              {lang === "es" ? "Guardar sitio aquí" : "Save site here"}
            </button>
          )}
        </div>
        {gpsMsg && <p className="status">{gpsMsg}</p>}
        <h3>{lang === "es" ? "En el sitio ahora" : "On site now"}</h3>
        {status.data?.active.map((a) => (
          <article className="tool-record" key={a.id}>
            <span>
              <strong>{a.crewMember}</strong>
              <small>
                {a.jobLabel} · {a.hours.toFixed(1)} h{" "}
                {a.missingGps
                  ? `· ${lang === "es" ? "sin GPS" : "no GPS"}`
                  : ""}
              </small>
            </span>
            {a.overTwelveHours && (
              <b className="urgency-badge">
                {lang === "es" ? "Más de 12 h" : "Over 12 hr"}
              </b>
            )}
            <button
              onClick={async () => {
                await api.clockOutCrew({
                  id: a.id,
                  latitude: coords?.latitude ?? null,
                  longitude: coords?.longitude ?? null,
                });
                refresh();
              }}
            >
              {lang === "es" ? "Marcar salida" : "Clock out"}
            </button>
          </article>
        ))}
        {!status.data?.active.length && (
          <p>
            {lang === "es"
              ? "Nadie ha marcado entrada."
              : "No one is clocked in."}
          </p>
        )}
      </div>
    </details>
  );
}

function CrewHoursReport({
  lang,
  rows,
}: {
  lang: Lang;
  rows: Array<{
    crewMember: string;
    jobId: number;
    jobLabel: string;
    hours: number;
  }>;
}) {
  const grouped = new Map<string, number>();
  for (const r of rows)
    grouped.set(r.crewMember, (grouped.get(r.crewMember) ?? 0) + r.hours);
  const text = [
    lang === "es" ? "Informe semanal de horas" : "Weekly crew hours",
    ...Array.from(grouped).map(([n, h]) => `${n}: ${h.toFixed(2)}h`),
    "",
    ...rows.map(
      (r) => `${r.crewMember} · ${r.jobLabel}: ${r.hours.toFixed(2)}h`,
    ),
  ].join("\n");
  return (
    <section className="toolkit-section">
      <div className="toolkit-summary">
        {Array.from(grouped).map(([name, h]) => (
          <article key={name}>
            <span>{name}</span>
            <strong>{h.toFixed(1)}h</strong>
          </article>
        ))}
      </div>
      <button
        className="primary-button"
        onClick={async () => {
          const title = lang === "es" ? "Horas del equipo" : "Crew hours";
          if (navigator.share) {
            try {
              await navigator.share({ title, text });
            } catch {
              /* share sheet dismissed */
            }
            return;
          }
          const url = URL.createObjectURL(
            new Blob([text], { type: "text/plain" }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "crew-hours-week.txt";
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        {lang === "es" ? "Compartir informe" : "Share report"}
      </button>
      <div className="tool-records">
        {rows.map((r, i) => (
          <article key={`${r.jobId}-${r.crewMember}-${i}`}>
            <div>
              <strong>
                {r.crewMember} · {r.hours.toFixed(2)}h
              </strong>
              <small>{r.jobLabel}</small>
            </div>
          </article>
        ))}
      </div>
      {rows.length === 0 && (
        <p className="detail-empty">
          {lang === "es"
            ? "Asigna nombres al registrar tiempo para ver el informe semanal."
            : "Assign crew names when tracking time to build the weekly report."}
        </p>
      )}
    </section>
  );
}

function SupplierManager({
  lang,
  data,
  refresh,
}: {
  lang: Lang;
  data: ExpansionData;
  refresh: () => void;
}) {
  const [form, setForm] = useState({
    id: null as number | null,
    name: "",
    category: "",
    phone: "",
    email: "",
    notes: "",
  });
  return (
    <section className="toolkit-section">
      <form
        className="compact-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.name) return;
          await api.saveSupplier(form);
          setForm({
            id: null,
            name: "",
            category: "",
            phone: "",
            email: "",
            notes: "",
          });
          refresh();
        }}
      >
        <div className="field-pair">
          <label>
            <span>{lang === "es" ? "Nombre" : "Name"}</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            <span>{lang === "es" ? "Categoría" : "Category"}</span>
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
          </label>
        </div>
        <div className="field-pair">
          <label>
            <span>{lang === "es" ? "Teléfono" : "Phone"}</span>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label>
            <span>{lang === "es" ? "Correo" : "Email"}</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
        </div>
        <label>
          <span>{lang === "es" ? "Notas" : "Notes"}</span>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </label>
        <button className="primary-button">
          {lang === "es" ? "Guardar proveedor" : "Save supplier"}
        </button>
      </form>
      <div className="tool-records">
        {data.suppliers.map((s) => (
          <article key={s.id}>
            <div>
              <strong>
                {s.name} · {s.category}
              </strong>
              <span>
                {s.orderCount} {lang === "es" ? "compras" : "orders"} ·{" "}
                {usd(s.orderTotal)}
              </span>
              <small>
                {[s.phone, s.email, s.notes].filter(Boolean).join(" · ")}
              </small>
            </div>
            <div className="row-actions">
              <button
                onClick={() =>
                  setForm({
                    id: s.id,
                    name: s.name,
                    category: s.category,
                    phone: s.phone,
                    email: s.email,
                    notes: s.notes,
                  })
                }
              >
                {lang === "es" ? "Editar" : "Edit"}
              </button>
              {s.phone && (
                <a href={`tel:${s.phone}`}>
                  {lang === "es" ? "Llamar" : "Call"}
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MaintenanceManager({
  lang,
  data,
  refresh,
}: {
  lang: Lang;
  data: ExpansionData;
  refresh: () => void;
}) {
  const today = new Date().toLocaleDateString("en-CA");
  const [form, setForm] = useState({
    id: null as number | null,
    clientId: null as number | null,
    clientName: "",
    clientPhone: "",
    title: "",
    tasks: "",
    startDate: today,
    intervalMonths: 12,
    active: true,
  });
  const choose = (id: number) => {
    const c = data.clients.find((x) => x.id === id);
    if (c)
      setForm({
        ...form,
        clientId: c.id,
        clientName: c.name,
        clientPhone: c.phone,
      });
  };
  return (
    <section className="toolkit-section">
      <form
        className="compact-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.clientName || !form.title) return;
          await api.saveMaintenancePlan(form);
          setForm({
            id: null,
            clientId: null,
            clientName: "",
            clientPhone: "",
            title: "",
            tasks: "",
            startDate: today,
            intervalMonths: 12,
            active: true,
          });
          refresh();
        }}
      >
        <label>
          <span>{lang === "es" ? "Cliente existente" : "Existing client"}</span>
          <select
            value={form.clientId ?? ""}
            onChange={(e) =>
              e.target.value
                ? choose(Number(e.target.value))
                : setForm({ ...form, clientId: null })
            }
          >
            <option value="">—</option>
            {data.clients.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field-pair">
          <label>
            <span>{lang === "es" ? "Cliente" : "Client"}</span>
            <input
              value={form.clientName}
              onChange={(e) => setForm({ ...form, clientName: e.target.value })}
            />
          </label>
          <label>
            <span>{lang === "es" ? "Teléfono" : "Phone"}</span>
            <input
              value={form.clientPhone}
              onChange={(e) =>
                setForm({ ...form, clientPhone: e.target.value })
              }
            />
          </label>
        </div>
        <label>
          <span>{lang === "es" ? "Nombre del plan" : "Plan name"}</span>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={lang === "es" ? "Revisión anual" : "Annual check-up"}
          />
        </label>
        <label>
          <span>{lang === "es" ? "Tareas" : "Tasks"}</span>
          <textarea
            rows={3}
            value={form.tasks}
            onChange={(e) => setForm({ ...form, tasks: e.target.value })}
            placeholder={
              lang === "es"
                ? "Calafateo, lechada, retoques de pintura"
                : "Caulk, grout, paint touch-ups"
            }
          />
        </label>
        <div className="field-pair">
          <label>
            <span>{lang === "es" ? "Inicio" : "Start"}</span>
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          <label>
            <span>{lang === "es" ? "Cada (meses)" : "Every (months)"}</span>
            <input
              type="number"
              min="1"
              value={form.intervalMonths}
              onChange={(e) =>
                setForm({
                  ...form,
                  intervalMonths: Number(e.target.value) || 1,
                })
              }
            />
          </label>
        </div>
        <button className="primary-button">
          {lang === "es" ? "Guardar plan" : "Save plan"}
        </button>
      </form>
      <div className="tool-records">
        {data.plans.map((p) => (
          <article key={p.id}>
            <div>
              <strong>
                {p.clientName} · {p.title}
              </strong>
              <span>
                {lang === "es" ? "Próximo" : "Next"}:{" "}
                {dateLabel(p.nextDueDate, lang)} · {p.intervalMonths}{" "}
                {lang === "es" ? "meses" : "months"}
              </span>
              <small>{p.tasks}</small>
            </div>
            <div className="row-actions">
              <button
                onClick={() =>
                  setForm({
                    id: p.id,
                    clientId: p.clientId,
                    clientName: p.clientName,
                    clientPhone: p.clientPhone,
                    title: p.title,
                    tasks: p.tasks,
                    startDate: p.startDate,
                    intervalMonths: p.intervalMonths,
                    active: p.active,
                  })
                }
              >
                {lang === "es" ? "Editar" : "Edit"}
              </button>
              <button
                onClick={async () => {
                  await api.completeMaintenancePlan({ id: p.id });
                  refresh();
                }}
              >
                {lang === "es"
                  ? "Completar y programar siguiente"
                  : "Complete & schedule next"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
