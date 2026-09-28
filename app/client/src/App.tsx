import { SafeAreaTopScrim, bytesToBase64, fileToBase64 } from "@hatch/space-sdk/client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PDFDocument } from "pdf-lib";
import { gzipSync, gunzipSync, strFromU8, zipSync, strToU8 } from "fflate";
import { jsPDF } from "jspdf";
import {
Bar,
BarChart,
CartesianGrid,
Legend,
ResponsiveContainer,
Tooltip,
XAxis,
YAxis,
} from "recharts";
import {
createContext,
useContext,
useEffect,
useLayoutEffect,
useMemo,
useRef,
useState,
type ChangeEvent,
type CSSProperties,
type FormEvent,
type PointerEvent,
type ReactNode,
type TouchEvent,
} from "react";
import { api, AUTH_SESSION_INVALID_EVENT, clearActiveSessionToken, getStoredSessionToken, isCookieLoginResult, offlineCacheTimestamp, persistLegacySessionToken, restoreLegacySessionToken, setActiveSessionToken, trySilentRefresh, type ApiResponse, type PortalExpiryDays } from "./api";
import { disablePushSubscription, ensurePushSubscription, registerAppServiceWorker, requestPushPermissionAndSubscribe, type PushStatus } from "./push";
import { FieldIntelligenceScreen } from "./FieldIntelligence";
import { LegalDocumentPage, type LegalDocumentKind } from "./LegalPages";
import { MARKETPLACE_TERMS_EFFECTIVE_DATE, MARKETPLACE_TERMS_SECTIONS, MARKETPLACE_TERMS_VERSION } from "../../server/src/marketplace-terms";
import crewkatLogo from "./assets/crewkat-wrench-cat.webp";

type Lang = "en" | "es";
type Stage = "before" | "during" | "after";
type JobData = ApiResponse<typeof api, "getJob">;
type Job = NonNullable<JobData["job"]>;
type Photo = JobData["photos"][number];
type SignedDocument = JobData["documents"][number];
type Quote = ApiResponse<typeof api, "listQuotes">["quotes"][number];
type Invoice = ApiResponse<typeof api, "listInvoices">["invoices"][number];
type Client = ApiResponse<typeof api, "listClients">["clients"][number];
type Settings = ApiResponse<typeof api, "getSettings">;
type SettingsInput = Omit<Settings, "logoUrl" | "coverUrl">;
type MarketplaceListing = ApiResponse<typeof api, "listMarketplaceListings">["listings"][number];
type MarketplaceRequest = ApiResponse<typeof api, "listMarketplaceRequests">["requests"][number];
type MarketplaceCategory = MarketplaceListing["category"];
type QuoteTheme = "classic" | "modern" | "bold" | "minimal";
type DocumentFont = "helvetica" | "times" | "courier" | "palatino";
type AdjustmentType = "percent" | "fixed";
type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";
type ThemeMode = "light" | "dark" | "system";
type DocumentLabels = { headline: string; billTo: string; description: string; amount: string; subtotal: string; total: string; paid: string; balanceDue: string; number: string; date: string; dueDate: string };
type DocumentCustomize = { logoSize: "huge" | "big" | "medium" | "small"; removeLogoBackground: boolean; colorMode: "solid" | "gradient"; showQuantityUnitPrice: boolean; showDiscount: boolean; showTax: boolean; showAmount: boolean; showSummaryInfo: boolean; showSubtotal: boolean; showPaidSummary: boolean; showBalanceDue: boolean; showPaidStamp: boolean; showBusinessSignature: boolean; showThankYou: boolean; showBusinessName: boolean; showShortBusinessName: boolean; showLicenseNumber: boolean; showDueDate: boolean; headline: string; dateFormat: "long" | "numeric" | "euro"; termsConditions: string; signatureDataUrl: string; labels: DocumentLabels; fontSize: "s" | "m" | "l" | "xl"; lineSpacing: "compact" | "comfortable" | "roomy"; highContrast: boolean };
type DocumentDesign = { theme: QuoteTheme; font: DocumentFont; accentColor: string; showTaxLine: boolean; showDiscountLine: boolean; showPaidLine: boolean; showPaymentTerms: boolean; showFooterNotes: boolean; showLogo: boolean; showCompanyInfo: boolean; customizeJson: string };
type ToolMode =
  | "contract"
  | "change"
  | "punch"
  | "progress"
  | "annotate"
  | "texts"
  | "deposit"
  | "time"
  | "receipts"
  | "crew"
  | "voice"
  | "completion"
  | "beforeAfter"
  | "subcontractors";

const APP_INFO = {
  name: "Crewkat",
  version: "0.9.0",
  releaseYear: "2026",
  developer: "Crewkat",
  supportEmail: "stallionsconstructioncompany@gmail.com",
} as const;

const HELP_CONTENT = {
  en: {
    search: "Search help",
    noResults: "No help topics match that search.",
    questions: "Questions & answers",
    guides: "Step-by-step guides",
    qas: [
      [
        "Jobs",
        "How do I keep a project organized?",
        "Open Jobs, create the project, then use its grouped sections for photos, documents, quotes and invoices, client updates, and job tracking.",
      ],
      [
        "Clients",
        "Can I reuse a client's details?",
        "Yes. Add the client once, then choose them when creating a job or quote. Their jobs and quotes stay together in client history.",
      ],
      [
        "Quotes",
        "What happens after I send a quote?",
        "Set the sent and expiry dates. Today ranks quotes that need follow-up, and you can turn an accepted quote into a job or invoice.",
      ],
      [
        "Invoices",
        "How do I track what is still owed?",
        "Record partial payments on an invoice. Crewkat updates paid-to-date and remaining balance, and Today surfaces overdue balances.",
      ],
      [
        "Photos",
        "Where should job photos go?",
        "Add photos inside a job and mark them Before, During, or After. Add captions, annotate a copy, or mark the best photos for your website gallery.",
      ],
      [
        "Proof packets",
        "What is a proof packet?",
        "It combines the job details and selected site photos into a clear PDF record you can preview, download, or share.",
      ],
      [
        "Schedule",
        "How do I plan appointments?",
        "Open Operations, choose Schedule, then add an appointment with a date and time. Today's appointments also appear in your morning briefing.",
      ],
      [
        "Leads",
        "How does the lead pipeline work?",
        "Move each lead through New, Contacted, Quoted, Won, or Lost. The pipeline keeps the next sales step visible and calculates your win rate.",
      ],
      [
        "Payments",
        "Can I split a job into payment stages?",
        "Yes. Add deposit, progress, and final milestones inside Job operations, connect invoices when needed, and mark each milestone paid.",
      ],
      [
        "Today & automation",
        "What does Today automate?",
        "Today ranks appointments, quote follow-ups, overdue-payment messages, material deadlines, expiring quotes, review requests, reminders, and crew updates.",
      ],
    ],
    guidesList: [
      [
        "Create your first quote",
        [
          "Open Jobs, then Quotes.",
          "Tap New quote and choose or enter the client.",
          "Add work items, amounts, dates, and terms.",
          "Save, preview the PDF, then share it from your phone.",
        ],
      ],
      [
        "Build a proof packet",
        [
          "Open a job and add Before, During, and After photos.",
          "Add useful captions to the photos.",
          "Open Proof packet from the Photos group.",
          "Preview the pages, then download or share the PDF.",
        ],
      ],
      [
        "Chase an overdue invoice",
        [
          "Open Today and find Overdue payments.",
          "Review the balance and escalation stage.",
          "Tap the prepared message, adjust it if needed, and send.",
          "Record the payment on the invoice when it arrives.",
        ],
      ],
      [
        "Log a work day",
        [
          "Open the job, then Job operations.",
          "Choose Daily log.",
          "Enter the date, crew, hours, site notes, and photos.",
          "Save the log so it stays in the job timeline.",
        ],
      ],
      [
        "Set up selections",
        [
          "Open the job, then Job operations.",
          "Choose Selections and add the tile, fixture, paint, or other item.",
          "Set its status and lead time in days.",
          "Watch Today for the order-by deadline.",
        ],
      ],
      [
        "Use the morning briefing",
        [
          "Open Today at the start of the day.",
          "Work from the highest-priority cards first.",
          "Use the prepared call or text actions instead of rewriting messages.",
          "Mark items handled so the list stays focused.",
        ],
      ],
    ],
  },
  es: {
    search: "Buscar ayuda",
    noResults: "Ningún tema coincide con esa búsqueda.",
    questions: "Preguntas y respuestas",
    guides: "Guías paso a paso",
    qas: [
      [
        "Trabajos",
        "¿Cómo mantengo un proyecto organizado?",
        "Abre Trabajos, crea el proyecto y usa sus secciones agrupadas para fotos, documentos, cotizaciones y facturas, actualizaciones al cliente y seguimiento.",
      ],
      [
        "Clientes",
        "¿Puedo reutilizar los datos de un cliente?",
        "Sí. Agrega el cliente una vez y selecciónalo al crear un trabajo o cotización. Su historial mantiene juntos los trabajos y cotizaciones.",
      ],
      [
        "Cotizaciones",
        "¿Qué pasa después de enviar una cotización?",
        "Define las fechas de envío y vencimiento. Hoy prioriza las cotizaciones que necesitan seguimiento y puedes convertir una aceptada en trabajo o factura.",
      ],
      [
        "Facturas",
        "¿Cómo controlo lo que falta por cobrar?",
        "Registra pagos parciales en la factura. Crewkat actualiza lo pagado y el saldo, y Hoy muestra los pagos vencidos.",
      ],
      [
        "Fotos",
        "¿Dónde guardo las fotos del trabajo?",
        "Agrégalas dentro del trabajo y márcalas como Antes, Durante o Después. Añade descripciones, anota una copia o elige las mejores para la galería web.",
      ],
      [
        "Paquetes de evidencia",
        "¿Qué es un paquete de evidencia?",
        "Combina los datos del trabajo y las fotos seleccionadas en un PDF claro que puedes ver, descargar o compartir.",
      ],
      [
        "Calendario",
        "¿Cómo programo citas?",
        "Abre Operaciones, elige Calendario y agrega una cita con fecha y hora. Las citas de hoy también aparecen en el resumen de la mañana.",
      ],
      [
        "Prospectos",
        "¿Cómo funciona el embudo de prospectos?",
        "Mueve cada prospecto por Nuevo, Contactado, Cotizado, Ganado o Perdido. El embudo mantiene visible el próximo paso y calcula tu tasa de éxito.",
      ],
      [
        "Pagos",
        "¿Puedo dividir un trabajo en etapas de pago?",
        "Sí. Agrega depósito, progreso y pago final en Operaciones del trabajo, conecta facturas cuando haga falta y marca cada etapa como pagada.",
      ],
      [
        "Hoy y automatización",
        "¿Qué automatiza Hoy?",
        "Hoy prioriza citas, seguimiento de cotizaciones, mensajes de cobro, fechas de materiales, cotizaciones por vencer, solicitudes de reseñas, recordatorios y avisos al equipo.",
      ],
    ],
    guidesList: [
      [
        "Crear tu primera cotización",
        [
          "Abre Trabajos y después Cotizaciones.",
          "Toca Nueva cotización y elige o escribe el cliente.",
          "Agrega partidas, montos, fechas y términos.",
          "Guarda, revisa el PDF y compártelo desde tu teléfono.",
        ],
      ],
      [
        "Crear un paquete de evidencia",
        [
          "Abre un trabajo y agrega fotos de Antes, Durante y Después.",
          "Añade descripciones útiles.",
          "Abre Paquete de evidencia en el grupo Fotos.",
          "Revisa las páginas y descarga o comparte el PDF.",
        ],
      ],
      [
        "Cobrar una factura vencida",
        [
          "Abre Hoy y busca Pagos vencidos.",
          "Revisa el saldo y la etapa del aviso.",
          "Abre el mensaje preparado, ajústalo si hace falta y envíalo.",
          "Registra el pago en la factura cuando llegue.",
        ],
      ],
      [
        "Registrar un día de trabajo",
        [
          "Abre el trabajo y luego Operaciones del trabajo.",
          "Elige Registro diario.",
          "Ingresa fecha, equipo, horas, notas y fotos.",
          "Guarda el registro para verlo en la cronología.",
        ],
      ],
      [
        "Configurar selecciones",
        [
          "Abre el trabajo y luego Operaciones del trabajo.",
          "Elige Selecciones y agrega el azulejo, accesorio, pintura u otro artículo.",
          "Define el estado y el tiempo de entrega en días.",
          "Revisa Hoy para ver la fecha límite de pedido.",
        ],
      ],
      [
        "Usar el resumen de la mañana",
        [
          "Abre Hoy al comenzar el día.",
          "Empieza por las tarjetas de mayor prioridad.",
          "Usa las acciones de llamada o texto ya preparadas.",
          "Marca lo atendido para mantener la lista enfocada.",
        ],
      ],
    ],
  },
} as const;
type Screen =
  | { name: "today" }
  | { name: "marketplace" }
  | { name: "marketplaceNew"; listingType: "job" | "project" }
  | { name: "marketplaceEdit"; listingId: number }
  | { name: "marketplaceDetail"; listingId: number; openMessages?: boolean }
  | { name: "tools" }
  | { name: "proWorkspace" }
  | { name: "upgrade" }
  | { name: "toolbox"; tab?: "loan" | "materials" | "angle" | "convert" | "area" | "yards" | "board" | "drywall" | "roofing" | "tile" | "margin" | "paint" | "flooring" | "fence" | "block" | "gravel" | "stairs" | "insulation" | "gutter" | "rate" | "punchlist" }
  | { name: "jobs" }
  | { name: "new" }
  | { name: "expansion"; tab?: "losses" | "warranties" | "videos" | "crew" | "scanner" | "tax" | "suppliers" | "plans" }
  | { name: "fieldIntelligence"; tab?: "purchasing" | "equipment" | "safety" | "credentials" | "payroll" | "costs" }
  | { name: "detail"; jobId: number }
  | { name: "proof"; jobId: number }
  | { name: "settings" }
  | { name: "legal"; document: LegalDocumentKind }
  | { name: "companyProfile" }
  | { name: "quotes" }
  | { name: "quoteNew"; clientId?: number }
  | { name: "quotePreview"; quoteId: number }
  | { name: "invoices" }
  | { name: "invoiceNew"; jobId?: number }
  | { name: "invoicePreview"; invoiceId: number }
  | { name: "clients" }
  | { name: "clientNew" }
  | { name: "client"; clientId: number }
  | { name: "followups" }
  | { name: "gallery" }
  | { name: "referrals" }
  | { name: "operations"; tab?: "calendar" | "leads" }
  | { name: "reports" }
  | { name: "businessTools"; tab?: "price" | "templates" | "mileage" | "expenses" | "analysis" }
  | { name: "admin" }
  | { name: "platformAdmin"; tab?: PlatformAdminTab; refundEmail?: string }
  | { name: "platformAdminUser"; userId: number }
  | { name: "jobOps"; jobId: number }
  | { name: "tool"; jobId: number; mode: ToolMode; photoId?: number };

const copy = {
  en: {
    jobs: "Jobs",
    newJob: "New job",
    search: "Search jobs",
    noJobs: "Your first job starts here.",
    firstHint: "Create a job, then add your first site photo.",
    client: "Client name",
    phone: "Client phone",
    email: "Client email",
    address: "Job address",
    type: "Job type",
    notes: "Notes",
    date: "Job date",
    appointment: "Appointment",
    create: "Create job",
    back: "Back",
    save: "Save",
    saving: "Saving…",
    done: "Done",
    edit: "Edit details",
    required: "Complete the required fields.",
    error: "Something went wrong. Try again.",
    clients: "Clients",
    newClient: "New client",
    chooseClient: "Choose an existing client",
    searchClients: "Search clients",
    clientHistory: "Client history",
    deleteClient: "Delete client",
    jobsAndQuotes: "Jobs & quotes",
    noClients: "No clients yet.",
    before: "Before",
    during: "During",
    after: "After",
    camera: "Take photo",
    gallery: "Choose photos",
    addCaption: "Add a caption",
    moveTo: "Move photo",
    deletePhoto: "Delete photo",
    noPhotos: "No photos here yet.",
    photos: "photos",
    photo: "photo",
    documentation: "Photo documentation",
    proof: "Proof packet",
    social: "Share to social",
    socialWait: "Preparing post…",
    socialReady: "Caption copied. Photos sent to the share sheet.",
    socialFallbackOne:
      "File sharing is not supported here, so the selected photo was downloaded. The caption is copied—attach the photo to your post.",
    socialFallbackMany:
      "File sharing is not supported here, so the selected photos were downloaded as a ZIP. The caption is copied—attach the photos to your post.",
    socialShareClosedOne:
      "The share sheet did not send the photo, so it was downloaded instead. The caption is copied—attach the photo to your post.",
    socialShareClosedMany:
      "The share sheet did not send the photos, so they were downloaded as a ZIP instead. The caption is copied—attach the photos to your post.",
    socialNoPhotos: "Add a Before or After photo before sharing.",
    socialError: "The photos could not be prepared. Try again.",
    quoteBuilder: "Quotes",
    followups: "Follow-ups",
    websiteGallery: "Website gallery",
    actionCenter: "Action center",
    overdue: "Overdue",
    quoteFollowups: "Quote follow-ups",
    noActions: "Nothing needs attention.",
    fieldTools: "Job tools",
    photosGroup: "Photos",
    documentsGroup: "Documents",
    quotesInvoicesGroup: "Quotes & invoices",
    clientUpdatesGroup: "Client updates",
    jobTrackingGroup: "Job tracking",
    contract: "Contract signer",
    change: "Change order",
    punch: "Walkthrough list",
    progress: "Progress update",
    texts: "Client texts",
    deposit: "Deposit request",
    annotations: "Annotate",
    galleryPick: "Gallery pick",
    amountDue: "Amount due",
    dueDate: "Due date",
    depositAmount: "Deposit amount",
    paymentNotes: "Payment notes",
    invoice: "Invoice details",
    paymentInstructions: "Payment instructions",
    followDays: "Quote follow-up after days",
    settings: "Company settings",
    businessIdentity: "Business identity",
    contactAndPayments: "Contact & payments",
    documentDefaults: "Documents & language",
    company: "Company name",
    license: "License number",
    companyPhone: "Company phone",
    companyEmail: "Company email",
    companyAddress: "Company address",
    website: "Website",
    reviewLink: "Google review link",
    language: "Default language",
    watermark: "Brand social photos",
    offersFree: "Mention free estimates",
    english: "English",
    spanish: "Español",
    yourDocument: "Your document, signed.",
    noTemplates:
      "Upload your own PDF or paste your own contract text. Crewkat provides no contract templates or legal advice.",
    title: "Document title",
    uploadPdf: "Upload your PDF",
    pasteText: "Or paste your contract text",
    signer: "Printed name",
    signature: "Signature",
    clear: "Clear",
    signSave: "Sign & save",
    signed: "Signed",
    download: "Download PDF",
    sharePdf: "Share PDF",
    changeDescription: "Extra work description",
    amount: "Amount",
    signedDocuments: "Signed documents",
    changeTotal: "Signed change orders",
    addItem: "Add item",
    itemPlaceholder: "Walkthrough item",
    customerName: "Customer printed name",
    contractorName: "Contractor printed name",
    customerSignature: "Customer signature",
    contractorSignature: "Contractor signature",
    signOff: "Complete sign-off",
    completedSignoff: "Walkthrough signed off",
    dayNumber: "Day number",
    updateNote: "Short update",
    chooseUpdatePhotos: "Choose photos",
    saveShare: "Save & share update",
    saveDraft: "Save draft",
    drafts: "Drafts",
    savedUpdates: "Sent updates",
    resume: "Resume",
    sendNow: "Send now",
    deleteDraft: "Delete draft",
    draftSaved: "Draft saved.",
    pen: "Pen",
    circle: "Circle",
    arrow: "Arrow",
    saveCopy: "Save annotated copy",
    selectPhoto: "Select a photo to mark up",
    newQuote: "New quote",
    lineItems: "Line items",
    item: "Work item",
    subtotal: "Subtotal",
    discount: "Discount",
    tax: "Tax",
    percent: "Percentage",
    fixed: "Fixed amount",
    total: "Total",
    expiry: "Expiry date",
    sentDate: "Sent date",
    addLine: "Add line",
    saveQuote: "Save quote",
    convertJob: "Convert to job",
    convertInvoice: "Create invoice",
    followUp: "Follow up",
    sentDays: "sent {days} days ago",
    quoteEmpty: "No quotes yet.",
    previewPdf: "Preview PDF",
    quoteTheme: "Document theme",
    classic: "Classic",
    modern: "Modern",
    bold: "Bold",
    minimal: "Minimal",
    defaultTheme: "Default document theme",
    accentColor: "Document accent color",
    companyLogo: "Company logo",
    uploadLogo: "Upload logo",
    replaceLogo: "Replace logo",
    documentFont: "Document font",
    defaultFont: "Default document font",
    fontHelvetica: "Clean sans",
    fontTimes: "Traditional serif",
    fontCourier: "Technical mono",
    fontPalatino: "Elegant serif",
    footnote: "Footnote / terms",
    defaultFootnote: "Default footnote",
    invoices: "Invoices",
    newInvoice: "New invoice",
    invoiceEmpty: "No invoices yet.",
    issueDate: "Issue date",
    invoiceStatus: "Status",
    draft: "Draft",
    sent: "Sent",
    paid: "Paid",
    overdueStatus: "Overdue",
    saveInvoice: "Save invoice",
    fromQuote: "Invoice created from quote",
    viewDocument: "View document",
    pdfPreview: "PDF preview",
    close: "Close",
    publicLinkNote:
      "Client links will be available in the public launch. For now, share the PDF securely from your phone.",
    exportGallery: "Export website bundle",
    galleryEmpty: "Mark photos as Gallery picks from a job.",
    bundleReady: "Website bundle downloaded.",
    paymentReminder: "Payment reminder",
    depositRequest: "Deposit request",
    shareRequest: "Share request",
    smsUpgrade: "Automatic versions are coming with the SMS upgrade.",
    appointmentConfirm: "Appointment confirmation",
    onMyWay: "On my way",
    missedCall: "Missed call / call back",
    eta: "ETA",
    openSms: "Open text message",
    noPhone: "Add the client phone number first.",
    timeTracking: "Time tracking",
    clockIn: "Clock in",
    clockOut: "Clock out",
    running: "Running",
    totalHours: "Total hours",
    timeNote: "Work note",
    receipts: "Receipts",
    receiptPhoto: "Receipt photo",
    vendor: "Vendor",
    materialsTotal: "Materials total",
    purchaseDate: "Purchase date",
    crewChecklist: "Crew checklist",
    taskName: "Task name",
    rename: "Rename",
    voiceNotes: "Voice notes",
    record: "Record",
    stopRecording: "Stop recording",
    recording: "Recording…",
    noteTitle: "Note title",
    partialPayments: "Payments",
    recordPayment: "Record payment",
    paidToDate: "Paid to date",
    balanceRemaining: "Balance remaining",
    method: "Method",
    paymentDate: "Payment date",
    recurring: "Recurring",
    frequency: "Frequency",
    none: "Not recurring",
    weekly: "Weekly",
    monthly: "Monthly",
    nextDue: "Next invoice due",
    generateNext: "Generate next invoice",
    recurringDue: "Recurring invoices due",
    completionCertificate: "Completion certificate",
    completionDate: "Completion date",
    warrantyTerms: "Warranty terms",
    saveCertificate: "Save certificate",
    referrals: "Referrals",
    referredBy: "Referred by",
    referralCount: "referrals",
    noReferrer: "No referrer",
    addRecording: "Save voice note",
    permissionsError:
      "Microphone access is unavailable. You can upload an audio file instead.",
    uploadAudio: "Upload audio",
    delete: "Delete",
    hours: "hours",
    minutes: "minutes",
    downloadPdf: "Download PDF",
    pdfWait: "Building PDF…",
    reviewAsk: "Happy with the work? Leave us a Google review",
    prepared: "Prepared",
    captured: "Captured",
    jobDetails: "Job details",
    noResults: "No jobs match that search.",
    clientLink: "Client link",
    clientLinkIntro: "Share a secure link so your client can view this document on their phone. No account needed.",
    createClientLink: "Create client link",
    resendClientLink: "Resend link",
    copyClientLink: "Copy link",
    revokeClientLink: "Revoke link",
    linkCopied: "Link copied",
    linkCopyOnce: "Copy it now — for security this link can't be shown again.",
    linkExpires: "Link expires",
    linkRevoked: "Link revoked",
    revokeConfirm: "Revoke this link? Your client will no longer be able to open it.",
    viewed: "Viewed",
    notViewed: "Not viewed yet",
    viewCount: "views",
    firstViewed: "First viewed",
    signHere: "Sign here",
    signDocument: "Sign document",
    signerName: "Your full name",
    signerNamePlaceholder: "Type your full name",
    signatureDrawHint: "Draw your signature below with your finger",
    signAndFinish: "Sign & finish",
    signing: "Signing…",
    signedThanks: "Thank you! Your signature has been recorded.",
    signedOn: "Signed on",
    alreadySigned: "Already signed",
    linkInvalid: "This link isn't working",
    linkInvalidHint: "It may have expired or been replaced. Please ask for a new link.",
    linkSecureNote: "This is a secure, private link just for you.",
    forLabel: "For",
  },
  es: {
    jobs: "Trabajos",
    newJob: "Nuevo trabajo",
    search: "Buscar trabajos",
    noJobs: "Tu primer trabajo comienza aquí.",
    firstHint: "Crea un trabajo y agrega tu primera foto.",
    client: "Nombre del cliente",
    phone: "Teléfono del cliente",
    email: "Correo del cliente",
    address: "Dirección",
    type: "Tipo de trabajo",
    notes: "Notas",
    date: "Fecha",
    appointment: "Cita",
    create: "Crear trabajo",
    back: "Atrás",
    save: "Guardar",
    saving: "Guardando…",
    done: "Listo",
    edit: "Editar detalles",
    required: "Completa los campos obligatorios.",
    error: "Algo salió mal. Inténtalo de nuevo.",
    clients: "Clientes",
    newClient: "Nuevo cliente",
    chooseClient: "Elegir cliente existente",
    searchClients: "Buscar clientes",
    clientHistory: "Historial del cliente",
    deleteClient: "Eliminar cliente",
    jobsAndQuotes: "Trabajos y cotizaciones",
    noClients: "Aún no hay clientes.",
    before: "Antes",
    during: "Durante",
    after: "Después",
    camera: "Tomar foto",
    gallery: "Elegir fotos",
    addCaption: "Agregar descripción",
    moveTo: "Mover foto",
    deletePhoto: "Eliminar foto",
    noPhotos: "Aún no hay fotos aquí.",
    photos: "fotos",
    photo: "foto",
    documentation: "Documentación fotográfica",
    proof: "Paquete de evidencia",
    social: "Compartir en redes",
    socialWait: "Preparando publicación…",
    socialReady: "Texto copiado. Las fotos se enviaron al menú de compartir.",
    socialFallbackOne:
      "Aquí no se pueden compartir archivos directamente, así que se descargó la foto elegida. El texto está copiado; adjunta la foto a tu publicación.",
    socialFallbackMany:
      "Aquí no se pueden compartir archivos directamente, así que las fotos elegidas se descargaron en un ZIP. El texto está copiado; adjunta las fotos a tu publicación.",
    socialShareClosedOne:
      "El menú de compartir no envió la foto, así que se descargó. El texto está copiado; adjunta la foto a tu publicación.",
    socialShareClosedMany:
      "El menú de compartir no envió las fotos, así que se descargaron en un ZIP. El texto está copiado; adjunta las fotos a tu publicación.",
    socialNoPhotos: "Agrega una foto de Antes o Después antes de compartir.",
    socialError: "No se pudieron preparar las fotos. Inténtalo de nuevo.",
    quoteBuilder: "Cotizaciones",
    followups: "Seguimientos",
    websiteGallery: "Galería web",
    actionCenter: "Centro de acciones",
    overdue: "Vencidos",
    quoteFollowups: "Seguimiento de cotizaciones",
    noActions: "Nada necesita atención.",
    fieldTools: "Herramientas",
    photosGroup: "Fotos",
    documentsGroup: "Documentos",
    quotesInvoicesGroup: "Cotizaciones y facturas",
    clientUpdatesGroup: "Actualizaciones al cliente",
    jobTrackingGroup: "Seguimiento del trabajo",
    contract: "Firmar contrato",
    change: "Orden de cambio",
    punch: "Lista de recorrido",
    progress: "Actualización",
    texts: "Textos al cliente",
    deposit: "Solicitud de depósito",
    annotations: "Anotar",
    galleryPick: "Elegir para galería",
    amountDue: "Saldo pendiente",
    dueDate: "Fecha de vencimiento",
    depositAmount: "Monto del depósito",
    paymentNotes: "Notas de pago",
    invoice: "Detalles de factura",
    paymentInstructions: "Instrucciones de pago",
    followDays: "Seguimiento de cotización después de días",
    settings: "Datos de la empresa",
    businessIdentity: "Identidad del negocio",
    contactAndPayments: "Contacto y pagos",
    documentDefaults: "Documentos e idioma",
    company: "Nombre de la empresa",
    license: "Licencia",
    companyPhone: "Teléfono de la empresa",
    companyEmail: "Correo de la empresa",
    companyAddress: "Dirección de la empresa",
    website: "Sitio web",
    reviewLink: "Enlace de reseña de Google",
    language: "Idioma predeterminado",
    watermark: "Marca en fotos sociales",
    offersFree: "Mencionar estimados gratis",
    english: "English",
    spanish: "Español",
    yourDocument: "Tu documento, firmado.",
    noTemplates:
      "Sube tu propio PDF o pega tu propio contrato. Crewkat no ofrece plantillas ni asesoría legal.",
    title: "Título del documento",
    uploadPdf: "Subir tu PDF",
    pasteText: "O pega el texto del contrato",
    signer: "Nombre en letra de molde",
    signature: "Firma",
    clear: "Borrar",
    signSave: "Firmar y guardar",
    signed: "Firmado",
    download: "Descargar PDF",
    sharePdf: "Compartir PDF",
    changeDescription: "Descripción del trabajo extra",
    amount: "Monto",
    signedDocuments: "Documentos firmados",
    changeTotal: "Órdenes de cambio firmadas",
    addItem: "Agregar",
    itemPlaceholder: "Elemento del recorrido",
    customerName: "Nombre del cliente",
    contractorName: "Nombre del contratista",
    customerSignature: "Firma del cliente",
    contractorSignature: "Firma del contratista",
    signOff: "Completar firmas",
    completedSignoff: "Recorrido firmado",
    dayNumber: "Día número",
    updateNote: "Actualización breve",
    chooseUpdatePhotos: "Elegir fotos",
    saveShare: "Guardar y compartir",
    saveDraft: "Guardar borrador",
    drafts: "Borradores",
    savedUpdates: "Actualizaciones enviadas",
    resume: "Continuar",
    sendNow: "Enviar ahora",
    deleteDraft: "Eliminar borrador",
    draftSaved: "Borrador guardado.",
    pen: "Lápiz",
    circle: "Círculo",
    arrow: "Flecha",
    saveCopy: "Guardar copia anotada",
    selectPhoto: "Selecciona una foto para marcar",
    newQuote: "Nueva cotización",
    lineItems: "Partidas",
    item: "Trabajo",
    subtotal: "Subtotal",
    discount: "Descuento",
    tax: "Impuesto",
    percent: "Porcentaje",
    fixed: "Monto fijo",
    total: "Total",
    expiry: "Vence",
    sentDate: "Fecha de envío",
    addLine: "Agregar partida",
    saveQuote: "Guardar cotización",
    convertJob: "Convertir en trabajo",
    convertInvoice: "Crear factura",
    followUp: "Dar seguimiento",
    sentDays: "enviada hace {days} días",
    quoteEmpty: "Aún no hay cotizaciones.",
    previewPdf: "Vista previa PDF",
    quoteTheme: "Tema del documento",
    classic: "Clásico",
    modern: "Moderno",
    bold: "Audaz",
    minimal: "Mínimo",
    defaultTheme: "Tema predeterminado",
    accentColor: "Color del documento",
    companyLogo: "Logo de la empresa",
    uploadLogo: "Subir logo",
    replaceLogo: "Cambiar logo",
    documentFont: "Fuente del documento",
    defaultFont: "Fuente predeterminada",
    fontHelvetica: "Sans limpia",
    fontTimes: "Serif tradicional",
    fontCourier: "Mono técnica",
    fontPalatino: "Serif elegante",
    footnote: "Nota al pie / términos",
    defaultFootnote: "Nota al pie predeterminada",
    invoices: "Facturas",
    newInvoice: "Nueva factura",
    invoiceEmpty: "Aún no hay facturas.",
    issueDate: "Fecha de emisión",
    invoiceStatus: "Estado",
    draft: "Borrador",
    sent: "Enviada",
    paid: "Pagada",
    overdueStatus: "Vencida",
    saveInvoice: "Guardar factura",
    fromQuote: "Factura creada desde cotización",
    viewDocument: "Ver documento",
    pdfPreview: "Vista previa PDF",
    close: "Cerrar",
    publicLinkNote:
      "Los enlaces para clientes estarán disponibles en el lanzamiento público. Por ahora, comparte el PDF de forma segura desde tu teléfono.",
    exportGallery: "Exportar paquete web",
    galleryEmpty: "Marca fotos como elegidas para galería desde un trabajo.",
    bundleReady: "Paquete web descargado.",
    paymentReminder: "Recordatorio de pago",
    depositRequest: "Solicitud de depósito",
    shareRequest: "Compartir solicitud",
    smsUpgrade: "Las versiones automáticas llegarán con la mejora de SMS.",
    appointmentConfirm: "Confirmación de cita",
    onMyWay: "Voy en camino",
    missedCall: "Llamada perdida",
    eta: "Hora de llegada",
    openSms: "Abrir mensaje",
    noPhone: "Agrega primero el teléfono del cliente.",
    timeTracking: "Control de tiempo",
    clockIn: "Marcar entrada",
    clockOut: "Marcar salida",
    running: "En curso",
    totalHours: "Horas totales",
    timeNote: "Nota de trabajo",
    receipts: "Recibos",
    receiptPhoto: "Foto del recibo",
    vendor: "Proveedor",
    materialsTotal: "Total de materiales",
    purchaseDate: "Fecha de compra",
    crewChecklist: "Lista del equipo",
    taskName: "Nombre de tarea",
    rename: "Renombrar",
    voiceNotes: "Notas de voz",
    record: "Grabar",
    stopRecording: "Detener",
    recording: "Grabando…",
    noteTitle: "Título de nota",
    partialPayments: "Pagos",
    recordPayment: "Registrar pago",
    paidToDate: "Pagado",
    balanceRemaining: "Saldo restante",
    method: "Método",
    paymentDate: "Fecha de pago",
    recurring: "Recurrente",
    frequency: "Frecuencia",
    none: "No recurrente",
    weekly: "Semanal",
    monthly: "Mensual",
    nextDue: "Próxima factura",
    generateNext: "Generar próxima factura",
    recurringDue: "Facturas recurrentes pendientes",
    completionCertificate: "Certificado de finalización",
    completionDate: "Fecha de finalización",
    warrantyTerms: "Términos de garantía",
    saveCertificate: "Guardar certificado",
    referrals: "Referidos",
    referredBy: "Referido por",
    referralCount: "referidos",
    noReferrer: "Sin referente",
    addRecording: "Guardar nota de voz",
    permissionsError:
      "No se puede acceder al micrófono. Puedes subir un archivo de audio.",
    uploadAudio: "Subir audio",
    delete: "Eliminar",
    hours: "horas",
    minutes: "minutos",
    downloadPdf: "Descargar PDF",
    pdfWait: "Creando PDF…",
    reviewAsk: "¿Feliz con el trabajo? Déjanos una reseña en Google",
    prepared: "Preparado",
    captured: "Capturada",
    jobDetails: "Detalles del trabajo",
    noResults: "Ningún trabajo coincide.",
    clientLink: "Enlace del cliente",
    clientLinkIntro: "Comparte un enlace seguro para que tu cliente vea este documento en su teléfono. Sin cuenta.",
    createClientLink: "Crear enlace",
    resendClientLink: "Reenviar enlace",
    copyClientLink: "Copiar enlace",
    revokeClientLink: "Revocar enlace",
    linkCopied: "Enlace copiado",
    linkCopyOnce: "Cópialo ahora — por seguridad este enlace no se puede mostrar de nuevo.",
    linkExpires: "El enlace vence",
    linkRevoked: "Enlace revocado",
    revokeConfirm: "¿Revocar este enlace? Tu cliente ya no podrá abrirlo.",
    viewed: "Visto",
    notViewed: "Aún no visto",
    viewCount: "vistas",
    firstViewed: "Visto por primera vez",
    signHere: "Firma aquí",
    signDocument: "Firmar documento",
    signerName: "Tu nombre completo",
    signerNamePlaceholder: "Escribe tu nombre completo",
    signatureDrawHint: "Dibuja tu firma abajo con tu dedo",
    signAndFinish: "Firmar y terminar",
    signing: "Firmando…",
    signedThanks: "¡Gracias! Tu firma ha sido registrada.",
    signedOn: "Firmado el",
    alreadySigned: "Ya firmado",
    linkInvalid: "Este enlace no funciona",
    linkInvalidHint: "Puede haber vencido o sido reemplazado. Pide un enlace nuevo.",
    linkSecureNote: "Este es un enlace seguro y privado solo para ti.",
    forLabel: "Para",
  },
} as const;

// ---------------------------------------------------------------------------
// Chunk D: offline mode v1 — banner + cached-list "last updated" note.
// ---------------------------------------------------------------------------

/** Returns true when the browser thinks the network is down. */
function useIsOffline(): boolean {
  const [offline, setOffline] = useState(typeof navigator !== "undefined" && navigator.onLine === false);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return offline;
}

/** Slim banner shown at the top of the app while offline. */
function OfflineBanner({ lang }: { lang: Lang }) {
  const offline = useIsOffline();
  if (!offline) return null;
  return (
    <div className="offline-banner" role="status">
      {lang === "es"
        ? "Sin conexión — estás viendo la información guardada en este teléfono."
        : "You're offline — showing what's saved on this phone."}
    </div>
  );
}

/** "Last updated …" note rendered under a list served from the offline cache. */
function OfflineCacheNote({ lang, action, isLoading }: { lang: Lang; action: "listJobs" | "listClients" | "listInvoices" | "listQuotes"; isLoading: boolean }) {
  const offline = useIsOffline();
  const [, forceRender] = useState(0);
  useEffect(() => {
    if (!isLoading) forceRender((n) => n + 1);
  }, [isLoading]);
  const at = offlineCacheTimestamp(action);
  if (offline || at == null) return null;
  const when = new Date(at);
  const stamp = when.toLocaleString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <p className="offline-note" role="status">
      <span className="dot" aria-hidden="true" />
      {lang === "es" ? `Datos guardados — última actualización: ${stamp}` : `Saved data — last updated ${stamp}`}
    </p>
  );
}

function Icon({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
const BackIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);
const CameraIcon = () => (
  <Icon>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3" />
  </Icon>
);
const FileIcon = () => (
  <Icon>
    <path d="M6 2h8l4 4v16H6z" />
    <path d="M14 2v5h5M9 13h6M9 17h6" />
  </Icon>
);
const GearIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="3" />
    <path d="M19 12h3M2 12h3M12 2v3M12 19v3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
  </Icon>
);
const ShareIcon = () => (
  <Icon>
    <circle cx="18" cy="5" r="2" />
    <circle cx="6" cy="12" r="2" />
    <circle cx="18" cy="19" r="2" />
    <path d="m8 11 8-5M8 13l8 5" />
  </Icon>
);
const TrashIcon = () => (
  <Icon size={18}>
    <path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14" />
  </Icon>
);
const CheckIcon = () => (
  <Icon>
    <path d="m5 12 4 4L19 6" />
  </Icon>
);

type RootTab = "today" | "jobs" | "invoices" | "clients" | "marketplace" | "tools";
function rootTabFor(screen: Screen): RootTab {
  if (screen.name === "today") return "today";
  if (["jobs", "new", "detail", "proof", "jobOps", "tool"].includes(screen.name)) return "jobs";
  if (["invoices", "invoiceNew", "invoicePreview", "quotes", "quoteNew", "quotePreview"].includes(screen.name)) return "invoices";
  if (["clients", "clientNew", "client"].includes(screen.name)) return "clients";
  if (["marketplace", "marketplaceNew", "marketplaceEdit", "marketplaceDetail"].includes(screen.name)) return "marketplace";
  return "tools";
}
function BottomNav({ lang, active, onSelect, onNavigate }: { lang: Lang; active: RootTab; onSelect: (tab: RootTab) => void; onNavigate: (screen: Screen) => void }) {
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const inboxQuery = useQuery({ queryKey: ["marketplace-inbox"], queryFn: () => api.getMarketplaceInbox({}), refetchInterval: 10000 });
  const notificationsQuery = useQuery({ queryKey: ["marketplace-notifications"], queryFn: () => api.listNotifications({}), refetchInterval: 30000 });
  // Chunk D: the Marketplace badge covers both unread messages and notifications.
  const unreadMarketplace = (inboxQuery.data?.unreadCount ?? 0) + (notificationsQuery.data?.unreadCount ?? 0);
  const items: Array<{ tab: RootTab; label: string; icon: ReactNode; badge?: number }> = [
    { tab: "today", label: lang === "es" ? "Inicio" : "Home", icon: <Icon><path d="m3 11 9-8 9 8M5 10v10h14V10M9 20v-6h6v6" /></Icon> },
    { tab: "jobs", label: lang === "es" ? "Trabajos" : "Jobs", icon: <Icon><path d="M4 7h16v13H4zM8 7V4h8v3M4 11h16M10 11v2h4v-2" /></Icon> },
    { tab: "invoices", label: lang === "es" ? "Facturas" : "Invoices", icon: <Icon><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h4" /></Icon> },
    { tab: "marketplace", label: lang === "es" ? "Mercado" : "Marketplace", icon: <Icon><path d="M4 10h16v10H4zM3 10l2-6h14l2 6M8 10v2M16 10v2M9 20v-5h6v5" /></Icon>, badge: unreadMarketplace },
  ];
  const quickActions: Array<{ label: string; destination: Screen; icon: ReactNode }> = [
    { label: lang === "es" ? "Nuevo trabajo" : "New job", destination: { name: "new" }, icon: <Icon><path d="M4 7h16v13H4zM8 7V4h8v3M4 11h16" /></Icon> },
    { label: lang === "es" ? "Nuevo estimado" : "New estimate", destination: { name: "quoteNew" }, icon: <Icon><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h3" /></Icon> },
    { label: lang === "es" ? "Nueva factura" : "New invoice", destination: { name: "invoiceNew" }, icon: <Icon><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" /></Icon> },
    { label: lang === "es" ? "Nuevo cliente" : "New client", destination: { name: "clientNew" }, icon: <Icon><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3-7 8-7s8 3 8 7M19 4v6M16 7h6"/></Icon> },
  ];
  const selectDestination = (destination: Screen) => {
    setQuickCreateOpen(false);
    onNavigate(destination);
  };
  return <>
    <nav className="bottom-nav" aria-label={lang === "es" ? "Navegación principal" : "Main navigation"}>
      {items.slice(0, 2).map((item) => <button type="button" key={item.tab} className={active === item.tab ? "active" : ""} aria-current={active === item.tab ? "page" : undefined} onClick={() => onSelect(item.tab)}><span className="bottom-nav-icon">{item.icon}{(item.badge ?? 0) > 0 && <span className="nav-unread-badge">{Math.min(item.badge ?? 0, 99)}</span>}</span><span>{item.label}</span></button>)}
      <button type="button" className="bottom-nav-add" aria-label={lang === "es" ? "Crear nuevo" : "Create new"} aria-expanded={quickCreateOpen} onClick={() => setQuickCreateOpen(true)}><span aria-hidden="true">+</span></button>
      {items.slice(2).map((item) => <button type="button" key={item.tab} className={active === item.tab ? "active" : ""} aria-current={active === item.tab ? "page" : undefined} onClick={() => onSelect(item.tab)}><span className="bottom-nav-icon">{item.icon}{(item.badge ?? 0) > 0 && <span className="nav-unread-badge">{Math.min(item.badge ?? 0, 99)}</span>}</span><span>{item.label}</span></button>)}
    </nav>
    {quickCreateOpen && <div className="quick-create-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setQuickCreateOpen(false); }}>
      <section className="quick-create-sheet" role="dialog" aria-modal="true" aria-labelledby="quick-create-title">
        <header><div><span>{lang === "es" ? "Acceso rápido" : "Quick create"}</span><h2 id="quick-create-title">{lang === "es" ? "¿Qué deseas crear?" : "What would you like to create?"}</h2></div><button type="button" aria-label={lang === "es" ? "Cerrar" : "Close"} onClick={() => setQuickCreateOpen(false)}><Icon><path d="m6 6 12 12M18 6 6 18" /></Icon></button></header>
        <div className="quick-create-grid">
          {quickActions.map((action) => <button type="button" key={action.destination.name} onClick={() => selectDestination(action.destination)}><span>{action.icon}</span><strong>{action.label}</strong><BackIcon /></button>)}
        </div>
      </section>
    </div>}
  </>;
}

const SettingsNavigationContext = createContext<(() => void) | null>(null);
const ToolsNavigationContext = createContext<(() => void) | null>(null);

function PageHeader({
  lang,
  title,
  onBack,
  actions,
}: {
  lang: Lang;
  title: string;
  onBack?: () => void;
  actions?: ReactNode;
}) {
  const openSettings = useContext(SettingsNavigationContext);
  const openTools = useContext(ToolsNavigationContext);
  return (
    <header className="app-header">
      <div className="header-side">
        {onBack && (
          <button
            className="icon-button"
            onClick={onBack}
            aria-label={copy[lang].back}
          >
            <BackIcon />
          </button>
        )}
      </div>
      <h1>
        {title === APP_INFO.name ? (
          <span className="app-brand-lockup">
            <img src={crewkatLogo} alt="" aria-hidden="true" />
            <span>{APP_INFO.name}</span>
          </span>
        ) : title}
      </h1>
      <div className="header-actions">
        {actions}
        {openTools && (
          <button
            className="icon-button"
            onClick={openTools}
            aria-label={lang === "es" ? "Abrir herramientas" : "Open tools"}
          >
            <Icon><path d="M14 6a4 4 0 0 0-5 5L3 17l4 4 6-6a4 4 0 0 0 5-5l-3 3-4-4z"/></Icon>
          </button>
        )}
        {openSettings && (
          <button
            className="icon-button master-settings-button"
            onClick={openSettings}
            aria-label={lang === "es" ? "Abrir configuración" : "Open settings"}
          >
            <GearIcon />
          </button>
        )}
      </div>
    </header>
  );
}
function formatDate(value: string, lang: Lang) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}
function safeName(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "") || "document"
  );
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}
async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
async function blobDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error());
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
function money(value: string) {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function smsHref(phone: string, message: string) {
  return `sms:${phone.replace(/[^+0-9]/g, "")}?body=${encodeURIComponent(message)}`;
}
function companyContact(settings: Settings | null, separator = " · ") {
  return [
    settings?.phone,
    settings?.email,
    settings?.website,
    settings?.address,
  ]
    .filter(Boolean)
    .join(separator);
}
function companySignature(settings: Settings | null) {
  return [
    settings?.companyName,
    settings?.licenseNumber,
    companyContact(settings),
  ]
    .filter(Boolean)
    .join(" · ");
}
async function nativeShare(
  blob: Blob,
  filename: string,
  title: string,
  text?: string,
) {
  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream",
  });
  if (
    navigator.share &&
    (!navigator.canShare || navigator.canShare({ files: [file] }))
  )
    await navigator
      .share({ title, text, files: [file] })
      .catch(() => undefined);
  else downloadBlob(blob, filename);
}
async function downloadSocialPhotos(files: File[], jobType: string) {
  if (files.length === 1) {
    const file = files[0];
    if (file) downloadBlob(file, file.name);
    return;
  }
  const entries: Record<string, Uint8Array> = {};
  for (const file of files)
    entries[file.name] = new Uint8Array(await file.arrayBuffer());
  downloadBlob(
    new Blob([zipSync(entries)], { type: "application/zip" }),
    `${safeName(jobType)}-social-photos.zip`,
  );
}

function SignaturePad({
  label,
  clearLabel,
  onChange,
}: {
  label: string;
  clearLabel: string;
  onChange: (data: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    };
  };
  const start = (e: PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    last.current = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const p = point(e);
    ctx.strokeStyle = "#17201e";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };
  const end = () => {
    drawing.current = false;
    const c = canvasRef.current;
    if (c) onChange(c.toDataURL("image/png").split(",")[1] ?? "");
  };
  const clear = () => {
    const c = canvasRef.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    onChange("");
  };
  return (
    <div className="signature-field">
      <div className="signature-head">
        <span>{label}</span>
        <button type="button" onClick={clear}>
          {clearLabel}
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={720}
        height={220}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        aria-label={label}
      />
    </div>
  );
}

type NavigationScrollSnapshot = {
  windowX: number;
  windowY: number;
  pageTop: number;
  surfaces: Record<string, { left: number; top: number }>;
};

type NavigationScrollIntent =
  | { mode: "top" }
  | { mode: "restore"; snapshot: NavigationScrollSnapshot };

const NAVIGATION_SCROLL_SURFACES = [
  ["document", () => document.scrollingElement],
  ["html", () => document.documentElement],
  ["body", () => document.body],
  ["root", () => document.getElementById("root")],
  ["hatch-root", () => document.querySelector(".hatch-space-root")],
  ["app-shell", () => document.querySelector(".app-shell")],
] as const;

function navigationScrollSurfaces() {
  const surfaces = new Map<string, HTMLElement>();
  const seen = new Set<HTMLElement>();
  for (const [name, getElement] of NAVIGATION_SCROLL_SURFACES) {
    const element = getElement();
    if (element instanceof HTMLElement && !seen.has(element)) {
      surfaces.set(name, element);
      seen.add(element);
    }
  }
  // Some Muse hosts make an app descendant, rather than the document, the
  // active viewport. Structural keys let the same screen recover that offset
  // after it remounts, and also preserve intentional inner-scroll positions.
  document.querySelectorAll(".app-shell, .app-shell *").forEach((element, index) => {
    if (element instanceof HTMLElement && !seen.has(element)) {
      surfaces.set(`app-${index}`, element);
      seen.add(element);
    }
  });
  return surfaces;
}

function captureNavigationScroll(): NavigationScrollSnapshot {
  const surfaces: NavigationScrollSnapshot["surfaces"] = {};
  navigationScrollSurfaces().forEach((element, name) => {
    if (!name.startsWith("app-") || element.scrollLeft !== 0 || element.scrollTop !== 0) {
      surfaces[name] = { left: element.scrollLeft, top: element.scrollTop };
    }
  });
  const page = document.querySelector(".app-shell > main");
  return {
    windowX: window.scrollX,
    windowY: window.scrollY,
    pageTop: page instanceof HTMLElement ? page.getBoundingClientRect().top : 0,
    surfaces,
  };
}

function applyNavigationScroll(intent: NavigationScrollIntent) {
  const top = intent.mode === "restore" ? intent.snapshot.windowY : 0;
  const left = intent.mode === "restore" ? intent.snapshot.windowX : window.scrollX;
  window.scrollTo({ top, left, behavior: "auto" });
  navigationScrollSurfaces().forEach((element, name) => {
    const saved = intent.mode === "restore" ? intent.snapshot.surfaces[name] : undefined;
    element.scrollTo({
      top: saved?.top ?? 0,
      left: saved?.left ?? 0,
      behavior: "auto",
    });
  });
  const page = document.querySelector(".app-shell > main");
  if (intent.mode === "top") {
    // scrollIntoView targets whichever ancestor the host made scrollable. Doing
    // this after clearing known surfaces also defeats browser scroll anchoring
    // from the button that disappeared during the route change.
    page?.scrollIntoView({
      block: "start",
      inline: "nearest",
      behavior: "auto",
    });
    window.scrollTo({ top: 0, left, behavior: "auto" });
  } else if (page instanceof HTMLElement) {
    // Some embedded browsers report zero for their scrolling element even
    // while the page visibly moves. Reproduce the saved page-edge position as
    // a visual fallback, independent of which ancestor owns the viewport.
    const delta = page.getBoundingClientRect().top - intent.snapshot.pageTop;
    if (Math.abs(delta) >= 1) window.scrollBy({ top: delta, behavior: "auto" });
  }
}

function runNavigationScroll(intent: NavigationScrollIntent) {
  // Apply only during the route commit. Delayed retries used to run after the
  // user had already started touching the new screen, which could reset a
  // perfectly normal scroll and feel like a page reload on a phone.
  applyNavigationScroll(intent);
  let secondFrame = window.requestAnimationFrame(() => applyNavigationScroll(intent));
  const stopForInteraction = () => {
    window.cancelAnimationFrame(secondFrame);
    secondFrame = 0;
  };
  window.addEventListener("touchstart", stopForInteraction, { once: true, passive: true });
  window.addEventListener("pointerdown", stopForInteraction, { once: true, passive: true });
  window.addEventListener("wheel", stopForInteraction, { once: true, passive: true });
  return () => {
    window.cancelAnimationFrame(secondFrame);
    window.removeEventListener("touchstart", stopForInteraction);
    window.removeEventListener("pointerdown", stopForInteraction);
    window.removeEventListener("wheel", stopForInteraction);
  };
}

function canScrollUpInside(target: EventTarget | null, shell: HTMLElement) {
  let element = target instanceof HTMLElement ? target : null;
  while (element && shell.contains(element)) {
    if (element.scrollHeight > element.clientHeight + 1 && element.scrollTop > 0.5) return true;
    if (element === shell) break;
    element = element.parentElement;
  }
  return false;
}

function useBlockHostPullToRefresh(shellRef: { current: HTMLDivElement | null }) {
  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    let lastTouchY: number | null = null;
    const onTouchStart = (event: globalThis.TouchEvent) => {
      lastTouchY = event.touches.length === 1 ? (event.touches[0]?.clientY ?? null) : null;
    };
    const onTouchMove = (event: globalThis.TouchEvent) => {
      const currentY = event.touches.length === 1 ? event.touches[0]?.clientY : undefined;
      if (currentY === undefined || lastTouchY === null) {
        lastTouchY = null;
        return;
      }
      const movingTowardTop = currentY > lastTouchY;
      lastTouchY = currentY;
      // Muse previews and some Android WebViews can hand a downward drag to
      // their parent pull-to-refresh control as soon as the inner scroller
      // reaches its top edge. Consume only that otherwise-unhandled edge
      // motion; ordinary scrolling and nested panels keep their native feel.
      if (movingTowardTop && !canScrollUpInside(event.target, shell) && event.cancelable) {
        event.preventDefault();
      }
    };
    const clearTouch = () => {
      lastTouchY = null;
    };

    shell.addEventListener("touchstart", onTouchStart, { passive: true });
    shell.addEventListener("touchmove", onTouchMove, { passive: false });
    shell.addEventListener("touchend", clearTouch, { passive: true });
    shell.addEventListener("touchcancel", clearTouch, { passive: true });
    return () => {
      shell.removeEventListener("touchstart", onTouchStart);
      shell.removeEventListener("touchmove", onTouchMove);
      shell.removeEventListener("touchend", clearTouch);
      shell.removeEventListener("touchcancel", clearTouch);
    };
  }, [shellRef]);
}

type AuthUser = ApiResponse<typeof api, "login">["user"];
const AuthContext = createContext<{ user: AuthUser; signOut: () => Promise<void> } | null>(null);

function actionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Something went wrong. Try again.";
  return message.replace(/^action [^ ]+ error:\s*/i, "");
}

// Maps machine-readable server sentinels to localized, user-friendly text.
// Any other server message passes through untouched.
function friendlyActionMessage(error: unknown, lang: Lang) {
  const message = actionErrorMessage(error);
  if (message === "MARKETPLACE_DISABLED") return lang === "es" ? "El Marketplace está temporalmente desactivado. Vuelve a intentarlo más tarde." : "The Marketplace is temporarily disabled. Please check back later.";
  if (message === "REGISTRATIONS_CLOSED") return "Registrations are temporarily closed. / El registro está temporalmente cerrado.";
  return message;
}

function PublicEntry({ kind, token }: { kind: "document" | "portal" | "booking"; token: string }) {
  const shellRef = useRef<HTMLDivElement>(null);
  useBlockHostPullToRefresh(shellRef);
  return <div className="app-shell" ref={shellRef}>
    <SafeAreaTopScrim backgroundColor="var(--bg)" />
    {kind === "document" && <ClientDocumentScreen token={token} />}
    {kind === "portal" && <ClientPortalScreen lang="en" token={token} />}
    {kind === "booking" && <BookingRequestScreen lang="en" />}
  </div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: AuthUser) => void }) {
  const bootstrap = useQuery({ queryKey: ["auth-bootstrap"], queryFn: () => api.getAuthBootstrap({}), retry: false });
  const [restoring, setRestoring] = useState(true);
  // Restore the previous session so the owner stays signed in across app
  // restarts: first a legacy pre-cookie token (transition window), otherwise
  // a silent refresh via the HttpOnly cookie. Falls through to sign-in.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const legacy = getStoredSessionToken();
      if (legacy) {
        restoreLegacySessionToken(legacy);
        try {
          const result = await api.getAuthSession({ _sessionToken: "active" });
          if (cancelled) return;
          if (result.user) {
            onAuthenticated(result.user);
            return;
          }
          clearActiveSessionToken();
        } catch {
          // A transport/server failure is not an auth verdict: retain the
          // legacy token and still try the cookie path before showing sign-in.
        }
      }
      const refreshed = await trySilentRefresh(Boolean(legacy)).catch(() => false);
      if (cancelled) return;
      if (refreshed) {
        try {
          const result = await api.getAuthSession({ _sessionToken: "active" });
          if (cancelled) return;
          if (result.user) {
            onAuthenticated(result.user);
            return;
          }
        } catch {
          // Both restoration paths failed; show the sign-in form below.
        }
      }
      setRestoring(false);
    })();
    return () => { cancelled = true; };
  }, [onAuthenticated]);
  const [mode, setMode] = useState<"login" | "signup" | "verify" | "forgot" | "reset">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [devCode, setDevCode] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedMarketplaceTerms, setAcceptedMarketplaceTerms] = useState(false);
  const [legalDocument, setLegalDocument] = useState<LegalDocumentKind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // Chunk D: referral links land here as ?ref=CODE — keep it for signup.
  const referralCode = useMemo(() => {
    try {
      const value = new URLSearchParams(window.location.search).get("ref");
      return value && /^[A-Za-z0-9]{4,12}$/.test(value) ? value : "";
    } catch { return ""; }
  }, []);
  const hasAccount = bootstrap.data?.hasAccount ?? true;
  useEffect(() => { if (bootstrap.data && !bootstrap.data.hasAccount) setMode("signup"); }, [bootstrap.data]);
  const move = (next: typeof mode) => { setMode(next); setError(""); setNotice(""); setCode(""); setDevCode(""); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      if (mode === "signup") {
        if (!acceptedTerms) { setError("You must agree to the Terms of Service and Privacy Policy to create an account."); return; }
        if (!acceptedMarketplaceTerms) { setError("You must agree to the Marketplace Terms of Use to create an account."); return; }
        const result = await api.signUp({ name, email, password, marketplaceTermsAccepted: true, referralCode: referralCode || undefined });
        setEmail(result.email); setDevCode(result.verificationCode ?? ""); setMode("verify"); setPassword("");
        if (result.emailDelivery === "sent") setNotice(`We emailed a verification code to ${result.email}.`);
        else if (result.emailDelivery === "failed") setNotice("Your account was created, but the email could not be sent. Use Get a new code to try again.");
        else setNotice(result.existingDataClaimed ? "Account created. Use the testing code below to claim the existing Crewkat workspace." : "Account created. Use the testing code below to continue.");
      } else if (mode === "verify") {
        await api.verifyEmail({ email, code });
        await bootstrap.refetch(); setMode("login"); setCode(""); setDevCode(""); setNotice("Email verified. Sign in to open Crewkat.");
      } else if (mode === "forgot") {
        const result = await api.requestPasswordReset({ email });
        setDevCode(result.resetCode ?? ""); setMode("reset");
        setNotice(result.emailDelivery === "fallback" ? "Use the testing code below to reset your password." : result.emailDelivery === "failed" ? "If that account exists, its reset email could not be sent. Try requesting a new code." : "If that account exists, we emailed a reset code.");
      } else if (mode === "reset") {
        await api.resetPassword({ email, code, password });
        setMode("login"); setCode(""); setPassword(""); setDevCode(""); setNotice("Password updated. Sign in with your new password.");
      } else {
        const result = await api.login({ email, password });
        if (isCookieLoginResult(result)) setActiveSessionToken(result.sessionToken);
        else persistLegacySessionToken(result.sessionToken);
        onAuthenticated(result.user);
      }
    } catch (caught) { setError(friendlyActionMessage(caught, "en")); } finally { setBusy(false); }
  };
  const title = mode === "signup" ? "Set up your owner account" : mode === "verify" ? "Verify your email" : mode === "forgot" ? "Reset your password" : mode === "reset" ? "Enter your reset code" : "Welcome back";
  if (legalDocument) return <div className="app-shell"><LegalDocumentPage kind={legalDocument} onBack={() => setLegalDocument(null)} /></div>;
  if (restoring) return <main className="auth-page">
    <SafeAreaTopScrim backgroundColor="var(--bg)" />
    <section className="auth-panel">
      <div className="auth-brand" aria-label="Crewkat">
        <img src={crewkatLogo} alt="Crewkat charcoal cat mascot holding a wrench" />
        <span>Crewkat</span>
      </div>
      <p className="auth-intro">Signing you back in…</p>
    </section>
  </main>;
  return <main className="auth-page">
    <SafeAreaTopScrim backgroundColor="var(--bg)" />
    <section className="auth-panel">
      <div className="auth-brand" aria-label="Crewkat">
        <img src={crewkatLogo} alt="Crewkat charcoal cat mascot holding a wrench" />
        <span>Crewkat</span>
      </div>
      <h1>{title}</h1>
      <p className="auth-intro">{mode === "login" ? "Sign in to manage your jobs, invoices, and clients." : mode === "signup" ? "Create a secure owner account and an empty company workspace." : mode === "verify" ? `Enter the 6-digit code for ${email}.` : "Use a one-time code to choose a new password."}</p>
      {mode === "signup" && bootstrap.data?.ownerClaimAvailable && (bootstrap.data.recordCounts.jobs + bootstrap.data.recordCounts.clients + bootstrap.data.recordCounts.invoices > 0) && <div className="auth-claim"><strong>Your existing workspace is ready</strong><span>{bootstrap.data.recordCounts.jobs} jobs · {bootstrap.data.recordCounts.clients} clients · {bootstrap.data.recordCounts.invoices} invoices</span><small>These records will stay intact and attach to the owner account.</small></div>}
      {mode === "signup" && referralCode && <div className="auth-claim"><strong>Invited by a friend</strong><span>You were invited with code {referralCode} — your friend earns bonus Marketplace listings when you join.</span></div>}
      <form className="auth-form" onSubmit={submit}>
        {mode === "signup" && <label><span>Name</span><input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} /></label>}
        <label><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={mode === "verify" || mode === "reset"} /></label>
        {(mode === "login" || mode === "signup" || mode === "reset") && <label><span>{mode === "reset" ? "New password" : "Password"}</span><input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "login" ? 1 : 10} /><small>{mode !== "login" ? "Use at least 10 characters." : ""}</small></label>}
        {(mode === "verify" || mode === "reset") && <label><span>6-digit code</span><input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} required /></label>}
        {mode === "signup" && <div className="auth-consent"><input aria-label="Agree to the Terms of Service and Privacy Policy" type="checkbox" checked={acceptedTerms} onChange={(event) => setAcceptedTerms(event.target.checked)} required /><span>I agree to the <button type="button" className="legal-inline-button" onClick={() => setLegalDocument("terms")}>Terms of Service</button> and acknowledge the <button type="button" className="legal-inline-button" onClick={() => setLegalDocument("privacy")}>Privacy Policy</button>.</span></div>}
        {mode === "signup" && <div className="auth-consent"><input aria-label="Agree to the Marketplace Terms of Use" type="checkbox" checked={acceptedMarketplaceTerms} onChange={(event) => setAcceptedMarketplaceTerms(event.target.checked)} required /><span>I agree to the <button type="button" className="legal-inline-button" onClick={() => setLegalDocument("marketplace")}>Marketplace Terms of Use</button>.</span></div>}
        {devCode && <div className="dev-code" role="status"><strong>Testing code</strong><code>{devCode}</code><small>No transactional email key is configured, so this fallback code is shown here. It expires in 30 minutes.</small></div>}
        {notice && <p className="status auth-success">{notice}</p>}
        {error && <p className="status error">{error}</p>}
        <button className="primary-button auth-submit" type="submit" disabled={busy || bootstrap.isLoading || (mode === "signup" && (!acceptedTerms || !acceptedMarketplaceTerms))}>{busy ? "Please wait…" : mode === "signup" ? "Create account" : mode === "verify" ? "Verify email" : mode === "forgot" ? "Get reset code" : mode === "reset" ? "Save new password" : "Sign in"}</button>
      </form>
      <div className="auth-links">
        {mode === "login" && <button type="button" onClick={() => move("forgot")}>Forgot password?</button>}
        {mode === "login" && <button type="button" onClick={() => move("signup")}>Create a company account</button>}
        {mode === "signup" && hasAccount && <button type="button" onClick={() => move("login")}>Already have an account? Sign in</button>}
        {(mode === "forgot" || mode === "reset" || mode === "verify") && <button type="button" onClick={() => move("login")}>Back to sign in</button>}
        {mode === "verify" && <button type="button" onClick={async () => { setBusy(true); setError(""); try { const result = await api.resendVerification({ email }); setDevCode(result.verificationCode ?? ""); setNotice(result.emailDelivery === "fallback" ? "Use the new testing code below." : result.emailDelivery === "failed" ? "The email could not be sent. Try again in a moment." : `We emailed a new verification code to ${email}.`); } catch (caught) { setError(actionErrorMessage(caught)); } finally { setBusy(false); } }}>Get a new code</button>}
      </div>
      <div className="auth-security"><p>Passwords are hashed before storage. You stay signed in on this device — sign out any time from Settings → Account.</p><nav className="auth-legal-links" aria-label="Legal documents"><button type="button" onClick={() => setLegalDocument("terms")}>Terms of Service</button><button type="button" onClick={() => setLegalDocument("privacy")}>Privacy Policy</button><button type="button" onClick={() => setLegalDocument("marketplace")}>Marketplace Terms</button></nav></div>
    </section>
  </main>;
}

// Blocking screen for users who have not accepted the current Marketplace
// Terms of Use (signed up before the terms existed, or the version changed).
function MarketplaceTermsGate({ onAccepted }: { onAccepted: (acceptedAt: string, version: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accept = async () => {
    setBusy(true); setError("");
    try {
      const result = await api.acceptMarketplaceTerms({ version: MARKETPLACE_TERMS_VERSION });
      onAccepted(result.acceptedAt, result.version);
    } catch (caught) { setError(actionErrorMessage(caught)); } finally { setBusy(false); }
  };
  return (
    <main className="page legal-page">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      <header className="app-header legal-header">
        <div className="header-side" />
        <h1>Marketplace Terms of Use</h1>
        <div className="header-actions" />
      </header>
      <article className="legal-document">
        <p className="legal-effective"><strong>Effective:</strong> {MARKETPLACE_TERMS_EFFECTIVE_DATE}</p>
        <p className="legal-intro">We've added terms for the Crewkat Marketplace. Please read and accept them to continue using Crewkat.</p>
        {MARKETPLACE_TERMS_SECTIONS.map((section) => (
          <section key={section.heading} className="legal-section">
            <h2>{section.heading}</h2>
            {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          </section>
        ))}
      </article>
      <div className="terms-gate-footer">
        {error && <p className="status error">{error}</p>}
        <button type="button" className="primary-button" onClick={accept} disabled={busy}>{busy ? "Saving…" : "I agree to the Marketplace Terms of Use"}</button>
      </div>
    </main>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  useEffect(() => {
    const handleInvalidSession = () => {
      queryClient.clear();
      setUser(null);
    };
    window.addEventListener(AUTH_SESSION_INVALID_EVENT, handleInvalidSession);
    return () => window.removeEventListener(AUTH_SESSION_INVALID_EVENT, handleInvalidSession);
  }, [queryClient]);
  // Chunk D: register the app service worker (offline mode + web push).
  useEffect(() => {
    void registerAppServiceWorker();
  }, []);
  // Chunk D: keep the push subscription current once signed in. Never prompts —
  // if permission isn't already granted the user enables it from Settings.
  useEffect(() => {
    if (user) void ensurePushSubscription();
  }, [user]);
  const params = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const hash = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const docToken = hash.get("doc") ?? "";
  const portalToken = hash.get("portal") ?? "";
  if (docToken) return <PublicEntry kind="document" token={docToken} />;
  if (portalToken) return <PublicEntry kind="portal" token={portalToken} />;
  if (params.has("booking")) return <PublicEntry kind="booking" token="" />;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;
  // Existing users who signed up before the Marketplace Terms existed (or a
  // newer version shipped) must accept before they can use the app.
  if (!user.marketplaceTermsAcceptedAt || user.marketplaceTermsVersion !== MARKETPLACE_TERMS_VERSION) {
    return <MarketplaceTermsGate onAccepted={(acceptedAt, version) => setUser({ ...user, marketplaceTermsAcceptedAt: acceptedAt, marketplaceTermsVersion: version })} />;
  }
  const signOut = async () => {
    try { await api.logout({ _sessionToken: "active" }); } finally { clearActiveSessionToken(); queryClient.clear(); setUser(null); }
  };
  return <AuthContext.Provider value={{ user, signOut }}><CrewkatApplication /></AuthContext.Provider>;
}

function SampleDataButton({
  lang,
  onLoaded,
}: {
  lang: Lang;
  onLoaded?: () => void;
}) {
  const client = useQueryClient();
  const [error, setError] = useState("");
  const load = useMutation({
    mutationFn: () => api.loadSampleData({}),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["jobs"] });
      await client.invalidateQueries({ queryKey: ["clients"] });
      await client.invalidateQueries({ queryKey: ["quotes"] });
      onLoaded?.();
    },
    onError: (e) => setError(actionErrorMessage(e)),
  });
  return (
    <div className="sample-data-block">
      <button
        type="button"
        className="secondary-button"
        disabled={load.isPending}
        onClick={() => {
          setError("");
          load.mutate();
        }}
      >
        {load.isPending
          ? lang === "es" ? "Cargando\u2026" : "Loading\u2026"
          : lang === "es" ? "Cargar datos de ejemplo" : "Load sample data"}
      </button>
      <p className="privacy-note">
        {lang === "es"
          ? "Agrega un cliente, un trabajo y un presupuesto de ejemplo para explorar. Puedes eliminarlos cuando quieras."
          : "Adds a sample client, job, and estimate so you can explore. You can delete them anytime."}
      </p>
      {error && <p className="form-error">{error}</p>}
    </div>
  );
}

function OnboardingTour({ lang }: { lang: Lang }) {
  const auth = useContext(AuthContext);
  const userId = auth?.user.id ?? 0;
  const [dismissed, setDismissed] = useState(
    () => window.localStorage.getItem(`crewkat-onboarding-${userId}`) === "done",
  );
  const [step, setStep] = useState(0);
  const jobsQuery = useQuery({
    queryKey: ["jobs", ""],
    queryFn: () => api.listJobs({ search: "" }),
  });
  const dismiss = () => {
    window.localStorage.setItem(`crewkat-onboarding-${userId}`, "done");
    setDismissed(true);
  };
  const createdAtMs = auth?.user.createdAt ? Date.parse(auth.user.createdAt) : NaN;
  const accountAgeDays = Number.isFinite(createdAtMs) ? (Date.now() - createdAtMs) / 86400000 : 99;
  // While jobs are loading, treat as non-empty so the tour never flashes.
  const jobCount = jobsQuery.data ? jobsQuery.data.jobs.length : 1;
  const eligible = !dismissed && accountAgeDays < 7 && jobCount === 0;
  const steps = [
    {
      icon: (
        <Icon>
          <path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" />
        </Icon>
      ),
      title: lang === "es" ? "Bienvenido a Crewkat" : "Welcome to Crewkat",
      body:
        lang === "es"
          ? "Tus trabajos, presupuestos, facturas y herramientas de cuadrilla en un solo lugar."
          : "Your jobs, estimates, invoices, and crew tools in one place.",
    },
    {
      icon: (
        <Icon>
          <path d="M4 7h16v13H4zM4 7l2-3h12l2 3M9 11h6" />
        </Icon>
      ),
      title: lang === "es" ? "Controla cada trabajo" : "Track every job",
      body:
        lang === "es"
          ? "Fotos, registro diario, listas de pendientes y documentos organizados por trabajo."
          : "Photos, daily log, punch lists, and documents stay organized per job.",
    },
    {
      icon: (
        <Icon>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" />
        </Icon>
      ),
      title:
        lang === "es"
          ? "Del presupuesto a la factura en un toque"
          : "Estimates to invoices in one tap",
      body:
        lang === "es"
          ? "Convierte un presupuesto aceptado en factura al instante, y programa facturas recurrentes autom\u00e1ticas."
          : "Convert an accepted estimate into an invoice instantly, and set invoices to repeat automatically.",
    },
    {
      icon: (
        <Icon>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </Icon>
      ),
      title: lang === "es" ? "Explora con datos de ejemplo" : "Explore with sample data",
      body:
        lang === "es"
          ? "Carga un ejemplo para ver c\u00f3mo funciona todo, o empieza creando tu primer trabajo."
          : "Load a sample to see how everything works, or start by creating your first job.",
    },
  ];
  if (!eligible) return null;
  const current = steps[Math.min(step, steps.length - 1)] as (typeof steps)[number];
  return (
    <div className="onboarding-backdrop" role="dialog" aria-modal="true" aria-label={current.title}>
      <section className="onboarding-card">
        <button type="button" className="onboarding-skip" onClick={dismiss}>
          {lang === "es" ? "Omitir" : "Skip"}
        </button>
        <div className="onboarding-icon">{current.icon}</div>
        <h2>{current.title}</h2>
        <p>{current.body}</p>
        {step === steps.length - 1 && <SampleDataButton lang={lang} onLoaded={dismiss} />}
        <div className="onboarding-dots" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={i === step ? "active" : ""} />
          ))}
        </div>
        <div className="onboarding-nav">
          {step > 0 && (
            <button type="button" className="secondary-button" onClick={() => setStep(step - 1)}>
              {lang === "es" ? "Atr\u00e1s" : "Back"}
            </button>
          )}
          {step < steps.length - 1 ? (
            <button type="button" className="primary-button" onClick={() => setStep(step + 1)}>
              {lang === "es" ? "Siguiente" : "Next"}
            </button>
          ) : (
            <button type="button" className="primary-button" onClick={dismiss}>
              {lang === "es" ? "Comenzar" : "Get started"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function CrewkatApplication() {
  const client = useQueryClient();
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("Authentication context is unavailable.");
  const appShellRef = useRef<HTMLDivElement>(null);
  useBlockHostPullToRefresh(appShellRef);
  useEffect(() => {
    const viewport = window.visualViewport;
    const updateKeyboardOffset = () => {
      const offset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      document.documentElement.style.setProperty("--keyboard-offset", `${Math.round(offset)}px`);
    };
    updateKeyboardOffset();
    viewport?.addEventListener("resize", updateKeyboardOffset);
    viewport?.addEventListener("scroll", updateKeyboardOffset);
    window.addEventListener("resize", updateKeyboardOffset);
    return () => {
      viewport?.removeEventListener("resize", updateKeyboardOffset);
      viewport?.removeEventListener("scroll", updateKeyboardOffset);
      window.removeEventListener("resize", updateKeyboardOffset);
      document.documentElement.style.removeProperty("--keyboard-offset");
    };
  }, []);
  const [screenStack, setScreenStack] = useState<Screen[]>([{ name: "today" }]);
  const [dismissedBanner, setDismissedBanner] = useState(() => window.localStorage.getItem("crewkat-banner-dismissed") ?? "");
  const scrollSnapshotsRef = useRef<Array<NavigationScrollSnapshot | undefined>>([]);
  const scrollIntentRef = useRef<NavigationScrollIntent>({ mode: "top" });
  const [scrollNavigationKey, setScrollNavigationKey] = useState(1);
  const [lang, setLang] = useState<Lang>("en");
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === "undefined") return "system";
    const saved = window.localStorage.getItem("crewkat-theme") ?? window.localStorage.getItem("tradesign-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const screen: Screen = screenStack[screenStack.length - 1] ?? {
    name: "today",
  };
  const requestNavigationScroll = (intent: NavigationScrollIntent) => {
    scrollIntentRef.current = intent;
    setScrollNavigationKey((key) => key + 1);
  };
  const setScreen = (next: Screen) => {
    const premiumScreen = next.name === "proWorkspace" || next.name === "businessTools" || next.name === "admin" || next.name === "expansion" || next.name === "fieldIntelligence" || next.name === "reports" || next.name === "followups";
    const destination: Screen = auth.user.tier === "free" && premiumScreen ? { name: "upgrade" } : next;
    const currentIndex = Math.max(0, screenStack.length - 1);
    scrollSnapshotsRef.current[currentIndex] = captureNavigationScroll();
    setScreenStack((stack) => [...stack, destination]);
    requestNavigationScroll({ mode: "top" });
  };
  const goBack = () => {
    if (screenStack.length <= 1) {
      scrollSnapshotsRef.current = [];
      setScreenStack([{ name: "today" }]);
      requestNavigationScroll({ mode: "top" });
      return;
    }
    const targetIndex = screenStack.length - 2;
    const snapshot = scrollSnapshotsRef.current[targetIndex];
    scrollSnapshotsRef.current = scrollSnapshotsRef.current.slice(0, targetIndex + 1);
    setScreenStack((stack) => stack.slice(0, -1));
    requestNavigationScroll(snapshot ? { mode: "restore", snapshot } : { mode: "top" });
  };
  const openRoot = (tab: RootTab) => {
    scrollSnapshotsRef.current = [];
    setScreenStack([{ name: tab }]);
    requestNavigationScroll({ mode: "top" });
  };
  useLayoutEffect(() => runNavigationScroll(scrollIntentRef.current), [scrollNavigationKey]);
  useEffect(() => {
    if (!("scrollRestoration" in window.history)) return;
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);
  const settings = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.getSettings({}),
  });
  useEffect(() => {
    if (settings.data) setLang(settings.data.language);
  }, [settings.data]);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => {
    if (themeMode === "system")
      document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem("crewkat-theme", themeMode);
  }, [themeMode]);
  const saveSettings = useMutation({
    mutationFn: (v: SettingsInput) => api.updateSettings(v),
    onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }),
  });
  const inProWorkspace = screenStack.some((item) => item.name === "proWorkspace");
  const appSettings: Settings | null = settings.data
    ? { ...settings.data, simpleMode: !inProWorkspace }
    : null;
  const goJob = (jobId: number) => {
    const currentIndex = Math.max(0, screenStack.length - 1);
    scrollSnapshotsRef.current[currentIndex] = undefined;
    setScreenStack((stack) => [
      ...stack.slice(0, -1),
      { name: "detail", jobId },
    ]);
    requestNavigationScroll({ mode: "top" });
  };
  const publicParams =
    typeof window === "undefined"
      ? new URLSearchParams()
      : new URLSearchParams(window.location.search);
  const [portalToken] = useState(() => {
    if (typeof window === "undefined") return "";
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const incoming = hash.get("portal");
    if (incoming) {
      sessionStorage.setItem("crewkat-portal-token", incoming);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      return incoming;
    }
    return sessionStorage.getItem("crewkat-portal-token") ?? sessionStorage.getItem("fieldhq-portal-token") ?? "";
  });
  // Secure client document links (#doc=): the token lives in React memory only
  // and is never written to localStorage or sessionStorage.
  const [docToken] = useState(() => {
    if (typeof window === "undefined") return "";
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return hash.get("doc") ?? "";
  });
  if (portalToken)
    return (
      <div className="app-shell" ref={appShellRef}>
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <ClientPortalScreen lang={lang} token={portalToken} />
      </div>
    );
  if (docToken)
    return (
      <div className="app-shell" ref={appShellRef}>
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <ClientDocumentScreen token={docToken} />
      </div>
    );
  if (publicParams.has("booking"))
    return (
      <div className="app-shell" ref={appShellRef}>
        <SafeAreaTopScrim backgroundColor="var(--bg)" />
        <BookingRequestScreen lang={lang} />
      </div>
    );
  return (
    <SettingsNavigationContext.Provider
      value={screen.name === "settings" ? null : () => setScreen({ name: "settings" })}
    >
    <ToolsNavigationContext.Provider
      value={screen.name === "tools" ? null : () => setScreen({ name: "tools" })}
    >
    <div className="app-shell" ref={appShellRef}>
      <SafeAreaTopScrim backgroundColor="var(--bg)" />
      {auth.user.announcementBanner.trim() && dismissedBanner !== auth.user.announcementBanner.trim() && (
        <div className="announcement-banner" role="status">
          <p>{auth.user.announcementBanner.trim()}</p>
          <button type="button" aria-label={lang === "es" ? "Cerrar anuncio" : "Dismiss announcement"} onClick={() => { const v = auth.user.announcementBanner.trim(); setDismissedBanner(v); window.localStorage.setItem("crewkat-banner-dismissed", v); }}>×</button>
        </div>
      )}
      <OnboardingTour lang={lang} />
      <OfflineBanner lang={lang} />
      {screen.name === "today" && (
        <TodayScreen
          lang={lang}
          settings={appSettings}
          setScreen={setScreen}
          toggleLanguage={() => {
            const next = lang === "en" ? "es" : "en";
            setLang(next);
            if (settings.data) {
              const { logoUrl: _logoUrl, coverUrl: _coverUrl, ...input } = settings.data;
              saveSettings.mutate({ ...input, language: next });
            }
          }}
        />
      )}
      {screen.name === "jobs" && (
        <JobsScreen
          lang={lang}
          settings={appSettings}
          onBack={goBack}
          setScreen={setScreen}
          toggleLanguage={() => {
            const next = lang === "en" ? "es" : "en";
            setLang(next);
            if (settings.data) {
              const { logoUrl: _logoUrl, coverUrl: _coverUrl, ...input } = settings.data;
              saveSettings.mutate({ ...input, language: next });
            }
          }}
        />
      )}
      {screen.name === "new" && (
        <JobFormScreen lang={lang} onBack={goBack} onCreated={goJob} />
      )}
      {screen.name === "detail" && (
        <JobDetail
          lang={lang}
          jobId={screen.jobId}
          settings={appSettings}
          onBack={goBack}
          setScreen={setScreen}
        />
      )}
      {screen.name === "proof" && (
        <ProofPacket
          lang={lang}
          jobId={screen.jobId}
          settings={appSettings}
          onBack={goBack}
        />
      )}
      {screen.name === "settings" && (
        <SettingsScreen
          lang={lang}
          value={settings.data ?? null}
          saving={saveSettings.isPending}
          themeMode={themeMode}
          onThemeChange={setThemeMode}
          onBack={goBack}
          setScreen={setScreen}
          onSave={(v) => saveSettings.mutate(v, { onSuccess: goBack })}
        />
      )}
      {screen.name === "legal" && <LegalDocumentPage kind={screen.document} onBack={goBack} />}
      {screen.name === "companyProfile" && (
        <CompanyProfileEditor
          lang={lang}
          value={settings.data ?? null}
          saving={saveSettings.isPending}
          onBack={goBack}
          onSave={(v) => saveSettings.mutate(v, { onSuccess: goBack })}
        />
      )}
      {screen.name === "quotes" && (
        <QuotesScreen
          lang={lang}
          settings={appSettings}
          onBack={goBack}
          setScreen={setScreen}
        />
      )}
      {screen.name === "quoteNew" && (
        <QuoteBuilder
          lang={lang}
          settings={appSettings}
          clientId={screen.clientId}
          onBack={goBack}
        />
      )}
      {screen.name === "quotePreview" && (
        <QuotePreview
          lang={lang}
          quoteId={screen.quoteId}
          settings={appSettings}
          onBack={goBack}
          setScreen={setScreen}
          onOpenQuote={(id) => setScreen({ name: "quotePreview", quoteId: id })}
          onOpenInvoice={(id) => setScreen({ name: "invoicePreview", invoiceId: id })}
        />
      )}
      {screen.name === "invoices" && (
        <InvoicesScreen
          lang={lang}
          settings={appSettings}
          onBack={goBack}
          setScreen={setScreen}
        />
      )}
      {screen.name === "invoiceNew" && (
        <InvoiceBuilder
          lang={lang}
          settings={appSettings}
          jobId={screen.jobId}
          onBack={goBack}
        />
      )}
      {screen.name === "invoicePreview" && (
        <InvoicePreview
          lang={lang}
          invoiceId={screen.invoiceId}
          settings={appSettings}
          onBack={goBack}
          setScreen={setScreen}
          onOpenInvoice={(id) => setScreen({ name: "invoicePreview", invoiceId: id })}
        />
      )}
      {screen.name === "clients" && (
        <ClientsScreen lang={lang} onBack={goBack} setScreen={setScreen} />
      )}
      {screen.name === "clientNew" && (
        <NewClientScreen lang={lang} onBack={goBack} />
      )}
      {screen.name === "client" && (
        <ClientDetail
          lang={lang}
          clientId={screen.clientId}
          onBack={goBack}
          setScreen={setScreen}
        />
      )}
      {screen.name === "followups" && (
        <FollowupsScreen
          lang={lang}
          settings={appSettings}
          onBack={goBack}
        />
      )}
      {screen.name === "gallery" && (
        <GalleryScreen lang={lang} onBack={goBack} />
      )}
      {screen.name === "referrals" && (
        <ReferralsScreen lang={lang} onBack={goBack} setScreen={setScreen} />
      )}
      {screen.name === "operations" && (
        <OperationsScreen
          lang={lang}
          settings={appSettings}
          onBack={goBack}
          setScreen={setScreen}
          initialTab={screen.tab}
        />
      )}
      {screen.name === "reports" && (
        <ReportsScreen lang={lang} onBack={goBack} />
      )}
      {screen.name === "marketplace" && (
        <MarketplaceScreen lang={lang} settings={appSettings} setScreen={setScreen} />
      )}
      {screen.name === "marketplaceNew" && (
        <MarketplaceListingForm lang={lang} settings={appSettings} initialListingType={screen.listingType} onBack={goBack} onSaved={(listingId) => setScreen({ name: "marketplaceDetail", listingId })} />
      )}
      {screen.name === "marketplaceEdit" && (
        <MarketplaceListingForm lang={lang} settings={appSettings} listingId={screen.listingId} onBack={goBack} onSaved={(listingId) => setScreen({ name: "marketplaceDetail", listingId })} />
      )}
      {screen.name === "marketplaceDetail" && (
        <MarketplaceListingDetail lang={lang} listingId={screen.listingId} initialMessageOpen={screen.openMessages === true} onBack={goBack} onEdit={() => setScreen({ name: "marketplaceEdit", listingId: screen.listingId })} onDeleted={() => setScreen({ name: "marketplace" })} />
      )}
      {screen.name === "tools" && (
        <ToolsHomeScreen lang={lang} setScreen={setScreen} />
      )}
      {screen.name === "proWorkspace" && (
        <ProWorkspaceScreen lang={lang} onBack={goBack} setScreen={setScreen} />
      )}
      {screen.name === "upgrade" && (
        <UpgradeScreen lang={lang} onBack={goBack} />
      )}
      {screen.name === "toolbox" && (
        <ToolboxScreen lang={lang} onBack={goBack} initialTab={screen.tab} />
      )}
      {screen.name === "businessTools" && (
        <BusinessToolsScreen lang={lang} onBack={goBack} initialTab={screen.tab} />
      )}
      {screen.name === "admin" && <AdminScreen lang={lang} onBack={goBack} />}
      {screen.name === "platformAdmin" && <PlatformAdminScreen lang={lang} onBack={goBack} setScreen={setScreen} initialTab={screen.tab} initialRefundEmail={screen.refundEmail} />}
      {screen.name === "platformAdminUser" && <PAUserDetailScreen lang={lang} userId={screen.userId} onBack={goBack} setScreen={setScreen} />}
      {screen.name === "expansion" && (
        <ExpansionSuiteScreen
          lang={lang}
          settings={appSettings}
          onBack={goBack}
          initialTab={screen.tab}
        />
      )}
      {screen.name === "fieldIntelligence" && (
        <FieldIntelligenceScreen
          lang={lang}
          onBack={goBack}
          onOpenSettings={() => setScreen({ name: "settings" })}
          initialTab={screen.tab}
          onOpenJob={(jobId) => setScreen({ name: "detail", jobId })}
        />
      )}
      {screen.name === "jobOps" && (
        <JobOperationsScreen
          lang={lang}
          jobId={screen.jobId}
          settings={appSettings}
          onBack={goBack}
          setScreen={setScreen}
        />
      )}
      {screen.name === "tool" && (
        <JobToolScreen
          lang={lang}
          jobId={screen.jobId}
          mode={screen.mode}
          photoId={screen.photoId}
          settings={appSettings}
          onBack={goBack}
        />
      )}
      {screen.name !== "legal" && <BottomNav lang={lang} active={rootTabFor(screen)} onSelect={openRoot} onNavigate={setScreen} />}
    </div>
    </ToolsNavigationContext.Provider>
    </SettingsNavigationContext.Provider>
  );
}

const MARKETPLACE_CATEGORIES: Array<{ value: MarketplaceCategory; en: string; es: string; icon: ReactNode }> = [
  { value: "kitchens", en: "Kitchens", es: "Cocinas", icon: <Icon><path d="M4 5h16v14H4zM8 5v14M12 9h5M12 13h5" /></Icon> },
  { value: "bathrooms", en: "Bathrooms", es: "Baños", icon: <Icon><path d="M5 12h14v5a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3zM7 12V6a3 3 0 0 1 6 0" /></Icon> },
  { value: "plumbing", en: "Plumbing", es: "Plomería", icon: <Icon><path d="M6 4h8v5H9v5M6 14h6v6H6zM14 6h4v7" /></Icon> },
  { value: "electrical", en: "Electrical", es: "Electricidad", icon: <Icon><path d="m13 2-7 12h6l-1 8 7-12h-6z" /></Icon> },
  { value: "hvac", en: "HVAC", es: "Aire acondicionado", icon: <Icon><circle cx="12" cy="12" r="3"/><path d="M12 3c4 0 4 5 0 6M21 12c0 4-5 4-6 0M12 21c-4 0-4-5 0-6M3 12c0-4 5-4 6 0"/></Icon> },
  { value: "roofing", en: "Roofing", es: "Techos", icon: <Icon><path d="m3 12 9-8 9 8M6 10v10h12V10" /></Icon> },
  { value: "tile_flooring", en: "Tile & Flooring", es: "Azulejos y pisos", icon: <Icon><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></Icon> },
  { value: "painting", en: "Painting", es: "Pintura", icon: <Icon><path d="M5 4h11v5H5zM16 6h3v6h-7v3M12 15v6" /></Icon> },
  { value: "concrete", en: "Concrete", es: "Concreto", icon: <Icon><path d="M4 8h16v10H4zM4 12h16M9 8v10M15 8v10" /></Icon> },
  { value: "landscaping", en: "Landscaping", es: "Jardinería", icon: <Icon><path d="M12 21V10M12 14c-5 0-7-3-7-7 5 0 7 3 7 7M12 11c4 0 6-3 6-6-4 0-6 3-6 6" /></Icon> },
  { value: "handyman", en: "Handyman", es: "Reparaciones", icon: <Icon><path d="M14 6a4 4 0 0 0-5 5L3 17l4 4 6-6a4 4 0 0 0 5-5l-3 3-4-4z" /></Icon> },
  { value: "equipment", en: "Equipment for sale/rent", es: "Equipo en venta/alquiler", icon: <Icon><path d="M4 16h16M6 16V8h6l3 5h3v3M8 19h.01M17 19h.01" /></Icon> },
  { value: "materials", en: "Materials", es: "Materiales", icon: <Icon><path d="m4 9 8-5 8 5-8 5zM4 14l8 5 8-5" /></Icon> },
  { value: "other", en: "Other", es: "Otro", icon: <Icon><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></Icon> },
];

function marketplaceCategoryLabel(category: MarketplaceCategory, lang: Lang) {
  const item = MARKETPLACE_CATEGORIES.find((candidate) => candidate.value === category);
  return item ? item[lang] : category;
}
function marketplacePrice(listing: MarketplaceListing, lang: Lang) {
  if (listing.priceKind === "free") return lang === "es" ? "Gratis" : "Free";
  if (listing.priceKind === "contact") return lang === "es" ? "Consultar precio" : "Contact for price";
  const amount = new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(listing.price || 0));
  if (listing.listingType === "job") return `${amount}${listing.payUnit === "hourly" ? (lang === "es" ? "/hora" : "/hr") : (lang === "es" ? "/año" : "/yr")}`;
  return amount;
}
function savedMarketplaceIds() {
  if (typeof window === "undefined") return [] as number[];
  try {
    const value = JSON.parse(window.localStorage.getItem("crewkat-marketplace-saved") ?? window.localStorage.getItem("fieldhq-marketplace-saved") ?? "[]") as unknown;
    return Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
  } catch { return []; }
}

type MarketplaceView = "explore" | "looking" | "more" | "mine" | "inbox" | "alerts";
type MarketplaceUiState = {
  view: MarketplaceView;
  search: string;
  category: MarketplaceCategory | "all";
  listingType: "all" | "job" | "project";
  location: string;
  searchOpen: boolean;
  locationOpen: boolean;
  savedOnly: boolean;
};
let marketplaceUiStateCache: MarketplaceUiState = {
  view: "explore",
  search: "",
  category: "all",
  listingType: "all",
  location: "",
  searchOpen: false,
  locationOpen: false,
  savedOnly: false,
};

// ---------------------------------------------------------------------------
// Chunk D: keyword alerts + in-app notifications.
// ---------------------------------------------------------------------------

function AlertsView({ lang, setScreen }: { lang: Lang; setScreen: (screen: Screen) => void }) {
  const qc = useQueryClient();
  const alerts = useQuery({ queryKey: ["marketplace-alerts"], queryFn: () => api.listMarketplaceAlerts({}) });
  const notifications = useQuery({ queryKey: ["marketplace-notifications"], queryFn: () => api.listNotifications({}), refetchInterval: 30000 });
  const [form, setForm] = useState({ keyword: "", category: "any", serviceArea: "" });
  const [error, setError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);

  // Opening this view marks everything read so the badge clears.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await api.markNotificationsRead({ ids: [] });
        if (!cancelled) await qc.invalidateQueries({ queryKey: ["marketplace-notifications"] });
      } catch { /* best-effort */ }
    })();
    return () => { cancelled = true; };
  }, [qc]);

  const save = useMutation({
    mutationFn: () => api.saveMarketplaceAlert({
      keyword: form.keyword.trim(),
      category: form.category === "any" ? null : (form.category as MarketplaceCategory),
      serviceArea: form.serviceArea.trim(),
    }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["marketplace-alerts"] });
      setForm({ keyword: "", category: "any", serviceArea: "" });
      setError("");
    },
    onError: (e) => setError(actionErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteMarketplaceAlert({ id }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["marketplace-alerts"] });
      setDeletingId(null);
    },
  });

  const openNotification = async (notification: { id: number; link: string }) => {
    try { await api.markNotificationsRead({ ids: [notification.id] }); } catch { /* best-effort */ }
    await qc.invalidateQueries({ queryKey: ["marketplace-notifications"] });
    const match = /^marketplace:(\d+)$/.exec(notification.link);
    if (match) setScreen({ name: "marketplaceDetail", listingId: Number(match[1]) });
  };

  const t = lang === "es" ? {
    title: "Alertas", intro: "Te avisamos cuando se publique algo que buscas: aquí, por push y por correo.",
    keyword: "Palabra clave", keywordPlaceholder: "p. ej. drywall, ayudante, pintura",
    category: "Categoría (opcional)", anyCategory: "Cualquiera",
    area: "Área (opcional)", areaPlaceholder: "p. ej. Tampa",
    add: "Crear alerta", adding: "Guardando…",
    yourAlerts: "Tus alertas", none: "Aún no tienes alertas.", noneBody: "Crea una y te avisaremos cuando aparezca algo.",
    delete: "Eliminar", deleting: "Eliminando…",
    notificationsTitle: "Notificaciones",
    noNotifications: "Sin notificaciones todavía.",
  } : {
    title: "Alerts", intro: "We'll notify you when something you want gets posted — here, by push, and by email.",
    keyword: "Keyword", keywordPlaceholder: "e.g. drywall, helper, painting",
    category: "Category (optional)", anyCategory: "Any",
    area: "Area (optional)", areaPlaceholder: "e.g. Tampa",
    add: "Create alert", adding: "Saving…",
    yourAlerts: "Your alerts", none: "No alerts yet.", noneBody: "Create one and we'll notify you when something shows up.",
    delete: "Delete", deleting: "Deleting…",
    notificationsTitle: "Notifications",
    noNotifications: "No notifications yet.",
  };

  return (
    <section className="market-alerts">
      <div className="market-section-heading"><div><h2>{t.title}</h2><p>{t.intro}</p></div></div>
      <form className="wanted-form" onSubmit={(event) => { event.preventDefault(); setError(""); if (form.keyword.trim().length >= 2) save.mutate(); }}>
        <label><span>{t.keyword}</span><input required minLength={2} maxLength={80} value={form.keyword} onChange={(event) => setForm({ ...form, keyword: event.target.value })} placeholder={t.keywordPlaceholder} /></label>
        <label><span>{t.category}</span><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option value="any">{t.anyCategory}</option>{MARKETPLACE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item[lang]}</option>)}</select></label>
        <label><span>{t.area}</span><input maxLength={120} value={form.serviceArea} onChange={(event) => setForm({ ...form, serviceArea: event.target.value })} placeholder={t.areaPlaceholder} /></label>
        {error && <p className="status error">{error}</p>}
        <button type="submit" className="primary-button" disabled={save.isPending}>{save.isPending ? t.adding : t.add}</button>
      </form>
      <h3 className="market-inbox-subheading">{t.yourAlerts}</h3>
      {alerts.isLoading ? <div className="loading-block" /> : (alerts.data?.alerts.length ?? 0) === 0 ? (
        <div className="market-empty compact"><h2>{t.none}</h2><p>{t.noneBody}</p></div>
      ) : (
        <ul className="alerts-list">
          {alerts.data?.alerts.map((alert) => (
            <li key={alert.id}>
              <span><strong>{alert.keyword}</strong><small>{alert.category ? marketplaceCategoryLabel(alert.category as MarketplaceCategory, lang) : t.anyCategory}{alert.serviceArea ? ` · ${alert.serviceArea}` : ""}</small></span>
              <button type="button" className="danger" disabled={remove.isPending} onClick={() => { setDeletingId(alert.id); remove.mutate(alert.id); }}>{deletingId === alert.id && remove.isPending ? t.deleting : t.delete}</button>
            </li>
          ))}
        </ul>
      )}
      <h3 className="market-inbox-subheading">{t.notificationsTitle}</h3>
      {notifications.isLoading ? <div className="loading-block" /> : (notifications.data?.notifications.length ?? 0) === 0 ? (
        <p className="privacy-note">{t.noNotifications}</p>
      ) : (
        <ul className="alerts-list notifications-list">
          {notifications.data?.notifications.map((notification) => (
            <li key={notification.id} className={notification.isRead ? "" : "unread"}>
              <button type="button" onClick={() => openNotification(notification)}>
                <strong>{lang === "es" ? notification.titleEs : notification.titleEn}</strong>
                <small>{new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(notification.createdAt))}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MarketplaceScreen({ lang, settings, setScreen }: { lang: Lang; settings: Settings | null; setScreen: (screen: Screen) => void }) {
  const qc = useQueryClient();
  const auth = useContext(AuthContext);
  const [view, setView] = useState<MarketplaceView>(marketplaceUiStateCache.view);
  const [search, setSearch] = useState(marketplaceUiStateCache.search);
  const [category, setCategory] = useState<MarketplaceCategory | "all">(marketplaceUiStateCache.category);
  const [listingType, setListingType] = useState<"all" | "job" | "project">(marketplaceUiStateCache.listingType);
  const [location, setLocation] = useState(marketplaceUiStateCache.location);
  const [searchOpen, setSearchOpen] = useState(marketplaceUiStateCache.searchOpen);
  const [locationOpen, setLocationOpen] = useState(marketplaceUiStateCache.locationOpen);
  const [savedOnly, setSavedOnly] = useState(marketplaceUiStateCache.savedOnly);
  const [savedIds, setSavedIds] = useState<number[]>(savedMarketplaceIds);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MarketplaceListing | null>(null);
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const pullGestureRef = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const pullDistanceRef = useRef(0);
  useEffect(() => {
    marketplaceUiStateCache = {
      view,
      search,
      category,
      listingType,
      location,
      searchOpen,
      locationOpen,
      savedOnly,
    };
  }, [view, search, category, listingType, location, searchOpen, locationOpen, savedOnly]);
  const listings = useQuery({ queryKey: ["marketplace-listings", search, category, location], queryFn: () => api.listMarketplaceListings({ search, category: category === "all" ? null : category, serviceArea: location }) });
  const gate = useQuery({ queryKey: ["marketplace-gate"], queryFn: () => api.marketplaceGate({}) });
  const requests = useQuery({ queryKey: ["marketplace-requests"], queryFn: () => api.listMarketplaceRequests({}) });
  const inbox = useQuery({ queryKey: ["marketplace-inbox"], queryFn: () => api.getMarketplaceInbox({}), refetchInterval: 10000 });
  // Chunk D: saved keyword alerts + in-app notifications (polled for freshness).
  const alerts = useQuery({ queryKey: ["marketplace-alerts"], queryFn: () => api.listMarketplaceAlerts({}) });
  const notifications = useQuery({ queryKey: ["marketplace-notifications"], queryFn: () => api.listNotifications({}), refetchInterval: 30000 });
  const removeListing = useMutation({ mutationFn: (id: number) => api.deleteMarketplaceListing({ id }), onSuccess: async (_, id) => { setSavedIds((current) => { const next = current.filter((value) => value !== id); window.localStorage.setItem("crewkat-marketplace-saved", JSON.stringify(next)); return next; }); setDeleteTarget(null); await qc.invalidateQueries({ queryKey: ["marketplace-listings"] }); } });
  const visibleListings = (listings.data?.listings ?? []).filter((listing) => (!savedOnly || savedIds.includes(listing.id)) && (listingType === "all" || listing.listingType === listingType));
  const myListings = (listings.data?.listings ?? []).filter((listing) => listing.isMine);
  const openNewListing = (type: "job" | "project") => {
    const limit = gate.data?.freeListingLimit ?? 3;
    const mine = gate.data?.myActiveListingCount ?? myListings.length;
    if (auth?.user.tier === "free" && mine >= limit) setScreen({ name: "upgrade" });
    else setScreen({ name: "marketplaceNew", listingType: type });
  };
  const openPromotion = () => {
    if (auth?.user.tier === "free") setScreen({ name: "upgrade" });
    else setPromotionOpen(true);
  };
  const toggleSaved = (id: number) => setSavedIds((current) => {
    const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    window.localStorage.setItem("crewkat-marketplace-saved", JSON.stringify(next));
    return next;
  });
  const openSearch = () => {
    setView("explore"); setSearchOpen(true); setSavedOnly(false);
    window.setTimeout(() => searchRef.current?.focus(), 50);
  };
  const chooseCategory = (value: MarketplaceCategory) => { setCategory(value); setSavedOnly(false); setView("explore"); };
  const canPullToRefresh = view === "explore" || view === "looking";
  const refreshMarketplace = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setPullDistance(56);
    try {
      await Promise.all([listings.refetch(), requests.refetch()]);
    } finally {
      setRefreshing(false);
      setPullDistance(0);
      pullDistanceRef.current = 0;
    }
  };
  const marketplaceScrollTop = (target: HTMLElement) => {
    const shell = target.closest<HTMLElement>(".app-shell");
    const documentTop = document.scrollingElement?.scrollTop ?? 0;
    return Math.max(shell?.scrollTop ?? 0, documentTop, window.scrollY);
  };
  const resetPullGesture = () => {
    pullGestureRef.current = null;
    pullDistanceRef.current = 0;
    if (!refreshing) setPullDistance(0);
  };
  const handlePullStart = (event: TouchEvent<HTMLElement>) => {
    // Arm only when this gesture starts at the true top of the app viewport.
    // Checking window.scrollY alone is not enough in Muse's nested webview:
    // .app-shell is normally the element that actually scrolls.
    if (!canPullToRefresh || refreshing || event.touches.length !== 1 || marketplaceScrollTop(event.currentTarget) > 0.5) {
      resetPullGesture();
      return;
    }
    const touch = event.touches[0];
    if (touch) pullGestureRef.current = { x: touch.clientX, y: touch.clientY, active: false };
  };
  const handlePullMove = (event: TouchEvent<HTMLElement>) => {
    const gesture = pullGestureRef.current;
    const touch = event.touches[0];
    if (!gesture || !touch || event.touches.length !== 1) return;
    if (marketplaceScrollTop(event.currentTarget) > 0.5) {
      resetPullGesture();
      return;
    }
    const deltaY = touch.clientY - gesture.y;
    const deltaX = touch.clientX - gesture.x;
    // A deliberate downward pull must clear a dead zone and be primarily
    // vertical. Ordinary upward scrolling, small taps, and sideways swipes
    // never become refresh gestures.
    if (!gesture.active) {
      if (deltaY <= 14 || Math.abs(deltaX) > deltaY * 0.7) return;
      gesture.active = true;
    }
    if (deltaY <= 0) {
      resetPullGesture();
      return;
    }
    if (event.cancelable) event.preventDefault();
    const distance = Math.max(0, Math.min(88, (deltaY - 14) * 0.48));
    pullDistanceRef.current = distance;
    setPullDistance(distance);
  };
  const handlePullEnd = () => {
    const gesture = pullGestureRef.current;
    const shouldRefresh = Boolean(gesture?.active) && pullDistanceRef.current >= 52;
    pullGestureRef.current = null;
    if (shouldRefresh) void refreshMarketplace();
    else {
      pullDistanceRef.current = 0;
      setPullDistance(0);
    }
  };
  const text = lang === "es" ? {
    list: "Publicar empleo", listProject: "Publicar proyecto", explore: "Explorar", looking: "Se busca", more: "Más", search: "¿Qué servicio necesitas?", location: "Área o código postal", all: "Todos", saved: "Guardados", savedNote: "Publicaciones que guardaste", top: "Categorías principales", categories: "Todas las categorías", emptyTitle: savedOnly ? "No tienes publicaciones guardadas" : "Aún no hay publicaciones", emptyBody: savedOnly ? "Toca el marcador en una publicación para guardarla aquí." : "Las publicaciones aparecerán aquí a medida que se unan empresas. Puedes publicar la primera ahora.", emptyWanted: "Aún no hay solicitudes", emptyWantedBody: "Las solicitudes de ayuda aparecerán aquí a medida que se unan empresas.", postRequest: "Publicar una solicitud", clear: "Borrar filtros", just: "Recién publicado", marketplaceSearch: "Buscar en el mercado", areaFilter: "Filtrar por área", myListings: "Mis publicaciones", myListingsNote: "Administra tu límite y promociones", quota: "publicaciones gratuitas usadas", promote: "Promocionar", edit: "Editar", remove: "Eliminar", removeTitle: "¿Eliminar esta publicación?", removeBody: "Se quitará del mercado y se liberará un espacio gratuito.", cancel: "Cancelar", deleting: "Eliminando…", removeError: "No se pudo eliminar. Inténtalo de nuevo.", moreSlots: "Obtener más espacios", launch: "Disponible en el lanzamiento", topPlacement: "Parte superior del mercado por 7 días", categoryFeature: "Destacado en la categoría", close: "Cerrar", promoted: "Promocionado", pull: "Desliza para actualizar", release: "Suelta para actualizar", refreshing: "Actualizando publicaciones…",
  } : {
    list: "List a job", listProject: "List a project", explore: "Explore", looking: "Looking for", more: "More", search: "What service do you need?", location: "Service area or ZIP", all: "All", saved: "Saved items", savedNote: "Listings you bookmarked", top: "Top categories", categories: "All categories", emptyTitle: savedOnly ? "No saved listings yet" : "No listings yet", emptyBody: savedOnly ? "Tap the bookmark on a listing to keep it here." : "Listings will appear here as companies join. You can add the first one now.", emptyWanted: "No requests yet", emptyWantedBody: "Requests for help will appear here as companies join.", postRequest: "Post a request", clear: "Clear filters", just: "Just listed", marketplaceSearch: "Search Marketplace", areaFilter: "Filter by service area", myListings: "My listings", myListingsNote: "Manage your quota and promotions", quota: "free listings used", promote: "Promote", edit: "Edit", remove: "Delete", removeTitle: "Delete this listing?", removeBody: "It will be removed from Marketplace and one free listing slot will open up.", cancel: "Cancel", deleting: "Deleting…", removeError: "The listing could not be deleted. Try again.", moreSlots: "Get more listing slots", launch: "Available at launch", topPlacement: "Top of Marketplace for 7 days", categoryFeature: "Featured in category", close: "Close", promoted: "Promoted", pull: "Pull to refresh", release: "Release to refresh", refreshing: "Refreshing listings…",
  };
  if (gate.data && !gate.data.enabled) {
    return <main className="page marketplace-page"><div className="market-empty"><span><Icon size={32}><path d="M4 10h16v10H4zM3 10l2-6h14l2 6"/></Icon></span><h2>{lang === "es" ? "Marketplace pausado" : "Marketplace paused"}</h2><p>{lang === "es" ? "El Marketplace está temporalmente desactivado. Vuelve a intentarlo más tarde." : "The Marketplace is temporarily disabled. Please check back later."}</p></div></main>;
  }
  return <main className="page marketplace-page" onTouchStart={handlePullStart} onTouchMove={handlePullMove} onTouchEnd={handlePullEnd} onTouchCancel={handlePullEnd}>
    {canPullToRefresh && <div className={`market-pull-indicator${refreshing ? " refreshing" : ""}`} style={{ height: `${pullDistance}px`, opacity: refreshing ? 1 : Math.min(1, pullDistance / 36) }} role="status" aria-live="polite">
      <span className="market-refresh-spinner" aria-hidden="true"/>
      <small>{refreshing ? text.refreshing : pullDistance >= 52 ? text.release : text.pull}</small>
    </div>}
    <PageHeader lang={lang} title={`${APP_INFO.name} Marketplace`} actions={<>
      <button className="icon-button" type="button" aria-label={text.marketplaceSearch} onClick={openSearch}><Icon><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></Icon></button>
      <button className="icon-button marketplace-inbox-button" type="button" aria-label={lang === "es" ? "Abrir bandeja de mensajes" : "Open message inbox"} onClick={() => setView("inbox")}><Icon><path d="M4 6h16v12H4zM4 7l8 6 8-6"/></Icon>{((inbox.data?.unreadCount ?? 0) + (notifications.data?.unreadCount ?? 0)) > 0 && <b>{Math.min((inbox.data?.unreadCount ?? 0) + (notifications.data?.unreadCount ?? 0), 99)}</b>}</button>
      <button className={`icon-button${locationOpen ? " active" : ""}`} type="button" aria-label={text.areaFilter} onClick={() => setLocationOpen((open) => !open)}><Icon><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2"/></Icon></button>
    </>} />
    {(searchOpen || view === "explore") && <label className={`market-search${searchOpen ? " emphasized" : ""}`}><Icon><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></Icon><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={text.search} aria-label={text.search}/>{search && <button type="button" onClick={() => setSearch("")} aria-label={lang === "es" ? "Borrar búsqueda" : "Clear search"}>×</button>}</label>}
    {locationOpen && <label className="market-location"><Icon><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/></Icon><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder={text.location} aria-label={text.location}/></label>}
    <nav className="market-pills" aria-label={lang === "es" ? "Vistas del mercado" : "Marketplace views"}>
      <button className="list-pill" onClick={() => openNewListing("job")}><PlusIcon/>{text.list}</button>
      <button className={view === "explore" ? "active" : ""} onClick={() => { setView("explore"); setSavedOnly(false); }}>{text.explore}</button>
      <button className={view === "looking" ? "active" : ""} onClick={() => setView("looking")}>{text.looking}</button>
      <button className={view === "more" ? "active" : ""} onClick={() => setView("more")}>{text.more}</button>
    </nav>
    {view === "explore" && <section className="market-explore">
      <div className="listing-type-filters" role="group" aria-label={lang === "es" ? "Filtrar por tipo de publicación" : "Filter by listing type"}><button className={listingType === "all" ? "active" : ""} onClick={() => setListingType("all")}>{lang === "es" ? "Todos" : "All"}</button><button className={listingType === "job" ? "active job" : "job"} onClick={() => setListingType("job")}><Icon><path d="M5 8h14v11H5zM9 8V5h6v3M5 12h14"/></Icon>{lang === "es" ? "Empleos" : "Jobs"}</button><button className={listingType === "project" ? "active project" : "project"} onClick={() => setListingType("project")}><Icon><path d="M4 20h16M6 20V9l6-5 6 5v11M9 20v-6h6v6"/></Icon>{lang === "es" ? "Proyectos" : "Projects"}</button></div>
      <div className="market-filter-row"><label><span className="sr-only">{lang === "es" ? "Categoría" : "Category"}</span><select value={category} onChange={(event) => { setCategory(event.target.value as MarketplaceCategory | "all"); setSavedOnly(false); }}><option value="all">{text.all}</option>{MARKETPLACE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item[lang]}</option>)}</select></label>{(category !== "all" || listingType !== "all" || location || search || savedOnly) && <button onClick={() => { setCategory("all"); setListingType("all"); setLocation(""); setSearch(""); setSavedOnly(false); }}>{text.clear}</button>}</div>
      {listings.isLoading ? <div className="market-grid market-loading"><div/><div/><div/><div/></div> : visibleListings.length ? <div className="market-grid">{visibleListings.map((listing) => <article className="market-card" key={listing.id}>
        <button className="market-card-main" onClick={() => setScreen({ name: "marketplaceDetail", listingId: listing.id })} aria-label={`${listing.title}, ${marketplacePrice(listing, lang)}`}>
          <div className="market-card-photo">{listing.photos[0] ? <img src={listing.photos[0].url} alt={listing.title}/> : <span className="market-card-placeholder">{MARKETPLACE_CATEGORIES.find((item) => item.value === listing.category)?.icon ?? <Icon><path d="M4 10h16v10H4zM3 10l2-6h14l2 6"/></Icon>}</span>}{listing.promoted && <em className="market-promoted-badge">{text.promoted}</em>}{listing.justListed && <b>{text.just}</b>}<span className={`listing-type-badge ${listing.listingType}`}><Icon>{listing.listingType === "job" ? <><path d="M5 8h14v11H5zM9 8V5h6v3M5 12h14"/></> : <><path d="M4 20h16M6 20V9l6-5 6 5v11"/></>}</Icon>{listing.listingType === "job" ? (lang === "es" ? "EMPLEO" : "JOB") : (lang === "es" ? "PROYECTO" : "PROJECT")}</span></div>
          <div className="market-card-copy"><div className="market-price"><strong>{listing.bookable ? `${new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(listing.dailyRate || 0))}/${lang === "es" ? "día" : "day"}` : marketplacePrice(listing, lang)}</strong>{listing.originalPrice && listing.priceKind === "amount" && <del>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(listing.originalPrice))}</del>}</div><h2>{listing.title}</h2><p>{listing.serviceArea}</p><small>{listing.companyName}</small></div>
        </button>
        <button className={`market-save${savedIds.includes(listing.id) ? " saved" : ""}`} onClick={() => toggleSaved(listing.id)} aria-label={savedIds.includes(listing.id) ? (lang === "es" ? "Quitar de guardados" : "Remove from saved") : (lang === "es" ? "Guardar publicación" : "Save listing")}><Icon><path d="M6 3h12v18l-6-4-6 4z"/></Icon></button>
      </article>)}</div> : <div className="market-empty"><span><Icon size={32}><path d="M4 10h16v10H4zM3 10l2-6h14l2 6"/></Icon></span><h2>{text.emptyTitle}</h2><p>{text.emptyBody}</p>{!savedOnly && <button className="primary-button" onClick={() => openNewListing("job")}><PlusIcon/>{text.list}</button>}</div>}
    </section>}
    {view === "looking" && <MarketplaceRequestsView lang={lang} settings={settings} requests={requests.data?.requests ?? []} loading={requests.isLoading} />}
    {view === "mine" && <section className="market-mine">
      <div className="market-quota"><div><strong>{auth?.user.tier === "premium" ? `${myListings.length} · Unlimited` : `${Math.min(gate.data?.myActiveListingCount ?? myListings.length, gate.data?.freeListingLimit ?? 3)} of ${gate.data?.freeListingLimit ?? 3}`}</strong><span>{auth?.user.tier === "premium" ? (lang === "es" ? "publicaciones Premium" : "Premium listings") : text.quota}</span></div>{auth?.user.tier === "free" && <div className="quota-track"><i style={{ width: `${Math.min(100, ((gate.data?.myActiveListingCount ?? myListings.length) / (gate.data?.freeListingLimit ?? 3)) * 100)}%` }}/></div>}</div>
      {myListings.length ? <div className="my-listing-list">{myListings.map((listing) => <article key={listing.id}><button onClick={() => setScreen({ name: "marketplaceDetail", listingId: listing.id })}><strong>{listing.title}</strong><small><span className={`inline-listing-type ${listing.listingType}`}>{listing.listingType === "job" ? (lang === "es" ? "Empleo" : "Job") : (lang === "es" ? "Proyecto" : "Project")}</span> · {marketplaceCategoryLabel(listing.category, lang)} · {listing.serviceArea}</small></button><div className="listing-manage-actions"><button onClick={() => setScreen({ name: "marketplaceEdit", listingId: listing.id })}><Icon><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/></Icon>{text.edit}</button><button className="danger" onClick={() => setDeleteTarget(listing)}><TrashIcon/>{text.remove}</button><button className="secondary-button" onClick={openPromotion}>{text.promote}</button></div></article>)}</div> : <div className="market-empty compact"><h2>{text.emptyTitle}</h2><p>{text.emptyBody}</p></div>}
      <button className="market-upsell" onClick={openPromotion}><PlusIcon/><span><strong>{text.moreSlots}</strong><small>{text.launch}</small></span></button>
    </section>}
    {view === "inbox" && <section className="market-inbox">
      <div className="market-section-heading"><div><h2>{lang === "es" ? "Bandeja" : "Inbox"}</h2><p>{lang === "es" ? "Conversaciones sobre publicaciones" : "Your conversations"}</p></div></div>
      {inbox.isLoading ? <div className="market-inbox-loading"><div/><div/><div/></div> : (() => {
        const ownerConvos = (inbox.data?.conversations ?? []).filter((c) => !c.isInquiry);
        const inquiryConvos = (inbox.data?.conversations ?? []).filter((c) => c.isInquiry);
        const renderConvo = (conversation: { listingId: number; listingTitle: string; companyName: string; lastMessage: string; lastMessageAt: string; unreadCount: number }) => <button key={conversation.listingId} type="button" className={conversation.unreadCount > 0 ? "unread" : ""} onClick={() => setScreen({ name: "marketplaceDetail", listingId: conversation.listingId, openMessages: true })}>
          <span className="inbox-avatar"><Icon><path d="M4 6h16v12H4zM4 7l8 6 8-6"/></Icon></span>
          <span className="inbox-copy"><strong>{conversation.listingTitle}</strong><small>{conversation.companyName}</small><p>{conversation.lastMessage === "Photo" && lang === "es" ? "Foto" : conversation.lastMessage}</p></span>
          <span className="inbox-meta"><time>{new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(conversation.lastMessageAt))}</time>{conversation.unreadCount > 0 && <b aria-label={`${conversation.unreadCount} ${lang === "es" ? "sin leer" : "unread"}`}>{conversation.unreadCount}</b>}</span>
        </button>;
        return <>
          {ownerConvos.length > 0 && <><div className="market-inbox-subheading"><h3>{lang === "es" ? "Conversaciones sobre tus publicaciones" : "Your listing conversations"}</h3></div><div className="market-inbox-list">{ownerConvos.map(renderConvo)}</div></>}
          {inquiryConvos.length > 0 && <><div className="market-inbox-subheading"><h3>{lang === "es" ? "Tus consultas" : "Your inquiries"}</h3></div><div className="market-inbox-list">{inquiryConvos.map(renderConvo)}</div></>}
          {ownerConvos.length === 0 && inquiryConvos.length === 0 && <div className="market-empty compact"><span><Icon size={32}><path d="M4 6h16v12H4zM4 7l8 6 8-6"/></Icon></span><h2>{lang === "es" ? "Aún no hay conversaciones" : "No conversations yet"}</h2><p>{lang === "es" ? "Los mensajes sobre publicaciones aparecerán aquí." : "Messages about listings will appear here."}</p></div>}
        </>;
      })()}
      <p className="market-inbox-note">{lang === "es" ? "Las notificaciones push llegarán con las cuentas públicas en el lanzamiento." : "Push notifications arrive with public accounts at launch."}</p>
    </section>}
    {view === "alerts" && <AlertsView lang={lang} setScreen={setScreen} />}
    {deleteTarget && <div className="sheet-backdrop" onClick={() => !removeListing.isPending && setDeleteTarget(null)}><section className="more-sheet delete-listing-sheet" role="dialog" aria-modal="true" aria-labelledby="delete-listing-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle"/><span className="delete-sheet-icon"><TrashIcon/></span><h2 id="delete-listing-title">{text.removeTitle}</h2><strong>{deleteTarget.title}</strong><p>{text.removeBody}</p>{removeListing.isError && <p className="status error">{text.removeError}</p>}<div className="delete-sheet-actions"><button type="button" disabled={removeListing.isPending} onClick={() => setDeleteTarget(null)}>{text.cancel}</button><button type="button" className="danger-button" disabled={removeListing.isPending} onClick={() => removeListing.mutate(deleteTarget.id)}>{removeListing.isPending ? text.deleting : text.remove}</button></div></section></div>}
    {promotionOpen && <div className="sheet-backdrop" onClick={() => setPromotionOpen(false)}><section className="more-sheet market-launch-sheet" onClick={(event) => event.stopPropagation()}><div className="sheet-handle"/><span className="launch-badge">{text.launch}</span><h2>{text.promote}</h2><div className="launch-option"><Icon><path d="M12 3v18M5 10l7-7 7 7"/></Icon><strong>{text.topPlacement}</strong></div><div className="launch-option"><Icon><path d="m12 3 3 6 6 .8-4.5 4.4 1.1 6.3L12 17.5l-5.6 3 1.1-6.3L3 9.8 9 9z"/></Icon><strong>{text.categoryFeature}</strong></div><p>{lang === "es" ? "Los pagos y la promoción pública se activarán cuando se lance la red." : "Payments and public promotion turn on when the network launches."}</p><button className="primary-button" onClick={() => setPromotionOpen(false)}>{text.close}</button></section></div>}
    {view === "more" && <section className="market-more">
      <label className="market-search"><Icon><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></Icon><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { setView("explore"); setSavedOnly(false); } }} placeholder={text.search} aria-label={text.search}/></label>
      <button className="market-menu-row" onClick={() => openNewListing("job")}><span className="market-category-icon"><Icon><path d="M5 8h14v11H5zM9 8V5h6v3M5 12h14"/></Icon></span><span><strong>{text.list}</strong><small>{lang === "es" ? "Contrata a un empleado" : "Hire an employee"}</small></span><BackIcon/></button>
      <button className="market-menu-row" onClick={() => openNewListing("project")}><span className="market-category-icon"><Icon><path d="M4 20h16M6 20V9l6-5 6 5v11M9 20v-6h6v6"/></Icon></span><span><strong>{text.listProject}</strong><small>{lang === "es" ? "Busca un subcontratista para una tarea específica" : "Find a subcontractor for one specific task"}</small></span><BackIcon/></button>
      <button className="market-menu-row" onClick={() => setView("alerts")}><span className="market-category-icon"><Icon><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></Icon></span><span><strong>{lang === "es" ? "Alertas" : "Alerts"}{(alerts.data?.alerts.length ?? 0) > 0 ? ` · ${alerts.data?.alerts.length}` : ""}</strong><small>{lang === "es" ? "Avisos cuando se publique lo que buscas" : "Get notified when what you want gets posted"}</small></span><BackIcon/></button>
      <button className="market-menu-row profile-menu-row" onClick={() => setScreen({ name: "companyProfile" })}><span className="market-category-icon"><Icon><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0M18 3l3 3M19.5 4.5l-4 4"/></Icon></span><span><strong>{lang === "es" ? "Editar perfil de empresa" : "Edit company profile"}</strong><small>{lang === "es" ? "Logo, portada, información y redes sociales" : "Logo, cover, company info, and social links"}</small></span><BackIcon/></button>
      <button className="market-menu-row" onClick={() => { setSearch(""); setCategory("all"); setLocation(""); setView("mine"); }}><span className="market-category-icon"><Icon><path d="M4 5h16v15H4zM8 3v4M16 3v4M8 11h8M8 15h5"/></Icon></span><span><strong>{text.myListings}</strong><small>{text.myListingsNote}</small></span><BackIcon/></button>
      <button className="market-menu-row" onClick={() => { setSavedOnly(true); setCategory("all"); setView("explore"); }}><span className="market-category-icon"><Icon><path d="M6 3h12v18l-6-4-6 4z"/></Icon></span><span><strong>{text.saved}</strong><small>{text.savedNote}</small></span><BackIcon/></button>
      <button className="market-menu-row" onClick={() => setScreen({ name: "legal", document: "marketplace" })}><span className="market-category-icon"><Icon><path d="M6 3h15v18H6zM9 7h7M9 11h7M9 15h5"/></Icon></span><span><strong>{lang === "es" ? "Términos del Marketplace" : "Marketplace Terms of Use"}</strong><small>{lang === "es" ? "Reglas para publicar y enviar mensajes" : "Posting and messaging rules"}</small></span><BackIcon/></button>
      <h2>{text.top}</h2>{MARKETPLACE_CATEGORIES.slice(0, 6).map((item) => <button className="market-menu-row" key={`top-${item.value}`} onClick={() => chooseCategory(item.value)}><span className="market-category-icon">{item.icon}</span><strong>{item[lang]}</strong><BackIcon/></button>)}
      <h2>{text.categories}</h2>{MARKETPLACE_CATEGORIES.map((item) => <button className="market-menu-row" key={item.value} onClick={() => chooseCategory(item.value)}><span className="market-category-icon">{item.icon}</span><strong>{item[lang]}</strong><BackIcon/></button>)}
    </section>}
  </main>;
}

function MarketplaceRequestsView({ lang, settings, requests, loading }: { lang: Lang; settings: Settings | null; requests: MarketplaceRequest[]; loading: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ title: "", category: "other" as MarketplaceCategory, listingType: "project" as "job" | "project", description: "", serviceArea: "", neededBy: "", companyName: settings?.companyName ?? "", companyPhone: settings?.phone ?? "" });
  useEffect(() => setForm((current) => ({ ...current, companyName: current.companyName || settings?.companyName || "", companyPhone: current.companyPhone || settings?.phone || "" })), [settings]);
  const save = useMutation({ mutationFn: () => api.createMarketplaceRequest(form), onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["marketplace-requests"] }); setOpen(false); setForm((current) => ({ ...current, title: "", description: "", neededBy: "" })); }, onError: () => setError(lang === "es" ? "No se pudo guardar la solicitud." : "The request could not be saved.") });
  const t = lang === "es" ? { title: "Solicitudes de empresas", intro: "Empresas que buscan una mano para un trabajo específico.", post: "Publicar una solicitud", empty: "Aún no hay solicitudes", emptyBody: "Las solicitudes aparecerán aquí a medida que se unan empresas.", requestTitle: "¿Qué ayuda necesitas?", category: "Categoría", description: "Detalles", area: "Área o código postal", needed: "Fecha o plazo", company: "Empresa", phone: "Teléfono (opcional)", save: "Publicar", cancel: "Cancelar", contact: "Contacto" } : { title: "Company requests", intro: "Companies looking for a hand with a specific job.", post: "Post a request", empty: "No requests yet", emptyBody: "Requests will appear here as companies join.", requestTitle: "What help do you need?", category: "Category", description: "Details", area: "Service area or ZIP", needed: "Needed by", company: "Company name", phone: "Phone (optional)", save: "Post request", cancel: "Cancel", contact: "Contact" };
  return <section className="market-looking">
    <div className="market-section-heading"><div><h2>{t.title}</h2><p>{t.intro}</p></div><button onClick={() => setOpen((value) => !value)}><PlusIcon/>{t.post}</button></div>
    {open && <form className="wanted-form" onSubmit={(event) => { event.preventDefault(); setError(""); save.mutate(); }}>
      <fieldset className="listing-type-choice"><legend>{lang === "es" ? "Tipo de publicación" : "Listing type"}</legend><button type="button" className={form.listingType === "job" ? "active job" : "job"} onClick={() => setForm({ ...form, listingType: "job" })}><Icon><path d="M5 8h14v11H5zM9 8V5h6v3M5 12h14"/></Icon><span><strong>{lang === "es" ? "Empleo" : "Job"}</strong><small>{lang === "es" ? "Contratar a un empleado" : "Hiring an employee"}</small></span></button><button type="button" className={form.listingType === "project" ? "active project" : "project"} onClick={() => setForm({ ...form, listingType: "project" })}><Icon><path d="M4 20h16M6 20V9l6-5 6 5v11"/></Icon><span><strong>{lang === "es" ? "Proyecto" : "Project"}</strong><small>{lang === "es" ? "Un subcontratista para una tarea" : "A subcontractor for one task"}</small></span></button></fieldset>
      <label><span>{t.requestTitle}</span><input required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })}/></label>
      <label><span>{t.category}</span><select aria-label={t.category} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as MarketplaceCategory })}>{MARKETPLACE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item[lang]}</option>)}</select></label>
      <label><span>{t.description}</span><textarea rows={4} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label>
      <label><span>{t.area}</span><input required aria-label={t.area} value={form.serviceArea} onChange={(event) => setForm({ ...form, serviceArea: event.target.value })}/></label>
      <label><span>{t.needed}</span><input value={form.neededBy} onChange={(event) => setForm({ ...form, neededBy: event.target.value })}/></label>
      <label><span>{t.company}</span><input required aria-label={t.company} value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })}/></label>
      <label><span>{t.phone}</span><input type="tel" aria-label={t.phone} value={form.companyPhone} onChange={(event) => setForm({ ...form, companyPhone: event.target.value })}/></label>
      {error && <p className="status error">{error}</p>}<div className="wanted-actions"><button type="button" onClick={() => setOpen(false)}>{t.cancel}</button><button className="primary-button" disabled={save.isPending}>{t.save}</button></div>
    </form>}
    {loading ? <div className="loading-block"/> : requests.length ? <div className="wanted-feed">{requests.map((request) => <article key={request.id}><span className="wanted-mark"><Icon><path d="M12 21s-7-4-7-11a7 7 0 0 1 14 0c0 7-7 11-7 11Z"/><circle cx="12" cy="10" r="2"/></Icon></span><div><div className="wanted-badges"><span className={`inline-listing-type ${request.listingType}`}>{request.listingType === "job" ? (lang === "es" ? "Empleo" : "Job") : (lang === "es" ? "Proyecto" : "Project")}</span><span className="wanted-category">{marketplaceCategoryLabel(request.category, lang)}</span></div><h3>{request.title}</h3>{request.description && <p>{request.description}</p>}<small>{request.companyName} · {request.serviceArea}{request.neededBy ? ` · ${request.neededBy}` : ""}</small>{request.companyPhone && <p className="wanted-contact"><strong>{t.contact}:</strong> {request.companyPhone}</p>}</div></article>)}</div> : !open && <div className="market-empty compact"><h2>{t.empty}</h2><p>{t.emptyBody}</p></div>}
  </section>;
}

function MarketplaceListingForm({ lang, settings, listingId, initialListingType = "job", onBack, onSaved }: { lang: Lang; settings: Settings | null; listingId?: number; initialListingType?: "job" | "project"; onBack: () => void; onSaved: (id: number) => void }) {
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ["marketplace-listing", listingId], queryFn: () => api.getMarketplaceListing({ id: listingId ?? 0 }), enabled: Boolean(listingId) });
  const [form, setForm] = useState({ title: "", category: "other" as MarketplaceCategory, listingType: initialListingType, employmentType: "full_time" as "full_time" | "part_time" | "temporary", payUnit: "hourly" as "hourly" | "salary", priceKind: "contact" as "amount" | "free" | "contact", price: "", originalPrice: "", description: "", serviceArea: "", companyName: settings?.companyName ?? "", companyPhone: settings?.phone ?? "", bookable: false, dailyRate: "" });
  const [photos, setPhotos] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [moderationNotice, setModerationNotice] = useState<{ id: number; reasons: string[] } | null>(null);
  const initializedListing = useRef<number | null>(null);
  useEffect(() => setForm((current) => ({ ...current, companyName: current.companyName || settings?.companyName || "", companyPhone: current.companyPhone || settings?.phone || "" })), [settings]);
  useEffect(() => {
    const listing = existing.data?.listing;
    if (!listingId || !listing || initializedListing.current === listingId) return;
    initializedListing.current = listingId;
    setForm({ title: listing.title, category: listing.category, listingType: listing.listingType, employmentType: listing.employmentType, payUnit: listing.payUnit, priceKind: listing.priceKind, price: listing.price, originalPrice: listing.originalPrice, description: listing.description, serviceArea: listing.serviceArea, companyName: listing.companyName, companyPhone: listing.companyPhone, bookable: listing.bookable, dailyRate: listing.dailyRate });
  }, [existing.data?.listing, listingId]);
  const save = useMutation({ mutationFn: async () => {
    const encoded = await Promise.all(photos.map(async (file) => ({ filename: file.name, contentType: file.type as "image/jpeg" | "image/png" | "image/webp", dataBase64: (await fileToBase64(file)).dataBase64 })));
    if (listingId) return api.updateMarketplaceListing({ id: listingId, ...form, replacePhotos: photos.length > 0, photos: encoded });
    return api.createMarketplaceListing({ ...form, photos: encoded });
  }, onSuccess: async (result) => { await Promise.all([qc.invalidateQueries({ queryKey: ["marketplace-listings"] }), qc.invalidateQueries({ queryKey: ["marketplace-listing", result.id] })]); if (result.moderation.flagged) setModerationNotice({ id: result.id, reasons: result.moderation.reasons }); else onSaved(result.id); }, onError: (caught) => setError(friendlyActionMessage(caught, lang)) });
  const t = lang === "es" ? { heading: listingId ? "Editar publicación" : form.listingType === "project" ? "Publicar un proyecto" : "Publicar un empleo", listingType: "Tipo de publicación", job: "Empleo", jobHelp: "Contratar a un empleado", project: "Proyecto", projectHelp: "Un subcontratista para una tarea", employment: "Condiciones de empleo", fullTime: "Tiempo completo", partTime: "Medio tiempo", temporary: "Temporal", payUnit: "Tipo de pago", hourly: "Por hora", salary: "Salario", title: "Título", titleHint: "Ej. Instalación de gabinetes disponible", category: "Categoría", priceType: "Precio", amount: "Precio actual", original: "Precio original (opcional)", fixed: "Precio fijo", free: "Gratis", contact: "Consultar precio", photos: "Fotos", photoHint: "Hasta 8 fotos JPG, PNG o WebP", keepPhotos: "Tus fotos actuales se conservarán. Elige nuevas fotos solo si quieres reemplazarlas.", replacePhotos: "Las fotos nuevas reemplazarán las actuales.", description: "Descripción", area: "Área de servicio o código postal", company: "Nombre de la empresa", phone: "Teléfono de contacto (opcional)", bookable: "Permitir reservas", bookableHelp: "Para alquileres de remolques, equipos u otros artículos por día", dailyRate: "Precio por día", publish: listingId ? "Guardar cambios" : "Publicar", required: "Agrega un título, área de servicio y empresa.", loading: "Cargando publicación…", notFound: "No se encontró esta publicación." } : { heading: listingId ? "Edit listing" : form.listingType === "project" ? "List a project" : "List a job", listingType: "Listing type", job: "Job", jobHelp: "Hiring an employee", project: "Project", projectHelp: "A subcontractor for one task", employment: "Employment terms", fullTime: "Full-time", partTime: "Part-time", temporary: "Temporary", payUnit: "Pay type", hourly: "Hourly", salary: "Salary", title: "Title", titleHint: "e.g. Cabinet installation available", category: "Trade category", priceType: "Price", amount: "Current price", original: "Original price (optional)", fixed: "Set a price", free: "Free", contact: "Contact for price", photos: "Photos", photoHint: "Up to 8 JPG, PNG, or WebP images", keepPhotos: "Your current photos will stay. Choose new photos only if you want to replace them.", replacePhotos: "New photos will replace the current ones.", description: "Description", area: "Service area or ZIP", company: "Company name", phone: "Contact phone (optional)", bookable: "Allow bookings", bookableHelp: "For trailers, equipment, or other items rented by the day", dailyRate: "Price per day", publish: listingId ? "Save changes" : "Publish listing", required: "Add a title, service area, and company name.", loading: "Loading listing…", notFound: "This listing could not be found." };
  if (listingId && existing.isLoading) return <main className="page form-page marketplace-form-page"><PageHeader lang={lang} title={t.heading} onBack={onBack}/><div className="loading-block" aria-label={t.loading}/></main>;
  if (listingId && !existing.data?.listing) return <main className="page form-page marketplace-form-page"><PageHeader lang={lang} title={t.heading} onBack={onBack}/><div className="market-empty"><h2>{t.notFound}</h2></div></main>;
  if (moderationNotice) return <main className="page form-page marketplace-form-page"><PageHeader lang={lang} title={t.heading} onBack={onBack}/><div className="market-empty moderation-notice">
    <span className="pa-badge pending_review">{lang === "es" ? "En revisión" : "Under review"}</span>
    <h2>{lang === "es" ? "Tu publicación fue marcada automáticamente y está en revisión." : "Your listing was automatically flagged and is under review."}</h2>
    <p>{lang === "es" ? "Se guardó, pero no será visible hasta que nuestro equipo la revise." : "It was saved, but it won't be visible until our team reviews it."}</p>
    {moderationNotice.reasons.length > 0 && <ul className="moderation-reasons">{moderationNotice.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
    <button type="button" className="primary-button" onClick={() => onSaved(moderationNotice.id)}>{lang === "es" ? "Continuar" : "Continue"}</button>
  </div></main>;
  const currentPhotos = existing.data?.listing?.photos ?? [];
  return <main className="page form-page marketplace-form-page"><PageHeader lang={lang} title={t.heading} onBack={onBack}/><form className="job-form marketplace-form" onSubmit={(event) => { event.preventDefault(); setError(""); if (!form.title.trim() || !form.serviceArea.trim() || !form.companyName.trim()) { setError(t.required); return; } save.mutate(); }}>
    <fieldset className="listing-type-choice"><legend>{t.listingType}</legend><button type="button" className={form.listingType === "job" ? "active job" : "job"} onClick={() => setForm({ ...form, listingType: "job", priceKind: form.priceKind === "free" ? "contact" : form.priceKind, bookable: false, dailyRate: "" })}><Icon><path d="M5 8h14v11H5zM9 8V5h6v3M5 12h14"/></Icon><span><strong>{t.job}</strong><small>{t.jobHelp}</small></span></button><button type="button" className={form.listingType === "project" ? "active project" : "project"} onClick={() => setForm({ ...form, listingType: "project" })}><Icon><path d="M4 20h16M6 20V9l6-5 6 5v11"/></Icon><span><strong>{t.project}</strong><small>{t.projectHelp}</small></span></button></fieldset>
    <label><span>{t.title}</span><input required aria-label={t.title} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder={t.titleHint}/></label>
    <label><span>{t.category}</span><select aria-label={t.category} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as MarketplaceCategory })}>{MARKETPLACE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item[lang]}</option>)}</select></label>
    {form.listingType === "job" && <div className="market-employment-fields"><label><span>{t.employment}</span><select value={form.employmentType} onChange={(event) => setForm({ ...form, employmentType: event.target.value as "full_time" | "part_time" | "temporary" })}><option value="full_time">{t.fullTime}</option><option value="part_time">{t.partTime}</option><option value="temporary">{t.temporary}</option></select></label><label><span>{t.payUnit}</span><select value={form.payUnit} onChange={(event) => setForm({ ...form, payUnit: event.target.value as "hourly" | "salary" })}><option value="hourly">{t.hourly}</option><option value="salary">{t.salary}</option></select></label></div>}
    <fieldset><legend>{form.listingType === "job" ? (lang === "es" ? "Pago" : "Pay") : (lang === "es" ? "Presupuesto del proyecto" : "Project budget")}</legend><div className="price-choice"><button type="button" className={form.priceKind === "amount" ? "active" : ""} onClick={() => setForm({ ...form, priceKind: "amount" })}>{form.listingType === "job" ? (lang === "es" ? "Agregar pago" : "Add pay") : (lang === "es" ? "Agregar presupuesto" : "Add budget")}</button><button type="button" className={form.priceKind === "contact" ? "active" : ""} onClick={() => setForm({ ...form, priceKind: "contact", price: "", originalPrice: "" })}>{t.contact}</button>{form.listingType === "project" && <button type="button" className={form.priceKind === "free" ? "active" : ""} onClick={() => setForm({ ...form, priceKind: "free", price: "", originalPrice: "" })}>{t.free}</button>}</div></fieldset>
    {form.priceKind === "amount" && <div className="market-price-fields"><label><span>{form.listingType === "job" ? (form.payUnit === "hourly" ? (lang === "es" ? "Pago por hora" : "Hourly pay") : (lang === "es" ? "Salario anual" : "Annual salary")) : (lang === "es" ? "Presupuesto del proyecto" : "Project budget")}</span><input required aria-label={form.listingType === "job" ? (lang === "es" ? "Pago" : "Pay") : t.amount} inputMode="decimal" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="$0.00"/></label>{form.listingType === "project" && <label><span>{t.original}</span><input aria-label={t.original} inputMode="decimal" value={form.originalPrice} onChange={(event) => setForm({ ...form, originalPrice: event.target.value })} placeholder="$0.00"/></label>}</div>}
    {form.listingType === "project" && <label className="market-bookable-switch"><span><strong>{t.bookable}</strong><small>{t.bookableHelp}</small></span><input type="checkbox" role="switch" aria-label={t.bookable} checked={form.bookable} onChange={(event) => setForm({ ...form, bookable: event.target.checked, dailyRate: event.target.checked ? form.dailyRate : "" })}/></label>}
    {form.listingType === "project" && form.bookable && <label><span>{t.dailyRate}</span><input required aria-label={t.dailyRate} inputMode="decimal" value={form.dailyRate} onChange={(event) => setForm({ ...form, dailyRate: event.target.value })} placeholder="$0.00"/></label>}
    {listingId && currentPhotos.length > 0 && <div className="existing-listing-photos"><span>{t.photos}</span><div>{currentPhotos.map((photo) => <img key={photo.id} src={photo.url} alt={photo.filename}/>)}</div><small>{photos.length ? t.replacePhotos : t.keepPhotos}</small></div>}
    <label className="market-photo-picker"><span>{listingId && currentPhotos.length ? (lang === "es" ? "Reemplazar fotos" : "Replace photos") : t.photos}</span><input type="file" aria-label={listingId && currentPhotos.length ? (lang === "es" ? "Reemplazar fotos" : "Replace photos") : t.photos} accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { const next = Array.from(event.target.files ?? []).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type)).slice(0, 8); setPhotos(next); }}/><small>{photos.length ? photos.map((file) => file.name).join(", ") : t.photoHint}</small></label>
    <label><span>{t.description}</span><textarea rows={6} aria-label={t.description} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label>
    <label><span>{t.area}</span><input required aria-label={t.area} value={form.serviceArea} onChange={(event) => setForm({ ...form, serviceArea: event.target.value })}/></label>
    <label><span>{t.company}</span><input required aria-label={t.company} value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })}/></label>
    <label><span>{t.phone}</span><input type="tel" aria-label={t.phone} value={form.companyPhone} onChange={(event) => setForm({ ...form, companyPhone: event.target.value })}/></label>
    {error && <p className="status error">{error}</p>}<button className="primary-button" disabled={save.isPending}>{save.isPending ? copy[lang].saving : t.publish}</button>
  </form></main>;
}

const MARKETPLACE_REPORT_REASONS: { value: "spam" | "explicit" | "illegal" | "scam" | "misleading" | "other"; en: string; es: string }[] = [
  { value: "spam", en: "Spam or duplicate listing", es: "Spam o publicación duplicada" },
  { value: "explicit", en: "Sexually explicit content", es: "Contenido sexual explícito" },
  { value: "illegal", en: "Illegal goods or services", es: "Bienes o servicios ilegales" },
  { value: "scam", en: "Scam or fraud", es: "Estafa o fraude" },
  { value: "misleading", en: "Misleading listing", es: "Publicación engañosa" },
  { value: "other", en: "Something else", es: "Otro motivo" },
];

function MarketplaceListingDetail({ lang, listingId, initialMessageOpen = false, onBack, onEdit, onDeleted }: { lang: Lang; listingId: number; initialMessageOpen?: boolean; onBack: () => void; onEdit: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["marketplace-listing", listingId], queryFn: () => api.getMarketplaceListing({ id: listingId }) });
  const [showPhone, setShowPhone] = useState(false);
  const [saved, setSaved] = useState(() => savedMarketplaceIds().includes(listingId));
  const [messageOpen, setMessageOpen] = useState(initialMessageOpen);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [messageImage, setMessageImage] = useState<File | null>(null);
  const [booking, setBooking] = useState({ startDate: "", endDate: "", note: "" });
  const [sentBooking, setSentBooking] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportConfirm, setReportConfirm] = useState(false);
  const [reportReason, setReportReason] = useState<"spam" | "explicit" | "illegal" | "scam" | "misleading" | "other">("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportDone, setReportDone] = useState(false);
  const reportListing = useMutation({
    mutationFn: () => api.marketplaceListingFlag({ listingId, reason: reportReason, details: reportDetails }),
    onSuccess: () => { setReportConfirm(false); setReportDone(true); setReportError(""); },
    onError: (caught) => setReportError(actionErrorMessage(caught)),
  });
  const messages = useQuery({ queryKey: ["marketplace-messages", listingId], queryFn: () => api.listMarketplaceMessages({ listingId }), enabled: messageOpen, refetchInterval: messageOpen ? 5000 : false });
  const markRead = useMutation({ mutationFn: () => api.markMarketplaceThreadRead({ listingId }), onSuccess: async () => { await Promise.all([qc.invalidateQueries({ queryKey: ["marketplace-inbox"] }), qc.invalidateQueries({ queryKey: ["marketplace-messages", listingId] })]); } });
  useEffect(() => { if (messageOpen) markRead.mutate(); }, [messageOpen, listingId]);
  const send = useMutation({ mutationFn: async () => api.sendMarketplaceMessage({ listingId, body: message, image: messageImage ? { filename: messageImage.name, contentType: messageImage.type as "image/jpeg" | "image/png" | "image/webp", dataBase64: (await fileToBase64(messageImage)).dataBase64 } : null, sender: "me" }), onSuccess: async () => { setMessage(""); setMessageImage(null); await Promise.all([qc.invalidateQueries({ queryKey: ["marketplace-messages", listingId] }), qc.invalidateQueries({ queryKey: ["marketplace-inbox"] })]); } });
  const requestBooking = useMutation({ mutationFn: () => api.createMarketplaceBooking({ listingId, ...booking }), onSuccess: () => setSentBooking(true) });
  const removeListing = useMutation({ mutationFn: () => api.deleteMarketplaceListing({ id: listingId }), onSuccess: async () => { const next = savedMarketplaceIds().filter((id) => id !== listingId); window.localStorage.setItem("crewkat-marketplace-saved", JSON.stringify(next)); await qc.invalidateQueries({ queryKey: ["marketplace-listings"] }); onDeleted(); } });
  const listing = query.data?.listing;
  const t = lang === "es" ? { notFound: "No se encontró esta publicación.", just: "Recién publicado", about: "Detalles", company: "Publicado por", contact: "Ver teléfono", noPhone: "Esta empresa no agregó un teléfono.", save: "Guardar", saved: "Guardado", preview: "Vista previa local", message: "Mensaje", book: "Reservar", conversation: "Conversación", messageIntro: "Este hilo se guarda en tu vista previa. Las conversaciones con otras empresas se activan al lanzar.", write: "Escribe un mensaje", addPhoto: "Agregar foto", send: "Enviar", bookingTitle: "Solicitar reserva", start: "Fecha de inicio", end: "Fecha final", note: "Nota para el propietario", submit: "Enviar solicitud", bookingSent: "Solicitud guardada", bookingSentBody: "La solicitud se guardó en esta vista previa. Los pagos y confirmaciones llegan al lanzar.", close: "Cerrar", perDay: "por día", noMessages: "Inicia la conversación sobre esta publicación.", manage: "Administrar publicación", edit: "Editar", remove: "Eliminar", removeTitle: "¿Eliminar esta publicación?", removeBody: "Se quitará del mercado y se liberará un espacio gratuito.", cancel: "Cancelar", deleting: "Eliminando…", removeError: "No se pudo eliminar. Inténtalo de nuevo.", report: "Reportar esta publicación", reportTitle: "Reportar publicación", reportReason: "Motivo", reportDetails: "Detalles (opcional)", reportSubmit: "Continuar", reportConfirmTitle: "¿Reportar esta publicación?", reportConfirmBody: "Nuestro equipo revisará esta publicación. Los reportes falsos pueden afectar tu cuenta.", reportConfirmYes: "Sí, reportar", reportThanks: "Gracias por tu reporte.", reportThanksBody: "Nuestro equipo revisará esta publicación pronto." } : { notFound: "This listing could not be found.", just: "Just listed", about: "About this listing", company: "Listed by", contact: "Show phone number", noPhone: "This company did not add a phone number.", save: "Save", saved: "Saved", preview: "Local preview", message: "Message", book: "Book", conversation: "Conversation", messageIntro: "This thread is saved in your preview. Conversations with other companies turn on at launch.", write: "Write a message", addPhoto: "Add photo", send: "Send", bookingTitle: "Request booking", start: "Start date", end: "End date", note: "Note for the owner", submit: "Send request", bookingSent: "Request saved", bookingSentBody: "The request is saved in this preview. Payments and confirmations arrive at launch.", close: "Close", perDay: "per day", noMessages: "Start the conversation about this listing.", manage: "Manage listing", edit: "Edit", remove: "Delete", removeTitle: "Delete this listing?", removeBody: "It will be removed from Marketplace and one free listing slot will open up.", cancel: "Cancel", deleting: "Deleting…", removeError: "The listing could not be deleted. Try again.", report: "Report this listing", reportTitle: "Report listing", reportReason: "Reason", reportDetails: "Details (optional)", reportSubmit: "Continue", reportConfirmTitle: "Report this listing?", reportConfirmBody: "Our team will review this listing. False reports can affect your account.", reportConfirmYes: "Yes, report it", reportThanks: "Thanks for the report.", reportThanksBody: "Our team will review this listing soon." };
  const toggle = () => { const ids = savedMarketplaceIds(); const next = ids.includes(listingId) ? ids.filter((id) => id !== listingId) : [...ids, listingId]; window.localStorage.setItem("crewkat-marketplace-saved", JSON.stringify(next)); setSaved(next.includes(listingId)); };
  return <main className="page marketplace-detail"><PageHeader lang={lang} title={lang === "es" ? "Publicación" : "Listing"} onBack={onBack} actions={<span className="preview-badge">{t.preview}</span>}/>{query.isLoading ? <div className="loading-block"/> : !listing ? <div className="market-empty"><h2>{t.notFound}</h2></div> : <>
    <section className="market-detail-gallery">{listing.photos.length ? listing.photos.map((photo, index) => <img key={photo.id} className={index === 0 ? "primary" : ""} src={photo.url} alt={`${listing.title} ${index + 1}`}/>) : <div className="market-detail-placeholder"><Icon size={44}><path d="M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4"/></Icon></div>}</section>
    <section className="market-detail-main"><div className="market-detail-kickers"><span className={`inline-listing-type ${listing.listingType}`}>{listing.listingType === "job" ? (lang === "es" ? "Empleo" : "Job") : (lang === "es" ? "Proyecto" : "Project")}</span>{listing.justListed && <span>{t.just}</span>}<small>{marketplaceCategoryLabel(listing.category, lang)}</small></div><h1>{listing.title}</h1><div className="market-price detail"><strong>{marketplacePrice(listing, lang)}</strong>{listing.originalPrice && listing.priceKind === "amount" && <del>{new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(listing.originalPrice))}</del>}</div>{listing.bookable && <p className="daily-rate"><strong>{new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", { style: "currency", currency: "USD" }).format(Number(listing.dailyRate || 0))}</strong> {t.perDay}</p>}<p className="market-detail-area"><Icon><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/></Icon>{listing.serviceArea}</p><button className={`market-detail-save${saved ? " saved" : ""}`} onClick={toggle}><Icon><path d="M6 3h12v18l-6-4-6 4z"/></Icon>{saved ? t.saved : t.save}</button></section>
    <div className={`market-contact-actions${listing.bookable ? " bookable" : ""}`}><button className="primary-button" onClick={() => setMessageOpen(true)}><Icon><path d="M4 5h16v12H8l-4 4z"/></Icon>{t.message}</button>{listing.bookable && <button className="primary-button" onClick={() => { setSentBooking(false); setBookingOpen(true); }}><Icon><path d="M5 5h14v15H5zM8 3v4M16 3v4M8 11h8"/></Icon>{t.book}</button>}</div>
    {listing.isMine && <section className="market-owner-actions" aria-label={t.manage}><button onClick={onEdit}><Icon><path d="M4 20h4L19 9l-4-4L4 16zM13 7l4 4"/></Icon>{t.edit}</button><button className="danger" onClick={() => setDeleteOpen(true)}><TrashIcon/>{t.remove}</button></section>}
    <section className="market-detail-section"><h2>{t.about}</h2><p>{listing.description || "—"}</p></section><section className="market-detail-section company"><h2>{t.company}</h2><strong>{listing.companyName}</strong>{listing.companyPhone ? <>{showPhone ? <p className="market-phone">{listing.companyPhone}</p> : <button className="primary-button" onClick={() => setShowPhone(true)}>{t.contact}</button>}</> : <p className="muted-note">{t.noPhone}</p>}</section>
    {!listing.isMine && <button type="button" className="market-report-link" onClick={() => { setReportOpen(true); setReportConfirm(false); setReportDone(false); setReportError(""); setReportDetails(""); }}>{t.report}</button>}
    {deleteOpen && <div className="sheet-backdrop" onClick={() => !removeListing.isPending && setDeleteOpen(false)}><section className="more-sheet delete-listing-sheet" role="dialog" aria-modal="true" aria-labelledby="detail-delete-listing-title" onClick={(event) => event.stopPropagation()}><div className="sheet-handle"/><span className="delete-sheet-icon"><TrashIcon/></span><h2 id="detail-delete-listing-title">{t.removeTitle}</h2><strong>{listing.title}</strong><p>{t.removeBody}</p>{removeListing.isError && <p className="status error">{t.removeError}</p>}<div className="delete-sheet-actions"><button type="button" disabled={removeListing.isPending} onClick={() => setDeleteOpen(false)}>{t.cancel}</button><button type="button" className="danger-button" disabled={removeListing.isPending} onClick={() => removeListing.mutate()}>{removeListing.isPending ? t.deleting : t.remove}</button></div></section></div>}
    {reportOpen && <div className="sheet-backdrop" onClick={() => !reportListing.isPending && setReportOpen(false)}><section className="more-sheet report-sheet" role="dialog" aria-modal="true" aria-labelledby="report-listing-title" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle"/><div className="sheet-title-row"><h2 id="report-listing-title">{t.reportTitle}</h2><button aria-label={t.close} onClick={() => setReportOpen(false)}>×</button></div>
      {reportDone ? <div className="booking-success"><Icon size={36}><path d="m5 12 4 4L19 6"/></Icon><h3>{t.reportThanks}</h3><p>{t.reportThanksBody}</p><button className="primary-button" onClick={() => setReportOpen(false)}>{t.close}</button></div>
      : reportConfirm ? <><p>{t.reportConfirmBody}</p><strong>{listing.title}</strong>{reportError && <p className="status error">{reportError}</p>}<div className="delete-sheet-actions"><button type="button" disabled={reportListing.isPending} onClick={() => setReportConfirm(false)}>{t.cancel}</button><button type="button" className="danger-button" disabled={reportListing.isPending} onClick={() => reportListing.mutate()}>{reportListing.isPending ? (lang === "es" ? "Enviando…" : "Sending…") : t.reportConfirmYes}</button></div></>
      : <><fieldset className="report-reasons"><legend>{t.reportReason}</legend>{MARKETPLACE_REPORT_REASONS.map((option) => <label key={option.value} className={reportReason === option.value ? "active" : ""}><input type="radio" name="report-reason" checked={reportReason === option.value} onChange={() => setReportReason(option.value)} /><span>{lang === "es" ? option.es : option.en}</span></label>)}</fieldset>
      <label className="report-details"><span>{t.reportDetails}</span><textarea rows={3} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} maxLength={1000} /></label>
      {reportError && <p className="status error">{reportError}</p>}
      <div className="delete-sheet-actions"><button type="button" onClick={() => setReportOpen(false)}>{t.cancel}</button><button type="button" className="primary-button" onClick={() => { setReportError(""); setReportConfirm(true); }}>{t.reportSubmit}</button></div></>}
    </section></div>}
    {messageOpen && <div className="sheet-backdrop"><section className="more-sheet conversation-sheet"><div className="sheet-handle"/><div className="sheet-title-row"><h2>{t.conversation}</h2><button aria-label={t.close} onClick={() => setMessageOpen(false)}>×</button></div><p className="sheet-note">{t.messageIntro}</p><div className="message-thread">{(messages.data?.messages ?? []).length ? messages.data?.messages.map((item) => { const outgoing = (listing?.isMine ?? true) ? item.sender === "me" : item.sender === "other"; return <article key={item.id} className={outgoing ? "outgoing" : "incoming"}>{!outgoing && <span className="message-sender">{item.senderName}</span>}{item.imageUrl && <img src={item.imageUrl} alt={item.imageFilename || (lang === "es" ? "Foto adjunta" : "Attached photo")}/>} {item.body && <p>{item.body}</p>}<time>{new Date(item.createdAt).toLocaleString(lang === "es" ? "es-US" : "en-US")}</time></article>; }) : <p className="thread-empty">{t.noMessages}</p>}</div><form className="message-composer" onSubmit={(event) => { event.preventDefault(); if (message.trim() || messageImage) send.mutate(); }}><textarea rows={2} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={t.write} aria-label={t.write}/><label><Icon><path d="M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4"/></Icon>{messageImage?.name || t.addPhoto}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setMessageImage(event.target.files?.[0] ?? null)}/></label><button className="primary-button" disabled={send.isPending || (!message.trim() && !messageImage)}>{t.send}</button></form></section></div>}
    {bookingOpen && <div className="sheet-backdrop"><section className="more-sheet booking-sheet"><div className="sheet-handle"/><div className="sheet-title-row"><h2>{t.bookingTitle}</h2><button aria-label={t.close} onClick={() => setBookingOpen(false)}>×</button></div>{sentBooking ? <div className="booking-success"><Icon size={36}><path d="m5 12 4 4L19 6"/></Icon><h3>{t.bookingSent}</h3><p>{t.bookingSentBody}</p><button className="primary-button" onClick={() => setBookingOpen(false)}>{t.close}</button></div> : <form className="booking-form" onSubmit={(event) => { event.preventDefault(); requestBooking.mutate(); }}><div><label><span>{t.start}</span><input required type="date" value={booking.startDate} onChange={(event) => setBooking({ ...booking, startDate: event.target.value })}/></label><label><span>{t.end}</span><input required type="date" min={booking.startDate} value={booking.endDate} onChange={(event) => setBooking({ ...booking, endDate: event.target.value })}/></label></div><label><span>{t.note}</span><textarea rows={4} value={booking.note} onChange={(event) => setBooking({ ...booking, note: event.target.value })}/></label>{requestBooking.isError && <p className="status error">{requestBooking.error instanceof Error ? requestBooking.error.message : "Error"}</p>}<button className="primary-button" disabled={requestBooking.isPending}>{t.submit}</button></form>}</section></div>}
  </>}</main>;
}

type ToolTile = {
  title: string;
  description: string;
  icon: ReactNode;
  screen?: Screen;
  comingSoon?: string;
  pro?: boolean;
};

function isProToolScreen(screen?: Screen) {
  if (!screen) return false;
  return screen.name === "proWorkspace" || screen.name === "businessTools" || screen.name === "admin" || screen.name === "expansion" || screen.name === "fieldIntelligence" || screen.name === "reports" || screen.name === "followups";
}

// Tool ids for Home-screen pinning: `<screenName>` or `<screenName>:<tab>`,
// matching the server TOOL_REGISTRY in app/server/src/actions.ts.
function toolIdForTile(tile: ToolTile): string | null {
  if (!tile.screen) return null;
  const tab = "tab" in tile.screen ? tile.screen.tab : undefined;
  return tab ? `${tile.screen.name}:${tab}` : tile.screen.name;
}
const PIN_ICON_PATH = "M9 4h6l1 8 3 3v2H5v-2l3-3zM12 16v5";
function pinnedScreenTarget(pin: { screen: string; tab: string | null }): Screen {
  return { name: pin.screen, ...(pin.tab ? { tab: pin.tab } : {}) } as Screen;
}

function ToolStatus({ lang, comingSoon }: { lang: Lang; comingSoon?: string }) {
  return (
    <span className={`tool-status${comingSoon ? " coming" : " ready"}`}>
      {comingSoon
        ? lang === "es"
          ? "Próximamente"
          : "Coming soon"
        : lang === "es"
          ? "Funciona ahora"
          : "Works now"}
    </span>
  );
}

function ComingSoonSheet({
  lang,
  tool,
  onClose,
}: {
  lang: Lang;
  tool: ToolTile;
  onClose: () => void;
}) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section
        className="more-sheet tool-coming-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tool-coming-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-handle" />
        <ToolStatus lang={lang} comingSoon={tool.comingSoon} />
        <h2 id="tool-coming-title">{tool.title}</h2>
        <p>{tool.comingSoon}</p>
        <button className="primary-button" type="button" onClick={onClose}>
          {lang === "es" ? "Entendido" : "Got it"}
        </button>
      </section>
    </div>
  );
}

function UpgradeGateSheet({ lang, tool, onClose, onUpgrade }: { lang: Lang; tool: ToolTile; onClose: () => void; onUpgrade: () => void }) {
  return <div className="client-sheet-backdrop" role="presentation" onClick={onClose}>
    <section className="client-sheet pro-gate-sheet" role="dialog" aria-modal="true" aria-labelledby="pro-gate-title" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" />
      <header><div><span className="pro-header-badge">PRO</span><h2 id="pro-gate-title">{tool.title}</h2></div><button type="button" aria-label={lang === "es" ? "Cerrar" : "Close"} onClick={onClose}>×</button></header>
      <p>{lang === "es" ? "Esta herramienta está incluida con Crewkat Premium." : "This tool is included with Crewkat Premium."}</p>
      <button className="primary-button" type="button" onClick={onUpgrade}>{lang === "es" ? "Ver Premium" : "View Premium"}</button>
    </section>
  </div>;
}

function ToolsHomeScreen({ lang, setScreen }: { lang: Lang; setScreen: (screen: Screen) => void }) {
  const auth = useContext(AuthContext);
  const isPremium = auth?.user.tier === "premium";
  const [soon, setSoon] = useState<ToolTile | null>(null);
  const [lockedTool, setLockedTool] = useState<ToolTile | null>(null);
  const qc = useQueryClient();
  const pinsQuery = useQuery({ queryKey: ["home-pins"], queryFn: () => api.listPinnedTools({}) });
  const pinnedIds = new Set((pinsQuery.data?.tools ?? []).map((t) => t.toolId));
  const pinMutation = useMutation({
    mutationFn: async (toolId: string) => {
      if (pinnedIds.has(toolId)) await api.unpinTool({ toolId });
      else await api.pinTool({ toolId });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["home-pins"] }),
  });
  const toolIcon = (path: ReactNode) => <span className="tool-tile-icon"><Icon>{path}</Icon></span>;
  const estimating: ToolTile[] = lang === "es" ? [
    { title: "Pago de préstamo", description: "Calcula pago mensual e interés", screen: { name: "toolbox", tab: "loan" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Guía de materiales", description: "Consulta medidas y referencias comunes", screen: { name: "toolbox", tab: "materials" }, icon: toolIcon(<path d="M4 18h16M6 18V7h12v11M9 7V4h6v3" />) },
    { title: "Ángulos", description: "Calcula ángulos y pendientes", screen: { name: "toolbox", tab: "angle" }, icon: toolIcon(<path d="M4 19h16L4 5zM8 15h5" />) },
    { title: "Convertidor de unidades", description: "Convierte medidas de obra", screen: { name: "toolbox", tab: "convert" }, icon: toolIcon(<path d="M5 8h13M15 5l3 3-3 3M19 16H6M9 13l-3 3 3 3" />) },
    { title: "Medidas", description: "Suma áreas y estima pintura", screen: { name: "toolbox", tab: "area" }, icon: toolIcon(<path d="M4 4h16v16H4zM8 4v16M4 10h16" />) },
    { title: "Concreto", description: "Yardas cúbicas y bolsas", screen: { name: "toolbox", tab: "yards" }, icon: toolIcon(<path d="M4 8h16v10H4zM4 12h16M9 8v10M15 8v10" />) },
    { title: "Madera", description: "Calcula pies tabla", screen: { name: "toolbox", tab: "board" }, icon: toolIcon(<path d="M4 7h16v10H4zM8 7v10M13 7v10" />) },
    { title: "Paneles de yeso", description: "Hojas, tornillos y compuesto", screen: { name: "toolbox", tab: "drywall" }, icon: toolIcon(<path d="M5 4h14v16H5zM9 4v16M5 10h14" />) },
    { title: "Techos", description: "Cuadrados, desperdicio y paquetes", screen: { name: "toolbox", tab: "roofing" }, icon: toolIcon(<path d="M3 13 12 4l9 9M6 11v9h12v-9" />) },
    { title: "Cajas de loseta", description: "Cobertura, desperdicio y cajas", screen: { name: "toolbox", tab: "tile" }, icon: toolIcon(<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />) },
    { title: "Margen y recargo", description: "Convierte costo, margen y recargo", screen: { name: "toolbox", tab: "margin" }, icon: toolIcon(<path d="M6 18 18 6M7 7h.01M17 17h.01" />) },
    { title: "Estimador de pintura", description: "Galones según área y manos", screen: { name: "toolbox", tab: "paint" }, icon: toolIcon(<path d="M4 4h13v4H4zM17 6v5h3M7 10v10h3V10" />) },
    { title: "Cajas de piso", description: "Cobertura, desperdicio y cajas", screen: { name: "toolbox", tab: "flooring" }, icon: toolIcon(<path d="M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M14 4v16" />) },
    { title: "Cerca y deck", description: "Estacas, postes y rieles", screen: { name: "toolbox", tab: "fence" }, icon: toolIcon(<path d="M4 20V6M8 20V6M12 20V6M16 20V6M20 20V6M3 10h18M3 15h18" />) },
    { title: "Bloques y adoquines", description: "Bloques y adoquines por área", screen: { name: "toolbox", tab: "block" }, icon: toolIcon(<path d="M4 10h7V4H4zM13 10h7V4h-7zM4 20h7v-6H4zM13 20h7v-6h-7z" />) },
    { title: "Grava y tierra", description: "Yardas cúbicas y toneladas", screen: { name: "toolbox", tab: "gravel" }, icon: toolIcon(<path d="M4 15 9 6l5 6 3-4 3 7zM4 20h16" />) },
    { title: "Zanca de escalera", description: "Contrahuellas, huellas y trazado", screen: { name: "toolbox", tab: "stairs" }, icon: toolIcon(<path d="M4 20h4v-4h4v-4h4V8h4V4" />) },
    { title: "Aislante en rollos", description: "Rollos según área de pared o ático", screen: { name: "toolbox", tab: "insulation" }, icon: toolIcon(<path d="M5 20c3-2 3-6 0-8 3-2 3-6 0-8M12 20c3-2 3-6 0-8 3-2 3-6 0-8M19 20c3-2 3-6 0-8 3-2 3-6 0-8" />) },
    { title: "Canalones y bajantes", description: "Pies de canalón, bajantes y codos", screen: { name: "toolbox", tab: "gutter" }, icon: toolIcon(<path d="M4 6h16v4H4zM17 10v8h-4M17 18H6" />) },
    { title: "Tarifa facturable", description: "Calcula tu tarifa por hora", screen: { name: "toolbox", tab: "rate" }, icon: toolIcon(<path d="M12 3v18M7 7h7a2 2 0 0 1 0 4H9a2 2 0 0 0 0 4h8" />) },
    { title: "Lista de pendientes", description: "Pendientes por trabajo con estados", screen: { name: "toolbox", tab: "punchlist" }, icon: toolIcon(<path d="M4 5h16M4 12h16M4 19h16M18 3l3 3-3 3" />) },
  ] : [
    { title: "Loan payment", description: "Calculate monthly payment and interest", screen: { name: "toolbox", tab: "loan" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Material guide", description: "Check common sizes and references", screen: { name: "toolbox", tab: "materials" }, icon: toolIcon(<path d="M4 18h16M6 18V7h12v11M9 7V4h6v3" />) },
    { title: "Angles", description: "Calculate angles and slopes", screen: { name: "toolbox", tab: "angle" }, icon: toolIcon(<path d="M4 19h16L4 5zM8 15h5" />) },
    { title: "Unit converter", description: "Convert job-site measurements", screen: { name: "toolbox", tab: "convert" }, icon: toolIcon(<path d="M5 8h13M15 5l3 3-3 3M19 16H6M9 13l-3 3 3 3" />) },
    { title: "Measurements", description: "Add areas and estimate paint", screen: { name: "toolbox", tab: "area" }, icon: toolIcon(<path d="M4 4h16v16H4zM8 4v16M4 10h16" />) },
    { title: "Concrete", description: "Cubic yards and bag counts", screen: { name: "toolbox", tab: "yards" }, icon: toolIcon(<path d="M4 8h16v10H4zM4 12h16M9 8v10M15 8v10" />) },
    { title: "Lumber", description: "Calculate board feet", screen: { name: "toolbox", tab: "board" }, icon: toolIcon(<path d="M4 7h16v10H4zM8 7v10M13 7v10" />) },
    { title: "Drywall sheets", description: "Sheets, screws, and compound", screen: { name: "toolbox", tab: "drywall" }, icon: toolIcon(<path d="M5 4h14v16H5zM9 4v16M5 10h14" />) },
    { title: "Roofing squares", description: "Squares, waste, and bundles", screen: { name: "toolbox", tab: "roofing" }, icon: toolIcon(<path d="M3 13 12 4l9 9M6 11v9h12v-9" />) },
    { title: "Tile boxes", description: "Coverage, waste, and box count", screen: { name: "toolbox", tab: "tile" }, icon: toolIcon(<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />) },
    { title: "Markup & margin", description: "Convert cost, margin, and markup", screen: { name: "toolbox", tab: "margin" }, icon: toolIcon(<path d="M6 18 18 6M7 7h.01M17 17h.01" />) },
    { title: "Paint estimator", description: "Gallons from wall area and coats", screen: { name: "toolbox", tab: "paint" }, icon: toolIcon(<path d="M4 4h13v4H4zM17 6v5h3M7 10v10h3V10" />) },
    { title: "Flooring boxes", description: "Coverage, waste, and box count", screen: { name: "toolbox", tab: "flooring" }, icon: toolIcon(<path d="M4 4h16v16H4zM4 9h16M4 14h16M9 4v16M14 4v16" />) },
    { title: "Fence & deck", description: "Pickets, posts, and rails", screen: { name: "toolbox", tab: "fence" }, icon: toolIcon(<path d="M4 20V6M8 20V6M12 20V6M16 20V6M20 20V6M3 10h18M3 15h18" />) },
    { title: "Block & pavers", description: "Blocks and pavers by area", screen: { name: "toolbox", tab: "block" }, icon: toolIcon(<path d="M4 10h7V4H4zM13 10h7V4h-7zM4 20h7v-6H4zM13 20h7v-6h-7z" />) },
    { title: "Gravel & soil", description: "Cubic yards and tons", screen: { name: "toolbox", tab: "gravel" }, icon: toolIcon(<path d="M4 15 9 6l5 6 3-4 3 7zM4 20h16" />) },
    { title: "Stair stringer", description: "Risers, treads, and layout", screen: { name: "toolbox", tab: "stairs" }, icon: toolIcon(<path d="M4 20h4v-4h4v-4h4V8h4V4" />) },
    { title: "Insulation batts", description: "Batts by wall or attic area", screen: { name: "toolbox", tab: "insulation" }, icon: toolIcon(<path d="M5 20c3-2 3-6 0-8 3-2 3-6 0-8M12 20c3-2 3-6 0-8 3-2 3-6 0-8M19 20c3-2 3-6 0-8 3-2 3-6 0-8" />) },
    { title: "Gutter & downspouts", description: "Gutter feet, downspouts, and elbows", screen: { name: "toolbox", tab: "gutter" }, icon: toolIcon(<path d="M4 6h16v4H4zM17 10v8h-4M17 18H6" />) },
    { title: "Billable rate", description: "Build your hourly rate", screen: { name: "toolbox", tab: "rate" }, icon: toolIcon(<path d="M12 3v18M7 7h7a2 2 0 0 1 0 4H9a2 2 0 0 0 0 4h8" />) },
    { title: "Punch list", description: "Per-job open-items checklist", screen: { name: "toolbox", tab: "punchlist" }, icon: toolIcon(<path d="M4 5h16M4 12h16M4 19h16M18 3l3 3-3 3" />) },
  ];
  const office: ToolTile[] = lang === "es" ? [
    { title: "Precios guardados", description: "Guarda precios que usas con frecuencia", screen: { name: "businessTools", tab: "price" }, icon: toolIcon(<path d="M5 5h14v14H5zM8 9h8M8 13h5" />) },
    { title: "Plantillas de presupuestos", description: "Reutiliza partidas frecuentes", screen: { name: "businessTools", tab: "templates" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Millaje", description: "Registra viajes y totales mensuales", screen: { name: "businessTools", tab: "mileage" }, icon: toolIcon(<path d="M5 18c4-8 10-8 14-12M5 18h5M19 6h-5" />) },
    { title: "Gastos y recibos", description: "Registra costos y fotos de recibos", screen: { name: "businessTools", tab: "expenses" }, icon: toolIcon(<path d="M4 6h16v14H4zM8 3v6M16 3v6" />) },
    { title: "Garantías", description: "Guarda coberturas y vencimientos", screen: { name: "expansion", tab: "warranties" }, icon: toolIcon(<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-5" />) },
    { title: "Escáner de documentos", description: "Guarda recibos, contratos y archivos", screen: { name: "expansion", tab: "scanner" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 7h6M4 16h16" />) },
    { title: "Informes", description: "Ingresos, gastos y estimado frente a real", screen: { name: "reports" }, icon: toolIcon(<path d="M4 20V10M10 20V4M16 20v-7M22 20V7" />) },
  ] : [
    { title: "Saved prices", description: "Save prices you use often", screen: { name: "businessTools", tab: "price" }, icon: toolIcon(<path d="M5 5h14v14H5zM8 9h8M8 13h5" />) },
    { title: "Quote templates", description: "Reuse common line items", screen: { name: "businessTools", tab: "templates" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Mileage", description: "Record work trips and monthly totals", screen: { name: "businessTools", tab: "mileage" }, icon: toolIcon(<path d="M5 18c4-8 10-8 14-12M5 18h5M19 6h-5" />) },
    { title: "Expenses & receipts", description: "Record costs and receipt photos", screen: { name: "businessTools", tab: "expenses" }, icon: toolIcon(<path d="M4 6h16v14H4zM8 3v6M16 3v6" />) },
    { title: "Warranties", description: "Save coverage and expiry dates", screen: { name: "expansion", tab: "warranties" }, icon: toolIcon(<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-5" />) },
    { title: "Document scanner", description: "Save receipts, contracts, and files", screen: { name: "expansion", tab: "scanner" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 7h6M4 16h16" />) },
    { title: "Reports", description: "Revenue, expenses, and estimate vs. actual", screen: { name: "reports" }, icon: toolIcon(<path d="M4 20V10M10 20V4M16 20v-7M22 20V7" />) },
  ];
  const operations: ToolTile[] = lang === "es" ? [
    { title: "Calendario", description: "Citas, plazos y horas guardadas", screen: { name: "operations", tab: "calendar" }, icon: toolIcon(<path d="M5 5h14v15H5zM8 3v4M16 3v4M8 11h3M13 11h3" />) },
    { title: "Cobros y seguimientos", description: "Facturas vencidas y presupuestos pendientes", screen: { name: "followups" }, icon: toolIcon(<path d="M12 7v5l3 2M4 12a8 8 0 1 0 2-5" />) },
    { title: "Pedidos esperando proveedores", description: "Compara cotizaciones y registra entregas", screen: { name: "fieldIntelligence", tab: "purchasing" }, icon: toolIcon(<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />) },
    { title: "Equipo", description: "Inventario, préstamos y ubicación", screen: { name: "fieldIntelligence", tab: "equipment" }, icon: toolIcon(<path d="M7 7h10v10H7zM4 10h3M17 10h3M10 4v3M10 17v3" />) },
    { title: "Cuidado del equipo", description: "Servicios y mantenimiento completado", screen: { name: "expansion", tab: "plans" }, icon: toolIcon(<path d="M4 18h16M7 18v-5l5-4 5 4v5M9 8V4h6v4" />) },
    { title: "Seguridad e incidentes", description: "Charlas, firmas e informes", screen: { name: "fieldIntelligence", tab: "safety" }, icon: toolIcon(<path d="M12 3l8 4v5c0 5-3 8-8 10-5-2-8-5-8-10V7zM9 12l2 2 4-5" />) },
    { title: "Licencias y certificados", description: "Vencimientos y renovaciones", screen: { name: "fieldIntelligence", tab: "credentials" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Nómina", description: "Horas por tarifa y descarga CSV", screen: { name: "fieldIntelligence", tab: "payroll" }, icon: toolIcon(<path d="M4 7h16v12H4zM8 11h8M8 15h5" />) },
    { title: "Horas del equipo", description: "Revisa las horas guardadas por persona", screen: { name: "expansion", tab: "crew" }, icon: toolIcon(<path d="M12 7v5l3 2M4 12a8 8 0 1 0 2-5" />) },
  ] : [
    { title: "Schedule", description: "Appointments, deadlines, and saved hours", screen: { name: "operations", tab: "calendar" }, icon: toolIcon(<path d="M5 5h14v15H5zM8 3v4M16 3v4M8 11h3M13 11h3" />) },
    { title: "Collections & follow-ups", description: "Overdue invoices and pending estimates", screen: { name: "followups" }, icon: toolIcon(<path d="M12 7v5l3 2M4 12a8 8 0 1 0 2-5" />) },
    { title: "Orders waiting on suppliers", description: "Compare bids and record deliveries", screen: { name: "fieldIntelligence", tab: "purchasing" }, icon: toolIcon(<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />) },
    { title: "Equipment", description: "Inventory, checkout, and current location", screen: { name: "fieldIntelligence", tab: "equipment" }, icon: toolIcon(<path d="M7 7h10v10H7zM4 10h3M17 10h3M10 4v3M10 17v3" />) },
    { title: "Equipment upkeep", description: "Service schedules and completed maintenance", screen: { name: "expansion", tab: "plans" }, icon: toolIcon(<path d="M4 18h16M7 18v-5l5-4 5 4v5M9 8V4h6v4" />) },
    { title: "Safety & incidents", description: "Talks, sign-offs, and incident reports", screen: { name: "fieldIntelligence", tab: "safety" }, icon: toolIcon(<path d="M12 3l8 4v5c0 5-3 8-8 10-5-2-8-5-8-10V7zM9 12l2 2 4-5" />) },
    { title: "Licenses & certificates", description: "Expiry dates and renewals", screen: { name: "fieldIntelligence", tab: "credentials" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Payroll", description: "Hours by rate and CSV download", screen: { name: "fieldIntelligence", tab: "payroll" }, icon: toolIcon(<path d="M4 7h16v12H4zM8 11h8M8 15h5" />) },
    { title: "Crew hours", description: "Review saved hours by crew member", screen: { name: "expansion", tab: "crew" }, icon: toolIcon(<path d="M12 7v5l3 2M4 12a8 8 0 1 0 2-5" />) },
  ];
  const openTool = (tile: ToolTile) => {
    if (!isPremium && (tile.pro || isProToolScreen(tile.screen))) setLockedTool(tile);
    else if (tile.comingSoon) setSoon(tile);
    else if (tile.screen) setScreen(tile.screen);
  };
  const section = (title: string, tiles: ToolTile[]) => (
    <section className="tool-group everyday-tool-group">
      <div className="tool-group-heading"><h2>{title}</h2></div>
      <div className="tool-directory">
        {tiles.map((tile) => {
          const toolId = toolIdForTile(tile);
          const pinned = toolId ? pinnedIds.has(toolId) : false;
          const pinLabel = pinned ? (lang === "es" ? "Quitar" : "Unpin") : (lang === "es" ? "Fijar al inicio" : "Pin to Home");
          return (
            <div key={toolId ?? tile.title} className="tool-row">
              <button type="button" className="tool-row-main" onClick={() => openTool(tile)}>
                {tile.icon}<span><strong>{tile.title}</strong><small>{tile.description}</small><ToolStatus lang={lang} comingSoon={tile.comingSoon} /></span><span className="tool-row-end">{!isPremium && (tile.pro || isProToolScreen(tile.screen)) && <b className="pro-row-badge">PRO</b>}{tile.comingSoon ? <span className="soon-dot" aria-hidden="true" /> : <BackIcon />}</span>
              </button>
              {toolId && (
                <button type="button" className={`tool-pin-toggle${pinned ? " pinned" : ""}`} aria-pressed={pinned} aria-label={pinLabel} title={pinLabel} disabled={pinMutation.isPending} onClick={() => pinMutation.mutate(toolId)}>
                  <Icon size={18}><path d={PIN_ICON_PATH} /></Icon>
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
  return (
    <main className="page tools-home">
      <PageHeader lang={lang} title={lang === "es" ? "Herramientas" : "Tools"} />
      <button className="pro-workspace-launch" type="button" onClick={() => setScreen({ name: "proWorkspace" })}>
        <span className="pro-launch-mark"><strong>PRO</strong><Icon><path d="M4 17 10 11l4 4 6-8"/><path d="M17 7h3v3"/></Icon></span>
        <span><strong>{lang === "es" ? "Herramientas Pro" : "Pro Tools"}</strong><small>{lang === "es" ? "Operaciones avanzadas, equipo, seguridad y control." : "Advanced operations, equipment, safety, and control."}</small></span>
        <BackIcon />
      </button>
      <div className="tools-featured-panels">
        {isPremium ? <CrewClockPanel lang={lang} /> : <ProFeatureCard title={lang === "es" ? "Reloj GPS del equipo" : "Crew GPS clock"} description={lang === "es" ? "Marca horas y ubicación por trabajo." : "Record time and location by job."} onClick={() => setLockedTool({ title: lang === "es" ? "Reloj GPS del equipo" : "Crew GPS clock", description: "", icon: null, pro: true })} />}
        {isPremium ? <BookingLinkPanel lang={lang} /> : <ProFeatureCard title={lang === "es" ? "Formulario público de estimado" : "Public estimate form"} description={lang === "es" ? "Recibe solicitudes desde tu sitio web." : "Collect estimate requests from your website."} onClick={() => setLockedTool({ title: lang === "es" ? "Formulario público de estimado" : "Public estimate form", description: "", icon: null, pro: true })} />}
      </div>
      {section(lang === "es" ? "Herramientas para estimar" : "Estimating toolbox", estimating)}
      {section(lang === "es" ? "Negocio y oficina" : "Business & office", office)}
      {section(lang === "es" ? "Operaciones" : "Operations", operations)}
      {soon && <ComingSoonSheet lang={lang} tool={soon} onClose={() => setSoon(null)} />}
      {lockedTool && <UpgradeGateSheet lang={lang} tool={lockedTool} onClose={() => setLockedTool(null)} onUpgrade={() => { setLockedTool(null); setScreen({ name: "upgrade" }); }} />}
    </main>
  );
}

function ProFeatureCard({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return <button type="button" className="pro-feature-card" onClick={onClick}>
    <span className="tool-tile-icon"><Icon><path d="M12 7v5l3 2M4 12a8 8 0 1 0 2-5" /></Icon></span>
    <span><strong>{title}</strong><small>{description}</small></span>
    <b className="pro-row-badge">PRO</b>
  </button>;
}

function UpgradeScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const auth = useContext(AuthContext);
  const subscription = useQuery({ queryKey: ["subscription"], queryFn: () => api.getSubscription({}) });
  const checkout = useMutation({ mutationFn: () => api.startPremiumCheckout({}) });
  const isPremium = auth?.user.tier === "premium" || subscription.data?.tier === "premium";
  const startCheckout = async () => {
    const result = await checkout.mutateAsync();
    if (result.checkoutUrl) window.open(result.checkoutUrl, "_blank", "noopener,noreferrer");
  };
  const features = lang === "es"
    ? ["Órdenes de compra y proveedores", "Equipo, mantenimiento y seguridad", "Nómina, puntaje de prospectos y automatizaciones", "Informes avanzados y límites ilimitados", "Promoción y espacios extra en Marketplace", "Todas las próximas herramientas Pro"]
    : ["Purchase orders and suppliers", "Equipment, upkeep, and safety", "Payroll, lead scoring, and automations", "Advanced reports and unlimited limits", "Marketplace promotion and extra listing slots", "Every upcoming Pro tool"];
  return <main className="page upgrade-page">
    <PageHeader lang={lang} title={lang === "es" ? "Crewkat Premium" : "Crewkat Premium"} onBack={onBack} />
    <section className="upgrade-hero">
      <span className="premium-plan-mark">PREMIUM</span>
      <h1>{isPremium ? (lang === "es" ? "Tu espacio Pro está activo" : "Your Pro workspace is active") : (lang === "es" ? "Todo el trabajo. Menos trabajo pesado." : "The whole operation. Less busywork.")}</h1>
      <p>{lang === "es" ? "Mantén Hoy, Trabajos, Clientes, Facturas, Presupuestos, agenda y fotos gratis. Premium desbloquea todo lo demás." : "Keep Today, Jobs, Clients, Invoices, Estimates, scheduling, and photos free. Premium unlocks everything else."}</p>
      <div className="upgrade-price"><strong>$19</strong><span>{lang === "es" ? "USD al mes" : "USD per month"}</span></div>
    </section>
    <section className="upgrade-features" aria-label={lang === "es" ? "Funciones Premium" : "Premium features"}>{features.map((feature) => <div key={feature}><span aria-hidden="true">✓</span><strong>{feature}</strong></div>)}</section>
    {checkout.isError && <p className="status error">{actionErrorMessage(checkout.error)}</p>}
    {checkout.data && !checkout.data.configured && <div className="billing-setup-note" role="status"><strong>{lang === "es" ? "La facturación aún no está conectada" : "Billing isn’t connected yet"}</strong><p>{lang === "es" ? "El propietario debe terminar la configuración segura de Stripe antes de aceptar suscripciones." : "The owner needs to finish the secure Stripe setup before subscriptions can be accepted."}</p></div>}
    {!isPremium && <button className="primary-button upgrade-button" type="button" disabled={checkout.isPending} onClick={() => void startCheckout()}>{checkout.isPending ? (lang === "es" ? "Abriendo Stripe…" : "Opening Stripe…") : (lang === "es" ? "Mejorar con Stripe" : "Upgrade with Stripe")}</button>}
    {isPremium && <div className="active-plan-note" role="status"><strong>{lang === "es" ? "Premium activo" : "Premium active"}</strong><span>{subscription.data?.status === "founder" ? (lang === "es" ? "Plan fundador" : "Founder plan") : subscription.data?.cancelAtPeriodEnd ? (lang === "es" ? "Activo hasta el final del período" : "Active through the end of the billing period") : (lang === "es" ? "Todas las herramientas Pro están desbloqueadas" : "All Pro tools are unlocked")}</span></div>}
    <p className="upgrade-fine-print">{lang === "es" ? "Pago mensual. Cancela cuando quieras; Premium permanece activo hasta el final del período pagado." : "Monthly billing. Cancel anytime; Premium remains active through the paid billing period."}</p>
  </main>;
}

function ProWorkspaceScreen({ lang, onBack, setScreen }: { lang: Lang; onBack: () => void; setScreen: (screen: Screen) => void }) {
  const [soon, setSoon] = useState<ToolTile | null>(null);
  const toolIcon = (path: ReactNode) => <span className="tool-tile-icon"><Icon>{path}</Icon></span>;
  const tiles: ToolTile[] = lang === "es" ? [
    { title: "Pedidos esperando proveedores", description: "Compara cotizaciones, crea órdenes y registra entregas", screen: { name: "fieldIntelligence", tab: "purchasing" }, icon: toolIcon(<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />) },
    { title: "Directorio de proveedores", description: "Guarda contactos y archivos fiscales", screen: { name: "expansion", tab: "suppliers" }, icon: toolIcon(<path d="M4 9h16v11H4zM7 9V5h10v4" />) },
    { title: "Garantías", description: "Guarda coberturas, vencimientos y certificados", screen: { name: "expansion", tab: "warranties" }, icon: toolIcon(<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-5" />) },
    { title: "Inventario de equipo", description: "Registra equipo, préstamos y ubicación actual", screen: { name: "fieldIntelligence", tab: "equipment" }, icon: toolIcon(<path d="M7 7h10v10H7zM4 10h3M17 10h3M10 4v3M10 17v3" />) },
    { title: "Cuidado del equipo", description: "Programa servicios y marca mantenimiento completado", screen: { name: "expansion", tab: "plans" }, icon: toolIcon(<path d="M4 18h16M7 18v-5l5-4 5 4v5M9 8V4h6v4" />) },
    { title: "Seguridad e incidentes", description: "Guarda charlas, firmas e informes de incidentes", screen: { name: "fieldIntelligence", tab: "safety" }, icon: toolIcon(<path d="M12 3l8 4v5c0 5-3 8-8 10-5-2-8-5-8-10V7zM9 12l2 2 4-5" />) },
    { title: "Nómina", description: "Calcula horas por tarifa y descarga un CSV", screen: { name: "fieldIntelligence", tab: "payroll" }, icon: toolIcon(<path d="M4 7h16v12H4zM8 11h8M8 15h5" />) },
    { title: "Licencias y certificados", description: "Guarda vencimientos y registra renovaciones", screen: { name: "fieldIntelligence", tab: "credentials" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Puntaje de prospectos", description: "Prioriza el embudo y convierte prospectos en cotizaciones", screen: { name: "operations", tab: "leads" }, icon: toolIcon(<path d="M5 5h14M7 10h10M9 15h6M11 20h2" />) },
    { title: "Alertas de presupuesto", description: "Compara costos registrados con el valor cotizado", screen: { name: "fieldIntelligence", tab: "costs" }, icon: toolIcon(<path d="M4 19V9M10 19V5M16 19v-8M22 19H2" />) },
    { title: "Entrada y salida del equipo", description: "Marca horas y ubicación GPS por trabajo", screen: { name: "operations", tab: "calendar" }, icon: toolIcon(<path d="M12 7v5l3 2M4 12a8 8 0 1 0 2-5" />) },
    { title: "Facturas recurrentes", description: "Programa la frecuencia y genera cada factura al vencer", screen: { name: "invoices" }, icon: toolIcon(<path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Controles del dueño", description: "Administra equipo, reglas, bandeja y datos guardados", screen: { name: "admin" }, icon: toolIcon(<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Portal del cliente", description: "Abre un trabajo → Portal del cliente para crear un enlace seguro para tu cliente", screen: { name: "jobs" }, icon: toolIcon(<path d="M4 5h16v14H4zM8 9h8M8 13h5" />) },
  ] : [
    { title: "Orders waiting on suppliers", description: "Compare bids, create orders, and record deliveries", screen: { name: "fieldIntelligence", tab: "purchasing" }, icon: toolIcon(<path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />) },
    { title: "Supplier directory", description: "Save contacts and tax files", screen: { name: "expansion", tab: "suppliers" }, icon: toolIcon(<path d="M4 9h16v11H4zM7 9V5h10v4" />) },
    { title: "Warranties", description: "Save coverage, expiry dates, and certificates", screen: { name: "expansion", tab: "warranties" }, icon: toolIcon(<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6zM9 12l2 2 4-5" />) },
    { title: "Equipment inventory", description: "Track equipment, checkout, and current location", screen: { name: "fieldIntelligence", tab: "equipment" }, icon: toolIcon(<path d="M7 7h10v10H7zM4 10h3M17 10h3M10 4v3M10 17v3" />) },
    { title: "Equipment upkeep", description: "Schedule service and mark maintenance complete", screen: { name: "expansion", tab: "plans" }, icon: toolIcon(<path d="M4 18h16M7 18v-5l5-4 5 4v5M9 8V4h6v4" />) },
    { title: "Safety & incidents", description: "Save talks, sign-offs, and incident reports", screen: { name: "fieldIntelligence", tab: "safety" }, icon: toolIcon(<path d="M12 3l8 4v5c0 5-3 8-8 10-5-2-8-5-8-10V7zM9 12l2 2 4-5" />) },
    { title: "Payroll", description: "Calculate hours by rate and download a CSV", screen: { name: "fieldIntelligence", tab: "payroll" }, icon: toolIcon(<path d="M4 7h16v12H4zM8 11h8M8 15h5" />) },
    { title: "Licenses & certificates", description: "Save expiry dates and record renewals", screen: { name: "fieldIntelligence", tab: "credentials" }, icon: toolIcon(<path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Lead scoring", description: "Prioritize the pipeline and turn leads into estimates", screen: { name: "operations", tab: "leads" }, icon: toolIcon(<path d="M5 5h14M7 10h10M9 15h6M11 20h2" />) },
    { title: "Budget alerts", description: "Compare recorded costs with the quoted job value", screen: { name: "fieldIntelligence", tab: "costs" }, icon: toolIcon(<path d="M4 19V9M10 19V5M16 19v-8M22 19H2" />) },
    { title: "Crew clock-in/out", description: "Record time and GPS location by job", screen: { name: "operations", tab: "calendar" }, icon: toolIcon(<path d="M12 7v5l3 2M4 12a8 8 0 1 0 2-5" />) },
    { title: "Recurring invoices", description: "Set a schedule and generate each invoice when due", screen: { name: "invoices" }, icon: toolIcon(<path d="M6 4h12v16H6zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Admin controls", description: "Manage team, rules, inbox, and stored data", screen: { name: "admin" }, icon: toolIcon(<path d="M5 4h14v16H5zM9 8h6M9 12h6M9 16h4" />) },
    { title: "Client portal", description: "Open a job → Client portal to create a secure link for your client", screen: { name: "jobs" }, icon: toolIcon(<path d="M4 5h16v14H4zM8 9h8M8 13h5" />) },
  ];
  const openTool = (tile: ToolTile) => {
    if (tile.comingSoon) setSoon(tile);
    else if (tile.screen) setScreen(tile.screen);
  };
  return (
    <main className="page pro-workspace">
      <PageHeader lang={lang} title={lang === "es" ? "Herramientas Pro" : "Pro Tools"} onBack={onBack} actions={<span className="pro-header-badge">PRO</span>} />
      <section className="pro-workspace-hero">
        <span className="pro-identity">PRO</span>
        <div><h2>{lang === "es" ? "Control avanzado" : "Advanced control"}</h2><p>{lang === "es" ? "Cada herramienta muestra si funciona ahora o qué necesita para activarse." : "Every tool shows whether it works now or what it needs before it can turn on."}</p></div>
      </section>
      <div className="pro-directory">
        {tiles.map((tile) => (
          <button key={tile.title} type="button" onClick={() => openTool(tile)}>
            {tile.icon}<span><strong>{tile.title}</strong><small>{tile.description}</small><ToolStatus lang={lang} comingSoon={tile.comingSoon} /></span>{tile.comingSoon ? <span className="soon-dot" aria-hidden="true" /> : <BackIcon />}
          </button>
        ))}
      </div>
      {soon && <ComingSoonSheet lang={lang} tool={soon} onClose={() => setSoon(null)} />}
    </main>
  );
}

function JobsScreen({
  lang,
  settings,
  onBack,
  setScreen,
  toggleLanguage,
}: {
  lang: Lang;
  settings: Settings | null;
  onBack: () => void;
  setScreen: (s: Screen) => void;
  toggleLanguage: () => void;
}) {
  const t = copy[lang];
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "completed" | "all">("active");
  const jobs = useQuery({
    queryKey: ["jobs", search],
    queryFn: () => api.listJobs({ search }),
  });
  const visibleJobs = (jobs.data?.jobs ?? []).filter((job) => statusFilter === "all" || (statusFilter === "completed" ? Boolean(job.completedAt) : !job.completedAt));
  return (
    <main className="page jobs-page">
      <PageHeader
        lang={lang}
        title={t.jobs}
        onBack={onBack}
        actions={
          <>
            <button
              className="lang-toggle"
              onClick={toggleLanguage}
              aria-label={t.language}
            >
              {lang === "en" ? "ES" : "EN"}
            </button>

          </>
        }
      />
      <OfflineCacheNote lang={lang} action="listJobs" isLoading={jobs.isLoading} />
      <section className="jobs-tools">
        <button
          className="primary-button new-job-button"
          onClick={() => setScreen({ name: "new" })}
        >
          <PlusIcon />
          {t.newJob}
        </button>
        <label className="search-field">
          <span className="sr-only">{t.search}</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.search}
            aria-label={t.search}
          />
        </label>
      </section>
      <nav className="section-switcher" aria-label={lang === "es" ? "Vistas de trabajos" : "Job views"}>
        <button className="active" aria-current="page">{lang === "es" ? "Trabajos" : "Jobs"}</button>
        {settings?.simpleMode !== true && <button onClick={() => setScreen({ name: "operations", tab: "leads" })}>{lang === "es" ? "Embudo" : "Pipeline"}</button>}
        <button onClick={() => setScreen({ name: "operations", tab: "calendar" })}>{lang === "es" ? "Calendario" : "Schedule"}</button>
      </nav>
      <label className="status-filter"><span>{lang === "es" ? "Estado" : "Status"}</span><select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}><option value="active">{lang === "es" ? "Activos" : "Active"}</option><option value="completed">{lang === "es" ? "Completados" : "Completed"}</option><option value="all">{lang === "es" ? "Todos" : "All"}</option></select></label>
      <section className="job-list">
        {jobs.isPending && (
          <div className="skeleton-list">
            <div />
            <div />
          </div>
        )}
        {visibleJobs.map((job) => (
          <button
            className="job-row"
            key={job.id}
            onClick={() => setScreen({ name: "detail", jobId: job.id })}
          >
            <span className="date-block">
              <strong>{new Date(`${job.jobDate}T12:00:00`).getDate()}</strong>
              <small>
                {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                  month: "short",
                }).format(new Date(`${job.jobDate}T12:00:00`))}
              </small>
            </span>
            <span className="job-copy">
              <strong>{job.clientName}</strong>
              <span>{job.jobType}</span>
              <small>{job.jobAddress}</small>
            </span>
            <span
              className={`photo-count${job.photoCompleteness < 100 ? " incomplete" : ""}`}
              title={
                lang === "es"
                  ? `Fotos requeridas ${job.photoCompleteness}%`
                  : `Required photos ${job.photoCompleteness}%`
              }
            >
              <CameraIcon />
              {job.photoCount} · {job.photoCompleteness}%
            </span>
            <BackIcon />
          </button>
        ))}
        {!jobs.isPending && visibleJobs.length === 0 && (
          <div className="empty-state">
            <div className="empty-mark">
              <CameraIcon />
            </div>
            <h2>{search ? t.noResults : t.noJobs}</h2>
            {!search && (
              <>
                <p>{t.firstHint}</p>
                <button
                  className="text-button"
                  onClick={() => setScreen({ name: "new" })}
                >
                  {t.newJob}
                </button>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

const emptyJob = (today: string) => ({
  clientId: null as number | null,
  clientName: "",
  clientPhone: "",
  clientEmail: "",
  jobAddress: "",
  jobType: "",
  notes: "",
  jobDate: today,
  appointmentAt: "",
  amountDue: "",
  dueDate: "",
  depositAmount: "",
  paymentNotes: "",
});
function JobFields({
  lang,
  form,
  setForm,
  hideClientFields = false,
  onOpenDates,
}: {
  lang: Lang;
  form: ReturnType<typeof emptyJob>;
  setForm: (v: ReturnType<typeof emptyJob>) => void;
  hideClientFields?: boolean;
  onOpenDates?: () => void;
}) {
  const t = copy[lang];
  return (
    <>
      {!hideClientFields && <>
        <label>
          <span>{t.client} *</span>
          <input value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} aria-label={t.client} />
        </label>
        <label>
          <span>{t.phone}</span>
          <input type="tel" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })} aria-label={t.phone} />
        </label>
        <label>
          <span>{t.email}</span>
          <input type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })} aria-label={t.email} />
        </label>
      </>}
      <label>
        <span>{t.address} *</span>
        <input value={form.jobAddress} onChange={(e) => setForm({ ...form, jobAddress: e.target.value })} aria-label={t.address} />
      </label>
      <label>
        <span>{t.type} *</span>
        <input value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })} aria-label={t.type} />
      </label>
      {onOpenDates ? <button className="job-plus-row" type="button" onClick={onOpenDates}>
        <span><b>＋</b><span><strong>{lang === "es" ? "Fecha y cita" : "Job date & appointment"}</strong><small>{[form.jobDate ? formatDate(form.jobDate, lang) : "", form.appointmentAt ? new Date(form.appointmentAt).toLocaleString(lang === "es" ? "es-US" : "en-US", { dateStyle: "medium", timeStyle: "short" }) : ""].filter(Boolean).join(" · ") || (lang === "es" ? "Agregar horario" : "Add schedule")}</small></span></span><BackIcon />
      </button> : <div className="field-pair">
        <label><span>{t.date}</span><input type="date" value={form.jobDate} onChange={(e) => setForm({ ...form, jobDate: e.target.value })} aria-label={t.date} /></label>
        <label><span>{t.appointment}</span><input type="datetime-local" value={form.appointmentAt} onChange={(e) => setForm({ ...form, appointmentAt: e.target.value })} aria-label={t.appointment} /></label>
      </div>}
      <label>
        <span>{t.notes}</span>
        <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} aria-label={t.notes} />
      </label>
      <details className="action-details job-payment-details"><summary>{lang === "es" ? "Detalles de pago" : "Payment details"}</summary><div className="compact-form">
        <div className="field-pair">
          <label><span>{t.amountDue}</span><input inputMode="decimal" value={form.amountDue} onChange={(e) => setForm({ ...form, amountDue: e.target.value })} /></label>
          <label><span>{t.dueDate}</span><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></label>
        </div>
        <label><span>{t.depositAmount}</span><input inputMode="decimal" value={form.depositAmount} onChange={(e) => setForm({ ...form, depositAmount: e.target.value })} /></label>
        <label><span>{t.paymentNotes}</span><textarea rows={2} value={form.paymentNotes} onChange={(e) => setForm({ ...form, paymentNotes: e.target.value })} /></label>
      </div></details>
    </>
  );
}
function ClientPicker({
  lang,
  value,
  selectedClient,
  onValueChange,
  onPick,
}: {
  lang: Lang;
  value: string;
  selectedClient?: { name: string; phone: string } | null;
  onValueChange: (value: string) => void;
  onPick: (client: Client) => void;
}) {
  const t = copy[lang];
  const [open, setOpen] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const query = useQuery({
    queryKey: ["clients", "picker"],
    queryFn: () => api.listClients({ search: "" }),
  });
  const term = value.trim().toLocaleLowerCase(lang === "es" ? "es" : "en");
  const visibleClients = (query.data?.clients ?? []).filter((client) => {
    if (!filtering || !term) return true;
    return [client.name, client.phone, client.email, client.notes]
      .some((field) => field.toLocaleLowerCase(lang === "es" ? "es" : "en").includes(term));
  });
  const emptyText = lang === "es" ? "No hay clientes que coincidan" : "No matching clients";
  if (selectedClient && !open) return (
    <section className="client-picker selected">
      <span className="client-picker-label">{t.chooseClient}</span>
      <button type="button" className="selected-client-row" onClick={() => setOpen(true)}>
        <span><strong>{selectedClient.name}</strong><small>{selectedClient.phone || (lang === "es" ? "Sin teléfono" : "No phone")}</small></span>
        <b>{lang === "es" ? "Cambiar" : "Change"}</b>
      </button>
    </section>
  );
  return (
    <section className={`client-picker${open ? " open" : ""}`}>
      <label>
        <span>{t.chooseClient}</span>
        <div className="client-picker-input">
          <input
            value={value}
            onFocus={(event) => { setOpen(true); setFiltering(false); event.currentTarget.select(); }}
            onChange={(event) => { onValueChange(event.target.value); setFiltering(true); setOpen(true); }}
            onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); event.currentTarget.blur(); } }}
            placeholder={t.searchClients}
            aria-label={t.searchClients}
            role="combobox"
            aria-expanded={open}
            aria-controls="client-picker-results"
            aria-autocomplete="list"
          />
          {value && <button type="button" className="client-picker-clear" aria-label={lang === "es" ? "Borrar cliente" : "Clear client"} onMouseDown={(event) => event.preventDefault()} onClick={() => { onValueChange(""); setFiltering(true); setOpen(true); }}>×</button>}
        </div>
      </label>
      {open && (
        <div className="client-picker-results" id="client-picker-results" role="listbox">
          {query.isPending && <p>{lang === "es" ? "Cargando clientes…" : "Loading clients…"}</p>}
          {!query.isPending && visibleClients.length === 0 && <p>{emptyText}</p>}
          {visibleClients.map((client) => (
            <button
              type="button"
              role="option"
              aria-selected={client.name === value}
              key={client.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onPick(client);
                setFiltering(false);
                setOpen(false);
              }}
            >
              <strong>{client.name}</strong>
              <small>
                {[client.phone, client.email, client.address].filter(Boolean).join(" · ")}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
function JobDateSheet({ lang, jobDate, appointmentAt, onChange, onClose, closing = false }: { lang: Lang; jobDate: string; appointmentAt: string; onChange: (value: { jobDate: string; appointmentAt: string }) => void; onClose: () => void; closing?: boolean }) {
  return <div className={`client-sheet-backdrop${closing ? " closing" : ""}`} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="client-sheet job-date-sheet" role="dialog" aria-modal="true" aria-label={lang === "es" ? "Fecha y cita" : "Job date and appointment"}>
      <div className="sheet-handle" />
      <header><h2>{lang === "es" ? "Fecha y cita" : "Job date & appointment"}</h2><button type="button" aria-label={lang === "es" ? "Guardar y cerrar" : "Save and close"} onClick={onClose}>×</button></header>
      <div className="compact-form">
        <label><span>{copy[lang].date}</span><input type="date" value={jobDate} onChange={(event) => onChange({ jobDate: event.target.value, appointmentAt })} /></label>
        <label><span>{copy[lang].appointment}</span><input type="datetime-local" value={appointmentAt} onChange={(event) => onChange({ jobDate, appointmentAt: event.target.value })} /></label>
      </div>
      <p className="sheet-note">{lang === "es" ? "Los cambios se guardan al cerrar." : "Changes save when you close."}</p>
    </section>
  </div>;
}

function JobFormScreen({
  lang,
  onBack,
  onCreated,
}: {
  lang: Lang;
  onBack: () => void;
  onCreated: (id: number) => void;
}) {
  const t = copy[lang];
  const [form, setForm] = useState(
    emptyJob(new Date().toLocaleDateString("en-CA")),
  );
  const [error, setError] = useState("");
  const [dateSheetOpen, setDateSheetOpen] = useState(false);
  const [dateSheetClosing, setDateSheetClosing] = useState(false);
  const closeDateSheet = () => { setDateSheetClosing(true); window.setTimeout(() => { setDateSheetOpen(false); setDateSheetClosing(false); }, 180); };
  const create = useMutation({
    mutationFn: () => api.createJob(form),
    onSuccess: (v) => onCreated(v.id),
    onError: () => setError(t.error),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (
      !form.clientName.trim() ||
      !form.jobAddress.trim() ||
      !form.jobType.trim()
    ) {
      setError(t.required);
      return;
    }
    create.mutate();
  };
  return (
    <main className="page form-page">
      <PageHeader lang={lang} title={t.newJob} onBack={onBack} />
      <form className="job-form" onSubmit={submit}>
        <ClientPicker
          lang={lang}
          value={form.clientName}
          selectedClient={form.clientId ? { name: form.clientName, phone: form.clientPhone } : null}
          onValueChange={(clientName) => setForm({ ...form, clientId: null, clientName })}
          onPick={(c) =>
            setForm({
              ...form,
              clientId: c.id,
              clientName: c.name,
              clientPhone: c.phone,
              clientEmail: c.email,
              jobAddress: c.address,
            })
          }
        />
        <JobFields lang={lang} form={form} setForm={setForm} hideClientFields={Boolean(form.clientId)} onOpenDates={() => setDateSheetOpen(true)} />
        {error && <p className="status error">{error}</p>}
        <button
          className="primary-button sticky-submit"
          disabled={create.isPending}
        >
          {create.isPending ? t.saving : t.create}
        </button>
      </form>
      {dateSheetOpen && <JobDateSheet lang={lang} jobDate={form.jobDate} appointmentAt={form.appointmentAt} onChange={(value) => setForm({ ...form, ...value })} onClose={closeDateSheet} closing={dateSheetClosing} />}
    </main>
  );
}

function JobDetail({
  lang,
  jobId,
  settings,
  onBack,
  setScreen,
}: {
  lang: Lang;
  jobId: number;
  settings: Settings | null;
  onBack: () => void;
  setScreen: (s: Screen) => void;
}) {
  const t = copy[lang];
  const client = useQueryClient();
  const [stage, setStage] = useState<Stage>("before");
  const [editing, setEditing] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [socialNotice, setSocialNotice] = useState("");
  const [socialNoticeError, setSocialNoticeError] = useState(false);
  const [activeJobSheet, setActiveJobSheet] = useState<"client" | "dates" | "invoices" | "contracts" | "payment" | "deposit" | "address" | null>(null);
  const [jobSheetClosing, setJobSheetClosing] = useState(false);
  const [linkTab, setLinkTab] = useState<"new" | "existing">("new");
  const [clientSearch, setClientSearch] = useState("");
  const [detailDraft, setDetailDraft] = useState({ notes: "", jobDate: "", appointmentAt: "", depositAmount: "", paymentNotes: "" });
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const query = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob({ id: jobId }),
  });
  const quotesQuery = useQuery({
    queryKey: ["quotes"],
    queryFn: () => api.listQuotes({}),
  });
  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api.listInvoices({}),
  });
  const clientsQuery = useQuery({ queryKey: ["clients", "job-picker"], queryFn: () => api.listClients({ search: "" }) });
  const documentsQuery = useQuery({ queryKey: ["documents"], queryFn: () => api.listDocuments({}) });
  const operationsQuery = useQuery({
    queryKey: ["job-operations", jobId],
    queryFn: () => api.getJobOperations({ jobId }),
  });
  const job = query.data?.job;
  useEffect(() => {
    if (job) setDetailDraft({ notes: job.notes, jobDate: job.jobDate, appointmentAt: job.appointmentAt, depositAmount: job.depositAmount, paymentNotes: job.paymentNotes });
  }, [job?.id, job?.updatedAt]);
  const [completionNote, setCompletionNote] = useState("");
  const [completionError, setCompletionError] = useState("");
  const requirements = useMutation({
    mutationFn: (requiredStages: Stage[]) =>
      api.setJobPhotoRequirements({ jobId, requiredStages }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["job", jobId] });
      client.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const complete = useMutation({
    mutationFn: () => api.completeJob({ jobId, overrideNote: completionNote }),
    onSuccess: () => {
      setCompletionError("");
      client.invalidateQueries({ queryKey: ["job", jobId] });
      client.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: () =>
      setCompletionError(
        lang === "es"
          ? "Agrega una nota para explicar las fotos requeridas que faltan."
          : "Add a note explaining any missing required photos.",
      ),
  });
  const refreshJob = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["job", jobId] }),
      client.invalidateQueries({ queryKey: ["jobs"] }),
      client.invalidateQueries({ queryKey: ["invoices"] }),
      client.invalidateQueries({ queryKey: ["documents"] }),
    ]);
  };
  const setJobClient = useMutation({ mutationFn: (clientId: number | null) => api.setJobClient({ jobId, clientId }), onSuccess: refreshJob });
  const saveJobInfo = useMutation({ mutationFn: () => api.updateJobInfo({ jobId, ...detailDraft }), onSuccess: refreshJob });
  const linkInvoice = useMutation({ mutationFn: ({ invoiceId, linkedJobId }: { invoiceId: number; linkedJobId: number | null }) => api.linkInvoiceToJob({ invoiceId, jobId: linkedJobId }), onSuccess: refreshJob });
  const linkDocument = useMutation({ mutationFn: (documentId: number) => api.linkDocumentToJob({ documentId, jobId }), onSuccess: refreshJob });
  const closeJobSheet = (save = false) => {
    if (save && activeJobSheet && ["dates", "payment", "deposit"].includes(activeJobSheet)) saveJobInfo.mutate();
    setJobSheetClosing(true);
    window.setTimeout(() => { setActiveJobSheet(null); setJobSheetClosing(false); }, 180);
  };
  const upload = useMutation({
    mutationFn: async ({
      file,
      annotatedFromId = null,
    }: {
      file: File;
      annotatedFromId?: number | null;
    }) => {
      const data = await fileToBase64(file);
      return api.addPhoto({
        jobId,
        stage,
        caption: "",
        filename: file.name,
        contentType: file.type as
          "image/jpeg" | "image/png" | "image/webp" | "image/gif",
        capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
        dataBase64: data.dataBase64,
        annotatedFromId,
      });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["job", jobId] });
      client.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const files = async (e: ChangeEvent<HTMLInputElement>) => {
    for (const file of Array.from(e.target.files ?? []))
      if (
        ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(
          file.type,
        )
      )
        await upload.mutateAsync({ file });
    e.target.value = "";
  };
  if (!job || !query.data)
    return (
      <main className="page">
        <PageHeader lang={lang} title="…" onBack={onBack} />
        <div className="loading-block" />
      </main>
    );
  const shareSocial = async () => {
    setShareBusy(true);
    setSocialNotice("");
    setSocialNoticeError(false);
    const brand = companySignature(settings);
    const caption =
      lang === "es"
        ? `${job.jobType} documentado de principio a fin.\n\n${settings?.offersFreeEstimates ? "Estimados gratis. " : ""}${brand}`
        : `${job.jobType} documented from start to finish.\n\n${settings?.offersFreeEstimates ? "Free estimates. " : ""}${brand}`;
    const picks = [
      query.data.photos.find(
        (p) => p.stage === "before" && !p.excludeFromSocial,
      ),
      [...query.data.photos]
        .reverse()
        .find((p) => p.stage === "after" && !p.excludeFromSocial),
    ].filter((p): p is Photo => Boolean(p));
    try {
      if (picks.length === 0) {
        setSocialNotice(t.socialNoPhotos);
        setSocialNoticeError(true);
        return;
      }
      await copyText(caption);
      const photoFiles = await Promise.all(
        picks.map(async (p) => {
          const response = await fetch(p.url);
          if (!response.ok) throw new Error("Photo unavailable");
          const blob = await response.blob();
          const extension = blob.type.includes("png")
            ? "png"
            : blob.type.includes("webp")
              ? "webp"
              : blob.type.includes("gif")
                ? "gif"
                : "jpg";
          return new File([blob], `${p.stage}-${p.id}.${extension}`, {
            type: blob.type || "image/jpeg",
          });
        }),
      );
      const shareNavigator: {
        share?: (data?: ShareData) => Promise<void>;
        canShare?: (data?: ShareData) => boolean;
      } = navigator;
      const shareFiles = shareNavigator.share;
      const supportsFileShare = Boolean(
        shareFiles &&
        (!shareNavigator.canShare ||
          shareNavigator.canShare({ files: photoFiles })),
      );
      if (!supportsFileShare || !shareFiles) {
        await downloadSocialPhotos(photoFiles, job.jobType);
        setSocialNotice(
          photoFiles.length === 1 ? t.socialFallbackOne : t.socialFallbackMany,
        );
        return;
      }
      try {
        await shareFiles.call(navigator, {
          title: job.jobType,
          text: caption,
          files: photoFiles,
        });
        setSocialNotice(t.socialReady);
      } catch {
        await downloadSocialPhotos(photoFiles, job.jobType);
        setSocialNotice(
          photoFiles.length === 1
            ? t.socialShareClosedOne
            : t.socialShareClosedMany,
        );
      }
    } catch {
      setSocialNotice(t.socialError);
      setSocialNoticeError(true);
    } finally {
      setShareBusy(false);
    }
  };
  const jobQuotes =
    quotesQuery.data?.quotes.filter((quote) => quote.jobId === jobId) ?? [];
  const jobInvoices =
    invoicesQuery.data?.invoices.filter((invoice) => invoice.jobId === jobId) ??
    [];
  const documentCount =
    query.data.documents.length + (query.data.certificate ? 1 : 0);
  const trackingCount =
    query.data.timeEntries.length +
    query.data.receipts.length +
    query.data.crewTasks.length +
    query.data.voiceNotes.length +
    query.data.punchItems.length;
  return (
    <main className="page detail-page">
      <PageHeader
        lang={lang}
        title={job.jobType}
        onBack={onBack}
        actions={
          <button
            className="icon-button"
            onClick={() => setScreen({ name: "proof", jobId })}
            aria-label={t.proof}
          >
            <FileIcon />
          </button>
        }
      />
      <section className="job-client-selector">
        <span>{lang === "es" ? "Cliente" : "Client"}</span>
        <button type="button" onClick={() => { setClientSearch(""); setActiveJobSheet("client"); }}>
          <span><strong>{job.clientId ? job.clientName : (lang === "es" ? "Sin cliente" : "No client")}</strong><small>{job.clientId ? (job.clientPhone || job.clientEmail || (lang === "es" ? "Toca para cambiar" : "Tap to change")) : (lang === "es" ? "Toca para vincular" : "Tap to link")}</small></span><BackIcon />
        </button>
      </section>
      <section className="job-summary">
        <div>
          <p className="job-type">{job.jobType}</p>
          <button type="button" className="job-address-button" onClick={() => setActiveJobSheet("address")}><h2>{job.jobAddress}</h2><small>{lang === "es" ? "Copiar o abrir en Maps" : "Copy or open in Maps"}</small></button>
          <p>{formatDate(job.jobDate, lang)}</p>
        </div>
        <button className="small-button" onClick={() => setEditing(!editing)}>{editing ? t.done : t.edit}</button>
      </section>
      {settings?.simpleMode !== true && operationsQuery.data && (
        <section className="profit-strip">
          <div>
            <span>{lang === "es" ? "Facturado" : "Invoiced"}</span>
            <strong>{usd(operationsQuery.data.profitability.invoiced)}</strong>
          </div>
          <div>
            <span>{lang === "es" ? "Ganancia" : "Profit"}</span>
            <strong
              className={
                operationsQuery.data.profitability.profit < 0 ? "negative" : ""
              }
            >
              {usd(operationsQuery.data.profitability.profit)}
            </strong>
          </div>
          <div>
            <span>{lang === "es" ? "Margen" : "Margin"}</span>
            <strong>
              {operationsQuery.data.profitability.margin.toFixed(1)}%
            </strong>
          </div>
          <button
            className="small-button"
            onClick={() => setScreen({ name: "jobOps", jobId })}
          >
            {lang === "es" ? "Ver operaciones" : "View operations"}
          </button>
        </section>
      )}
      {settings?.simpleMode !== true && <PortalOwnerPanel lang={lang} jobId={jobId} />}
      {editing && (
        <EditJobForm
          lang={lang}
          job={job}
          onDone={() => {
            setEditing(false);
            client.invalidateQueries({ queryKey: ["job", jobId] });
          }}
        />
      )}
      {settings?.simpleMode !== true && (<section className="completion-panel">
        <div className="completion-heading">
          <div>
            <span>
              {lang === "es" ? "Completitud de fotos" : "Photo completeness"}
            </span>
            <strong>{job.photoCompleteness}%</strong>
          </div>
          <progress max="100" value={job.photoCompleteness} />
        </div>
        <fieldset>
          <legend>
            {lang === "es" ? "Etapas requeridas" : "Required stages"}
          </legend>
          <div className="requirement-checks">
            {(["before", "during", "after"] as Stage[]).map((item) => (
              <label key={item}>
                <input
                  type="checkbox"
                  checked={job.requiredPhotoStages.includes(item)}
                  onChange={(e) =>
                    requirements.mutate(
                      e.target.checked
                        ? [...job.requiredPhotoStages, item]
                        : job.requiredPhotoStages.filter(
                            (stageName) => stageName !== item,
                          ),
                    )
                  }
                />
                <span>{t[item]}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {job.completedAt ? (
          <p className="status success">
            <CheckIcon />
            {lang === "es"
              ? `Completado ${formatDate(job.completedAt.slice(0, 10), lang)}`
              : `Completed ${formatDate(job.completedAt.slice(0, 10), lang)}`}
            {job.completionOverrideNote
              ? ` · ${job.completionOverrideNote}`
              : ""}
          </p>
        ) : (
          <>
            <label>
              <span>
                {lang === "es"
                  ? "Nota de excepción si faltan fotos"
                  : "Override note if required photos are missing"}
              </span>
              <textarea
                rows={2}
                value={completionNote}
                onChange={(e) => setCompletionNote(e.target.value)}
              />
            </label>
            <button
              className="primary-button"
              disabled={complete.isPending}
              onClick={() => complete.mutate()}
            >
              {lang === "es" ? "Marcar trabajo completo" : "Mark job complete"}
            </button>
            {completionError && (
              <p className="status error" role="alert">
                {completionError}
              </p>
            )}
          </>
        )}
      </section>)}
      <section className="job-accordion job-hub" aria-label={lang === "es" ? "Centro del trabajo" : "Job hub"}>
        <AccordionSection title={lang === "es" ? "Facturas" : "Invoices"} count={jobInvoices.length} icon={<Icon><path d="M7 3h10v18l-2-1-3 1-3-1-2 1z"/><path d="M9 8h6M9 12h6M9 16h4"/></Icon>} defaultOpen>
          <div className="job-section-heading"><p>{lang === "es" ? "Facturas vinculadas a este trabajo" : "Invoices linked to this job"}</p><button type="button" className="job-round-add" aria-label={lang === "es" ? "Agregar factura" : "Add invoice"} onClick={() => { setLinkTab("new"); setActiveJobSheet("invoices"); }}>＋</button></div>
          {jobInvoices.length ? <div className="job-linked-list">{jobInvoices.map((invoice) => <article key={invoice.id}><button type="button" onClick={() => setScreen({ name: "invoicePreview", invoiceId: invoice.id })}><span><strong>{invoice.invoiceNumber}</strong><small>{usd(money(invoice.totalWithLateFee))} · {t[invoice.status]}</small></span><BackIcon /></button><button type="button" className="unlink-button" onClick={() => linkInvoice.mutate({ invoiceId: invoice.id, linkedJobId: null })}>{lang === "es" ? "Desvincular" : "Unlink"}</button></article>)}</div> : <p className="job-section-empty">{lang === "es" ? "No hay facturas vinculadas." : "No linked invoices yet."}</p>}
          {jobQuotes.length > 0 && <div className="related-estimates"><strong>{lang === "es" ? "Presupuestos relacionados" : "Related estimates"}</strong>{jobQuotes.map((quote) => <button key={quote.id} type="button" onClick={() => setScreen({ name: "quotePreview", quoteId: quote.id })}><span>#{quote.id} · {usd(money(quote.total))}</span><BackIcon /></button>)}</div>}
        </AccordionSection>
        <AccordionSection title={lang === "es" ? "Contratos" : "Contracts"} count={query.data.documents.length} icon={<FileIcon />}>
          <div className="job-section-heading"><p>{lang === "es" ? "Contratos y órdenes de cambio" : "Contracts & change orders"}</p><button type="button" className="job-round-add" aria-label={lang === "es" ? "Agregar contrato" : "Add contract"} onClick={() => { setLinkTab("new"); setActiveJobSheet("contracts"); }}>＋</button></div>
          {query.data.documents.length ? <div className="job-linked-list">{query.data.documents.map((doc) => <article key={doc.id}><button type="button" onClick={() => setScreen({ name: "tool", jobId, mode: doc.kind === "contract" ? "contract" : "change" })}><span><strong>{doc.title}</strong><small>{doc.kind === "contract" ? (lang === "es" ? "Contrato" : "Contract") : (lang === "es" ? "Orden de cambio" : "Change order")}</small></span><BackIcon /></button></article>)}</div> : <p className="job-section-empty">{lang === "es" ? "No hay contratos vinculados." : "No linked contracts yet."}</p>}
        </AccordionSection>
        <AccordionSection title={lang === "es" ? "Notas de pago" : "Payment notes"} count={job.paymentNotes ? 1 : 0} icon={<Icon><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></Icon>}>
          <div className="job-value-row"><p>{job.paymentNotes || (lang === "es" ? "Sin notas de pago" : "No payment notes")}</p><button type="button" className="small-button" onClick={() => setActiveJobSheet("payment")}>{job.paymentNotes ? t.edit : (lang === "es" ? "Agregar" : "Add")}</button></div>
        </AccordionSection>
        <AccordionSection title={lang === "es" ? "Depósitos" : "Deposits"} count={job.depositAmount ? 1 : 0} icon={<Icon><path d="M4 7h16v12H4zM8 11h8M8 15h5"/></Icon>}>
          <div className="job-value-row"><p><strong>{job.depositAmount ? usd(money(job.depositAmount)) : usd(0)}</strong></p><button type="button" className="small-button" onClick={() => setActiveJobSheet("deposit")}>{job.depositAmount ? t.edit : (lang === "es" ? "Registrar" : "Record")}</button></div>
        </AccordionSection>
        <AccordionSection title={lang === "es" ? "Fotos" : "Pictures"} count={query.data.photos.length} icon={<CameraIcon />}>
          <div className="accordion-actions"><button onClick={shareSocial} disabled={shareBusy}><ShareIcon /><span>{shareBusy ? t.socialWait : t.social}</span></button></div>
          {socialNotice && <p className={`status social-notice${socialNoticeError ? " error" : ""}`} role="status">{socialNotice}</p>}
          <div className="photo-workspace">
            <div className="stage-tabs">{(["before", "during", "after"] as const).map((s) => <button key={s} className={stage === s ? "active" : ""} onClick={() => setStage(s)}>{t[s]} <span>{query.data.photos.filter((p) => p.stage === s).length}</span></button>)}</div>
            <div className="upload-row"><button className="camera-button" onClick={() => camera.current?.click()}><CameraIcon />{t.camera}</button><button className="gallery-button" onClick={() => gallery.current?.click()}>{t.gallery}</button><input className="sr-only" ref={camera} type="file" accept="image/*" capture="environment" onChange={files}/><input className="sr-only" ref={gallery} type="file" accept="image/*" multiple onChange={files}/></div>
            <div className="photo-grid">{query.data.photos.filter((p) => p.stage === stage).map((p) => <PhotoCard key={p.id} photo={p} lang={lang} jobId={jobId} onAnnotate={() => setScreen({ name: "tool", jobId, mode: "annotate", photoId: p.id })}/>)}</div>
            {query.data.photos.filter((p) => p.stage === stage).length === 0 && <div className="stage-empty"><CameraIcon /><p>{t.noPhotos}</p></div>}
          </div>
        </AccordionSection>
        <AccordionSection title={lang === "es" ? "Otra información del trabajo" : "Other job info"} count={[job.notes, job.jobDate, job.appointmentAt].filter(Boolean).length} icon={<Icon><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></Icon>}>
          <button className="job-plus-row detail-date-row" type="button" onClick={() => setActiveJobSheet("dates")}><span><b>＋</b><span><strong>{lang === "es" ? "Fecha y cita" : "Job date & appointment"}</strong><small>{formatDate(job.jobDate, lang)}{job.appointmentAt ? ` · ${new Date(job.appointmentAt).toLocaleString(lang === "es" ? "es-US" : "en-US", { dateStyle: "medium", timeStyle: "short" })}` : ""}</small></span></span><BackIcon /></button>
          <label className="job-notes-editor"><span>{t.notes}</span><textarea rows={3} value={detailDraft.notes} onChange={(event) => setDetailDraft({ ...detailDraft, notes: event.target.value })}/></label>
          <button className="secondary-button" type="button" disabled={saveJobInfo.isPending} onClick={() => saveJobInfo.mutate()}>{saveJobInfo.isPending ? t.saving : t.save}</button>
        </AccordionSection>
        <AccordionSection title={lang === "es" ? "Más herramientas" : "More job tools"} count={trackingCount + documentCount} icon={<CheckIcon />}>
          <div className="tool-grid"><ToolButton label={t.proof} onClick={() => setScreen({ name: "proof", jobId })}/><ToolButton label={lang === "es" ? "Antes / después" : "Before / after"} onClick={() => setScreen({ name: "tool", jobId, mode: "beforeAfter" })}/><ToolButton label={t.completionCertificate} onClick={() => setScreen({ name: "tool", jobId, mode: "completion" })}/><ToolButton label={t.progress} onClick={() => setScreen({ name: "tool", jobId, mode: "progress" })}/><ToolButton label={t.texts} onClick={() => setScreen({ name: "tool", jobId, mode: "texts" })}/><ToolButton label={t.timeTracking} onClick={() => setScreen({ name: "tool", jobId, mode: "time" })}/><ToolButton label={t.receipts} onClick={() => setScreen({ name: "tool", jobId, mode: "receipts" })}/><ToolButton label={t.crewChecklist} onClick={() => setScreen({ name: "tool", jobId, mode: "crew" })}/><ToolButton label={lang === "es" ? "Subcontratistas" : "Subcontractors"} onClick={() => setScreen({ name: "tool", jobId, mode: "subcontractors" })}/><ToolButton label={t.voiceNotes} onClick={() => setScreen({ name: "tool", jobId, mode: "voice" })}/><ToolButton label={t.punch} onClick={() => setScreen({ name: "tool", jobId, mode: "punch" })}/><ToolButton label={lang === "es" ? "Operaciones del trabajo" : "Job operations"} onClick={() => setScreen({ name: "jobOps", jobId })}/></div>
        </AccordionSection>
      </section>
      {activeJobSheet && <div className={`client-sheet-backdrop${jobSheetClosing ? " closing" : ""}`} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closeJobSheet(["dates", "payment", "deposit"].includes(activeJobSheet)); }}><section className="client-sheet job-action-sheet" role="dialog" aria-modal="true" aria-label={activeJobSheet}>
        <div className="sheet-handle"/><header><h2>{activeJobSheet === "client" ? (lang === "es" ? "Elegir cliente" : "Choose client") : activeJobSheet === "dates" ? (lang === "es" ? "Fecha y cita" : "Job date & appointment") : activeJobSheet === "invoices" ? (lang === "es" ? "Agregar factura" : "Add invoice") : activeJobSheet === "contracts" ? (lang === "es" ? "Agregar contrato" : "Add contract") : activeJobSheet === "payment" ? (lang === "es" ? "Notas de pago" : "Payment notes") : activeJobSheet === "deposit" ? (lang === "es" ? "Registrar depósito" : "Record deposit") : (lang === "es" ? "Dirección" : "Address")}</h2><button type="button" aria-label={lang === "es" ? "Guardar y cerrar" : "Save and close"} onClick={() => closeJobSheet(["dates", "payment", "deposit"].includes(activeJobSheet))}>×</button></header>
        {activeJobSheet === "client" && <><label className="client-search"><Icon><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></Icon><span className="sr-only">{t.searchClients}</span><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder={t.searchClients} aria-label={t.searchClients}/></label><div className="sheet-record-list"><button type="button" onClick={() => { setJobClient.mutate(null); closeJobSheet(); }}><span><strong>{lang === "es" ? "Sin cliente" : "No client"}</strong><small>{lang === "es" ? "Conservar los datos copiados en el trabajo" : "Keep the copied details on this job"}</small></span></button>{(clientsQuery.data?.clients ?? []).filter((c) => !clientSearch.trim() || [c.name,c.phone,c.email].some((v) => v.toLowerCase().includes(clientSearch.trim().toLowerCase()))).map((c) => <button type="button" key={c.id} onClick={() => { setJobClient.mutate(c.id); closeJobSheet(); }}><span><strong>{c.name}</strong><small>{[c.phone,c.email].filter(Boolean).join(" · ")}</small></span>{job.clientId === c.id && <CheckIcon/>}</button>)}</div></>}
        {activeJobSheet === "dates" && <div className="compact-form"><label><span>{t.date}</span><input type="date" value={detailDraft.jobDate} onChange={(event) => setDetailDraft({ ...detailDraft, jobDate: event.target.value })}/></label><label><span>{t.appointment}</span><input type="datetime-local" value={detailDraft.appointmentAt} onChange={(event) => setDetailDraft({ ...detailDraft, appointmentAt: event.target.value })}/></label><p className="sheet-note">{lang === "es" ? "Los cambios se guardan al cerrar." : "Changes save when you close."}</p></div>}
        {(activeJobSheet === "invoices" || activeJobSheet === "contracts") && <><div className="direction-toggle" role="tablist"><button type="button" className={linkTab === "new" ? "active" : ""} onClick={() => setLinkTab("new")}>{lang === "es" ? "Nuevo" : "New"}</button><button type="button" className={linkTab === "existing" ? "active" : ""} onClick={() => setLinkTab("existing")}>{lang === "es" ? "Existente" : "Existing"}</button></div>{linkTab === "new" ? <div className="sheet-new-actions">{activeJobSheet === "invoices" ? <button className="primary-button" type="button" onClick={() => setScreen({ name: "invoiceNew", jobId })}>{lang === "es" ? "Crear factura para este trabajo" : "Create invoice for this job"}</button> : <><button className="primary-button" type="button" onClick={() => setScreen({ name: "tool", jobId, mode: "contract" })}>{lang === "es" ? "Nuevo contrato" : "New contract"}</button><button className="secondary-button" type="button" onClick={() => setScreen({ name: "tool", jobId, mode: "change" })}>{lang === "es" ? "Nueva orden de cambio" : "New change order"}</button></>}</div> : <div className="sheet-record-list">{activeJobSheet === "invoices" ? (invoicesQuery.data?.invoices ?? []).filter((invoice) => invoice.jobId !== jobId).map((invoice) => <button type="button" key={invoice.id} onClick={() => { linkInvoice.mutate({ invoiceId: invoice.id, linkedJobId: jobId }); closeJobSheet(); }}><span><strong>{invoice.invoiceNumber} · {invoice.clientName}</strong><small>{usd(money(invoice.totalWithLateFee))}</small></span><PlusIcon/></button>) : (documentsQuery.data?.documents ?? []).filter((doc) => doc.jobId !== jobId).map((doc) => <button type="button" key={doc.id} onClick={() => { linkDocument.mutate(doc.id); closeJobSheet(); }}><span><strong>{doc.title}</strong><small>{doc.kind === "contract" ? (lang === "es" ? "Contrato" : "Contract") : (lang === "es" ? "Orden de cambio" : "Change order")}</small></span><PlusIcon/></button>)}</div>}</>}
        {activeJobSheet === "payment" && <div className="compact-form"><label><span>{lang === "es" ? "Notas de pago" : "Payment notes"}</span><textarea rows={5} value={detailDraft.paymentNotes} onChange={(event) => setDetailDraft({ ...detailDraft, paymentNotes: event.target.value })}/></label><p className="sheet-note">{lang === "es" ? "Los cambios se guardan al cerrar." : "Changes save when you close."}</p></div>}
        {activeJobSheet === "deposit" && <div className="compact-form"><label><span>{t.depositAmount}</span><input inputMode="decimal" value={detailDraft.depositAmount} onChange={(event) => setDetailDraft({ ...detailDraft, depositAmount: event.target.value })} placeholder="$0.00"/></label><p className="sheet-note">{lang === "es" ? "El depósito se guarda al cerrar." : "The deposit saves when you close."}</p></div>}
        {activeJobSheet === "address" && <div className="address-sheet-actions"><p>{job.jobAddress}</p><button type="button" onClick={() => { void copyText(job.jobAddress); closeJobSheet(); }}><Icon><path d="M8 8h11v11H8zM5 16H3V3h13v2"/></Icon><span>{lang === "es" ? "Copiar dirección" : "Copy address"}</span></button><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.jobAddress)}`} target="_blank" rel="noreferrer"><Icon><path d="M12 21s6-5.4 6-11a6 6 0 1 0-12 0c0 5.6 6 11 6 11z"/><circle cx="12" cy="10" r="2"/></Icon><span>{lang === "es" ? "Abrir en Maps" : "Open in Maps"}</span></a></div>}
        {(setJobClient.isError || saveJobInfo.isError || linkInvoice.isError || linkDocument.isError) && <p className="status error">{t.error}</p>}
      </section></div>}
    </main>
  );
}
function AccordionSection({
  title,
  count,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = `job-group-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section className={`accordion-section${open ? " open" : ""}`}>
      <button
        className="accordion-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="accordion-icon">{icon}</span>
        <span className="accordion-title">{title}</span>
        <span className="accordion-count">{count}</span>
        <span className="accordion-chevron">
          <BackIcon />
        </span>
      </button>
      {open && (
        <div className="accordion-panel" id={panelId}>
          {children}
        </div>
      )}
    </section>
  );
}
function ToolButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick}>
      <span>{label}</span>
      <BackIcon />
    </button>
  );
}

function EditJobForm({
  lang,
  job,
  onDone,
}: {
  lang: Lang;
  job: Job;
  onDone: () => void;
}) {
  const t = copy[lang];
  const [form, setForm] = useState({
    clientId: job.clientId,
    clientName: job.clientName,
    clientPhone: job.clientPhone,
    clientEmail: job.clientEmail,
    jobAddress: job.jobAddress,
    jobType: job.jobType,
    notes: job.notes,
    jobDate: job.jobDate,
    appointmentAt: job.appointmentAt,
    amountDue: job.amountDue,
    dueDate: job.dueDate,
    depositAmount: job.depositAmount,
    paymentNotes: job.paymentNotes,
  });
  const save = useMutation({
    mutationFn: () =>
      api.updateJob({ id: job.id, ...form, galleryPick: job.galleryPick }),
    onSuccess: onDone,
  });
  return (
    <form
      className="inline-edit"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <JobFields lang={lang} form={form} setForm={setForm} />
      <button className="primary-button" disabled={save.isPending}>
        {save.isPending ? t.saving : t.save}
      </button>
    </form>
  );
}
function PhotoCard({
  photo,
  lang,
  jobId,
  onAnnotate,
}: {
  photo: Photo;
  lang: Lang;
  jobId: number;
  onAnnotate: () => void;
}) {
  const t = copy[lang];
  const client = useQueryClient();
  const [caption, setCaption] = useState(photo.caption);
  const social = useMutation({
    mutationFn: (excludeFromSocial: boolean) =>
      api.togglePhotoSocial({ id: photo.id, excludeFromSocial }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["job", jobId] }),
  });
  const update = useMutation({
    mutationFn: (v: { caption: string; stage: Stage; galleryPick: boolean }) =>
      api.updatePhoto({ id: photo.id, ...v }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["job", jobId] }),
  });
  const remove = useMutation({
    mutationFn: () => api.deletePhoto({ id: photo.id, jobId }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["job", jobId] });
      client.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  return (
    <article className="photo-card">
      <img
        src={photo.url}
        alt={photo.caption || `${t[photo.stage]} ${t.photo}`}
      />
      {photo.annotatedFromId != null && (
        <span className="markup-badge">
          {lang === "es" ? "Con anotaciones" : "Marked up"}
        </span>
      )}
      <div className="photo-fields">
        <input
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          onBlur={() =>
            caption !== photo.caption &&
            update.mutate({
              caption,
              stage: photo.stage,
              galleryPick: photo.galleryPick,
            })
          }
          placeholder={t.addCaption}
        />
        <select
          value={photo.stage}
          onChange={(e) =>
            update.mutate({
              caption,
              stage: e.target.value as Stage,
              galleryPick: photo.galleryPick,
            })
          }
          aria-label={t.moveTo}
        >
          <option value="before">{t.before}</option>
          <option value="during">{t.during}</option>
          <option value="after">{t.after}</option>
        </select>
        <button
          className="delete-button"
          onClick={() => remove.mutate()}
          aria-label={t.deletePhoto}
        >
          <TrashIcon />
        </button>
      </div>
      <div className="photo-actions">
        <label>
          <input
            type="checkbox"
            checked={photo.galleryPick}
            onChange={(e) =>
              update.mutate({
                caption,
                stage: photo.stage,
                galleryPick: e.target.checked,
              })
            }
          />
          <span>{t.galleryPick}</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={photo.excludeFromSocial}
            onChange={(e) => social.mutate(e.target.checked)}
          />
          <span>{lang === "es" ? "No usar en redes" : "Not for social"}</span>
        </label>
        <button onClick={onAnnotate}>{t.annotations}</button>
      </div>
    </article>
  );
}

type AutomatedBackupRun = {
  status: "ok" | "failed" | "running";
  kind: "weekly-full" | "manual" | "daily";
  totalBytes: number | null;
  startedAt: string;
  offsiteSent: boolean;
  error: string | null;
};

const automatedBackupApi = api as unknown as {
  getBackupStatus: (args: Record<string, never>) => Promise<{ configured: boolean; runs: AutomatedBackupRun[] }>;
  runAutomatedBackup: (args: { note: string }) => Promise<{ offsiteSent: boolean }>;
};

function AutomaticBackupCard({ lang }: { lang: Lang }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["backupStatus"], queryFn: () => automatedBackupApi.getBackupStatus({}), refetchInterval: 30000 });
  const [notice, setNotice] = useState("");
  const runNow = useMutation({
    mutationFn: () => automatedBackupApi.runAutomatedBackup({ note: "" }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["backupStatus"] });
      setNotice(lang === "es"
        ? `Copia del servidor lista${result.offsiteSent ? " y enviada por correo" : ""}.`
        : `Server backup complete${result.offsiteSent ? " and emailed" : ""}.`);
    },
    onError: () => setNotice(lang === "es" ? "No se pudo crear la copia del servidor. Inténtalo de nuevo." : "Couldn't create the server backup. Try again."),
  });
  const latest = status.data?.runs[0];
  const dotClass = !latest ? "" : latest.status === "ok" ? "ok" : latest.status === "failed" ? "failed" : "running";
  const kindLabel = !latest ? "" : latest.kind === "weekly-full" ? (lang === "es" ? "completa" : "full") : latest.kind === "manual" ? (lang === "es" ? "manual" : "manual") : (lang === "es" ? "diaria" : "daily");
  const sizeLabel = latest?.totalBytes ? ` · ${(latest.totalBytes / 1048576).toFixed(1)} MB` : "";
  const line = !status.data
    ? (lang === "es" ? "Cargando estado…" : "Loading status…")
    : !status.data.configured
      ? (lang === "es" ? "Sin configurar: falta BACKUP_ALERT_EMAIL en el servidor." : "Not configured: BACKUP_ALERT_EMAIL is missing on the server.")
      : !latest
        ? (lang === "es" ? "Aún no hay copias automáticas. La primera se hará esta noche." : "No automatic backups yet. The first runs tonight.")
        : latest.status === "running"
          ? (lang === "es" ? "Creando copia…" : "Backup running…")
          : latest.status === "failed"
            ? (lang === "es" ? `Falló la última copia ${kindLabel}. ${latest.error ?? ""}` : `Last ${kindLabel} backup failed. ${latest.error ?? ""}`)
            : (lang === "es"
              ? `Última copia ${kindLabel}: ${new Date(latest.startedAt).toLocaleString()}${sizeLabel}${latest.offsiteSent ? " · enviada por correo" : ""}`
              : `Last ${kindLabel} backup: ${new Date(latest.startedAt).toLocaleString()}${sizeLabel}${latest.offsiteSent ? " · emailed" : ""}`);
  return (
    <div className="auto-backup-card">
      <strong>{lang === "es" ? "Copias automáticas" : "Automatic backups"}</strong>
      <p className="auto-backup-line"><span className={`backup-dot ${dotClass}`} aria-hidden="true" />{line}</p>
      <p className="privacy-note">{lang === "es"
        ? "El servidor guarda una copia diaria y una copia completa con fotos cada domingo, y las envía por correo."
        : "The server saves a daily snapshot and a full copy with photos every Sunday, and emails them offsite."}</p>
      <button type="button" className="backup-action" disabled={runNow.isPending} onClick={() => { setNotice(""); runNow.mutate(); }}>
        <Icon><path d="M12 3v12M7 10l5 5 5-5M4 19h16" /></Icon>
        <span>
          <strong>{runNow.isPending ? (lang === "es" ? "Creando copia…" : "Creating backup…") : (lang === "es" ? "Hacer copia ahora" : "Back up now")}</strong>
          <small>{lang === "es" ? "Copia completa del servidor + correo" : "Full server snapshot + email"}</small>
        </span>
      </button>
      {notice && <p className="status success" role="status">{notice}</p>}
    </div>
  );
}

const SettingsAccordionContext = createContext<{
  openId: string | null;
  setOpenId: (id: string | null) => void;
} | null>(null);

// Chunk D: web push opt-in toggle. The toggle itself must be a user gesture
// because the browser permission prompt requires one.
function PushToggle({ lang }: { lang: Lang }) {
  const [status, setStatus] = useState<PushStatus | "checking">("checking");
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (!cancelled) { setSupported(false); setStatus("unavailable"); }
        return;
      }
      const next = await ensurePushSubscription();
      if (!cancelled) setStatus(next);
    })();
    return () => { cancelled = true; };
  }, []);
  const toggle = async () => {
    if (status === "subscribed") {
      setStatus("checking");
      await disablePushSubscription();
      setStatus("needs-permission");
    } else {
      setStatus("checking");
      const next = await requestPushPermissionAndSubscribe();
      setStatus(next);
    }
  };
  if (!supported) return null;
  const enabled = status === "subscribed";
  const hint = status === "denied"
    ? (lang === "es" ? "Bloqueadas en el navegador — actívalas en los ajustes del sitio." : "Blocked in the browser — enable them in site settings.")
    : status === "unavailable"
      ? (lang === "es" ? "No disponible en este dispositivo o navegador." : "Not available on this device or browser.")
      : status === "needs-permission"
        ? (lang === "es" ? "Recibe avisos cuando un cliente vea tu portal, pague una factura o te escriba en el Marketplace." : "Get alerts when a client views your portal, pays an invoice, or messages you on Marketplace.")
        : status === "checking"
          ? (lang === "es" ? "Comprobando…" : "Checking…")
          : status === "error"
            ? (lang === "es" ? "No se pudo activar. Inténtalo de nuevo." : "Couldn't enable. Try again.")
            : (lang === "es" ? "Activadas en este dispositivo." : "On for this device.");
  return (
    <label className="switch-row">
      <span>{lang === "es" ? "Notificaciones push" : "Push notifications"}<small>{hint}</small></span>
      <input type="checkbox" role="switch" checked={enabled} disabled={status === "checking" || status === "unavailable"} onChange={toggle} />
    </label>
  );
}
// Chunk D: referral loop panel — invite friends, earn bonus Marketplace listings.
function ReferralPanel({ lang }: { lang: Lang }) {
  const stats = useQuery({ queryKey: ["referral-stats"], queryFn: () => api.getReferralStats({}) });
  const [copied, setCopied] = useState(false);
  const data = stats.data;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const link = data ? `${origin}/app/?ref=${data.referralCode}` : "";
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      const field = document.createElement("textarea");
      field.value = link;
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      document.body.removeChild(field);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };
  const share = async () => {
    if (!link) return;
    const text = lang === "es"
      ? `Prueba Crewkat, la app para contratistas: ${link}`
      : `Try Crewkat, the contractor app: ${link}`;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try { await (navigator as Navigator & { share: (data: { title: string; text: string; url: string }) => Promise<void> }).share({ title: "Crewkat", text, url: link }); return; } catch { /* fell through to copy */ }
    }
    await copy();
  };
  return (
    <div className="settings-heading">
      <p>
        {lang === "es"
          ? "Invita a otros contratistas. Por cada amigo que se una y verifique su correo, tu compañía gana 5 listados extra gratis en el Marketplace."
          : "Invite other contractors. For each friend who joins and verifies their email, your company earns 5 extra free Marketplace listings."}
      </p>
      {stats.isLoading && <div className="loading-block" />}
      {stats.isError && <p className="status error">{lang === "es" ? "No se pudo cargar tu enlace." : "Couldn't load your invite link."}</p>}
      {data && (
        <>
          <div className="referral-link-row">
            <input readOnly value={link} aria-label={lang === "es" ? "Enlace de invitación" : "Invite link"} onFocus={(e) => e.target.select()} />
            <button type="button" className="secondary-button" onClick={copy}>{copied ? (lang === "es" ? "¡Copiado!" : "Copied!") : (lang === "es" ? "Copiar" : "Copy")}</button>
          </div>
          <button type="button" className="primary-button" onClick={share}>{lang === "es" ? "Invitar a un amigo" : "Invite a friend"}</button>
          <p className="privacy-note">
            {lang === "es"
              ? `Amigos que se unieron: ${data.joinedCount} · Listados extra ganados: ${data.bonusListings} (límite actual: ${data.effectiveLimit})`
              : `Friends joined: ${data.joinedCount} · Bonus listings earned: ${data.bonusListings} (current limit: ${data.effectiveLimit})`}
          </p>
        </>
      )}
    </div>
  );
}

function SettingsAccordion({
  title,
  icon,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const accordion = useContext(SettingsAccordionContext);
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const panelId = `settings-group-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const open = accordion ? accordion.openId === panelId : localOpen;
  const toggle = () => {
    if (accordion) accordion.setOpenId(open ? null : panelId);
    else setLocalOpen((value) => !value);
  };
  return (
    <section className={`settings-accordion${open ? " open" : ""}`}>
      <button
        className="settings-accordion-trigger"
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={toggle}
      >
        <span className="accordion-icon">{icon}</span>
        <span>{title}</span>
        <span className="accordion-chevron">
          <BackIcon />
        </span>
      </button>
      {open && (
        <div className="settings-accordion-panel" id={panelId}>
          {children}
        </div>
      )}
    </section>
  );
}

function CompanyProfileEditor({ lang, value, saving, onBack, onSave }: { lang: Lang; value: Settings | null; saving: boolean; onBack: () => void; onSave: (value: SettingsInput) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Settings | null>(value);
  const [imageError, setImageError] = useState("");
  useEffect(() => { if (value) setForm(value); }, [value]);
  const uploadImage = async (file: File, kind: "logo" | "cover") => {
    if (file.type !== "image/jpeg" && file.type !== "image/png") {
      setImageError(lang === "es" ? "Elige una imagen JPG o PNG." : "Choose a JPG or PNG image.");
      return;
    }
    setImageError("");
    const data = await fileToBase64(file);
    if (kind === "logo") await api.uploadLogo({ filename: file.name, contentType: file.type, dataBase64: data.dataBase64 });
    else await api.uploadCompanyCover({ filename: file.name, contentType: file.type, dataBase64: data.dataBase64 });
    await qc.invalidateQueries({ queryKey: ["settings"] });
  };
  const logoUpload = useMutation({ mutationFn: (file: File) => uploadImage(file, "logo"), onError: () => setImageError(lang === "es" ? "No se pudo subir el logo." : "The logo could not be uploaded.") });
  const coverUpload = useMutation({ mutationFn: (file: File) => uploadImage(file, "cover"), onError: () => setImageError(lang === "es" ? "No se pudo subir la portada." : "The cover could not be uploaded.") });
  const text = lang === "es" ? {
    title: "Editar perfil de empresa", intro: "Esta información aparece en tu perfil del mercado y se mantiene sincronizada con Configuración.", cover: "Foto de portada", logo: "Logo de la empresa", addCover: "Agregar portada", replaceCover: "Cambiar portada", addLogo: "Agregar logo", replaceLogo: "Cambiar logo", company: "Nombre de la empresa", description: "Descripción", descriptionHint: "Cuenta qué hace tu empresa y qué la distingue.", area: "Ubicación o área de servicio", website: "Sitio web", phone: "Teléfono", social: "Páginas sociales", facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", save: "Guardar perfil", saving: "Guardando…"
  } : {
    title: "Edit company profile", intro: "This information appears on your Marketplace profile and stays in sync with Settings.", cover: "Cover photo", logo: "Company logo", addCover: "Add cover", replaceCover: "Change cover", addLogo: "Add logo", replaceLogo: "Change logo", company: "Company name", description: "Description", descriptionHint: "Tell people what your company does and what sets it apart.", area: "Location or service area", website: "Website", phone: "Phone", social: "Social pages", facebook: "Facebook", instagram: "Instagram", youtube: "YouTube", save: "Save profile", saving: "Saving…"
  };
  if (!form) return <main className="page company-profile-page"><PageHeader lang={lang} title={text.title} onBack={onBack}/><div className="loading-block"/></main>;
  return <main className="page company-profile-page">
    <PageHeader lang={lang} title={text.title} onBack={onBack}/>
    <p className="profile-editor-intro">{text.intro}</p>
    <form className="job-form company-profile-form" onSubmit={(event) => { event.preventDefault(); const { logoUrl: _logoUrl, coverUrl: _coverUrl, ...input } = form; onSave(input); }}>
      <section className="profile-visual-editor" aria-label={lang === "es" ? "Imágenes del perfil" : "Profile images"}>
        <div className="profile-cover-preview">
          {form.coverUrl ? <img src={form.coverUrl} alt={text.cover}/> : <span><Icon size={34}><path d="M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4"/></Icon></span>}
          <label className="profile-image-action"><CameraIcon/><span>{form.coverUrl ? text.replaceCover : text.addCover}</span><input className="sr-only" type="file" accept="image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; if (file) logoUpload.reset(), coverUpload.mutate(file); }}/></label>
        </div>
        <div className="profile-logo-row">
          <div className="profile-logo-preview">{form.logoUrl ? <img src={form.logoUrl} alt={text.logo}/> : <span>{form.companyName.trim().slice(0, 2).toUpperCase() || "CO"}</span>}</div>
          <div><strong>{text.logo}</strong><label className="secondary-button profile-logo-action"><CameraIcon/><span>{form.logoUrl ? text.replaceLogo : text.addLogo}</span><input className="sr-only" type="file" accept="image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; if (file) coverUpload.reset(), logoUpload.mutate(file); }}/></label></div>
        </div>
        {(logoUpload.isPending || coverUpload.isPending) && <p className="status">{lang === "es" ? "Subiendo imagen…" : "Uploading image…"}</p>}
        {imageError && <p className="status error" role="alert">{imageError}</p>}
      </section>
      <label><span>{text.company}</span><input required value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })}/></label>
      <label><span>{text.description}</span><textarea rows={5} placeholder={text.descriptionHint} value={form.profileDescription} onChange={(event) => setForm({ ...form, profileDescription: event.target.value })}/></label>
      <label><span>{text.area}</span><input value={form.serviceArea} onChange={(event) => setForm({ ...form, serviceArea: event.target.value })}/></label>
      <div className="field-pair"><label><span>{text.website}</span><input inputMode="url" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })}/></label><label><span>{text.phone}</span><input type="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></label></div>
      <fieldset className="profile-social-fields"><legend>{text.social}</legend>
        <label><span>{text.facebook}</span><input inputMode="url" placeholder="https://facebook.com/…" value={form.facebookUrl} onChange={(event) => setForm({ ...form, facebookUrl: event.target.value })}/></label>
        <label><span>{text.instagram}</span><input inputMode="url" placeholder="https://instagram.com/…" value={form.instagramUrl} onChange={(event) => setForm({ ...form, instagramUrl: event.target.value })}/></label>
        <label><span>{text.youtube}</span><input inputMode="url" placeholder="https://youtube.com/…" value={form.youtubeUrl} onChange={(event) => setForm({ ...form, youtubeUrl: event.target.value })}/></label>
      </fieldset>
      <button className="primary-button sticky-save" type="submit" disabled={saving || logoUpload.isPending || coverUpload.isPending}>{saving ? text.saving : text.save}</button>
    </form>
  </main>;
}

let settingsOpenSectionCache: string | null = null;
let settingsMorePanelCache: "email" | "payments" | "overdue" | "sorting" | "notifications" | "trash" | null = null;

function SettingsScreen({
  lang,
  value,
  saving,
  themeMode,
  onThemeChange,
  onBack,
  setScreen,
  onSave,
}: {
  lang: Lang;
  value: Settings | null;
  saving: boolean;
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
  onBack: () => void;
  setScreen: (screen: Screen) => void;
  onSave: (v: SettingsInput) => void;
}) {
  const t = copy[lang];
  const help = HELP_CONTENT[lang];
  const client = useQueryClient();
  const auth = useContext(AuthContext);
  const fallback: Settings = {
    companyName: "",
    licenseNumber: "",
    phone: "",
    email: "",
    website: "",
    address: "",
    profileDescription: "",
    serviceArea: "",
    facebookUrl: "",
    instagramUrl: "",
    youtubeUrl: "",
    reviewUrl: "",
    paymentInstructions: "",
    quoteFollowUpDays: 3,
    offersFreeEstimates: true,
    socialWatermark: true,
    language: lang,
    accentColor: "#1f5a4a",
    defaultQuoteTheme: "classic",
    defaultDocumentFont: "helvetica",
    defaultShowTaxLine: true,
    defaultShowDiscountLine: true,
    defaultShowPaidLine: true,
    defaultShowPaymentTerms: true,
    defaultShowFooterNotes: true,
    defaultShowLogo: true,
    defaultShowCompanyInfo: true,
    defaultCustomizeJson: "{}",
    defaultFootnote: "",
    warrantyTerms: "",
    hourlyCostRate: "0",
    lateFeeType: "percent",
    lateFeeValue: "0",
    lateFeeGraceDays: 0,
    costAlertPercent: 85,
    paymentRemindersEnabled: true,
    onlineSignatureEnabled: true,
    overdueInvoiceRemindersEnabled: true,
    overdueReminderDays: 3,
    invoiceGroupBy: "creation_date",
    addShippingAddress: false,
    addJobSiteAddress: true,
    convertToQuote: false,
    notificationsEnabled: true,
    simpleMode: true,
    logoUrl: null,
    coverUrl: null,
  };
  const [form, setForm] = useState<Settings>(value ?? fallback);
  const [openSettingsSection, setOpenSettingsSection] = useState<string | null>(settingsOpenSectionCache);
  const [helpSearch, setHelpSearch] = useState("");
  const [supportForm, setSupportForm] = useState({
    kind: "support" as "support" | "problem" | "question" | "general",
    subject: "",
    message: "",
  });
  const [sentReport, setSentReport] = useState<{
    id: number;
    sentAt: string;
  } | null>(null);
  const [morePanel, setMorePanel] = useState<"email" | "payments" | "overdue" | "sorting" | "notifications" | "trash" | null>(settingsMorePanelCache);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [backupNotice, setBackupNotice] = useState("");
  useEffect(() => {
    if (value) setForm(value);
  }, [value]);
  useEffect(() => {
    settingsOpenSectionCache = openSettingsSection;
    settingsMorePanelCache = morePanel;
  }, [openSettingsSection, morePanel]);
  const logo = useMutation({
    mutationFn: async (file: File) => {
      const data = await fileToBase64(file);
      return api.uploadLogo({
        filename: file.name,
        contentType: file.type as "image/jpeg" | "image/png",
        dataBase64: data.dataBase64,
      });
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["settings"] }),
  });
  const report = useMutation({
    mutationFn: () =>
      api.submitSupportReport({ ...supportForm, language: lang }),
    onSuccess: (result) => {
      setSentReport(result);
      setSupportForm((current) => ({ ...current, subject: "", message: "" }));
    },
  });
  const backup = useMutation({
    mutationFn: () => api.exportBackup({}),
    onSuccess: async (result) => {
      try {
        const compressed = Uint8Array.from(atob(result.dataBase64), (char) => char.charCodeAt(0));
        const payload = JSON.parse(strFromU8(gunzipSync(compressed))) as { blobs: Record<string, { contentType: string; dataBase64: string }> };
        for (const attachment of result.attachments) {
          const response = await fetch(attachment.url);
          if (!response.ok) throw new Error("attachment");
          const bytes = new Uint8Array(await response.arrayBuffer());
          payload.blobs[attachment.key] = { contentType: attachment.contentType, dataBase64: bytesToBase64(bytes) };
        }
        const completed = gzipSync(strToU8(JSON.stringify(payload)), { level: 6 });
        const url = URL.createObjectURL(new Blob([completed], { type: "application/gzip" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = result.filename;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        setBackupNotice(lang === "es" ? `Copia lista: ${result.recordCount} registros y ${result.attachments.length} archivos.` : `Backup ready: ${result.recordCount} records and ${result.attachments.length} files.`);
      } catch {
        setBackupNotice(lang === "es" ? "No se pudo incluir todos los archivos en la copia." : "Couldn't include every attachment in the backup.");
      }
    },
    onError: () => setBackupNotice(lang === "es" ? "No se pudo crear la copia. Inténtalo de nuevo." : "Couldn't create the backup. Try again."),
  });
  const restore = useMutation({
    mutationFn: async (file: File) => {
      const data = await fileToBase64(file);
      return api.restoreBackup({ dataBase64: data.dataBase64 });
    },
    onSuccess: async (result) => {
      await client.invalidateQueries();
      setRestoreFile(null);
      setConfirmRestore(false);
      setBackupNotice(lang === "es" ? `Restaurado: ${result.recordCount} registros y ${result.attachmentCount} archivos.` : `Restored: ${result.recordCount} records and ${result.attachmentCount} files.`);
    },
    onError: () => {
      setConfirmRestore(false);
      setBackupNotice(lang === "es" ? "No se pudo restaurar. Usa una copia válida de Crewkat." : "Couldn't restore. Choose a valid Crewkat backup.");
    },
  });
  const term = helpSearch.trim().toLocaleLowerCase(lang === "es" ? "es" : "en");
  const filteredQas = help.qas.filter(
    (entry) =>
      !term ||
      entry
        .join(" ")
        .toLocaleLowerCase(lang === "es" ? "es" : "en")
        .includes(term),
  );
  const filteredGuides = help.guidesList.filter(
    (entry) =>
      !term ||
      `${entry[0]} ${entry[1].join(" ")}`
        .toLocaleLowerCase(lang === "es" ? "es" : "en")
        .includes(term),
  );
  const appearanceText =
    lang === "es"
      ? {
          title: "Apariencia",
          note: "El tema cambia al instante y se guarda en este dispositivo.",
          light: "Claro",
          dark: "Oscuro",
          system: "Sistema",
          systemNote: "Usa la configuración del teléfono",
        }
      : {
          title: "Appearance",
          note: "Changes immediately and stays saved on this device.",
          light: "Light",
          dark: "Dark",
          system: "System",
          systemNote: "Follows your phone setting",
        };
  return (
    <main className="page settings-page">
      <PageHeader lang={lang} title={t.settings} onBack={onBack} />
      <form
        className="job-form settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const { logoUrl: _logoUrl, coverUrl: _coverUrl, ...input } = form;
          onSave(input);
        }}
      >
        <SettingsAccordionContext.Provider value={{ openId: openSettingsSection, setOpenId: setOpenSettingsSection }}>
        <div className="settings-accordion-list">
          {auth && <>
            <h2 className="settings-group-title">{lang === "es" ? "Cuenta" : "Account"}</h2>
            <SettingsAccordion title={auth.user.name} icon={<Icon><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0" /></Icon>}>
              <div className="account-settings">
                <div><strong>{auth.user.email}</strong><small>{auth.user.tier === "premium" ? (lang === "es" ? "Propietario verificado · Premium" : "Verified owner · Premium") : (lang === "es" ? "Propietario verificado · Gratis" : "Verified owner · Free")}</small></div>
                <button type="button" className="secondary-button" onClick={() => setScreen({ name: "upgrade" })}>{lang === "es" ? "Ver plan" : "View plan"}</button>
                <button type="button" className="secondary-button account-signout" onClick={() => void auth.signOut()}>{lang === "es" ? "Cerrar sesión" : "Sign out"}</button>
              </div>
            </SettingsAccordion>
            <SettingsAccordion title={lang === "es" ? "Datos de ejemplo" : "Sample data"} icon={<Icon><path d="M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" /></Icon>}>
              <SampleDataButton lang={lang} />
            </SettingsAccordion>
          </>}
          <SettingsAccordion
            title={lang === "es" ? "Información de la empresa" : "Company info"}
            icon={
              <Icon>
                <path d="M4 21V7l8-4 8 4v14M8 21v-5h8v5M8 9h1M12 9h1M16 9h1M8 13h1M12 13h1M16 13h1" />
              </Icon>
            }
          >
            <button type="button" className="market-profile-shortcut" onClick={() => setScreen({ name: "companyProfile" })}><span className="market-category-icon"><Icon><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0M18 3l3 3M19.5 4.5l-4 4"/></Icon></span><span><strong>{lang === "es" ? "Editar perfil del mercado" : "Edit Marketplace profile"}</strong><small>{lang === "es" ? "Portada, descripción, área y redes sociales" : "Cover, description, service area, and social links"}</small></span><BackIcon/></button>
            <fieldset className="brand-settings">
              <legend>{t.companyLogo}</legend>
              <div className="logo-preview">
                {form.logoUrl ? (
                  <img src={form.logoUrl} alt={t.companyLogo} />
                ) : (
                  <span>
                    {form.companyName.trim().slice(0, 2).toUpperCase() || "TS"}
                  </span>
                )}
              </div>
              <label className="secondary-button logo-upload">
                <span>{form.logoUrl ? t.replaceLogo : t.uploadLogo}</span>
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (
                      file &&
                      (file.type === "image/png" || file.type === "image/jpeg")
                    )
                      logo.mutate(file);
                  }}
                />
              </label>
            </fieldset>
            <label>
              <span>{t.company}</span>
              <input
                value={form.companyName}
                onChange={(e) =>
                  setForm({ ...form, companyName: e.target.value })
                }
              />
            </label>
            <label>
              <span>{t.license}</span>
              <input
                value={form.licenseNumber}
                onChange={(e) =>
                  setForm({ ...form, licenseNumber: e.target.value })
                }
              />
            </label>
            <div className="field-pair">
              <label>
                <span>{t.companyPhone}</span>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </label>
              <label>
                <span>{t.companyEmail}</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </label>
            </div>
            <label>
              <span>{t.website}</span>
              <input
                inputMode="url"
                value={form.website}
                onChange={(e) => setForm({ ...form, website: e.target.value })}
              />
            </label>
            <label>
              <span>{t.companyAddress}</span>
              <textarea
                rows={2}
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </label>
            <label>
              <span>{t.reviewLink}</span>
              <input
                inputMode="url"
                value={form.reviewUrl}
                onChange={(e) =>
                  setForm({ ...form, reviewUrl: e.target.value })
                }
              />
            </label>
            <label>
              <span>{t.accentColor}</span>
              <div className="color-field">
                <input
                  type="color"
                  value={form.accentColor}
                  onChange={(e) =>
                    setForm({ ...form, accentColor: e.target.value })
                  }
                />
                <input
                  value={form.accentColor}
                  pattern="^#[0-9a-fA-F]{6}$"
                  onChange={(e) =>
                    setForm({ ...form, accentColor: e.target.value })
                  }
                />
              </div>
            </label>
            <label>
              <span>
                {lang === "es"
                  ? "Costo de mano de obra por hora"
                  : "Hourly labor cost"}
              </span>
              <input
                inputMode="decimal"
                value={form.hourlyCostRate}
                onChange={(e) =>
                  setForm({ ...form, hourlyCostRate: e.target.value })
                }
              />
            </label>
          </SettingsAccordion>

          <h2 className="settings-group-title">{lang === "es" ? "Negocio" : "Business"}</h2>
          <SettingsAccordion
            title={lang === "es" ? "Opciones de pago" : "Payment options"}
            icon={<Icon><path d="M3 6h18v12H3zM3 10h18M7 15h4" /></Icon>}
          >
            <label>
              <span>{t.paymentInstructions}</span>
              <textarea
                rows={4}
                value={form.paymentInstructions}
                onChange={(e) => setForm({ ...form, paymentInstructions: e.target.value })}
              />
            </label>
            <p className="privacy-note">{lang === "es" ? "Estas instrucciones aparecen en las facturas y cotizaciones que envía." : "These instructions appear on the invoices and estimates you send."}</p>
          </SettingsAccordion>

          <SettingsAccordion title={lang === "es" ? "Más opciones" : "More options"} icon={<FileIcon />}>
            <div className="more-options-groups">
              <section className="more-options-section">
                <h3>{lang === "es" ? "Comunicaciones con clientes" : "Client Communications"}</h3>
                <button type="button" className="more-option-row" onClick={() => setMorePanel(morePanel === "email" ? null : "email")} aria-expanded={morePanel === "email"}>
                  <span className="option-row-icon email"><Icon><path d="M3 5h18v14H3zM3 6l9 7 9-7" /></Icon></span><span>{lang === "es" ? "Configuración de correo" : "Email Settings"}</span><BackIcon />
                </button>
                {morePanel === "email" && <div className="more-option-detail"><label><span>{lang === "es" ? "Correo de respuesta" : "Reply-to email"}</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><p>{lang === "es" ? "Aparece como el correo de contacto en documentos y mensajes." : "Used as the contact email on documents and client messages."}</p></div>}
                <button type="button" className="more-option-row" onClick={() => setMorePanel(morePanel === "payments" ? null : "payments")} aria-expanded={morePanel === "payments"}>
                  <span className="option-row-icon reminder"><Icon><circle cx="12" cy="13" r="8"/><path d="M12 9v5l3 2M8 2h8" /></Icon></span><span>{lang === "es" ? "Recordatorios de pago" : "Payment Reminders"}</span><BackIcon />
                </button>
                {morePanel === "payments" && <div className="more-option-detail"><label className="switch-row"><span>{lang === "es" ? "Mostrar recordatorios de pago" : "Show payment reminders"}</span><input type="checkbox" role="switch" checked={form.paymentRemindersEnabled} onChange={(e) => setForm({ ...form, paymentRemindersEnabled: e.target.checked })} /></label><label><span>{t.paymentInstructions}</span><textarea rows={3} value={form.paymentInstructions} onChange={(e) => setForm({ ...form, paymentInstructions: e.target.value })} /></label></div>}
                <label className="more-option-row toggle-row"><span>{lang === "es" ? "Firma en línea" : "Online signature"} <span className="info-icon" title={lang === "es" ? "Permite recoger firmas en cotizaciones y facturas" : "Lets you collect signatures on estimates and invoices"}>i</span></span><input type="checkbox" role="switch" checked={form.onlineSignatureEnabled} onChange={(e) => setForm({ ...form, onlineSignatureEnabled: e.target.checked })} /></label>
              </section>
              <section className="more-options-section"><h3>{lang === "es" ? "Mis alertas" : "My alerts"}</h3>
                <button type="button" className="more-option-row" onClick={() => setMorePanel(morePanel === "overdue" ? null : "overdue")} aria-expanded={morePanel === "overdue"}><span>{lang === "es" ? "Recordatorios de facturas vencidas" : "Overdue Invoice Reminders"}</span><BackIcon /></button>
                {morePanel === "overdue" && <div className="more-option-detail"><label className="switch-row"><span>{lang === "es" ? "Avisarme sobre facturas vencidas" : "Alert me about overdue invoices"}</span><input type="checkbox" role="switch" checked={form.overdueInvoiceRemindersEnabled} onChange={(e) => setForm({ ...form, overdueInvoiceRemindersEnabled: e.target.checked })} /></label><label><span>{lang === "es" ? "Primer recordatorio después de" : "First reminder after"}</span><select value={form.overdueReminderDays} onChange={(e) => setForm({ ...form, overdueReminderDays: Number(e.target.value) })}><option value={1}>1 {lang === "es" ? "día" : "day"}</option><option value={3}>3 {lang === "es" ? "días" : "days"}</option><option value={7}>7 {lang === "es" ? "días" : "days"}</option><option value={14}>14 {lang === "es" ? "días" : "days"}</option></select></label></div>}
              </section>
              <section className="more-options-section"><h3>{lang === "es" ? "Orden" : "Sorting"}</h3>
                <button type="button" className="more-option-row value-row" onClick={() => setMorePanel(morePanel === "sorting" ? null : "sorting")} aria-expanded={morePanel === "sorting"}><span>{lang === "es" ? "Facturas agrupadas por" : "Invoices grouped by"} <span className="info-icon" title={lang === "es" ? "Cambia el orden de la lista de facturas" : "Changes the invoice list order"}>i</span></span><small>{form.invoiceGroupBy === "client" ? (lang === "es" ? "Cliente" : "Client") : form.invoiceGroupBy === "due_date" ? (lang === "es" ? "Vencimiento" : "Due date") : (lang === "es" ? "Fecha de creación" : "Creation date")}</small><BackIcon /></button>
                {morePanel === "sorting" && <div className="more-option-detail"><label><span>{lang === "es" ? "Agrupar por" : "Group by"}</span><select value={form.invoiceGroupBy} onChange={(e) => setForm({ ...form, invoiceGroupBy: e.target.value as Settings["invoiceGroupBy"] })}><option value="creation_date">{lang === "es" ? "Fecha de creación" : "Creation date"}</option><option value="due_date">{lang === "es" ? "Fecha de vencimiento" : "Due date"}</option><option value="client">{lang === "es" ? "Cliente" : "Client"}</option></select></label></div>}
              </section>
              <section className="more-options-section"><h3>{lang === "es" ? "Campos extra" : "Extra Fields"}</h3>
                <label className="more-option-row toggle-row"><span>{lang === "es" ? "Agregar dirección de envío" : "Add Shipping Address"}</span><input type="checkbox" role="switch" checked={form.addShippingAddress} onChange={(e) => setForm({ ...form, addShippingAddress: e.target.checked })} /></label>
                <label className="more-option-row toggle-row"><span>{lang === "es" ? "Agregar dirección del trabajo" : 'Add "Job Site" Address'}</span><input type="checkbox" role="switch" checked={form.addJobSiteAddress} onChange={(e) => setForm({ ...form, addJobSiteAddress: e.target.checked })} /></label>
              </section>
              <section className="more-options-section"><h3>{lang === "es" ? "Presupuestos" : "Estimates"}</h3>
                <label className="more-option-row toggle-row"><span>{lang === "es" ? "Convertir en cotización" : "Convert to Quote"} <span className="info-icon" title={lang === "es" ? "Usa la palabra Cotización para los presupuestos" : "Uses Quote wording for estimates"}>i</span></span><input type="checkbox" role="switch" checked={form.convertToQuote} onChange={(e) => setForm({ ...form, convertToQuote: e.target.checked })} /></label>
              </section>
              <section className="more-options-section"><h3>{lang === "es" ? "Otros" : "Other"}</h3>
                <button type="button" className="more-option-row" onClick={() => setMorePanel(morePanel === "notifications" ? null : "notifications")} aria-expanded={morePanel === "notifications"}><span className="option-row-icon notification"><Icon><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></Icon></span><span>{lang === "es" ? "Notificaciones" : "Notifications"}</span><BackIcon /></button>
                {morePanel === "notifications" && <div className="more-option-detail"><label className="switch-row"><span>{lang === "es" ? "Mostrar avisos y seguimientos" : "Show alerts and follow-ups"}</span><input type="checkbox" role="switch" checked={form.notificationsEnabled} onChange={(e) => setForm({ ...form, notificationsEnabled: e.target.checked })} /></label><PushToggle lang={lang} /></div>}
                <button type="button" className="more-option-row danger-row" onClick={() => setMorePanel(morePanel === "trash" ? null : "trash")} aria-expanded={morePanel === "trash"}><span className="option-row-icon trash"><TrashIcon /></span><span>{lang === "es" ? "Papelera" : "Trash"}</span><BackIcon /></button>
                {morePanel === "trash" && <div className="more-option-detail"><p>{lang === "es" ? "Los elementos eliminados se quitan de inmediato. Haz una copia de seguridad antes de borrar registros importantes." : "Deleted items are removed immediately. Make a backup before deleting important records."}</p></div>}
              </section>
            </div>
          </SettingsAccordion>

          <SettingsAccordion title={lang === "es" ? "Copia de seguridad y restauración" : "Backup & restore"} icon={<Icon><path d="M12 3v12M7 10l5 5 5-5M4 19h16" /></Icon>}>
            <AutomaticBackupCard lang={lang} />
            <div className="settings-heading"><p>{lang === "es" ? "Guarda una copia completa de trabajos, clientes, facturas, fotos, documentos y configuración." : "Save a complete copy of jobs, clients, invoices, photos, documents, and settings."}</p></div>
            <button type="button" className="backup-action" disabled={backup.isPending} onClick={() => { setBackupNotice(""); backup.mutate(); }}><Icon><path d="M12 3v12M7 10l5 5 5-5M4 19h16" /></Icon><span><strong>{backup.isPending ? (lang === "es" ? "Creando copia…" : "Creating backup…") : (lang === "es" ? "Guardar copia de mis datos" : "Back up my data")}</strong><small>{lang === "es" ? "Descarga un archivo .crewkat" : "Downloads one .crewkat file"}</small></span></button>
            <label className="backup-action restore-picker"><Icon><path d="M12 21V9M7 14l5-5 5 5M4 5h16" /></Icon><span><strong>{lang === "es" ? "Restaurar desde una copia" : "Restore from backup"}</strong><small>{restoreFile?.name ?? (lang === "es" ? "Elegir archivo .crewkat" : "Choose a .crewkat file")}</small></span><input className="sr-only" type="file" accept=".crewkat,.fhq,application/gzip" onChange={(e) => { const file = e.target.files?.[0] ?? null; setRestoreFile(file); setConfirmRestore(Boolean(file)); setBackupNotice(""); }} /></label>
            {confirmRestore && restoreFile && <div className="restore-warning" role="alert"><strong>{lang === "es" ? "Esto reemplazará todos los datos actuales." : "This will replace all current data."}</strong><p>{lang === "es" ? "No cierres la app durante la restauración." : "Do not close the app while restore is running."}</p><div><button type="button" className="danger-button" disabled={restore.isPending} onClick={() => restore.mutate(restoreFile)}>{restore.isPending ? (lang === "es" ? "Restaurando…" : "Restoring…") : (lang === "es" ? "Sí, reemplazar y restaurar" : "Yes, replace and restore")}</button><button type="button" className="secondary-button" onClick={() => { setConfirmRestore(false); setRestoreFile(null); }}>{lang === "es" ? "Cancelar" : "Cancel"}</button></div></div>}
            {backupNotice && <p className={`status ${backup.isError || restore.isError ? "error" : "success"}`} role="status">{backupNotice}</p>}
            <p className="privacy-note">{lang === "es" ? "La copia protege contra pérdida accidental. El acceso con cuenta en cualquier dispositivo se añadirá con el sistema de inicio de sesión del lanzamiento." : "Backups protect against accidental loss. Account sign-in on any device will arrive with the launch authentication system."}</p>
          </SettingsAccordion>

          <SettingsAccordion
            title={
              lang === "es"
                ? "Impuestos y moneda"
                : "Tax & currency"
            }
            icon={
              <Icon>
                <path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" />
              </Icon>
            }
          >
            <label>
              <span>
                {lang === "es" ? "Tipo de cargo por atraso" : "Late-fee type"}
              </span>
              <select
                value={form.lateFeeType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    lateFeeType: e.target.value as Settings["lateFeeType"],
                  })
                }
              >
                <option value="flat">
                  {lang === "es" ? "Monto fijo" : "Fixed amount"}
                </option>
                <option value="percent">
                  {lang === "es" ? "Porcentaje" : "Percentage"}
                </option>
              </select>
            </label>
            <div className="field-pair">
                <label>
                  <span>
                    {form.lateFeeType === "percent"
                      ? lang === "es"
                        ? "Porcentaje"
                        : "Percentage"
                      : lang === "es"
                        ? "Monto"
                        : "Amount"}
                  </span>
                  <input
                    inputMode="decimal"
                    value={form.lateFeeValue}
                    onChange={(e) =>
                      setForm({ ...form, lateFeeValue: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>{lang === "es" ? "Días de gracia" : "Grace days"}</span>
                  <input
                    type="number"
                    min="0"
                    max="365"
                    value={form.lateFeeGraceDays}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        lateFeeGraceDays: Number(e.target.value) || 0,
                      })
                    }
                  />
                </label>
              </div>
            <label>
              <span>
                {lang === "es"
                  ? "Avisar cuando el costo llegue al % del presupuesto"
                  : "Alert when job cost reaches % of budget"}
              </span>
              <input
                type="number"
                min="50"
                max="100"
                value={form.costAlertPercent}
                onChange={(e) =>
                  setForm({
                    ...form,
                    costAlertPercent: Number(e.target.value) || 85,
                  })
                }
              />
            </label>
            <p className="privacy-note">
              {lang === "es"
                ? "Los cargos aparecen separados del total original. Las alertas comparan costos registrados con la cotización del trabajo."
                : "Late fees appear separately from the original total. Cost alerts compare recorded job costs with the job quote."}
            </p>
          </SettingsAccordion>

          <SettingsAccordion
            title={lang === "es" ? "Configuración de la app" : "App settings"}
            icon={
              <Icon>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 3a9 9 0 0 0 0 18z" />
              </Icon>
            }
          >
            <div className="settings-heading">
              <p>{appearanceText.note}</p>
            </div>
            <div
              className="appearance-picker"
              role="group"
              aria-label={appearanceText.title}
            >
              {(["light", "dark", "system"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={themeMode === mode ? "active" : ""}
                  aria-pressed={themeMode === mode}
                  onClick={() => onThemeChange(mode)}
                >
                  <span className={`theme-preview ${mode}`} aria-hidden="true">
                    <i />
                    <i />
                  </span>
                  <strong>
                    {mode === "light"
                      ? appearanceText.light
                      : mode === "dark"
                        ? appearanceText.dark
                        : appearanceText.system}
                  </strong>
                  {mode === "system" && (
                    <small>{appearanceText.systemNote}</small>
                  )}
                </button>
              ))}
            </div>
          </SettingsAccordion>

          <h2 className="settings-group-title">{lang === "es" ? "Ayuda y comentarios" : "Help & Feedback"}</h2>
          <SettingsAccordion
            title={lang === "es" ? "Sitio web y ayuda" : "Website & help"}
            icon={
              <Icon>
                <circle cx="12" cy="12" r="9" />
                <path d="M9.5 9a2.6 2.6 0 1 1 4.2 2c-1 .7-1.7 1.2-1.7 2.5M12 17h.01" />
              </Icon>
            }
          >
            <div className="settings-heading">
              <p>
                {lang === "es"
                  ? "Respuestas rápidas y recorridos breves para el trabajo diario."
                  : "Quick answers and short walkthroughs for daily work."}
              </p>
            </div>
            <label className="help-search">
              <span>{help.search}</span>
              <input
                type="search"
                value={helpSearch}
                onChange={(e) => setHelpSearch(e.target.value)}
                placeholder={help.search}
              />
            </label>
            {filteredQas.length > 0 && (
              <div className="help-results">
                <h3>{help.questions}</h3>
                {filteredQas.map(([topic, question, answer]) => (
                  <details key={question}>
                    <summary>
                      <span>{topic}</span>
                      {question}
                    </summary>
                    <p>{answer}</p>
                  </details>
                ))}
              </div>
            )}
            {filteredGuides.length > 0 && (
              <div className="help-results guide-results">
                <h3>{help.guides}</h3>
                {filteredGuides.map(([title, steps]) => (
                  <details key={title}>
                    <summary>{title}</summary>
                    <ol>
                      {steps.map((step, index) => (
                        <li key={`${title}-${index}`}>{step}</li>
                      ))}
                    </ol>
                  </details>
                ))}
              </div>
            )}
            {filteredQas.length === 0 && filteredGuides.length === 0 && (
              <p className="help-empty">{help.noResults}</p>
            )}
          </SettingsAccordion>

          <SettingsAccordion
            title={lang === "es" ? "Atención al cliente" : "Customer support"}
            icon={
              <Icon>
                <path d="M3 5h18v14H3z" />
                <path d="m3 6 9 7 9-7" />
              </Icon>
            }
          >
            <div className="settings-heading">
              <p>
                {lang === "es"
                  ? "Escríbenos por correo o envía un reporte dentro de la app."
                  : "Email support or send a report from inside the app."}
              </p>
            </div>
            <a
              className="support-email"
              href={`mailto:${APP_INFO.supportEmail}?subject=${encodeURIComponent("Crewkat support")}`}
            >
              <Icon>
                <path d="M3 5h18v14H3z" />
                <path d="m3 6 9 7 9-7" />
              </Icon>
              <span>
                <strong>
                  {lang === "es" ? "Enviar correo a soporte" : "Email support"}
                </strong>
                <small>{APP_INFO.supportEmail}</small>
              </span>
              <BackIcon />
            </a>
            <fieldset className="support-form">
              <legend>
                {lang === "es" ? "Enviar un reporte" : "Send a report"}
              </legend>
              <div
                className="support-kind"
                role="group"
                aria-label={
                  lang === "es" ? "Tipo de solicitud" : "Request type"
                }
              >
                {(["support", "problem", "question", "general"] as const).map(
                  (kind) => (
                    <button
                      key={kind}
                      type="button"
                      className={supportForm.kind === kind ? "active" : ""}
                      aria-pressed={supportForm.kind === kind}
                      onClick={() => {
                        setSentReport(null);
                        setSupportForm({ ...supportForm, kind });
                      }}
                    >
                      {lang === "es"
                        ? (
                            {
                              support: "Soporte",
                              problem: "Error",
                              question: "Pregunta",
                              general: "Consulta",
                            } as const
                          )[kind]
                        : (
                            {
                              support: "Support",
                              problem: "Bug / error",
                              question: "Question",
                              general: "General",
                            } as const
                          )[kind]}
                    </button>
                  ),
                )}
              </div>
              <label>
                <span>{lang === "es" ? "Asunto" : "Subject"}</span>
                <input
                  value={supportForm.subject}
                  maxLength={160}
                  onChange={(e) => {
                    setSentReport(null);
                    setSupportForm({ ...supportForm, subject: e.target.value });
                  }}
                />
              </label>
              <label>
                <span>{lang === "es" ? "Detalles" : "Details"}</span>
                <textarea
                  rows={5}
                  value={supportForm.message}
                  maxLength={5000}
                  onChange={(e) => {
                    setSentReport(null);
                    setSupportForm({ ...supportForm, message: e.target.value });
                  }}
                />
              </label>
              <button
                type="button"
                className="secondary-button"
                disabled={
                  report.isPending ||
                  !supportForm.subject.trim() ||
                  !supportForm.message.trim()
                }
                onClick={() => report.mutate()}
              >
                {report.isPending
                  ? lang === "es"
                    ? "Enviando…"
                    : "Sending…"
                  : lang === "es"
                    ? "Enviar reporte"
                    : "Send report"}
              </button>
              {sentReport && (
                <p className="status success" role="status">
                  <CheckIcon />
                  {lang === "es"
                    ? `Enviado · reporte #${sentReport.id}`
                    : `Sent · report #${sentReport.id}`}
                </p>
              )}
              {report.isError && (
                <p className="status error" role="alert">
                  {lang === "es"
                    ? "No se pudo enviar. Inténtalo de nuevo."
                    : "Couldn't send the report. Try again."}
                </p>
              )}
            </fieldset>
          </SettingsAccordion>

          <SettingsAccordion
            title={lang === "es" ? "Calificar la app" : "Rate the app"}
            icon={<Icon><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></Icon>}
          >
            <p className="privacy-note">{lang === "es" ? "Cuéntanos qué funciona bien o qué debemos mejorar usando Atención al cliente arriba." : "Tell us what works well or what needs improvement in Customer support above."}</p>
          </SettingsAccordion>

          <SettingsAccordion
            title={lang === "es" ? "Compartir la app" : "Share the app"}
            icon={<ShareIcon />}
          >
            <p className="privacy-note">{lang === "es" ? "Usa el botón Compartir de Muse para invitar a alguien sin exponer información privada del negocio." : "Use Muse’s Share control to invite someone without exposing private business information."}</p>
          </SettingsAccordion>

          <SettingsAccordion
            title={lang === "es" ? "Invitar y ganar" : "Invite & earn"}
            icon={<Icon><path d="M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7c-1.7 0-3-1.3-3-3h6c0 1.7-1.3 3-3 3z" /></Icon>}
          >
            <ReferralPanel lang={lang} />
          </SettingsAccordion>

          <h2 className="settings-group-title">{lang === "es" ? "Otros" : "Others"}</h2>
          <SettingsAccordion
            title={
              lang === "es" ? "Administrar equipo" : "Manage crew & team"
            }
            icon={
              <Icon>
                <path d="M4 21V9l8-6 8 6v12M9 21v-7h6v7" />
                <path d="M8 10h8" />
              </Icon>
            }
          >
            <div className="settings-heading">
              <p>
                {lang === "es"
                  ? "Bandeja de soporte, usuarios, reglas de automatización y datos guardados. Solo los propietarios pueden entrar."
                  : "Support inbox, users, automation rules, and stored data. Owners only."}
              </p>
            </div>
            <button
              type="button"
              className="admin-launch"
              onClick={() => setScreen({ name: "admin" })}
            >
              <span>
                <strong>
                  {lang === "es"
                    ? "Abrir panel de administración"
                    : "Open admin panel"}
                </strong>
                <small>
                  {lang === "es"
                    ? "Área privada del propietario"
                    : "Private owner area"}
                </small>
              </span>
              <BackIcon />
            </button>
          </SettingsAccordion>
          {auth?.user.isPlatformAdmin && (
            <SettingsAccordion
              title={lang === "es" ? "Administración de la plataforma" : "Platform admin"}
              icon={
                <Icon>
                  <path d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" />
                  <path d="m9 12 2 2 4-4" />
                </Icon>
              }
            >
              <div className="settings-heading">
                <p>
                  {lang === "es"
                    ? "Moderación del Marketplace, usuarios, reembolsos y configuración de la plataforma."
                    : "Marketplace moderation, users, refunds, and platform settings."}
                </p>
              </div>
              <button
                type="button"
                className="admin-launch"
                onClick={() => setScreen({ name: "platformAdmin" })}
              >
                <span>
                  <strong>
                    {lang === "es" ? "Abrir administración" : "Open platform admin"}
                  </strong>
                  <small>
                    {lang === "es"
                      ? "Solo administradores de la plataforma"
                      : "Platform administrators only"}
                  </small>
                </span>
                <BackIcon />
              </button>
            </SettingsAccordion>
          )}

          <SettingsAccordion
            title={lang === "es" ? "Acerca de" : "About"}
            icon={
              <Icon>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 11v6M12 7h.01" />
              </Icon>
            }
          >
            <div className="settings-heading">
              <p>
                {lang === "es"
                  ? "Herramientas de campo y oficina para contratistas."
                  : "Field and office tools for contractors."}
              </p>
            </div>
            <div className="app-info-section">
              <dl>
                <div>
                  <dt>{lang === "es" ? "Aplicación" : "App"}</dt>
                  <dd>{APP_INFO.name}</dd>
                </div>
                <div>
                  <dt>{lang === "es" ? "Versión" : "Version"}</dt>
                  <dd>{APP_INFO.version}</dd>
                </div>
                <div>
                  <dt>{lang === "es" ? "Año" : "Year"}</dt>
                  <dd>{APP_INFO.releaseYear}</dd>
                </div>
                <div>
                  <dt>{lang === "es" ? "Desarrollador" : "Developer"}</dt>
                  <dd>{APP_INFO.developer}</dd>
                </div>
              </dl>
              <p>
                {lang === "es"
                  ? "Crewkat reúne trabajos, clientes, cotizaciones, facturas, fotos, comprobantes, calendario, prospectos y recordatorios en un solo lugar para el equipo."
                  : "Crewkat brings jobs, clients, quotes, invoices, photos, proof packets, scheduling, leads, and reminders together for the crew."}
              </p>
              <nav className="legal-nav-list" aria-label={lang === "es" ? "Documentos legales" : "Legal documents"}>
                <button type="button" onClick={() => setScreen({ name: "legal", document: "terms" })}><span>{lang === "es" ? "Términos de servicio" : "Terms of Service"}</span><BackIcon /></button>
                <button type="button" onClick={() => setScreen({ name: "legal", document: "privacy" })}><span>{lang === "es" ? "Política de privacidad" : "Privacy Policy"}</span><BackIcon /></button>
                <button type="button" onClick={() => setScreen({ name: "legal", document: "marketplace" })}><span>{lang === "es" ? "Términos del Marketplace" : "Marketplace Terms of Use"}</span><BackIcon /></button>
              </nav>
            </div>
          </SettingsAccordion>
        </div>
        </SettingsAccordionContext.Provider>
        <button
          className="primary-button sticky-submit"
          disabled={saving || logo.isPending}
        >
          {saving || logo.isPending ? t.saving : t.save}
        </button>
      </form>
    </main>
  );
}

type AdminTab = "inbox" | "users" | "parameters" | "data";
type AdminData = ApiResponse<typeof api, "getAdminConsole">;
type AdminParameters = AdminData["parameters"];
const ADMIN_DEFAULTS: AdminParameters = {
  paymentDay1: 3,
  paymentDay2: 14,
  paymentDay3: 30,
  reviewDelayDays: 1,
  reengagementMonth1: 6,
  reengagementMonth2: 12,
  quoteExpiryWarningDays: 3,
  materialLeadTimeDays: 14,
  defaultTaxRate: "0",
  hourlyLaborCost: "0",
};

type PlatformAdminTab = "queue" | "users" | "refunds" | "settings" | "audit";

function PlatformAdminScreen({ lang, onBack, setScreen, initialTab, initialRefundEmail }: { lang: Lang; onBack: () => void; setScreen: (screen: Screen) => void; initialTab?: PlatformAdminTab; initialRefundEmail?: string }) {
  const auth = useContext(AuthContext);
  const [tab, setTab] = useState<PlatformAdminTab>(initialTab ?? "queue");
  const [refundEmail, setRefundEmail] = useState(initialRefundEmail ?? "");
  useEffect(() => { if (initialTab) setTab(initialTab); }, [initialTab]);
  useEffect(() => { if (initialRefundEmail !== undefined) setRefundEmail(initialRefundEmail); }, [initialRefundEmail]);
  const t = lang === "es"
    ? { title: "Administración de la plataforma", denied: "No disponible", deniedBody: "Esta área es solo para administradores de la plataforma.", queue: "Moderación", users: "Usuarios", refunds: "Reembolsos", settings: "Ajustes", audit: "Registro" }
    : { title: "Platform admin", denied: "Not available", deniedBody: "This area is for platform administrators only.", queue: "Moderation", users: "Users", refunds: "Refunds", settings: "Settings", audit: "Audit log" };
  if (!auth?.user.isPlatformAdmin) {
    return <main className="page"><PageHeader lang={lang} title={t.title} onBack={onBack} /><div className="market-empty"><h2>{t.denied}</h2><p>{t.deniedBody}</p></div></main>;
  }
  return <main className="page pa-page">
    <PageHeader lang={lang} title={t.title} onBack={onBack} />
    <nav className="pa-tabs" aria-label={t.title}>
      {(["queue", "users", "refunds", "settings", "audit"] as PlatformAdminTab[]).map((value) => (
        <button key={value} type="button" className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{t[value]}</button>
      ))}
    </nav>
    {tab === "queue" && <PAQueueTab lang={lang} />}
    {tab === "users" && <PAUsersTab lang={lang} setScreen={setScreen} />}
    {tab === "refunds" && <PARefundsTab lang={lang} initialEmail={refundEmail} />}
    {tab === "settings" && <PASettingsTab lang={lang} />}
    {tab === "audit" && <PAAuditTab lang={lang} />}
  </main>;
}

function PAQueueTab({ lang }: { lang: Lang }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["pa-queue"], queryFn: () => api.adminModerationQueue({}) });
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [confirm, setConfirm] = useState<{ id: number; title: string } | null>(null);
  const [error, setError] = useState("");
  const decide = useMutation({
    mutationFn: (args: { listingId: number; decision: "approve" | "remove"; note: string }) => api.adminListingDecision(args),
    onSuccess: async () => { setConfirm(null); setError(""); await Promise.all([qc.invalidateQueries({ queryKey: ["pa-queue"] }), qc.invalidateQueries({ queryKey: ["marketplace-listings"] })]); },
    onError: (caught) => setError(actionErrorMessage(caught)),
  });
  const t = lang === "es"
    ? { loading: "Cargando…", empty: "No hay publicaciones por revisar.", emptyBody: "Las publicaciones rechazadas automáticamente o reportadas aparecerán aquí.", loadError: "No se pudo cargar la cola de moderación.", retry: "Reintentar", note: "Nota (opcional)", approve: "Aprobar", remove: "Eliminar", removeTitle: "¿Eliminar esta publicación?", removeBody: "Se ocultará del Marketplace y no podrá volver a publicarse sin revisión.", cancel: "Cancelar", confirmRemove: "Eliminar publicación", reports: "reportes", autoRejected: "Rechazo automático", pendingReview: "En revisión", by: "por" }
    : { loading: "Loading…", empty: "Nothing to review.", emptyBody: "Auto-rejected or reported listings will appear here.", loadError: "Could not load the moderation queue.", retry: "Retry", note: "Note (optional)", approve: "Approve", remove: "Remove", removeTitle: "Remove this listing?", removeBody: "It will be hidden from the Marketplace.", cancel: "Cancel", confirmRemove: "Remove listing", reports: "reports", autoRejected: "Auto-rejected", pendingReview: "Pending review", by: "by" };
  if (query.isLoading) return <div className="loading-block" aria-label={t.loading} />;
  if (query.isError) return <div className="market-empty"><h2>{t.loadError}</h2><p>{actionErrorMessage(query.error)}</p><button type="button" className="primary-button" onClick={() => query.refetch()}>{t.retry}</button></div>;
  const items = query.data?.queue ?? [];
  if (!items.length) return <div className="market-empty"><h2>{t.empty}</h2><p>{t.emptyBody}</p></div>;
  return <div className="pa-list">
    {error && <p className="status error">{error}</p>}
    {items.map(({ listing, flags }) => (
      <article key={listing.id} className="pa-card">
        <div className="pa-card-head">
          <div><h3>{listing.title}</h3><small>{t.by} {listing.companyName} · {new Date(listing.createdAt).toLocaleDateString(lang === "es" ? "es-US" : "en-US")}</small></div>
          <span className={`pa-badge ${listing.moderationStatus}`}>{listing.moderationStatus === "auto_rejected" ? t.autoRejected : t.pendingReview}</span>
        </div>
        {listing.description && <p className="pa-desc">{listing.description}</p>}
        {listing.moderationReason && <p className="pa-reason"><strong>{lang === "es" ? "Motivo:" : "Reason:"}</strong> {listing.moderationReason}</p>}
        {flags.length > 0 && <div className="pa-flags"><strong>{flags.length} {t.reports}</strong>{flags.map((flag) => (
          <div key={flag.id} className="pa-flag"><span className="pa-flag-reason">{flag.reason}</span><span>{flag.reporterCompanyName} · {new Date(flag.createdAt).toLocaleDateString(lang === "es" ? "es-US" : "en-US")}</span>{flag.details && <p>{flag.details}</p>}</div>
        ))}</div>}
        <label className="pa-note"><span>{t.note}</span><input value={notes[listing.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [listing.id]: event.target.value }))} maxLength={500} /></label>
        <div className="pa-actions">
          <button type="button" className="primary-button" disabled={decide.isPending} onClick={() => decide.mutate({ listingId: listing.id, decision: "approve", note: notes[listing.id] ?? "" })}>{t.approve}</button>
          <button type="button" className="danger-button" disabled={decide.isPending} onClick={() => setConfirm({ id: listing.id, title: listing.title })}>{t.remove}</button>
        </div>
      </article>
    ))}
    {confirm && <div className="sheet-backdrop" onClick={() => !decide.isPending && setConfirm(null)}><section className="more-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" /><h2>{t.removeTitle}</h2><strong>{confirm.title}</strong><p>{t.removeBody}</p>
      <div className="delete-sheet-actions"><button type="button" disabled={decide.isPending} onClick={() => setConfirm(null)}>{t.cancel}</button><button type="button" className="danger-button" disabled={decide.isPending} onClick={() => decide.mutate({ listingId: confirm.id, decision: "remove", note: notes[confirm.id] ?? "" })}>{t.confirmRemove}</button></div>
    </section></div>}
  </div>;
}

function PAUsersTab({ lang, setScreen }: { lang: Lang; setScreen: (screen: Screen) => void }) {
  const qc = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = window.setTimeout(() => { setSearch(searchInput); setPage(1); }, 500); return () => window.clearTimeout(timer); }, [searchInput]);
  const query = useQuery({ queryKey: ["pa-users", search, page], queryFn: () => api.adminUsersList({ search, page, pageSize: 20 }) });
  const [confirm, setConfirm] = useState<{ id: number; name: string; email: string; suspend: boolean } | null>(null);
  const [error, setError] = useState("");
  const toggle = useMutation({
    mutationFn: (args: { id: number; suspend: boolean }) => args.suspend ? api.adminUserSuspend({ userId: args.id }) : api.adminUserUnsuspend({ userId: args.id }),
    onSuccess: async () => { setConfirm(null); setError(""); await qc.invalidateQueries({ queryKey: ["pa-users"] }); },
    onError: (caught) => setError(actionErrorMessage(caught)),
  });
  const t = lang === "es"
    ? { search: "Buscar por nombre o correo…", loading: "Cargando…", empty: "Sin resultados.", loadError: "No se pudieron cargar los usuarios.", retry: "Reintentar", suspended: "Suspendido", admin: "Admin", active: "Activo", suspend: "Suspender", unsuspend: "Reactivar", suspendTitle: "¿Suspender esta cuenta?", suspendBody: "Se cerrarán todas sus sesiones de inmediato y no podrá iniciar sesión.", unsuspendTitle: "¿Reactivar esta cuenta?", unsuspendBody: "Podrá volver a iniciar sesión.", cancel: "Cancelar", confirmSuspend: "Suspender cuenta", confirmUnsuspend: "Reactivar cuenta", prev: "Anterior", next: "Siguiente", of: "de", open: "Abrir ficha del usuario" }
    : { search: "Search by name or email…", loading: "Loading…", empty: "No results.", loadError: "Could not load users.", retry: "Retry", suspended: "Suspended", admin: "Admin", active: "Active", suspend: "Suspend", unsuspend: "Unsuspend", suspendTitle: "Suspend this account?", suspendBody: "All of their sessions will be revoked immediately and they won't be able to sign in.", unsuspendTitle: "Unsuspend this account?", unsuspendBody: "They will be able to sign in again.", cancel: "Cancel", confirmSuspend: "Suspend account", confirmUnsuspend: "Unsuspend account", prev: "Previous", next: "Next", of: "of", open: "Open user details" };
  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <div className="pa-list">
    <label className="pa-search"><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={t.search} aria-label={t.search} /></label>
    {error && <p className="status error">{error}</p>}
    {query.isLoading ? <div className="loading-block" aria-label={t.loading} /> : query.isError ? <div className="market-empty"><h2>{t.loadError}</h2><p>{actionErrorMessage(query.error)}</p><button type="button" className="primary-button" onClick={() => query.refetch()}>{t.retry}</button></div> : !data?.users.length ? <div className="market-empty"><h2>{t.empty}</h2></div> : <>
      {data.users.map((user) => (
        <article key={user.id} className="pa-card pa-user pa-user-clickable" onClick={() => setScreen({ name: "platformAdminUser", userId: user.id })} role="button" tabIndex={0} aria-label={`${t.open}: ${user.name}`} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setScreen({ name: "platformAdminUser", userId: user.id }); } }}>
          <div className="pa-card-head"><div><h3>{user.name}</h3><small>{user.email}</small><small>{user.companyName} · {user.tier}{user.subscriptionStatus !== "inactive" ? ` · ${user.subscriptionStatus}` : ""}</small></div>
            <span className={`pa-badge ${user.suspended ? "suspended" : "active"}`}>{user.suspended ? t.suspended : t.active}</span></div>
          {user.isPlatformAdmin && <p className="pa-reason"><strong>{t.admin}</strong></p>}
          {!user.isPlatformAdmin && (user.suspended
            ? <div className="pa-actions"><button type="button" className="primary-button" disabled={toggle.isPending} onClick={(event) => { event.stopPropagation(); setConfirm({ id: user.id, name: user.name, email: user.email, suspend: false }); }}>{t.unsuspend}</button></div>
            : <div className="pa-actions"><button type="button" className="danger-button" disabled={toggle.isPending} onClick={(event) => { event.stopPropagation(); setConfirm({ id: user.id, name: user.name, email: user.email, suspend: true }); }}>{t.suspend}</button></div>)}
        </article>
      ))}
      <div className="pa-pager"><button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t.prev}</button><span>{page} {t.of} {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{t.next}</button></div>
    </>}
    {confirm && <div className="sheet-backdrop" onClick={() => !toggle.isPending && setConfirm(null)}><section className="more-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" /><h2>{confirm.suspend ? t.suspendTitle : t.unsuspendTitle}</h2><strong>{confirm.name}</strong><p>{confirm.email}</p><p>{confirm.suspend ? t.suspendBody : t.unsuspendBody}</p>
      <div className="delete-sheet-actions"><button type="button" disabled={toggle.isPending} onClick={() => setConfirm(null)}>{t.cancel}</button><button type="button" className={confirm.suspend ? "danger-button" : "primary-button"} disabled={toggle.isPending} onClick={() => toggle.mutate({ id: confirm.id, suspend: confirm.suspend })}>{confirm.suspend ? t.confirmSuspend : t.confirmUnsuspend}</button></div>
    </section></div>}
  </div>;
}

function PAUserDetailScreen({ lang, userId, onBack, setScreen }: { lang: Lang; userId: number; onBack: () => void; setScreen: (screen: Screen) => void }) {
  const auth = useContext(AuthContext);
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["pa-user-detail", userId], queryFn: () => api.adminUserDetail({ userId }) });
  const [confirm, setConfirm] = useState<null | { kind: "suspend" } | { kind: "revokeSessions" } | { kind: "tier"; to: "free" | "premium" }>(null);
  const [error, setError] = useState("");
  const runAction = useMutation({
    mutationFn: async (kind: NonNullable<typeof confirm>) => {
      if (!kind) return;
      if (kind.kind === "suspend") {
        const u = query.data?.user;
        if (u?.suspended) await api.adminUserUnsuspend({ userId });
        else await api.adminUserSuspend({ userId });
      } else if (kind.kind === "revokeSessions") await api.adminUserRevokeSessions({ userId });
      else await api.adminUserSetTier({ userId, tier: kind.to });
    },
    onSuccess: async () => { setConfirm(null); setError(""); await Promise.all([qc.invalidateQueries({ queryKey: ["pa-user-detail", userId] }), qc.invalidateQueries({ queryKey: ["pa-users"] })]); },
    onError: (caught) => { setConfirm(null); setError(actionErrorMessage(caught)); },
  });
  const t = lang === "es"
    ? { title: "Ficha del usuario", loading: "Cargando…", loadError: "No se pudo cargar el usuario.", retry: "Reintentar", notAdmin: "No disponible", notAdminBody: "Esta área es solo para administradores de la plataforma.",
        account: "Cuenta", subscription: "Suscripción", sessions: "Sesiones activas", listings: "Publicaciones", flagsFiled: "Reportes enviados", history: "Historial de administración",
        id: "ID", name: "Nombre", email: "Correo", company: "Empresa", companyId: "ID de empresa", created: "Creado", updated: "Actualizado",
        emailVerified: "Correo verificado", yes: "Sí", no: "No", terms: "Términos del Marketplace", termsNone: "No aceptados",
        tier: "Plan", status: "Estado de suscripción", stripeCustomer: "Cliente de Stripe", stripeSub: "Suscripción de Stripe", periodEnd: "Fin del período actual", cancelAtEnd: "Se cancela al final del período", none: "—",
        suspended: "Suspendido", active: "Activo", suspendedAt: "Suspendido el", admin: "Admin de plataforma", platformAdmin: "Administrador de plataforma",
        suspend: "Suspender", unsuspend: "Reactivar", revokeSessions: "Cerrar sesiones", makePremium: "Dar Premium", revokePremium: "Quitar Premium", issueRefund: "Emitir reembolso",
        suspendTitle: "¿Suspender esta cuenta?", suspendBody: "Se cerrarán todas sus sesiones de inmediato y no podrá iniciar sesión.", unsuspendTitle: "¿Reactivar esta cuenta?", unsuspendBody: "Podrá volver a iniciar sesión.",
        revokeTitle: "¿Cerrar todas las sesiones?", revokeBody: "El usuario tendrá que volver a iniciar sesión en todos sus dispositivos.",
        tierTitle: "¿Cambiar el plan?", tierToPremiumBody: "El usuario tendrá Premium sin pasar por Stripe. Quedará registrado en la auditoría.", tierToFreeBody: "El usuario volverá al plan gratis. Si tiene una suscripción de Stripe activa, cancélala en Stripe para no seguir cobrando.",
        stripeWarning: "Tiene suscripción de Stripe: cambia el plan en Stripe para no seguir cobrando.",
        cancel: "Cancelar", confirmBtn: "Confirmar", lastSeen: "Última actividad", noSessions: "Sin sesiones activas.", noListings: "Sin publicaciones.", noFlags: "No ha enviado reportes.", noHistory: "Sin actividad registrada.", flags: "reportes", premium: "Premium", free: "Gratis" }
    : { title: "User details", loading: "Loading…", loadError: "Could not load the user.", retry: "Retry", notAdmin: "Not available", notAdminBody: "This area is for platform administrators only.",
        account: "Account", subscription: "Subscription", sessions: "Active sessions", listings: "Listings", flagsFiled: "Reports filed", history: "Admin history",
        id: "ID", name: "Name", email: "Email", company: "Company", companyId: "Company ID", created: "Created", updated: "Updated",
        emailVerified: "Email verified", yes: "Yes", no: "No", terms: "Marketplace Terms", termsNone: "Not accepted",
        tier: "Plan", status: "Subscription status", stripeCustomer: "Stripe customer", stripeSub: "Stripe subscription", periodEnd: "Current period ends", cancelAtEnd: "Cancels at period end", none: "—",
        suspended: "Suspended", active: "Active", suspendedAt: "Suspended at", admin: "Platform admin", platformAdmin: "Platform administrator",
        suspend: "Suspend", unsuspend: "Unsuspend", revokeSessions: "Revoke sessions", makePremium: "Grant Premium", revokePremium: "Revoke Premium", issueRefund: "Issue refund",
        suspendTitle: "Suspend this account?", suspendBody: "All of their sessions will be revoked immediately and they won't be able to sign in.", unsuspendTitle: "Unsuspend this account?", unsuspendBody: "They will be able to sign in again.",
        revokeTitle: "Revoke all sessions?", revokeBody: "The user will have to sign in again on all their devices.",
        tierTitle: "Change plan?", tierToPremiumBody: "The user will get Premium without going through Stripe. This is recorded in the audit log.", tierToFreeBody: "The user will go back to the free plan. If they have an active Stripe subscription, cancel it in Stripe so billing stops.",
        stripeWarning: "Has an active Stripe subscription — change the plan in Stripe so billing stops.",
        cancel: "Cancel", confirmBtn: "Confirm", lastSeen: "Last seen", noSessions: "No active sessions.", noListings: "No listings.", noFlags: "No reports filed.", noHistory: "No recorded activity.", flags: "flags", premium: "Premium", free: "Free" };
  if (!auth?.user.isPlatformAdmin) {
    return <main className="page"><PageHeader lang={lang} title={t.title} onBack={onBack} /><div className="market-empty"><h2>{t.notAdmin}</h2><p>{t.notAdminBody}</p></div></main>;
  }
  const fmtDate = (iso: string) => new Date(iso).toLocaleString(lang === "es" ? "es-US" : "en-US");
  const confirmTitle = !confirm ? "" : confirm.kind === "suspend" ? (query.data?.user.suspended ? t.unsuspendTitle : t.suspendTitle) : confirm.kind === "revokeSessions" ? t.revokeTitle : t.tierTitle;
  const confirmBody = !confirm ? "" : confirm.kind === "suspend" ? (query.data?.user.suspended ? t.unsuspendBody : t.suspendBody) : confirm.kind === "revokeSessions" ? t.revokeBody : confirm.to === "premium" ? t.tierToPremiumBody : t.tierToFreeBody;
  return <main className="page pa-page pa-user-detail">
    <PageHeader lang={lang} title={t.title} onBack={onBack} />
    <div className="pa-list">
      {error && <p className="status error">{error}</p>}
      {query.isLoading ? <div className="loading-block" aria-label={t.loading} /> : query.isError || !query.data ? <div className="market-empty"><h2>{t.loadError}</h2><p>{query.isError ? actionErrorMessage(query.error) : ""}</p><button type="button" className="primary-button" onClick={() => query.refetch()}>{t.retry}</button></div> : (() => {
        const { user, listings, flagsFiled, sessions, audit } = query.data;
        const isSelf = auth.user.id === user.id;
        return <>
          <article className="pa-card">
            <div className="pa-card-head"><div><h3>{user.name}</h3><small>{user.email}</small></div>
              <span className={`pa-badge ${user.suspended ? "suspended" : "active"}`}>{user.suspended ? t.suspended : t.active}</span></div>
            <div className="pa-badges-row">{user.isPlatformAdmin && <span className="pa-badge admin">{t.platformAdmin}</span>}<span className={`pa-badge ${user.tier === "premium" ? "premium" : ""}`}>{user.tier === "premium" ? t.premium : t.free}</span></div>
            {!isSelf && <div className="pa-actions">
              {user.suspended
                ? <button type="button" className="primary-button" disabled={runAction.isPending} onClick={() => setConfirm({ kind: "suspend" })}>{t.unsuspend}</button>
                : <button type="button" className="danger-button" disabled={runAction.isPending} onClick={() => setConfirm({ kind: "suspend" })}>{t.suspend}</button>}
              <button type="button" className="secondary-button" disabled={runAction.isPending} onClick={() => setConfirm({ kind: "revokeSessions" })}>{t.revokeSessions}</button>
              {user.tier === "premium"
                ? <button type="button" className="secondary-button" disabled={runAction.isPending} onClick={() => setConfirm({ kind: "tier", to: "free" })}>{t.revokePremium}</button>
                : <button type="button" className="secondary-button" disabled={runAction.isPending} onClick={() => setConfirm({ kind: "tier", to: "premium" })}>{t.makePremium}</button>}
              <button type="button" className="secondary-button" onClick={() => setScreen({ name: "platformAdmin", tab: "refunds", refundEmail: user.email })}>{t.issueRefund}</button>
            </div>}
          </article>
          <article className="pa-card"><h3>{t.account}</h3>
            <dl className="pa-dl">
              <div><dt>{t.id}</dt><dd>{user.id}</dd></div>
              <div><dt>{t.name}</dt><dd>{user.name}</dd></div>
              <div><dt>{t.email}</dt><dd>{user.email}</dd></div>
              <div><dt>{t.company}</dt><dd>{user.companyName || t.none} ({t.companyId} {user.companyId})</dd></div>
              <div><dt>{t.created}</dt><dd>{fmtDate(user.createdAt)}</dd></div>
              <div><dt>{t.updated}</dt><dd>{fmtDate(user.updatedAt)}</dd></div>
              <div><dt>{t.emailVerified}</dt><dd>{user.emailVerifiedAt ? fmtDate(user.emailVerifiedAt) : t.no}</dd></div>
              <div><dt>{t.terms}</dt><dd>{user.marketplaceTermsAcceptedAt ? `${user.marketplaceTermsVersion ?? ""} · ${fmtDate(user.marketplaceTermsAcceptedAt)}` : t.termsNone}</dd></div>
              {user.suspendedAt && <div><dt>{t.suspendedAt}</dt><dd>{fmtDate(user.suspendedAt)}</dd></div>}
            </dl>
          </article>
          <article className="pa-card"><h3>{t.subscription}</h3>
            <dl className="pa-dl">
              <div><dt>{t.tier}</dt><dd>{user.tier === "premium" ? t.premium : t.free}</dd></div>
              <div><dt>{t.status}</dt><dd>{user.subscriptionStatus}</dd></div>
              {user.subscriptionCurrentPeriodEnd && <div><dt>{t.periodEnd}</dt><dd>{fmtDate(user.subscriptionCurrentPeriodEnd)}</dd></div>}
              {user.cancelAtPeriodEnd && <div><dt>{t.cancelAtEnd}</dt><dd>{t.yes}</dd></div>}
              <div><dt>{t.stripeCustomer}</dt><dd className="mono">{user.stripeCustomerId ?? t.none}</dd></div>
              <div><dt>{t.stripeSub}</dt><dd className="mono">{user.stripeSubscriptionId ?? t.none}</dd></div>
            </dl>
            {user.stripeSubscriptionId && <p className="status error">{t.stripeWarning}</p>}
          </article>
          <article className="pa-card"><h3>{t.sessions} ({sessions.length})</h3>
            {sessions.length ? sessions.map((s) => (
              <div key={s.id} className="pa-row"><div><strong>#{s.id}</strong><small>{s.userAgent || t.none}</small></div><small>{t.lastSeen}: {fmtDate(s.lastSeenAt)}</small></div>
            )) : <p className="pa-desc">{t.noSessions}</p>}
          </article>
          <article className="pa-card"><h3>{t.listings} ({listings.length})</h3>
            {listings.length ? listings.map((l) => (
              <div key={l.id} className="pa-row"><div><strong>#{l.id} {l.title}</strong><small>{l.moderationStatus}{l.flagCount > 0 ? ` · ${l.flagCount} ${t.flags}` : ""}</small></div><small>{fmtDate(l.createdAt)}</small></div>
            )) : <p className="pa-desc">{t.noListings}</p>}
          </article>
          <article className="pa-card"><h3>{t.flagsFiled} ({flagsFiled.count})</h3>
            {flagsFiled.recent.length ? flagsFiled.recent.map((f) => (
              <div key={f.id} className="pa-row"><div><strong>#{f.listingId} {f.listingTitle}</strong><small>{f.reason} · {fmtDate(f.createdAt)}</small></div></div>
            )) : <p className="pa-desc">{t.noFlags}</p>}
          </article>
          <article className="pa-card"><h3>{t.history}</h3>
            {audit.length ? audit.map((a) => (
              <div key={a.id} className="pa-row"><div><strong>{a.action}</strong><small>{a.adminName} · {fmtDate(a.createdAt)}</small>{a.details && <small>{a.details}</small>}</div></div>
            )) : <p className="pa-desc">{t.noHistory}</p>}
          </article>
        </>;
      })()}
    </div>
    {confirm && <div className="sheet-backdrop" onClick={() => !runAction.isPending && setConfirm(null)}><section className="more-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" /><h2>{confirmTitle}</h2><p>{confirmBody}</p>
      <div className="delete-sheet-actions"><button type="button" disabled={runAction.isPending} onClick={() => setConfirm(null)}>{t.cancel}</button><button type="button" className={confirm.kind === "suspend" && !query.data?.user.suspended ? "danger-button" : "primary-button"} disabled={runAction.isPending} onClick={() => runAction.mutate(confirm)}>{t.confirmBtn}</button></div>
    </section></div>}
  </main>;
}

function PARefundsTab({ lang, initialEmail }: { lang: Lang; initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail ?? "");
  useEffect(() => { if (initialEmail !== undefined) setEmail(initialEmail); }, [initialEmail]);
  const [result, setResult] = useState<ApiResponse<typeof api, "adminRefundPreview"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<{ chargeId: string; amountCents?: number; label: string } | null>(null);
  const [done, setDone] = useState("");
  const lookup = async () => {
    setBusy(true); setError(""); setDone(""); setResult(null);
    try { setResult(await api.adminRefundPreview({ email })); }
    catch (caught) { setError(actionErrorMessage(caught)); }
    finally { setBusy(false); }
  };
  const refund = useMutation({
    mutationFn: (args: { chargeId: string; amountCents?: number; reason: string }) => api.adminRefund(args),
    onSuccess: async (data) => { setConfirm(null); setDone(`${(data.amount / 100).toFixed(2)} ${data.currency.toUpperCase()} — ${data.status}`); setError(""); await lookup(); },
    onError: (caught) => setError(actionErrorMessage(caught)),
  });
  const t = lang === "es"
    ? { email: "Correo del cliente", lookup: "Buscar cargos", looking: "Buscando…", noUser: "No hay cuenta con ese correo.", noCharges: "Sin cargos en Stripe para este cliente.", amount: "Monto USD (vacío = total)", refund: "Reembolsar", refundTitle: "¿Emitir reembolso?", cancel: "Cancelar", confirmRefund: "Emitir reembolso", refunded: "Restante por reembolsar", done: "Reembolso emitido:" }
    : { email: "Customer email", lookup: "Look up charges", looking: "Looking up…", noUser: "No account found with that email.", noCharges: "No Stripe charges for this customer.", amount: "Amount USD (blank = full)", refund: "Refund", refundTitle: "Issue refund?", cancel: "Cancel", confirmRefund: "Issue refund", refunded: "Refundable left", done: "Refund issued:" };
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return <div className="pa-list">
    <div className="pa-search-row"><label><span>{t.email}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") lookup(); }} /></label><button type="button" className="primary-button" disabled={busy || !email.trim()} onClick={lookup}>{busy ? t.looking : t.lookup}</button></div>
    {error && <p className="status error">{error}</p>}
    {done && <p className="status auth-success">{t.done} {done}</p>}
    {result && !result.user && <div className="market-empty"><h2>{t.noUser}</h2></div>}
    {result?.user && !result.charges.length && <div className="market-empty"><h2>{t.noCharges}</h2><p>{result.user.name} · {result.user.email}</p></div>}
    {(result?.charges.length ?? 0) > 0 && result?.user && <p className="pa-customer">{result.user.name} · {result.user.email}</p>}
    {result?.charges.map((charge) => {
      const refundable = charge.amount - charge.amountRefunded;
      const amountInput = (amounts[charge.id] ?? "").trim();
      const amountCents = amountInput ? Math.round(Number(amountInput) * 100) : undefined;
      return <article key={charge.id} className="pa-card">
        <div className="pa-card-head"><div><h3>{money(charge.amount)} {charge.currency.toUpperCase()}</h3><small>{new Date(charge.created * 1000).toLocaleDateString(lang === "es" ? "es-US" : "en-US")} · {charge.status}{charge.description ? ` · ${charge.description}` : ""}</small><small className="mono">{charge.id}</small></div></div>
        <p className="pa-reason">{t.refunded}: <strong>{money(refundable)}</strong></p>
        {refundable > 0 && <div className="pa-refund-row"><label><span>{t.amount}</span><input inputMode="decimal" placeholder={money(refundable)} value={amounts[charge.id] ?? ""} onChange={(event) => setAmounts((current) => ({ ...current, [charge.id]: event.target.value }))} /></label>
        <button type="button" className="danger-button" disabled={refund.isPending} onClick={() => {
          if (amountCents !== undefined && (!Number.isFinite(amountCents) || amountCents <= 0)) { setError(lang === "es" ? "Monto inválido." : "Invalid amount."); return; }
          setConfirm({ chargeId: charge.id, amountCents, label: amountCents ? `${money(amountCents)} ${charge.currency.toUpperCase()}` : `${money(refundable)} ${charge.currency.toUpperCase()} (full)` });
        }}>{t.refund}</button></div>}
      </article>;
    })}
    {confirm && <div className="sheet-backdrop" onClick={() => !refund.isPending && setConfirm(null)}><section className="more-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" /><h2>{t.refundTitle}</h2><strong>{confirm.label}</strong><p className="mono">{confirm.chargeId}</p>
      <div className="delete-sheet-actions"><button type="button" disabled={refund.isPending} onClick={() => setConfirm(null)}>{t.cancel}</button><button type="button" className="danger-button" disabled={refund.isPending} onClick={() => refund.mutate({ chargeId: confirm.chargeId, amountCents: confirm.amountCents, reason: "" })}>{t.confirmRefund}</button></div>
    </section></div>}
  </div>;
}

function PASettingsTab({ lang }: { lang: Lang }) {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["pa-settings"], queryFn: () => api.adminSettingsGet({}) });
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    const d = query.data;
    if (d) {
      const next: Record<string, string> = {};
      for (const def of d.defs) next[def.key] = d.settings[def.key] ?? "";
      setValues(next);
    }
  }, [query.data]);
  const save = useMutation({
    mutationFn: async () => {
      const d = query.data;
      if (!d) throw new Error("Settings are still loading.");
      for (const def of d.defs) {
        const value = values[def.key] ?? "";
        if (def.type === "int") {
          const parsed = Number.parseInt(value.trim(), 10);
          if (!Number.isInteger(parsed) || (def.min !== undefined && parsed < def.min) || (def.max !== undefined && parsed > def.max))
            throw new Error(lang === "es" ? `${def.labelEs}: ingresa un número del ${def.min} al ${def.max}.` : `${def.labelEn}: enter a whole number from ${def.min} to ${def.max}.`);
        }
        if (def.type === "text" && def.maxLength !== undefined && value.trim().length > def.maxLength)
          throw new Error(lang === "es" ? `${def.labelEs}: máximo ${def.maxLength} caracteres.` : `${def.labelEn}: keep it under ${def.maxLength} characters.`);
        await api.adminSettingsSet({ key: def.key, value });
      }
    },
    onSuccess: async () => { setError(""); setSaved(true); window.setTimeout(() => setSaved(false), 2500); await qc.invalidateQueries({ queryKey: ["pa-settings"] }); },
    onError: (caught) => { setError(actionErrorMessage(caught)); setSaved(false); },
  });
  const help: Record<string, { en: string; es: string }> = {
    registration_enabled: { en: "When off, nobody can create a new account.", es: "Si está apagado, nadie puede crear una cuenta nueva." },
    marketplace_enabled: { en: "When off, the Marketplace is hidden and all listing actions are blocked.", es: "Si está apagado, el Marketplace se oculta y todas las acciones se bloquean." },
    announcement_banner: { en: "Shown to every signed-in user at the top of the app. Empty = no banner.", es: "Se muestra a todos los usuarios al inicio de la app. Vacío = sin anuncio." },
    auto_moderation_enabled: { en: "Screen listing text on create and update. Violations are auto-rejected.", es: "Revisar el texto de las publicaciones al crearlas o editarlas. Las que violen las reglas se rechazan automáticamente." },
    flag_threshold: { en: "Reports needed to send a listing to review.", es: "Reportes necesarios para enviar una publicación a revisión." },
    free_listing_limit: { en: "Max active Marketplace listings per company on the free plan. Premium is unlimited.", es: "Máximo de publicaciones activas por empresa en el plan gratis. Premium es ilimitado." },
  };
  const order = ["registration_enabled", "marketplace_enabled", "announcement_banner", "auto_moderation_enabled", "flag_threshold", "free_listing_limit"];
  const t = lang === "es"
    ? { loading: "Cargando…", loadError: "No se pudieron cargar los ajustes.", retry: "Reintentar", save: "Guardar ajustes", saving: "Guardando…", saved: "Ajustes guardados.", on: "Activado", off: "Apagado", bannerPlaceholder: "Escribe el anuncio…" }
    : { loading: "Loading…", loadError: "Could not load settings.", retry: "Retry", save: "Save settings", saving: "Saving…", saved: "Settings saved.", on: "On", off: "Off", bannerPlaceholder: "Type the announcement…" };
  if (query.isLoading) return <div className="loading-block" aria-label={t.loading} />;
  if (query.isError || !query.data) return <div className="market-empty"><h2>{t.loadError}</h2><p>{query.isError ? actionErrorMessage(query.error) : ""}</p><button type="button" className="primary-button" onClick={() => query.refetch()}>{t.retry}</button></div>;
  const defs = query.data.defs.slice().sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return <div className="pa-list">
    {error && <p className="status error">{error}</p>}
    {saved && <p className="status auth-success">{t.saved}</p>}
    {defs.map((def) => {
      const label = lang === "es" ? def.labelEs : def.labelEn;
      const hintEntry = help[def.key];
      const hint = hintEntry ? (lang === "es" ? hintEntry.es : hintEntry.en) : "";
      const value = values[def.key] ?? "";
      return <div className="pa-card" key={def.key}>
        {def.type === "boolean" ? (
          <label className="pa-switch"><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span><input type="checkbox" role="switch" checked={value === "1"} onChange={(event) => setValues((current) => ({ ...current, [def.key]: event.target.checked ? "1" : "0" }))} /></label>
        ) : def.type === "int" ? (
          <label className="pa-field"><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span><input inputMode="numeric" value={value} onChange={(event) => setValues((current) => ({ ...current, [def.key]: event.target.value.replace(/\D/g, "").slice(0, 3) }))} /></label>
        ) : (
          <label className="pa-field"><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span><input value={value} maxLength={def.maxLength ?? 300} placeholder={t.bannerPlaceholder} onChange={(event) => setValues((current) => ({ ...current, [def.key]: event.target.value }))} /></label>
        )}
      </div>;
    })}
    <button type="button" className="primary-button" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? t.saving : t.save}</button>
  </div>;
}

function PAAuditTab({ lang }: { lang: Lang }) {
  const [page, setPage] = useState(1);
  const query = useQuery({ queryKey: ["pa-audit", page], queryFn: () => api.adminAuditLog({ page, pageSize: 25 }) });
  const t = lang === "es"
    ? { loading: "Cargando…", empty: "Sin actividad registrada.", loadError: "No se pudo cargar el registro.", retry: "Reintentar", prev: "Anterior", next: "Siguiente", of: "de" }
    : { loading: "Loading…", empty: "No admin activity yet.", loadError: "Could not load the audit log.", retry: "Retry", prev: "Previous", next: "Next", of: "of" };
  const data = query.data;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  if (query.isLoading) return <div className="loading-block" aria-label={t.loading} />;
  if (query.isError) return <div className="market-empty"><h2>{t.loadError}</h2><p>{actionErrorMessage(query.error)}</p><button type="button" className="primary-button" onClick={() => query.refetch()}>{t.retry}</button></div>;
  if (!data?.entries.length) return <div className="market-empty"><h2>{t.empty}</h2></div>;
  return <div className="pa-list">
    {data.entries.map((entry) => (
      <article key={entry.id} className="pa-card pa-audit">
        <div className="pa-card-head"><div><h3>{entry.action}</h3><small>{entry.adminName} · {new Date(entry.createdAt).toLocaleString(lang === "es" ? "es-US" : "en-US")}</small></div></div>
        {(entry.targetType || entry.targetId) && <p className="pa-reason mono">{entry.targetType}{entry.targetId ? ` #${entry.targetId}` : ""}</p>}
        {entry.details && <p className="pa-desc">{entry.details}</p>}
      </article>
    ))}
    <div className="pa-pager"><button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t.prev}</button><span>{page} {t.of} {totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>{t.next}</button></div>
  </div>;
}

function AdminScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<AdminTab>("inbox");
  const [table, setTable] = useState("jobs");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("open");
  const [opened, setOpened] = useState<number | null>(null);
  const [newUser, setNewUser] = useState({
    name: "",
    role: "crew" as "owner" | "crew",
  });
  const query = useQuery({
    queryKey: ["admin-console", table],
    queryFn: () => api.getAdminConsole({ table }),
  });
  const [parameters, setParameters] = useState<AdminParameters>(ADMIN_DEFAULTS);
  useEffect(() => {
    if (query.data) setParameters(query.data.parameters);
  }, [query.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-console"] });
  const updateReport = useMutation({
    mutationFn: (value: {
      id: number;
      status: "open" | "resolved";
      isUnread: boolean;
    }) => api.updateSupportReport(value),
    onSuccess: refresh,
  });
  const addUser = useMutation({
    mutationFn: () => api.addAppUser(newUser),
    onSuccess: () => {
      setNewUser({ name: "", role: "crew" });
      refresh();
    },
  });
  const updateUser = useMutation({
    mutationFn: (value: {
      id: number;
      role: "owner" | "crew";
      active: boolean;
    }) => api.updateAppUser(value),
    onSuccess: refresh,
  });
  const saveParameters = useMutation({
    mutationFn: (value: AdminParameters) => api.updateAdminParameters(value),
    onSuccess: () => {
      refresh();
      qc.invalidateQueries({ queryKey: ["automation-center"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });
  const data = query.data;
  const labels =
    lang === "es"
      ? {
          title: "Controles del dueño",
          private: "Área privada del propietario",
          inbox: "Bandeja",
          users: "Usuarios",
          parameters: "Parámetros",
          data: "Datos",
          unread: "Sin leer",
          resolved: "Resuelto",
          open: "Abierto",
          all: "Todos",
          markResolved: "Marcar resuelto",
          markOpen: "Reabrir",
          markUnread: "Marcar sin leer",
          add: "Agregar miembro",
          save: "Guardar parámetros",
          reset: "Restablecer valores",
          noInbox: "No hay solicitudes con estos filtros.",
          noRows: "No hay filas guardadas.",
          ownerOnly: "Esta área solo está disponible para propietarios.",
          recent: "Filas recientes",
          rows: "filas",
        }
      : {
          title: "Admin",
          private: "Private owner area",
          inbox: "Inbox",
          users: "Users",
          parameters: "Parameters",
          data: "Data browser",
          unread: "Unread",
          resolved: "Resolved",
          open: "Open",
          all: "All",
          markResolved: "Mark resolved",
          markOpen: "Reopen",
          markUnread: "Mark unread",
          add: "Add team member",
          save: "Save parameters",
          reset: "Reset to defaults",
          noInbox: "No requests match these filters.",
          noRows: "No stored rows yet.",
          ownerOnly: "This area is available to owners only.",
          recent: "Recent rows",
          rows: "rows",
        };
  if (!data)
    return (
      <main className="page admin-page">
        <PageHeader lang={lang} title={labels.title} onBack={onBack} />
        <div className="loading-block" />
      </main>
    );
  if (!data.allowed)
    return (
      <main className="page admin-page">
        <PageHeader lang={lang} title={labels.title} onBack={onBack} />
        <div className="admin-denied">
          <Icon>
            <path d="M6 10V8a6 6 0 0 1 12 0v2M5 10h14v11H5z" />
          </Icon>
          <h2>{labels.ownerOnly}</h2>
        </div>
      </main>
    );
  const inbox = data.inbox.filter(
    (item) =>
      (typeFilter === "all" || item.kind === typeFilter) &&
      (statusFilter === "all" || item.status === statusFilter),
  );
  const activeReport = data.inbox.find((item) => item.id === opened) ?? null;
  const input = (key: keyof AdminParameters, label: string, suffix: string) => (
    <label>
      <span>{label}</span>
      <div className="parameter-input">
        <input
          type={
            key === "defaultTaxRate" || key === "hourlyLaborCost"
              ? "text"
              : "number"
          }
          min="0"
          value={parameters[key]}
          onChange={(e) =>
            setParameters({
              ...parameters,
              [key]:
                typeof parameters[key] === "number"
                  ? Number(e.target.value)
                  : e.target.value,
            })
          }
        />
        <small>{suffix}</small>
      </div>
    </label>
  );
  return (
    <main className="page admin-page">
      <PageHeader lang={lang} title={labels.title} onBack={onBack} />
      <section className="admin-identity">
        <div className="admin-lock">
          <Icon>
            <path d="M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5z" />
          </Icon>
        </div>
        <div>
          <strong>{labels.private}</strong>
          <span>
            {data.currentUser?.name} · {lang === "es" ? "Propietario" : "Owner"}
          </span>
        </div>
      </section>
      <nav className="admin-tabs" aria-label={labels.title}>
        {(["inbox", "users", "parameters", "data"] as const).map((item) => (
          <button
            key={item}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {labels[item]}
            {item === "inbox" &&
              data.inbox.filter((entry) => entry.isUnread).length > 0 && (
                <span>
                  {data.inbox.filter((entry) => entry.isUnread).length}
                </span>
              )}
          </button>
        ))}
      </nav>
      {tab === "inbox" && (
        <section className="admin-section">
          <div className="admin-filters">
            <label>
              <span>{lang === "es" ? "Tipo" : "Type"}</span>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="all">{labels.all}</option>
                <option value="support">
                  {lang === "es" ? "Soporte" : "Support"}
                </option>
                <option value="problem">
                  {lang === "es" ? "Error" : "Bug / error"}
                </option>
                <option value="question">
                  {lang === "es" ? "Pregunta" : "Question"}
                </option>
                <option value="general">
                  {lang === "es" ? "Consulta general" : "General inquiry"}
                </option>
                <option value="feature">
                  {lang === "es" ? "Función" : "Feature"}
                </option>
              </select>
            </label>
            <label>
              <span>{lang === "es" ? "Estado" : "Status"}</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">{labels.all}</option>
                <option value="open">{labels.open}</option>
                <option value="resolved">{labels.resolved}</option>
              </select>
            </label>
          </div>
          <div className="admin-inbox">
            {inbox.map((item) => (
              <button
                key={item.id}
                className={item.isUnread ? "unread" : ""}
                onClick={() => {
                  setOpened(item.id);
                  if (item.isUnread)
                    updateReport.mutate({
                      id: item.id,
                      status: item.status,
                      isUnread: false,
                    });
                }}
              >
                <span className={`inbox-kind kind-${item.kind}`}>
                  {item.kind.replace(
                    "feature",
                    lang === "es" ? "función" : "feature",
                  )}
                </span>
                <strong>{item.subject}</strong>
                <p>{item.message}</p>
                <small>
                  {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(item.createdAt))}{" "}
                  · {item.status === "resolved" ? labels.resolved : labels.open}
                </small>
              </button>
            ))}
            {inbox.length === 0 && (
              <p className="detail-empty">{labels.noInbox}</p>
            )}
          </div>
        </section>
      )}
      {tab === "users" && (
        <section className="admin-section">
          <div className="admin-note">
            <strong>
              {lang === "es" ? "Permisos por función" : "Role permissions"}
            </strong>
            <p>
              {lang === "es"
                ? "Los propietarios ven administración y finanzas. El equipo ve trabajos y herramientas, sin acceso a administración ni finanzas de la empresa."
                : "Owners see admin and company financials. Crew members see jobs and tools, without admin or company-financial access."}
            </p>
          </div>
          <form
            className="admin-user-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (newUser.name.trim()) addUser.mutate();
            }}
          >
            <label>
              <span>{lang === "es" ? "Nombre" : "Name"}</span>
              <input
                value={newUser.name}
                onChange={(e) =>
                  setNewUser({ ...newUser, name: e.target.value })
                }
              />
            </label>
            <label>
              <span>{lang === "es" ? "Función" : "Role"}</span>
              <select
                value={newUser.role}
                onChange={(e) =>
                  setNewUser({
                    ...newUser,
                    role: e.target.value as "owner" | "crew",
                  })
                }
              >
                <option value="crew">
                  {lang === "es" ? "Equipo" : "Crew"}
                </option>
                <option value="owner">
                  {lang === "es" ? "Propietario" : "Owner"}
                </option>
              </select>
            </label>
            <button
              className="primary-button"
              disabled={addUser.isPending || !newUser.name.trim()}
            >
              {labels.add}
            </button>
          </form>
          <div className="admin-users">
            {data.users.map((user) => (
              <article key={user.id}>
                <div>
                  <strong>
                    {user.name}
                    {user.isCurrent
                      ? ` · ${lang === "es" ? "Actual" : "Current"}`
                      : ""}
                  </strong>
                  <small>
                    {user.active
                      ? lang === "es"
                        ? "Activo"
                        : "Active"
                      : lang === "es"
                        ? "Inactivo"
                        : "Inactive"}
                  </small>
                </div>
                <select
                  aria-label={`${user.name} ${lang === "es" ? "función" : "role"}`}
                  value={user.role}
                  disabled={user.isCurrent}
                  onChange={(e) =>
                    updateUser.mutate({
                      id: user.id,
                      role: e.target.value as "owner" | "crew",
                      active: user.active,
                    })
                  }
                >
                  <option value="owner">
                    {lang === "es" ? "Propietario" : "Owner"}
                  </option>
                  <option value="crew">
                    {lang === "es" ? "Equipo" : "Crew"}
                  </option>
                </select>
                {!user.isCurrent && (
                  <button
                    onClick={() =>
                      updateUser.mutate({
                        id: user.id,
                        role: user.role,
                        active: !user.active,
                      })
                    }
                  >
                    {user.active
                      ? lang === "es"
                        ? "Desactivar"
                        : "Deactivate"
                      : lang === "es"
                        ? "Activar"
                        : "Activate"}
                  </button>
                )}
              </article>
            ))}
          </div>
        </section>
      )}
      {tab === "parameters" && (
        <section className="admin-section">
          <div className="admin-note">
            <strong>
              {lang === "es" ? "Reglas activas" : "Live automation rules"}
            </strong>
            <p>
              {lang === "es"
                ? "Los cambios se usan de inmediato en Hoy, alertas y nuevos documentos."
                : "Changes take effect immediately in Today, alerts, and new documents."}
            </p>
          </div>
          <div className="parameter-grid">
            {input(
              "paymentDay1",
              lang === "es" ? "Primer aviso de pago" : "First payment reminder",
              "days",
            )}
            {input(
              "paymentDay2",
              lang === "es"
                ? "Segundo aviso de pago"
                : "Second payment reminder",
              "days",
            )}
            {input(
              "paymentDay3",
              lang === "es" ? "Aviso final de pago" : "Final payment notice",
              "days",
            )}
            {input(
              "reviewDelayDays",
              lang === "es"
                ? "Demora para pedir reseña"
                : "Review request delay",
              "days",
            )}
            {input(
              "reengagementMonth1",
              lang === "es" ? "Primer recontacto" : "First re-engagement",
              "months",
            )}
            {input(
              "reengagementMonth2",
              lang === "es" ? "Segundo recontacto" : "Second re-engagement",
              "months",
            )}
            {input(
              "quoteExpiryWarningDays",
              lang === "es"
                ? "Aviso de vencimiento de cotización"
                : "Quote expiry warning",
              "days",
            )}
            {input(
              "materialLeadTimeDays",
              lang === "es"
                ? "Tiempo de materiales predeterminado"
                : "Default material lead time",
              "days",
            )}
            {input(
              "defaultTaxRate",
              lang === "es" ? "Impuesto predeterminado" : "Default tax rate",
              "%",
            )}
            {input(
              "hourlyLaborCost",
              lang === "es"
                ? "Costo de mano de obra por hora"
                : "Hourly labor cost",
              "$/hr",
            )}
          </div>
          <div className="dual-actions">
            <button
              className="secondary-button"
              onClick={() => setParameters(ADMIN_DEFAULTS)}
            >
              {labels.reset}
            </button>
            <button
              className="primary-button"
              disabled={saveParameters.isPending}
              onClick={() => saveParameters.mutate(parameters)}
            >
              {saveParameters.isPending
                ? lang === "es"
                  ? "Guardando…"
                  : "Saving…"
                : labels.save}
            </button>
          </div>
          {saveParameters.isSuccess && (
            <p className="status success">
              <CheckIcon />
              {lang === "es"
                ? "Parámetros actualizados."
                : "Parameters updated."}
            </p>
          )}
        </section>
      )}
      {tab === "data" && (
        <section className="admin-section">
          <div className="admin-note">
            <strong>{lang === "es" ? "Solo lectura" : "Read only"}</strong>
            <p>
              {lang === "es"
                ? "Explora los conteos y las filas más recientes sin cambiar datos."
                : "Inspect counts and recent rows without changing stored data."}
            </p>
          </div>
          <div className="data-tables">
            {data.tables.map((item) => (
              <button
                key={item.key}
                className={table === item.key ? "active" : ""}
                onClick={() => setTable(item.key)}
              >
                <span>{item.key.replaceAll("_", " ")}</span>
                <strong>{item.count}</strong>
                <small>{labels.rows}</small>
              </button>
            ))}
          </div>
          <div className="recent-data">
            <h2>
              {labels.recent} · {table.replaceAll("_", " ")}
            </h2>
            {data.recentRows.map((row) => (
              <article key={`${table}-${row.id}`}>
                <div>
                  <strong>{row.title}</strong>
                  <span>{row.detail}</span>
                </div>
                <small>
                  #{row.id}
                  {row.date
                    ? ` · ${new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { dateStyle: "medium" }).format(new Date(row.date))}`
                    : ""}
                </small>
              </article>
            ))}
            {data.recentRows.length === 0 && (
              <p className="detail-empty">{labels.noRows}</p>
            )}
          </div>
        </section>
      )}
      {activeReport && (
        <div className="sheet-backdrop">
          <section
            className="admin-message-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={activeReport.subject}
          >
            <header>
              <span className={`inbox-kind kind-${activeReport.kind}`}>
                {activeReport.kind}
              </span>
              <button
                aria-label={copy[lang].close}
                onClick={() => setOpened(null)}
              >
                ×
              </button>
            </header>
            <h2>{activeReport.subject}</h2>
            <p>{activeReport.message}</p>
            <small>
              {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                dateStyle: "full",
                timeStyle: "short",
              }).format(new Date(activeReport.createdAt))}
            </small>
            <div className="dual-actions">
              <button
                className="secondary-button"
                onClick={() =>
                  updateReport.mutate({
                    id: activeReport.id,
                    status: activeReport.status,
                    isUnread: true,
                  })
                }
              >
                {labels.markUnread}
              </button>
              <button
                className="primary-button"
                onClick={() => {
                  updateReport.mutate({
                    id: activeReport.id,
                    status:
                      activeReport.status === "resolved" ? "open" : "resolved",
                    isUnread: false,
                  });
                  setOpened(null);
                }}
              >
                {activeReport.status === "resolved"
                  ? labels.markOpen
                  : labels.markResolved}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function FontPicker({
  lang,
  value,
  onChange,
}: {
  lang: Lang;
  value: DocumentFont;
  onChange: (font: DocumentFont) => void;
}) {
  const t = copy[lang];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as DocumentFont)}
      aria-label={t.documentFont}
    >
      <option value="helvetica">{t.fontHelvetica}</option>
      <option value="times">{t.fontTimes}</option>
      <option value="courier">{t.fontCourier}</option>
      <option value="palatino">{t.fontPalatino}</option>
    </select>
  );
}
function financialTotals(
  items: Array<{ amount: string; quantity?: number; discount?: string }> ,
  discountType: AdjustmentType,
  discountValue: string,
  taxType: AdjustmentType,
  taxValue: string,
) {
  const subtotal = items.reduce((sum, item) => sum + Math.max(0, money(item.amount) * (item.quantity ?? 1) - money(item.discount ?? "0")), 0);
  const discountRaw = Math.max(0, money(discountValue));
  const discount = Math.min(
    subtotal,
    discountType === "percent" ? (subtotal * discountRaw) / 100 : discountRaw,
  );
  const taxable = Math.max(0, subtotal - discount);
  const taxRaw = Math.max(0, money(taxValue));
  const tax = taxType === "percent" ? (taxable * taxRaw) / 100 : taxRaw;
  return { subtotal, discount, tax, total: taxable + tax };
}
function usd(value: number) {
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
function AdjustmentField({
  lang,
  label,
  type,
  value,
  onType,
  onValue,
}: {
  lang: Lang;
  label: string;
  type: AdjustmentType;
  value: string;
  onType: (v: AdjustmentType) => void;
  onValue: (v: string) => void;
}) {
  const t = copy[lang];
  return (
    <fieldset className="adjustment-field">
      <legend>{label}</legend>
      <div>
        <select
          value={type}
          onChange={(e) => onType(e.target.value as AdjustmentType)}
          aria-label={`${label} ${t.percent}`}
        >
          <option value="percent">{t.percent}</option>
          <option value="fixed">{t.fixed}</option>
        </select>
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => onValue(e.target.value)}
          placeholder={type === "percent" ? "0%" : "$0.00"}
          aria-label={label}
        />
      </div>
    </fieldset>
  );
}

async function loadImageDataUrl(url: string | null) {
  if (!url) return null;
  try {
    return await blobDataUrl(await (await fetch(url)).blob());
  } catch {
    return null;
  }
}
function hexRgb(hex: string) {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16) || 31,
    Number.parseInt(clean.slice(2, 4), 16) || 90,
    Number.parseInt(clean.slice(4, 6), 16) || 74,
  ] as const;
}
function defaultDocumentCustomize(kind: "quote" | "invoice", lang: Lang = "en"): DocumentCustomize {
  return {
    logoSize: "medium", removeLogoBackground: false, colorMode: "solid",
    showQuantityUnitPrice: true, showDiscount: true, showTax: true, showAmount: true,
    showSummaryInfo: true, showSubtotal: true, showPaidSummary: true, showBalanceDue: true,
    showPaidStamp: true, showBusinessSignature: false, showThankYou: true,
    showBusinessName: true, showShortBusinessName: false, showLicenseNumber: true, showDueDate: true,
    headline: kind === "invoice" ? (lang === "es" ? "FACTURA" : "INVOICE") : (lang === "es" ? "COTIZACIÓN" : "ESTIMATE"),
    dateFormat: "long", termsConditions: "", signatureDataUrl: "",
    labels: { headline: "", billTo: lang === "es" ? "Facturar a" : "Bill to", description: lang === "es" ? "Descripción" : "Description", amount: lang === "es" ? "Importe" : "Amount", subtotal: lang === "es" ? "Subtotal" : "Subtotal", total: lang === "es" ? "Total" : "Total", paid: lang === "es" ? "Pagado" : "Paid", balanceDue: lang === "es" ? "Saldo pendiente" : "Balance due", number: lang === "es" ? "Número" : "Number", date: lang === "es" ? "Fecha" : "Date", dueDate: lang === "es" ? "Vencimiento" : "Due date" },
    fontSize: "m", lineSpacing: "comfortable", highContrast: true,
  };
}
function parseDocumentCustomize(value: string | undefined, kind: "quote" | "invoice", lang: Lang): DocumentCustomize {
  const base = defaultDocumentCustomize(kind, lang);
  if (!value || value === "{}") return base;
  try {
    const parsed = JSON.parse(value) as Partial<DocumentCustomize>;
    return { ...base, ...parsed, labels: { ...base.labels, ...(parsed.labels ?? {}) } };
  } catch { return base; }
}
function formatDocumentDate(value: string, format: DocumentCustomize["dateFormat"], lang: Lang) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  if (format === "numeric") return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "2-digit", day: "2-digit", year: "numeric" }).format(date);
  if (format === "euro") return new Intl.DateTimeFormat(lang === "es" ? "es-ES" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}
type FinancialDocument = {
  id?: number;
  clientName: string;
  clientEmail?: string;
  jobAddress: string;
  shippingAddress?: string;
  jobType: string;
  lineItems: Array<{ name?: string; description: string; amount: string; quantity?: number; discount?: string; unit?: "none" | "days" | "hours" }>;
  invoiceNumber?: string;
  subtotal: string;
  discountType: AdjustmentType;
  discountValue: string;
  taxType: AdjustmentType;
  taxValue: string;
  total: string;
  lateFeeAccrued?: string;
  totalWithLateFee?: string;
  footnote: string;
  theme: QuoteTheme;
  font: DocumentFont;
  accentColor: string;
  showTaxLine: boolean;
  showDiscountLine: boolean;
  showPaidLine: boolean;
  showPaymentTerms: boolean;
  showFooterNotes: boolean;
  showLogo: boolean;
  showCompanyInfo: boolean;
  customizeJson: string;
  paidToDate?: string;
  expiryDate?: string;
  issueDate?: string;
  dueDate?: string;
  status?: InvoiceStatus;
};
async function buildFinancialPdf(
  document: FinancialDocument,
  settings: Settings | null,
  lang: Lang,
  kind: "quote" | "invoice",
) {
  const t = copy[lang];
  const custom = parseDocumentCustomize(document.customizeJson, kind, lang);
  const labels = custom.labels;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const w = doc.internal.pageSize.getWidth();
  const [r, g, b] = hexRgb(
    document.accentColor || settings?.accentColor || "#1f5a4a",
  );
  const logo = document.showLogo ? await loadImageDataUrl(settings?.logoUrl ?? null) : null;
  const theme = document.theme || "classic";
  const margin = theme === "minimal" ? 56 : 42;
  const docTitle = labels.headline || custom.headline;
  const docNumber = kind === "invoice" && document.invoiceNumber
    ? document.invoiceNumber
    : document.id
      ? `${kind === "quote" ? "EST" : "INV"}${String(document.id).padStart(4, "0")}`
      : "";
  const font = document.font || settings?.defaultDocumentFont || "helvetica";
  const bandH = theme === "bold" ? 72 : 56;
  const inBand = theme === "bold" || theme === "classic";
  if (theme === "bold") {
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, w, bandH, "F");
    doc.setTextColor(255, 255, 255);
  } else if (theme === "modern") {
    doc.setFillColor(r, g, b);
    doc.rect(0, 0, 12, 792, "F");
    doc.setTextColor(r, g, b);
  } else if (theme === "classic") {
    doc.setFillColor(23, 26, 28);
    doc.rect(0, 0, w, bandH, "F");
    doc.setTextColor(255, 255, 255);
  } else doc.setTextColor(r, g, b);
  if (logo) {
    try {
      doc.addImage(
        logo,
        logo.startsWith("data:image/png") ? "PNG" : "JPEG",
        margin,
        inBand ? 12 : 18,
        { huge: 72, big: 58, medium: 40, small: 28 }[custom.logoSize],
        { huge: 45, big: 36, medium: 25, small: 18 }[custom.logoSize],
        undefined,
        "FAST",
      );
    } catch {
      /* text branding stays */
    }
  }
  doc.setFont(font, "bold");
  if (document.showCompanyInfo && inBand) {
    doc.setFontSize(theme === "bold" ? 11 : 9);
    if (custom.showBusinessName) doc.text(custom.showShortBusinessName ? (settings?.companyName || "").split(/\s+/).slice(0, 2).join(" ") : settings?.companyName || "", w - margin, 22, { align: "right" });
    doc.setFont(font, "normal");
    doc.setFontSize(7);
    doc.setTextColor(214, 218, 217);
    const infoBits = [settings?.phone, custom.showLicenseNumber ? settings?.licenseNumber : "", settings?.website].filter(Boolean);
    if (infoBits.length) doc.text(infoBits.join("  ·  "), w - margin, 33, { align: "right" });
    if (settings?.address) doc.text(settings.address, w - margin, 43, { align: "right" });
  } else if (document.showCompanyInfo) {
    doc.setFontSize(11);
    doc.setTextColor(24, 32, 30);
    if (custom.showBusinessName) doc.text(custom.showShortBusinessName ? (settings?.companyName || "").split(/\s+/).slice(0, 2).join(" ") : settings?.companyName || "", logo ? margin + 50 : margin, 30);
  }
  const titleY = theme === "bold" ? 58 : inBand ? bandH + 26 : 82;
  doc.setFont(font, "bold");
  doc.setFontSize(theme === "bold" ? 14 : theme === "minimal" ? 18 : 20);
  if (theme === "bold") doc.setTextColor(255, 255, 255);
  else doc.setTextColor(24, 32, 30);
  doc.text(docTitle, margin, titleY);
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  if (theme === "bold") doc.setTextColor(255, 255, 255);
  else doc.setTextColor(70, 78, 76);
  if (docNumber) doc.text(docNumber, w - margin, titleY, { align: "right" });
  const infoY = titleY + 24;
  const clientPad = theme === "modern" ? 12 : 0;
  if (theme === "modern") {
    doc.setFillColor(241, 244, 243);
    doc.roundedRect(margin, infoY - 12, w - margin * 2, 68, 6, 6, "F");
  }
  const clientX = margin + clientPad;
  const rightX = w - margin - clientPad;
  doc.setTextColor(24, 32, 30);
  doc.setFont(font, "bold");
  doc.setFontSize(9);
  doc.text(`${labels.billTo}: ${document.clientName}`, clientX, infoY);
  doc.setFont(font, "normal");
  doc.setFontSize(8);
  doc.setTextColor(70, 78, 76);
  const clientSub = [document.jobType, document.jobAddress, document.shippingAddress]
    .filter((s) => s && s.trim())
    .join("  ·  ");
  const clientLines = clientSub
    ? ((doc.splitTextToSize(clientSub, (w - margin * 2) * 0.58) as string[]).slice(0, 3))
    : [];
  if (clientLines.length) doc.text(clientLines, clientX, infoY + 13);
  let ry = infoY;
  doc.setFont(font, "bold");
  doc.setFontSize(8);
  doc.setTextColor(24, 32, 30);
  if (docNumber) {
    doc.text(
      `${labels.number}: ${docNumber}`,
      rightX,
      ry,
      { align: "right" },
    );
    ry += 13;
  }
  if (kind === "invoice" && document.issueDate) {
    doc.setFont(font, "normal");
    doc.text(`${labels.date}: ${formatDocumentDate(document.issueDate, custom.dateFormat, lang)}`, rightX, ry, {
      align: "right",
    });
    ry += 13;
  }
  let y = Math.max(infoY + 13 + clientLines.length * 10 + 14, ry + 10);
  if (theme !== "minimal") {
    if (theme === "classic") doc.setFillColor(23, 26, 28);
    else if (theme === "bold") doc.setFillColor(r, g, b);
    else doc.setFillColor(238, 241, 240);
    doc.rect(margin, y - 13, w - margin * 2, 20, "F");
    if (theme === "bold" || theme === "classic") doc.setTextColor(255, 255, 255);
    else doc.setTextColor(24, 32, 30);
  }
  doc.setFont(font, "bold");
  doc.setFontSize(9);
  doc.text(labels.description, margin + 8, y);
  if (custom.showQuantityUnitPrice) doc.text(lang === "es" ? "Cant. × Precio" : "Qty × Price", w - margin - 92, y, { align: "right" });
  if (custom.showAmount) doc.text(labels.amount, w - margin - 8, y, { align: "right" });
  y += 26;
  doc.setTextColor(24, 32, 30);
  doc.setFont(font, "normal");
  doc.setFontSize(9);
  for (const item of document.lineItems) {
    const itemLabel = [item.name, item.description].filter(Boolean).join(" — ");
    const qty = item.quantity ?? 1;
    const itemTotal = Math.max(0, money(item.amount) * qty - money(item.discount ?? "0"));
    const detail = !custom.showQuantityUnitPrice || (qty === 1 && item.unit === "none" && money(item.discount ?? "0") <= 0)
      ? itemLabel
      : `${itemLabel} (${qty} ${item.unit === "days" ? "days" : item.unit === "hours" ? "hours" : "qty"}${money(item.discount ?? "0") > 0 ? `, -${usd(money(item.discount ?? "0"))}` : ""})`;
    const lines = doc.splitTextToSize(detail, w - margin * 2 - 130) as string[];
    doc.text(lines, margin + 8, y);
    if (custom.showAmount) doc.text(usd(itemTotal), w - margin - 8, y, { align: "right" });
    y += Math.max(20, lines.length * 11 + 6);
  }
  y += 6;
  const totals = financialTotals(
    document.lineItems,
    document.discountType,
    document.discountValue,
    document.taxType,
    document.taxValue,
  );
  if (custom.showSummaryInfo) {
  doc.setDrawColor(r, g, b);
  doc.line(w - margin - 200, y, w - margin, y);
  y += 16;
  doc.setFontSize(9);
  if (custom.showSubtotal) doc.text(`${labels.subtotal}: ${usd(totals.subtotal)}`, w - margin, y, { align: "right" });
  if (custom.showDiscount && document.showDiscountLine && totals.discount > 0) {
    y += 14;
    doc.text(`${t.discount}: -${usd(totals.discount)}`, w - margin, y, {
      align: "right",
    });
  }
  if (custom.showTax && document.showTaxLine && totals.tax > 0) {
    y += 14;
    doc.text(`${t.tax}: ${usd(totals.tax)}`, w - margin, y, { align: "right" });
  }
  if (kind === "invoice" && custom.showPaidSummary && document.showPaidLine && money(document.paidToDate ?? "0") > 0) {
    y += 14;
    doc.text(`${lang === "es" ? "Monto pagado" : "Amount paid"}: -${usd(money(document.paidToDate ?? "0"))}`, w - margin, y, { align: "right" });
  }
  const lateFee =
    kind === "invoice" ? money(document.lateFeeAccrued ?? "0") : 0;
  if (lateFee > 0) {
    y += 14;
    doc.text(
      `${lang === "es" ? "Cargo por atraso" : "Late fee"}: ${usd(lateFee)}`,
      w - margin,
      y,
      { align: "right" },
    );
  }
  y += 18;
  const totalLabel =
    kind === "invoice" && lateFee > 0
      ? lang === "es"
        ? "Total con cargo"
        : "Total with fee"
      : labels.total;
  const totalValue = usd(
    kind === "invoice" ? money(document.totalWithLateFee ?? document.total) : totals.total,
  );
  if (custom.showAmount && theme === "classic") {
    doc.setFillColor(23, 26, 28);
    doc.rect(w - margin - 210, y - 12, 210, 22, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont(font, "bold");
    doc.setFontSize(12);
    doc.text(`${totalLabel}: ${totalValue}`, w - margin - 8, y + 3, {
      align: "right",
    });
  } else if (custom.showAmount) {
    doc.setFont(font, "bold");
    doc.setFontSize(12);
    doc.setTextColor(r, g, b);
    doc.text(`${totalLabel}: ${totalValue}`, w - margin, y, {
      align: "right",
    });
  }
  }
  y += 24;
  doc.setTextColor(70, 78, 76);
  const dateValue = kind === "quote" ? document.expiryDate : document.dueDate;
  const dateLabel = labels.dueDate;
  if (custom.showDueDate && dateValue) {
    y += 6;
    doc.setFont(font, "normal");
    doc.setFontSize(9);
    doc.text(`${dateLabel}: ${formatDocumentDate(dateValue, custom.dateFormat, lang)}`, margin, y);
    y += 8;
  }
  if (document.showFooterNotes && document.footnote) {
    y += 16;
    doc.setFont(font, "normal");
    doc.setFontSize(8);
    doc.setTextColor(70, 78, 76);
    const lines = doc.splitTextToSize(
      document.footnote,
      w - margin * 2,
    ) as string[];
    doc.text(lines, margin, y);
    y += lines.length * 10 + 6;
  }
  if (document.showPaymentTerms && settings?.paymentInstructions) {
    const paymentLines = doc.splitTextToSize(`${t.paymentInstructions}: ${settings.paymentInstructions}`, w - margin * 2) as string[];
    doc.setFont(font, "normal"); doc.setFontSize(8); doc.setTextColor(70, 78, 76); doc.text(paymentLines, margin, 680);
  }
  if (custom.termsConditions) {
    const terms = doc.splitTextToSize(`${lang === "es" ? "Términos y condiciones" : "Terms and conditions"}: ${custom.termsConditions}`, w - margin * 2) as string[];
    doc.setFont(font, "normal"); doc.setFontSize(8); doc.setTextColor(70, 78, 76); doc.text(terms.slice(0, 4), margin, 715);
  }
  if (custom.showBusinessSignature && custom.signatureDataUrl) {
    try { doc.addImage(`data:image/png;base64,${custom.signatureDataUrl}`, "PNG", w - margin - 120, 665, 110, 38, undefined, "FAST"); } catch { /* keep PDF usable */ }
  }
  if (custom.showThankYou) { doc.setFont(font, "italic"); doc.setFontSize(8); doc.setTextColor(r, g, b); doc.text(lang === "es" ? "Gracias por su preferencia" : "Thank you for your business", w / 2, 742, { align: "center" }); }
  doc.setFont(font, "normal");
  doc.setFontSize(7);
  doc.setTextColor(90, 98, 96);
  if (document.showCompanyInfo) doc.text(
    [settings?.licenseNumber, companyContact(settings)]
      .filter(Boolean)
      .join(" · "),
    margin,
    752,
  );
  return doc.output("blob");
}
async function buildQuotePdf(
  quote: Quote | FinancialDocument,
  settings: Settings | null,
  lang: Lang,
) {
  return buildFinancialPdf(quote, settings, lang, "quote");
}
async function buildInvoicePdf(
  invoice: Invoice | FinancialDocument,
  settings: Settings | null,
  lang: Lang,
) {
  return buildFinancialPdf(invoice, settings, lang, "invoice");
}
function QuotesScreen({
  lang,
  settings: _settings,
  onBack,
  setScreen,
}: {
  lang: Lang;
  settings: Settings | null;
  onBack: () => void;
  setScreen: (s: Screen) => void;
}) {
  const t = copy[lang];
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["quotes"],
    queryFn: () => api.listQuotes({}),
  });
  const convert = useMutation({
    mutationFn: (id: number) => api.convertQuoteToJob({ id }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["quotes"] });
      client.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
  const invoice = useMutation({
    mutationFn: (id: number) => api.convertQuoteToInvoice({ quoteId: id }),
    onSuccess: (r) => {
      client.invalidateQueries({ queryKey: ["invoices"] });
      setScreen({ name: "invoicePreview", invoiceId: r.invoiceId });
    },
  });
  return (
    <main className="page">
      <PageHeader lang={lang} title={t.quoteBuilder} onBack={onBack} />
      <div className="page-actions">
        <button
          className="primary-button"
          onClick={() => setScreen({ name: "quoteNew" })}
        >
          <PlusIcon />
          {t.newQuote}
        </button>
      </div>
      <section className="quote-list">
        {query.data?.quotes.map((q) => (
          <article key={q.id}>
            <div>
              <h2>{q.clientName}</h2>
              <p>
                {q.jobType || t.quoteBuilder} · {usd(money(q.total))}
              </p>
              <small>
                {q.sentAt ? `${t.sentDate}: ${formatDate(q.sentAt, lang)}` : ""}
              </small>
            </div>
            <div className="row-actions">
              <button
                onClick={() =>
                  setScreen({ name: "quotePreview", quoteId: q.id })
                }
              >
                {t.previewPdf}
              </button>
              <button onClick={() => invoice.mutate(q.id)}>
                {t.convertInvoice}
              </button>
              {!q.jobId ? (
                <button onClick={() => convert.mutate(q.id)}>
                  {t.convertJob}
                </button>
              ) : (
                <span>
                  <CheckIcon />
                  {t.jobs}
                </span>
              )}
            </div>
          </article>
        ))}
        {query.data?.quotes.length === 0 && (
          <div className="empty-state">
            <h2>{t.quoteEmpty}</h2>
          </div>
        )}
      </section>
    </main>
  );
}
function QuoteBuilder({
  lang,
  settings,
  clientId,
  onBack,
}: {
  lang: Lang;
  settings: Settings | null;
  clientId?: number;
  onBack: () => void;
}) {
  const t = copy[lang];
  const client = useQueryClient();
  const growth = useQuery({
    queryKey: ["growth-toolkit"],
    queryFn: () => api.getGrowthToolkit({}),
  });
  const documentParameters = useQuery({
    queryKey: ["document-parameters"],
    queryFn: () => api.getDocumentParameters({}),
  });
  const leadClient = useQuery({
    queryKey: ["client", clientId],
    enabled: Boolean(clientId),
    queryFn: () => api.getClient({ id: clientId ?? 0 }),
  });
  const defaultApplied = useRef(false);
  const taxApplied = useRef(false);
  const [form, setForm] = useState({
    clientId: null as number | null,
    clientName: "",
    clientPhone: "",
    clientEmail: "",
    jobAddress: "",
    shippingAddress: "",
    jobType: "",
    expiryDate: "",
    sentAt: new Date().toLocaleDateString("en-CA"),
    theme: (settings?.defaultQuoteTheme ?? "classic") as QuoteTheme,
    font: (settings?.defaultDocumentFont ?? "helvetica") as DocumentFont,
    accentColor: settings?.accentColor ?? "#1f5a4a",
    showTaxLine: settings?.defaultShowTaxLine ?? true,
    showDiscountLine: settings?.defaultShowDiscountLine ?? true,
    showPaidLine: settings?.defaultShowPaidLine ?? true,
    showPaymentTerms: settings?.defaultShowPaymentTerms ?? true,
    showFooterNotes: settings?.defaultShowFooterNotes ?? true,
    showLogo: settings?.defaultShowLogo ?? true,
    showCompanyInfo: settings?.defaultShowCompanyInfo ?? true,
    customizeJson: settings?.defaultCustomizeJson ?? JSON.stringify(defaultDocumentCustomize("quote", lang)),
    footnote: settings?.defaultFootnote ?? "",
    discountType: "percent" as AdjustmentType,
    discountValue: "0",
    taxType: "percent" as AdjustmentType,
    taxValue: "0",
    lineItems: [{ description: "", amount: "" }],
  });
  useEffect(() => {
    if (settings && !defaultApplied.current) {
      setForm((current) => ({
        ...current,
        theme: settings.defaultQuoteTheme,
        font: settings.defaultDocumentFont,
        accentColor: settings.accentColor,
        showTaxLine: settings.defaultShowTaxLine,
        showDiscountLine: settings.defaultShowDiscountLine,
        showPaidLine: settings.defaultShowPaidLine,
        showPaymentTerms: settings.defaultShowPaymentTerms,
        showFooterNotes: settings.defaultShowFooterNotes,
        showLogo: settings.defaultShowLogo,
        showCompanyInfo: settings.defaultShowCompanyInfo,
        customizeJson: settings.defaultCustomizeJson,
        footnote: settings.defaultFootnote,
      }));
      defaultApplied.current = true;
    }
  }, [settings]);
  useEffect(() => {
    if (documentParameters.data && !taxApplied.current) {
      setForm((current) => ({
        ...current,
        taxValue: documentParameters.data.defaultTaxRate,
      }));
      taxApplied.current = true;
    }
  }, [documentParameters.data]);
  useEffect(() => {
    const c = leadClient.data?.client;
    if (c && !form.clientName)
      setForm((current) => ({
        ...current,
        clientId: c.id,
        clientName: c.name,
        clientPhone: c.phone,
        clientEmail: c.email,
        jobAddress: c.address,
      }));
  }, [leadClient.data, form.clientName]);
  const totals = financialTotals(
    form.lineItems,
    form.discountType,
    form.discountValue,
    form.taxType,
    form.taxValue,
  );
  const [error, setError] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api.saveQuote({
        ...form,
        lineItems: form.lineItems.filter((i) => i.description.trim()),
        subtotal: usd(totals.subtotal),
        total: usd(totals.total),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["quotes"] });
      client.invalidateQueries({ queryKey: ["clients"] });
      onBack();
    },
    onError: () => setError(t.error),
  });
  const preview: FinancialDocument = {
    ...form,
    subtotal: usd(totals.subtotal),
    total: usd(totals.total),
  };
  return (
    <main className="page form-page">
      <PageHeader lang={lang} title={t.newQuote} onBack={onBack} actions={<button className="small-button preview-trigger" type="button" onClick={() => setPreviewOpen(true)}><FileIcon />{t.previewPdf}</button>} />
      <form
        className="job-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !form.clientName.trim() ||
            !form.lineItems.some((i) => i.description.trim())
          ) {
            setError(t.required);
            return;
          }
          save.mutate();
        }}
      >
        <ClientPicker
          lang={lang}
          value={form.clientName}
          onValueChange={(clientName) => setForm({ ...form, clientId: null, clientName })}
          onPick={(c) =>
            setForm({
              ...form,
              clientId: c.id,
              clientName: c.name,
              clientPhone: c.phone,
              clientEmail: c.email,
              jobAddress: c.address,
            })
          }
        />
        <label>
          <span>{t.client} *</span>
          <input
            value={form.clientName}
            onChange={(e) => setForm({ ...form, clientName: e.target.value })}
          />
        </label>
        <details className="action-details editor-advanced"><summary>{lang === "es" ? "Detalles del cliente" : "Client details"}</summary><div className="compact-form">
        <label>
          <span>{t.phone}</span>
          <input
            type="tel"
            value={form.clientPhone}
            onChange={(e) => setForm({ ...form, clientPhone: e.target.value })}
          />
        </label>
        <label>
          <span>{t.email}</span>
          <input
            type="email"
            value={form.clientEmail}
            onChange={(e) => setForm({ ...form, clientEmail: e.target.value })}
          />
        </label>
        <label>
          <span>{t.type}</span>
          <input
            value={form.jobType}
            onChange={(e) => setForm({ ...form, jobType: e.target.value })}
          />
        </label>
        {settings?.addJobSiteAddress !== false && <label>
          <span>{lang === "es" ? "Dirección del trabajo" : "Job site address"}</span>
          <input
            value={form.jobAddress}
            onChange={(e) => setForm({ ...form, jobAddress: e.target.value })}
          />
        </label>}
        {settings?.addShippingAddress && <label>
          <span>{lang === "es" ? "Dirección de envío" : "Shipping address"}</span>
          <input value={form.shippingAddress} onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })} />
        </label>}
        </div></details>
        <div className="field-pair">
          <label>
            <span>{t.sentDate}</span>
            <input
              type="date"
              value={form.sentAt}
              onChange={(e) => setForm({ ...form, sentAt: e.target.value })}
            />
          </label>
          <label>
            <span>{t.expiry}</span>
            <input
              type="date"
              value={form.expiryDate}
              onChange={(e) => setForm({ ...form, expiryDate: e.target.value })}
            />
          </label>
        </div>
        <fieldset className="form-section">
          <legend>{t.lineItems}</legend>
          {(growth.data?.templates.length ?? 0) > 0 && (
            <label>
              <span>
                {lang === "es" ? "Aplicar plantilla" : "Apply template"}
              </span>
              <select
                defaultValue=""
                onChange={(e) => {
                  const template = growth.data?.templates.find(
                    (row) => row.id === Number(e.target.value),
                  );
                  if (template)
                    setForm({
                      ...form,
                      lineItems: template.lineItems.map((item) => ({
                        ...item,
                      })),
                    });
                  e.currentTarget.value = "";
                }}
              >
                <option value="">
                  {lang === "es" ? "Elegir plantilla…" : "Choose template…"}
                </option>
                {growth.data?.templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {(growth.data?.priceBook.length ?? 0) > 0 && (
            <div className="quick-add">
              <span>
                {lang === "es"
                  ? "Agregar de lista de precios"
                  : "Add from price book"}
              </span>
              <div>
                {growth.data?.priceBook.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() =>
                      setForm({
                        ...form,
                        lineItems: [
                          ...form.lineItems.filter(
                            (line) => line.description || line.amount,
                          ),
                          {
                            description:
                              item.name +
                              (item.description
                                ? ` — ${item.description}`
                                : ""),
                            amount: item.unitPrice,
                          },
                        ],
                      })
                    }
                  >
                    {item.name} · {usd(money(item.unitPrice))}
                  </button>
                ))}
              </div>
            </div>
          )}
          {form.lineItems.map((item, i) => (
            <div className="line-item" key={i}>
              <input
                placeholder={t.item}
                value={item.description}
                onChange={(e) =>
                  setForm({
                    ...form,
                    lineItems: form.lineItems.map((x, j) =>
                      j === i ? { ...x, description: e.target.value } : x,
                    ),
                  })
                }
              />
              <input
                placeholder="$0.00"
                inputMode="decimal"
                value={item.amount}
                onChange={(e) =>
                  setForm({
                    ...form,
                    lineItems: form.lineItems.map((x, j) =>
                      j === i ? { ...x, amount: e.target.value } : x,
                    ),
                  })
                }
              />
            </div>
          ))}
          <button
            className="secondary-button"
            type="button"
            onClick={() =>
              setForm({
                ...form,
                lineItems: [...form.lineItems, { description: "", amount: "" }],
              })
            }
          >
            <PlusIcon />
            {t.addLine}
          </button>
          <div className="field-pair">
            <AdjustmentField
              lang={lang}
              label={t.discount}
              type={form.discountType}
              value={form.discountValue}
              onType={(discountType) => setForm({ ...form, discountType })}
              onValue={(discountValue) => setForm({ ...form, discountValue })}
            />
            <AdjustmentField
              lang={lang}
              label={t.tax}
              type={form.taxType}
              value={form.taxValue}
              onType={(taxType) => setForm({ ...form, taxType })}
              onValue={(taxValue) => setForm({ ...form, taxValue })}
            />
          </div>
          <div className="calculation-summary">
            <span>
              {t.subtotal}
              <strong>{usd(totals.subtotal)}</strong>
            </span>
            {totals.discount > 0 && (
              <span>
                {t.discount}
                <strong>-{usd(totals.discount)}</strong>
              </span>
            )}
            {totals.tax > 0 && (
              <span>
                {t.tax}
                <strong>{usd(totals.tax)}</strong>
              </span>
            )}
            <span className="grand-total">
              {t.total}
              <strong>{usd(totals.total)}</strong>
            </span>
          </div>
        </fieldset>
        <label>
          <span>{t.footnote}</span>
          <textarea
            rows={3}
            value={form.footnote}
            onChange={(e) => setForm({ ...form, footnote: e.target.value })}
          />
        </label>
        {error && <p className="status error">{error}</p>}
        <button
          className="primary-button sticky-submit"
          disabled={save.isPending}
        >
          {save.isPending ? t.saving : t.saveQuote}
        </button>
      </form>
      {previewOpen && <DocumentDesignOverlay lang={lang} kind="quote" document={preview} settings={settings} onClose={() => setPreviewOpen(false)} onConfirm={async (design, saveDefault) => { setForm((current) => ({ ...current, ...design })); if (saveDefault) await api.saveDocumentDesignDefault(design); setPreviewOpen(false); }} />}
    </main>
  );
}

function QuotePaper({
  quote,
  settings,
  lang,
  kind = "quote",
}: {
  quote: FinancialDocument;
  settings: Settings | null;
  lang: Lang;
  kind?: "quote" | "invoice";
}) {
  const c = parseDocumentCustomize(quote.customizeJson, kind, lang);
  const totals = financialTotals(quote.lineItems, quote.discountType, quote.discountValue, quote.taxType, quote.taxValue);
  const labels = c.labels;
  const title = labels.headline || c.headline;
  const companyName = settings?.companyName ?? "";
  const shortName = companyName.split(/\s+/).filter(Boolean).slice(0, 2).join(" ");
  const dueValue = kind === "quote" ? quote.expiryDate : quote.dueDate;
  const paid = money(quote.paidToDate ?? "0");
  const balance = Math.max(0, money(quote.totalWithLateFee ?? quote.total) - paid);
  const logoSize = { huge: 74, big: 58, medium: 42, small: 30 }[c.logoSize];
  return (
    <article
      className={`quote-paper theme-${quote.theme} font-${quote.font} customize-font-${c.fontSize} spacing-${c.lineSpacing} ${c.highContrast ? "high-contrast" : "soft-contrast"} ${c.colorMode === "gradient" ? "color-gradient" : "color-solid"}`}
      style={{ "--quote-accent": quote.accentColor || settings?.accentColor || "#1f5a4a", "--logo-size": `${logoSize}px` } as CSSProperties}
    >
      <header className="quote-paper-band">
        <div className="quote-paper-brand">
          {quote.showLogo && settings?.logoUrl && <span className={`paper-logo ${c.removeLogoBackground ? "transparent" : ""}`}><img src={settings.logoUrl} alt={lang === "es" ? "Logo de la empresa" : "Company logo"} /></span>}
          {quote.showCompanyInfo && <div>
            {c.showBusinessName && <strong>{c.showShortBusinessName ? shortName : companyName}</strong>}
            <small>{[settings?.phone, c.showLicenseNumber ? settings?.licenseNumber : ""].filter(Boolean).join(" · ")}</small>
          </div>}
        </div>
        {quote.showCompanyInfo && settings?.website && <span className="quote-paper-web">{settings.website}</span>}
      </header>
      <div className="quote-paper-title-row">
        <h2>{title}</h2>
        {quote.id ? <span className="quote-paper-number">{labels.number}: {kind === "invoice" && quote.invoiceNumber ? quote.invoiceNumber : `${kind === "quote" ? "EST" : "INV"}${String(quote.id).padStart(4, "0")}`}</span> : null}
      </div>
      <section className="quote-paper-client">
        <strong>{labels.billTo}: {quote.clientName || "—"}</strong>
        <span>{[quote.jobType, quote.jobAddress, quote.shippingAddress].filter((s) => s && s.trim()).join(" · ") || (lang === "es" ? "Dirección" : "Address")}</span>
        {kind === "invoice" && quote.issueDate && <small>{labels.date}: {formatDocumentDate(quote.issueDate, c.dateFormat, lang)}</small>}
        {c.showDueDate && dueValue && <small>{labels.dueDate}: {formatDocumentDate(dueValue, c.dateFormat, lang)}</small>}
      </section>
      {kind === "invoice" && c.showPaidStamp && quote.status === "paid" && <div className="paid-stamp">{labels.paid.toUpperCase()}</div>}
      <div className={`quote-paper-lines ${c.showQuantityUnitPrice ? "with-quantity" : ""} ${c.showAmount ? "" : "hide-amount"}`}>
        <div className="quote-line heading"><span>{labels.description}</span>{c.showQuantityUnitPrice && <span>{lang === "es" ? "Cant. × Precio" : "Qty × Price"}</span>}{c.showAmount && <span>{labels.amount}</span>}</div>
        {quote.lineItems.filter((i) => i.description || i.name).map((item, i) => {
          const qty = item.quantity ?? 1;
          const amount = money(item.amount);
          const lineTotal = Math.max(0, amount * qty - money(item.discount ?? "0"));
          return <div className="quote-line" key={i}><span>{[item.name, item.description].filter(Boolean).join(item.name && item.description ? " — " : "")}</span>{c.showQuantityUnitPrice && <span className="line-quantity">{qty} × {usd(amount)}</span>}{c.showAmount && <strong>{usd(lineTotal)}</strong>}</div>;
        })}
      </div>
      {c.showSummaryInfo && <div className="document-totals">
        {c.showSubtotal && <span>{labels.subtotal}<strong>{usd(totals.subtotal)}</strong></span>}
        {c.showDiscount && quote.showDiscountLine && totals.discount > 0 && <span>{lang === "es" ? "Descuento" : "Discount"}<strong>-{usd(totals.discount)}</strong></span>}
        {c.showTax && quote.showTaxLine && totals.tax > 0 && <span>{lang === "es" ? "Impuesto" : "Tax"}<strong>{usd(totals.tax)}</strong></span>}
        {kind === "invoice" && c.showPaidSummary && quote.showPaidLine && paid > 0 && <span>{labels.paid}<strong>-{usd(paid)}</strong></span>}
        {c.showAmount && <span className="grand-total">{labels.total}<strong>{usd(kind === "invoice" ? money(quote.totalWithLateFee ?? quote.total) : totals.total)}</strong></span>}
        {kind === "invoice" && c.showBalanceDue && <span className="balance-due">{labels.balanceDue}<strong>{usd(balance)}</strong></span>}
      </div>}
      {quote.showFooterNotes && quote.footnote && <p className="quote-payment"><strong>{lang === "es" ? "Notas" : "Notes"}</strong>{quote.footnote}</p>}
      {quote.showPaymentTerms && settings?.paymentInstructions && <p className="quote-payment"><strong>{lang === "es" ? "Instrucciones de pago" : "Payment instructions"}</strong>{settings.paymentInstructions}</p>}
      {c.termsConditions && <p className="quote-payment"><strong>{lang === "es" ? "Términos y condiciones" : "Terms and conditions"}</strong>{c.termsConditions}</p>}
      {c.showBusinessSignature && c.signatureDataUrl && <div className="paper-signature"><img src={`data:image/png;base64,${c.signatureDataUrl}`} alt={lang === "es" ? "Firma de la empresa" : "Business signature"} /><small>{lang === "es" ? "Firma autorizada" : "Authorized signature"}</small></div>}
      {c.showThankYou && <p className="paper-thank-you">{lang === "es" ? "Gracias por su preferencia" : "Thank you for your business"}</p>}
      <footer><span>{c.showDueDate && dueValue ? `${labels.dueDate}: ${formatDocumentDate(dueValue, c.dateFormat, lang)}` : ""}</span>{c.showAmount && <strong>{labels.total}: {usd(totals.total)}</strong>}</footer>
    </article>
  );
}

function PdfFrame({ blob, title }: { blob: Blob | null; title: string }) {
  const [pages, setPages] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  useEffect(() => {
    if (!blob) {
      setPages([]);
      setState("loading");
      return;
    }
    let cancelled = false;
    setPages([]);
    setState("loading");
    void (async () => {
      try {
        const dataUrl = await blobDataUrl(blob);
        const dataBase64 = dataUrl.split(",")[1] ?? "";
        const result = await api.renderPdfPreview({ dataBase64 });
        if (!cancelled) {
          setPages(result.pagesBase64);
          setState("ready");
        }
      } catch {
        if (!cancelled) setState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [blob]);
  return (
    <section
      className="pdf-viewer"
      aria-label={title}
      aria-busy={state === "loading"}
    >
      {state === "loading" && <div className="pdf-loading">{title}…</div>}
      {state === "error" && (
        <div className="pdf-loading" role="status">
          {title} could not be displayed. Use Download PDF to open the file.
        </div>
      )}
      {state === "ready" && (
        <div className="pdf-pages ready" role="document">
          {pages.map((page, index) => (
            <img
              key={index}
              src={`data:image/jpeg;base64,${page}`}
              alt={`${title}, page ${index + 1} of ${pages.length}`}
            />
          ))}
        </div>
      )}
    </section>
  );
}
function documentDesignOf(document: FinancialDocument): DocumentDesign {
  return { theme: document.theme, font: document.font, accentColor: document.accentColor, showTaxLine: document.showTaxLine, showDiscountLine: document.showDiscountLine, showPaidLine: document.showPaidLine, showPaymentTerms: document.showPaymentTerms, showFooterNotes: document.showFooterNotes, showLogo: document.showLogo, showCompanyInfo: document.showCompanyInfo, customizeJson: document.customizeJson || "{}" };
}
type CustomizeSheetKind = "summary" | "headline" | "date" | "business" | "signature" | "terms" | "labels";
function DocumentDesignOverlay({ lang, kind, document, settings, onClose, onConfirm }: { lang: Lang; kind: "quote" | "invoice"; document: FinancialDocument; settings: Settings | null; onClose: () => void; onConfirm: (design: DocumentDesign, saveDefault: boolean) => Promise<void> }) {
  const qc = useQueryClient();
  const [design, setDesign] = useState<DocumentDesign>(() => documentDesignOf(document));
  const [custom, setCustom] = useState<DocumentCustomize>(() => parseDocumentCustomize(document.customizeJson, kind, lang));
  const [localSettings, setLocalSettings] = useState<Settings | null>(settings);
  const [logoPreview, setLogoPreview] = useState(settings?.logoUrl ?? "");
  const [saveDefault, setSaveDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"template" | "logo" | "color" | "options" | "info">("template");
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [fullScreen, setFullScreen] = useState(false);
  const [sheet, setSheet] = useState<CustomizeSheetKind | null>(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  const updateCustom = <K extends keyof DocumentCustomize>(key: K, value: DocumentCustomize[K]) => setCustom((current) => ({ ...current, [key]: value }));
  const previewSettings = localSettings ? { ...localSettings, logoUrl: logoPreview || localSettings.logoUrl } : settings;
  const preview: FinancialDocument = { ...document, ...design, customizeJson: JSON.stringify(custom) };
  const closeSheet = async () => {
    if (sheet === "business" && localSettings) {
      const { logoUrl: _logoUrl, coverUrl: _coverUrl, ...input } = localSettings;
      await api.updateSettings(input);
      await qc.invalidateQueries({ queryKey: ["settings"] });
    }
    setSheetClosing(true);
    window.setTimeout(() => { setSheet(null); setSheetClosing(false); }, 180);
  };
  const text = lang === "es" ? {
    title: "Vista previa y personalizar", back: "Atrás", template: "Plantilla", logo: "Logo", color: "Color", options: "Opciones", info: "Info", typography: "Tipografía", save: "Aplicar diseño", saving: "Guardando…", defaults: "Guardar como predeterminado", custom: "Color personalizado", solid: "Sólido", gradient: "Degradado", satisfied: kind === "invoice" ? "¿Satisfecho con esta factura?" : "¿Satisfecho con esta cotización?", thank: "Gracias por tu opinión", size: "Tamaño", removeBg: "Quitar fondo", huge: "Enorme", big: "Grande", medium: "Mediano", small: "Pequeño", content: "Contenido", summary: "Resumen", header: "Encabezado", showQty: "Mostrar cantidad y precio unitario", showDiscount: "Mostrar descuento", showTax: "Mostrar impuesto", showAmount: "Mostrar importe", summaryInfo: "Mostrar u ocultar resumen", paidStamp: "Mostrar sello PAGADO", businessSignature: "Mostrar firma de la empresa", thankYou: "Mostrar “Gracias por su preferencia”", headline: "Título predeterminado", businessName: "Mostrar nombre de la empresa", shortName: "Mostrar nombre corto", license: "Mostrar número de licencia", dueDate: "Mostrar fecha de vencimiento", dateFormat: "Formato de fecha", businessInfo: "Información y logo de la empresa", terms: "Términos y condiciones", labels: "Etiquetas personalizadas", fontSize: "Tamaño de letra", lineSpacing: "Espaciado de línea", highContrast: "Texto de alto contraste", compact: "Compacto", comfortable: "Cómodo", roomy: "Amplio", done: "Listo", changeLogo: "Cambiar logo", noLogo: "Agrega el logo de tu empresa", expand: "Ampliar vista previa"
  } : {
    title: "Preview & Customize", back: "Back", template: "Template", logo: "Logo", color: "Color", options: "Options", info: "Info", typography: "Typography", save: "Apply design", saving: "Saving…", defaults: "Save as default", custom: "Custom color", solid: "Solid", gradient: "Gradient", satisfied: kind === "invoice" ? "Satisfied with this invoice?" : "Satisfied with this estimate?", thank: "Thanks for the feedback", size: "Size", removeBg: "Remove Background", huge: "Huge", big: "Big", medium: "Medium", small: "Small", content: "Content", summary: "Summary", header: "Header", showQty: "Show quantity and unit price", showDiscount: "Show discount", showTax: "Show tax", showAmount: "Show amount", summaryInfo: "Show or Hide Summary info", paidStamp: "Show “PAID” Stamp", businessSignature: "Show business signature", thankYou: "Show “Thank you for your business”", headline: "Default Headline", businessName: "Show business name", shortName: "Show short business name", license: "Show license number", dueDate: "Show due date", dateFormat: "Date format", businessInfo: "Business info & logo", terms: "Terms and conditions", labels: "Custom labels", fontSize: "Font size", lineSpacing: "Line spacing", highContrast: "High-contrast text", compact: "Compact", comfortable: "Comfortable", roomy: "Roomy", done: "Done", changeLogo: "Change logo", noLogo: "Add your company logo", expand: "Expand preview"
  };
  const palettes = ["#1f5a4a", "#174f7a", "#2563eb", "#7c3aed", "#9a3412", "#dc2626", "#334155", "#a16207", "#0f766e", "#111827"];
  const tabIcons = {
    template: <Icon><path d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6"/></Icon>,
    logo: <Icon><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m5 18 5-5 3 3 2-2 4 4"/></Icon>,
    color: <Icon><path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10z"/><circle cx="7.5" cy="9" r=".8"/><circle cx="10" cy="6.5" r=".8"/></Icon>,
    options: <Icon><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></Icon>,
    info: <Icon><path d="M7 5h14M7 12h14M7 19h14"/><circle cx="3" cy="5" r="1"/><circle cx="3" cy="12" r="1"/><circle cx="3" cy="19" r="1"/></Icon>,
  };
  const tabs = (["template", "logo", "color", "options", "info"] as const).map((id) => ({ id, label: text[id], icon: tabIcons[id] }));
  const checkRow = (label: string, checked: boolean, onChange: (value: boolean) => void) => <label className="custom-check-row"><span>{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /></label>;
  const navRow = (label: string, target: CustomizeSheetKind, value?: string, previewImage?: string) => <button type="button" className="custom-nav-row" onClick={() => setSheet(target)}><span>{label}</span>{previewImage ? <img src={previewImage} alt="" /> : value ? <small>{value}</small> : null}<BackIcon /></button>;
  const optionHeading = (label: string, icon: ReactNode) => <h3 className="custom-section-title">{icon}<span>{label}</span></h3>;
  const renderedSheet = sheet && <div className={`sheet-backdrop customize-sheet-backdrop ${sheetClosing ? "closing" : ""}`} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) void closeSheet(); }}><section className="customize-sheet" role="dialog" aria-modal="true" aria-label={text.info}><div className="sheet-handle"/><div className="section-title-row"><h2>{sheet === "summary" ? text.summaryInfo : sheet === "headline" ? text.headline : sheet === "date" ? text.dateFormat : sheet === "business" ? text.businessInfo : sheet === "signature" ? text.businessSignature : sheet === "terms" ? text.terms : text.labels}</h2><button type="button" onClick={() => void closeSheet()}>{text.done}</button></div>
    {sheet === "summary" && <div className="sheet-form">{checkRow(custom.labels.subtotal, custom.showSubtotal, (v) => updateCustom("showSubtotal", v))}{checkRow(custom.labels.paid, custom.showPaidSummary, (v) => updateCustom("showPaidSummary", v))}{checkRow(custom.labels.balanceDue, custom.showBalanceDue, (v) => updateCustom("showBalanceDue", v))}{checkRow(lang === "es" ? "Mostrar términos de pago" : "Show payment terms", design.showPaymentTerms, (v) => setDesign({ ...design, showPaymentTerms: v }))}{checkRow(lang === "es" ? "Mostrar notas al pie" : "Show footer notes", design.showFooterNotes, (v) => setDesign({ ...design, showFooterNotes: v }))}</div>}
    {sheet === "headline" && <div className="sheet-form"><label><span>{text.headline}</span><input value={custom.headline} maxLength={40} onChange={(e) => updateCustom("headline", e.target.value)} /></label></div>}
    {sheet === "date" && <div className="sheet-choice-list">{(["long", "numeric", "euro"] as const).map((value) => <button type="button" key={value} className={custom.dateFormat === value ? "active" : ""} onClick={() => updateCustom("dateFormat", value)}><span>{formatDocumentDate("2026-09-27", value, lang)}</span>{custom.dateFormat === value && <CheckIcon />}</button>)}</div>}
    {sheet === "business" && localSettings && <div className="sheet-form"><label><span>{lang === "es" ? "Nombre de la empresa" : "Company name"}</span><input value={localSettings.companyName} onChange={(e) => setLocalSettings({ ...localSettings, companyName: e.target.value })}/></label><label><span>{lang === "es" ? "Teléfono" : "Phone"}</span><input value={localSettings.phone} onChange={(e) => setLocalSettings({ ...localSettings, phone: e.target.value })}/></label><label><span>{lang === "es" ? "Correo" : "Email"}</span><input type="email" value={localSettings.email} onChange={(e) => setLocalSettings({ ...localSettings, email: e.target.value })}/></label><label><span>{lang === "es" ? "Dirección" : "Address"}</span><input value={localSettings.address} onChange={(e) => setLocalSettings({ ...localSettings, address: e.target.value })}/></label><label><span>{lang === "es" ? "Sitio web" : "Website"}</span><input value={localSettings.website} onChange={(e) => setLocalSettings({ ...localSettings, website: e.target.value })}/></label></div>}
    {sheet === "signature" && <div className="sheet-form"><SignaturePad label={lang === "es" ? "Firma de la empresa" : "Business signature"} clearLabel={lang === "es" ? "Borrar" : "Clear"} onChange={(value) => updateCustom("signatureDataUrl", value)}/>{custom.signatureDataUrl && <img className="signature-preview" src={`data:image/png;base64,${custom.signatureDataUrl}`} alt={lang === "es" ? "Vista previa de firma" : "Signature preview"}/>}</div>}
    {sheet === "terms" && <div className="sheet-form"><label><span>{text.terms}</span><textarea rows={7} value={custom.termsConditions} onChange={(e) => updateCustom("termsConditions", e.target.value)}/></label></div>}
    {sheet === "labels" && <div className="sheet-form label-grid">{(Object.keys(custom.labels) as Array<keyof DocumentLabels>).map((key) => <label key={key}><span>{{ headline: text.headline, billTo: lang === "es" ? "Facturar a" : "Bill to", description: lang === "es" ? "Descripción" : "Description", amount: lang === "es" ? "Importe" : "Amount", subtotal: "Subtotal", total: "Total", paid: lang === "es" ? "Pagado" : "Paid", balanceDue: lang === "es" ? "Saldo pendiente" : "Balance due", number: lang === "es" ? "Número" : "Number", date: lang === "es" ? "Fecha" : "Date", dueDate: text.dueDate }[key]}</span><input value={custom.labels[key]} onChange={(e) => updateCustom("labels", { ...custom.labels, [key]: e.target.value })}/></label>)}</div>}
  </section></div>;
  return <div className="document-overlay customize-overlay" role="dialog" aria-modal="true" aria-label={text.title}>
    <header className="document-overlay-head customize-head"><button type="button" onClick={onClose} aria-label={text.back}><BackIcon /></button><strong>{text.title}</strong><span /></header>
    <div className="customize-workspace">
      <section className="customize-preview-wrap"><div className="customize-preview-card"><QuotePaper quote={preview} settings={previewSettings} lang={lang} kind={kind}/><button type="button" className="preview-expand" aria-label={text.expand} onClick={() => setFullScreen(true)}><Icon><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></Icon></button></div></section>
      <aside className="design-panel custom-design-panel" aria-live="polite">
        <div key={tab} className="custom-tab-content">
          {tab === "template" && <><div className="design-feedback"><span>{feedback ? text.thank : text.satisfied}</span><div><button type="button" className={feedback === "up" ? "active" : ""} aria-label={lang === "es" ? "Me gusta" : "Thumbs up"} onClick={() => setFeedback("up")}><Icon><path d="M7 10v11H3V10h4Zm0 9h10a2 2 0 0 0 2-1.6l1-5A2 2 0 0 0 18 10h-5l1-5-2-2-5 7"/></Icon></button><button type="button" className={feedback === "down" ? "active" : ""} aria-label={lang === "es" ? "No me gusta" : "Thumbs down"} onClick={() => setFeedback("down")}><Icon><path d="M7 14V3H3v11h4Zm0-9h10a2 2 0 0 1 2 1.6l1 5A2 2 0 0 1 18 14h-5l1 5-2 2-5-7"/></Icon></button></div></div><div className="template-carousel" aria-label={text.template}>{(["classic", "modern", "bold", "minimal"] as QuoteTheme[]).map((theme) => <button type="button" key={theme} className={design.theme === theme ? "active" : ""} onClick={() => setDesign({ ...design, theme })}><span className="template-paper"><QuotePaper quote={{ ...preview, theme }} settings={previewSettings} lang={lang} kind={kind}/></span><strong>{copy[lang][theme]}</strong></button>)}</div><label className="design-font"><span>{text.typography}</span><FontPicker lang={lang} value={design.font} onChange={(font) => setDesign({ ...design, font })}/></label></>}
          {tab === "logo" && <div className="logo-custom-grid"><div><strong>{text.logo}</strong><label className="logo-edit-control">{logoPreview ? <img src={logoPreview} alt={text.logo}/> : <span>{text.noLogo}</span>}<i aria-hidden="true"><Icon><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20ZM13.5 7l3.5 3.5"/></Icon></i><input className="sr-only" type="file" accept="image/png,image/jpeg" onChange={async(e)=>{const file=e.target.files?.[0];if(!file)return;const data=await fileToBase64(file);await api.uploadLogo({filename:file.name,contentType:file.type as "image/png"|"image/jpeg",dataBase64:data.dataBase64});setLogoPreview(URL.createObjectURL(file));setDesign((current)=>({...current,showLogo:true}));await qc.invalidateQueries({queryKey:["settings"]});}}/></label>{checkRow(lang === "es" ? "Mostrar logo" : "Show logo", design.showLogo, (v) => setDesign({ ...design, showLogo: v }))}</div><div><strong>{text.size}</strong><div className="logo-size-list">{(["huge", "big", "medium", "small"] as const).map((size)=><button type="button" key={size} onClick={()=>updateCustom("logoSize",size)}><span>{text[size]}</span>{custom.logoSize===size&&<CheckIcon/>}</button>)}</div></div><div><strong>{text.removeBg}</strong><input role="switch" aria-label={text.removeBg} type="checkbox" checked={custom.removeLogoBackground} onChange={(e)=>updateCustom("removeLogoBackground",e.target.checked)}/></div></div>}
          {tab === "color" && <><div className="segmented-control"><button type="button" className={custom.colorMode === "solid" ? "active" : ""} onClick={()=>updateCustom("colorMode","solid")}>{text.solid}</button><button type="button" className={custom.colorMode === "gradient" ? "active" : ""} onClick={()=>updateCustom("colorMode","gradient")}>{text.gradient}</button></div><div className="palette-grid">{palettes.map((color)=><button key={color} type="button" className={design.accentColor.toLowerCase()===color?"active":""} style={{background:color}} aria-label={`${text.color} ${color}`} aria-pressed={design.accentColor.toLowerCase()===color} onClick={()=>setDesign({...design,accentColor:color})}/>)}</div><label className="custom-color-row"><span>{text.custom}</span><input type="color" value={design.accentColor} onChange={(e)=>setDesign({...design,accentColor:e.target.value})}/></label></>}
          {tab === "options" && <div className="custom-options">{optionHeading(text.content,<Icon><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></Icon>)}{checkRow(text.showQty,custom.showQuantityUnitPrice,(v)=>updateCustom("showQuantityUnitPrice",v))}{checkRow(text.showDiscount,custom.showDiscount,(v)=>{updateCustom("showDiscount",v);setDesign({...design,showDiscountLine:v});})}{checkRow(text.showTax,custom.showTax,(v)=>{updateCustom("showTax",v);setDesign({...design,showTaxLine:v});})}{checkRow(text.showAmount,custom.showAmount,(v)=>updateCustom("showAmount",v))}{optionHeading(text.summary,<Icon><path d="M5 5h14M5 12h14M12 19h7"/></Icon>)}{navRow(text.summaryInfo,"summary")}{checkRow(text.paidStamp,custom.showPaidStamp,(v)=>updateCustom("showPaidStamp",v))}{checkRow(text.businessSignature,custom.showBusinessSignature,(v)=>updateCustom("showBusinessSignature",v))}{checkRow(text.thankYou,custom.showThankYou,(v)=>updateCustom("showThankYou",v))}{optionHeading(text.header,<Icon><path d="M4 6h16M7 10v9M17 10v9M7 14h10"/></Icon>)}{navRow(text.headline,"headline",custom.headline)}{checkRow(text.businessName,custom.showBusinessName,(v)=>{updateCustom("showBusinessName",v);setDesign({...design,showCompanyInfo:v});})}{checkRow(text.shortName,custom.showShortBusinessName,(v)=>updateCustom("showShortBusinessName",v))}{checkRow(text.license,custom.showLicenseNumber,(v)=>updateCustom("showLicenseNumber",v))}{checkRow(text.dueDate,custom.showDueDate,(v)=>updateCustom("showDueDate",v))}{navRow(text.dateFormat,"date",formatDocumentDate("2026-09-27",custom.dateFormat,lang))}</div>}
          {tab === "info" && <div className="info-options">{navRow(text.businessInfo,"business",undefined,logoPreview || undefined)}{navRow(text.businessSignature,"signature",undefined,custom.signatureDataUrl?`data:image/png;base64,${custom.signatureDataUrl}`:undefined)}{navRow(text.terms,"terms",custom.termsConditions?`${custom.termsConditions.slice(0,28)}${custom.termsConditions.length>28?"…":""}`:undefined)}{navRow(text.labels,"labels")}<div className="control-row"><span>{text.fontSize}</span><div className="mini-segments">{(["s","m","l","xl"] as const).map(size=><button type="button" key={size} className={custom.fontSize===size?"active":""} onClick={()=>updateCustom("fontSize",size)}>{size.toUpperCase()}</button>)}</div></div><div className="control-row"><span>{text.lineSpacing}</span><div className="density-buttons">{(["compact","comfortable","roomy"] as const).map((space,index)=><button type="button" key={space} className={custom.lineSpacing===space?"active":""} aria-label={text[space]} onClick={()=>updateCustom("lineSpacing",space)}><Icon><path d={index===0?"M5 8h14M5 12h14M5 16h14":index===1?"M5 6h14M5 12h14M5 18h14":"M5 4h14M5 12h14M5 20h14"}/></Icon></button>)}</div></div>{checkRow(text.highContrast,custom.highContrast,(v)=>updateCustom("highContrast",v))}</div>}
        </div>
        <label className="default-design"><input type="checkbox" checked={saveDefault} onChange={(e)=>setSaveDefault(e.target.checked)}/><span>{text.defaults}</span></label>
        <button className="primary-button apply-design" disabled={saving} onClick={async()=>{setSaving(true);try{await onConfirm({...design,customizeJson:JSON.stringify(custom)},saveDefault);}finally{setSaving(false);}}}>{saving?text.saving:text.save}</button>
      </aside>
    </div>
    <nav className="customize-tabs" aria-label={text.title}>{tabs.map((item)=><button type="button" key={item.id} className={tab===item.id?"active":""} aria-current={tab===item.id?"page":undefined} onClick={()=>setTab(item.id)}>{item.icon}<span>{item.label}</span></button>)}</nav>
    {fullScreen&&<div className="document-overlay fullscreen-preview customize-fullscreen" role="dialog" aria-modal="true"><header className="document-overlay-head"><button type="button" onClick={()=>setFullScreen(false)}><BackIcon/><span>{text.back}</span></button><strong>{text.title}</strong><span/></header><div className="fullscreen-paper"><QuotePaper quote={preview} settings={previewSettings} lang={lang} kind={kind}/></div></div>}
    {renderedSheet}
  </div>;
}

async function downloadPdfAsImage(blob: Blob, filename: string) {
  const dataUrl = await blobDataUrl(blob);
  const result = await api.renderPdfPreview({ dataBase64: dataUrl.split(",")[1] ?? "" });
  const first = result.pagesBase64[0];
  if (!first) return;
  const bytes = Uint8Array.from(atob(first), (char) => char.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: "image/jpeg" }), filename.replace(/\.pdf$/i, ".jpg"));
}

function buildPaymentReceipt(invoice: Invoice, settings: Settings | null, lang: Lang) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text(lang === "es" ? "Recibo de pago" : "Payment receipt", 42, 56);
  doc.setFontSize(11); doc.setFont("helvetica", "normal");
  doc.text(settings?.companyName || "", 42, 82); doc.text(`${lang === "es" ? "Factura" : "Invoice"} #${invoice.id}`, 42, 118); doc.text(`${lang === "es" ? "Cliente" : "Client"}: ${invoice.clientName}`, 42, 140);
  doc.text(`${lang === "es" ? "Pagado" : "Paid"}: ${usd(Number(invoice.paidToDate))}`, 42, 174); doc.text(`${lang === "es" ? "Saldo" : "Balance"}: ${usd(Number(invoice.balanceRemaining))}`, 42, 196);
  doc.setDrawColor(210); doc.line(42, 218, 570, 218);
  let y = 244; for (const payment of invoice.payments) { doc.text(`${formatDate(payment.paymentDate, lang)}  ${payment.method || (lang === "es" ? "Pago" : "Payment")}`, 42, y); doc.text(usd(money(payment.amount)), 570, y, { align: "right" }); y += 24; }
  doc.setFontSize(9); doc.text(companyContact(settings), 42, 744); return doc.output("blob");
}

type EditableFinancial = Pick<FinancialDocument, "lineItems" | "discountType" | "discountValue" | "taxType" | "taxValue" | "footnote">;
function FinancialEditor({ lang, kind, document, onCancel, onSaved, onDelete }: { lang: Lang; kind: "invoice" | "quote"; document: FinancialDocument & { id: number }; onCancel: () => void; onSaved: () => void; onDelete: () => void }) {
  const t = copy[lang];
  const [form, setForm] = useState<EditableFinancial>({ lineItems: document.lineItems.map((item) => ({...item})), discountType: document.discountType, discountValue: document.discountValue, taxType: document.taxType, taxValue: document.taxValue, footnote: document.footnote });
  const [showDiscount, setShowDiscount] = useState(money(document.discountValue) > 0);
  const [showTax, setShowTax] = useState(money(document.taxValue) > 0);
  const [reorder, setReorder] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const totals = financialTotals(form.lineItems, form.discountType, showDiscount ? form.discountValue : "0", form.taxType, showTax ? form.taxValue : "0");
  const move = (index: number, direction: -1 | 1) => { const next = [...form.lineItems]; const target = index + direction; if (target < 0 || target >= next.length) return; const current = next[index]; const other = next[target]; if (!current || !other) return; next[index] = other; next[target] = current; setForm({...form,lineItems:next}); };
  const save = async () => { const items=form.lineItems.filter((item)=>item.description.trim()).map((item)=>({description:item.description,amount:item.amount,name:item.name??"",quantity:item.quantity??1,discount:item.discount??"0",unit:item.unit??"none" as const})); if(!items.length)return;setSaving(true);try{const payload={id:document.id,lineItems:items,discountType:form.discountType,discountValue:showDiscount?form.discountValue:"0",taxType:form.taxType,taxValue:showTax?form.taxValue:"0",subtotal:usd(totals.subtotal),total:usd(totals.total),footnote:form.footnote};if(kind==="invoice")await api.updateInvoiceDocument(payload);else await api.updateQuoteDocument(payload);onSaved();}finally{setSaving(false);}};
  return <div className="document-overlay editor-overlay" role="dialog" aria-modal="true" aria-label={lang === "es" ? "Editar documento" : "Edit document"}>
    <header className="document-overlay-head"><button onClick={onCancel}><BackIcon />{t.close}</button><strong>{kind === "invoice" ? t.invoices : (lang === "es" ? "Cotización" : "Estimate")}</strong><button className="small-button" onClick={() => void save()} disabled={saving}>{saving ? t.saving : t.save}</button></header>
    <div className="financial-editor">
      <section className="editor-section"><div className="section-title-row"><h2>{t.lineItems}</h2><button type="button" className="text-button" onClick={() => setReorder(!reorder)}>{reorder ? (lang === "es" ? "Listo" : "Done") : (lang === "es" ? "Reordenar" : "Reorder")}</button></div>{form.lineItems.map((item,index)=><article className="editor-line-item" key={index}>{reorder && <div className="reorder-buttons"><button type="button" aria-label={`${lang === "es" ? "Subir" : "Move up"} ${index+1}`} onClick={()=>move(index,-1)}>↑</button><button type="button" aria-label={`${lang === "es" ? "Bajar" : "Move down"} ${index+1}`} onClick={()=>move(index,1)}>↓</button></div>}<div className="line-item-fields"><input aria-label={`${t.item} ${index+1}`} value={item.description} onChange={(e)=>setForm({...form,lineItems:form.lineItems.map((x,i)=>i===index?{...x,description:e.target.value}:x)})}/><small>1 × {usd(money(item.amount))}</small></div><input className="amount-input" aria-label={`${t.amount} ${index+1}`} inputMode="decimal" value={item.amount} onChange={(e)=>setForm({...form,lineItems:form.lineItems.map((x,i)=>i===index?{...x,amount:e.target.value}:x)})}/></article>)}<button className="primary-button add-item-wide" type="button" onClick={()=>setForm({...form,lineItems:[...form.lineItems,{description:"",amount:""}]})}><PlusIcon />{lang === "es" ? "Agregar artículo" : "Add item"}</button></section>
      <section className="editor-section totals-editor"><div><span>{t.subtotal}</span><strong>{usd(totals.subtotal)}</strong></div>{!showDiscount?<button type="button" onClick={()=>setShowDiscount(true)}>+ {t.discount}</button>:<AdjustmentField lang={lang} label={t.discount} type={form.discountType} value={form.discountValue} onType={(discountType)=>setForm({...form,discountType})} onValue={(discountValue)=>setForm({...form,discountValue})}/>} {!showTax?<button type="button" onClick={()=>setShowTax(true)}>+ {t.tax}</button>:<AdjustmentField lang={lang} label={t.tax} type={form.taxType} value={form.taxValue} onType={(taxType)=>setForm({...form,taxType})} onValue={(taxValue)=>setForm({...form,taxValue})}/>}<div className="editor-grand-total"><span>{t.total}</span><strong>{usd(totals.total)}</strong></div></section>
      {kind === "invoice" && <section className="editor-section"><div className="section-title-row"><h2>{t.partialPayments}</h2><button type="button" onClick={()=>setPaymentOpen(!paymentOpen)}>+ {lang === "es" ? "Agregar pago" : "Add payment"}</button></div><div className="balance-row"><span>{t.balanceRemaining}</span><strong>{usd(Math.max(0, totals.total - Number(document.paidToDate ?? "0")))}</strong></div><label className="switch-row"><span>{lang === "es" ? "Marcar como pagada" : "Mark as paid"}</span><input type="checkbox" checked={document.status === "paid"} onChange={async(e)=>{await api.toggleInvoicePaid({id:document.id,paid:e.target.checked});onSaved();}}/></label>{paymentOpen&&<div className="compact-form"><label><span>{t.amount}</span><input inputMode="decimal" value={amount} onChange={(e)=>setAmount(e.target.value)}/></label><label><span>{t.method}</span><input value={method} onChange={(e)=>setMethod(e.target.value)}/></label><label><span>{t.notes}</span><input value={note} onChange={(e)=>setNote(e.target.value)}/></label><button type="button" className="secondary-button" onClick={async()=>{if(money(amount)<=0)return;await api.addPayment({invoiceId:document.id,amount,paymentDate:new Date().toISOString().slice(0,10),method,note});setAmount("");setMethod("");setNote("");setPaymentOpen(false);onSaved();}}>{t.recordPayment}</button></div>}</section>}
      <section className="editor-section"><label><span>{t.notes}</span><textarea rows={4} value={form.footnote} onChange={(e)=>setForm({...form,footnote:e.target.value})}/></label><small className="muted-note">{lang === "es" ? "Tu nota predeterminada, incluida la tarifa de procesamiento de tarjeta del 3%, está disponible desde Configuración." : "Your saved default note, including the 3% card processing fee, stays available from Settings."}</small></section>
      {!confirmDelete?<button className="danger-button editor-delete" type="button" onClick={()=>setConfirmDelete(true)}><TrashIcon />{kind === "invoice" ? (lang === "es" ? "Eliminar factura" : "Delete invoice") : (lang === "es" ? "Eliminar cotización" : "Delete estimate")}</button>:<div className="delete-confirm"><strong>{lang === "es" ? "¿Eliminar permanentemente?" : "Delete permanently?"}</strong><button className="danger-button" onClick={onDelete}>{lang === "es" ? "Sí, eliminar" : "Yes, delete"}</button><button onClick={()=>setConfirmDelete(false)}>{lang === "es" ? "Cancelar" : "Cancel"}</button></div>}
    </div>
  </div>;
}

function SignatureDialog({lang,kind,id,onClose,onSaved}:{lang:Lang;kind:"invoice"|"quote";id:number;onClose:()=>void;onSaved:()=>void}){
 const [name,setName]=useState("");const [signature,setSignature]=useState("");const [saving,setSaving]=useState(false);return <div className="sheet-backdrop" role="presentation"><section className="signature-sheet" role="dialog" aria-modal="true" aria-label={lang==="es"?"Firma del cliente":"Client signature"}><div className="sheet-handle"/><div className="section-title-row"><h2>{lang==="es"?"Firma del cliente":"Client signature"}</h2><button onClick={onClose}>{copy[lang].close}</button></div><label><span>{lang==="es"?"Nombre del firmante":"Signer name"}</span><input value={name} onChange={(e)=>setName(e.target.value)}/></label><SignaturePad label={copy[lang].signature} clearLabel={copy[lang].clear} onChange={setSignature}/><button className="primary-button" disabled={!name.trim()||!signature||saving} onClick={async()=>{setSaving(true);try{await api.saveFinancialSignature({kind,id,signerName:name,signatureDataBase64:signature});onSaved();}finally{setSaving(false);}}}>{saving?copy[lang].saving:(lang==="es"?"Guardar firma":"Save signature")}</button></section></div>;
}

function QuotePreview({
  lang,
  quoteId,
  settings,
  onBack,
  setScreen,
  onOpenQuote,
  onOpenInvoice,
}: {
  lang: Lang;
  quoteId: number;
  settings: Settings | null;
  onBack: () => void;
  setScreen: (screen: Screen) => void;
  onOpenQuote: (id: number) => void;
  onOpenInvoice: (id: number) => void;
}) {
  const t = copy[lang], qc = useQueryClient();
  const query = useQuery({ queryKey: ["quotes"], queryFn: () => api.listQuotes({}) });
  const quote = query.data?.quotes.find((q) => q.id === quoteId);
  const signature = useQuery({ queryKey:["financial-signature","quote",quoteId], queryFn:()=>api.getFinancialSignature({kind:"quote",id:quoteId}) });
  const versions = useQuery({ queryKey:["quote-versions",quoteId], queryFn:()=>api.getQuoteVersions({id:quoteId}) });
  const [blob, setBlob] = useState<Blob | null>(null);
  const [designOpen, setDesignOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { if (quote) void buildQuotePdf(quote, settings, lang).then(setBlob); }, [quote, settings, lang]);
  const duplicate = useMutation({mutationFn:()=>api.duplicateQuote({id:quoteId}),onSuccess:async(r)=>{await qc.invalidateQueries({queryKey:["quotes"]});setMoreOpen(false);onOpenQuote(r.id);}});
  const convert = useMutation({mutationFn:()=>api.convertQuoteToInvoice({quoteId:quoteId}),onSuccess:async(r)=>{await qc.invalidateQueries({queryKey:["invoices"]});await qc.invalidateQueries({queryKey:["quotes"]});onOpenInvoice(r.invoiceId);}});
  const [confirmConvert, setConfirmConvert] = useState(false);
  const remove = useMutation({mutationFn:()=>api.deleteQuote({id:quoteId}),onSuccess:async()=>{await qc.invalidateQueries({queryKey:["quotes"]});onBack();}});
  if (!quote) return <main className="page"><PageHeader lang={lang} title={lang === "es" ? "Cotización" : "Estimate"} onBack={onBack}/><div className="loading-block"/></main>;
  const filename = `${safeName(quote.clientName)}-estimate-${quote.id}.pdf`;
  const status = quote.accepted || quote.automationStatus === "won" ? (lang === "es" ? "Aceptada" : "Accepted") : quote.automationStatus === "lost" ? (lang === "es" ? "Perdida" : "Lost") : quote.sentAt ? (lang === "es" ? "Abierta" : "Opened") : (lang === "es" ? "Borrador" : "Draft");
  const refresh=async()=>{await qc.invalidateQueries({queryKey:["quotes"]});await qc.invalidateQueries({queryKey:["quote-versions",quoteId]});};
  return <main className="page financial-detail-page">
    <PageHeader lang={lang} title={`EST${String(quote.id).padStart(4,"0")}`} onBack={onBack} actions={<button className="customize-button" onClick={()=>setDesignOpen(true)}>{lang==="es"?"Personalizar":"Customize"}</button>}/>
    <button className="document-preview-card" onClick={()=>setFullScreen(true)} aria-label={lang==="es"?"Abrir vista previa completa":"Open full-screen preview"}><QuotePaper quote={quote} settings={settings} lang={lang}/><span>{lang==="es"?"Toca para ampliar":"Tap to enlarge"}</span></button>
    <section className="document-detail-summary"><div><span>{t.total}</span><strong>{usd(money(quote.total))}</strong></div><span className={`status-chip ${quote.accepted?"paid":quote.sentAt?"sent":"draft"}`}>{status}</span><ViewedBadge lang={lang} kind="quote" id={quote.id} /><div className="record-links"><button onClick={() => quote.clientId ? setScreen({ name: "client", clientId: quote.clientId }) : setScreen({ name: "clients" })}>{quote.clientName}</button>{quote.jobId && <button onClick={() => setScreen({ name: "detail", jobId: quote.jobId as number })}>{lang === "es" ? "Ver trabajo" : "View job"}</button>}</div>{signature.data?.signature&&<small className="signed-label"><CheckIcon/>{lang==="es"?"Firmada por":"Signed by"} {signature.data.signature.signerName}</small>}</section>
    <button className="primary-button send-document" disabled={!blob} onClick={async()=>{if(!quote.sentAt)await api.sendQuoteVersion({id:quote.id});await refresh();if(blob)await nativeShare(blob,filename,lang==="es"?"Cotización":"Estimate");}}><ShareIcon/>{lang==="es"?"Enviar cotización":"Send estimate"}</button>
    <DocumentLinkPanel lang={lang} kind="quote" id={quote.id} />
    <details className="action-details version-details"><summary>{lang==="es"?"Historial de versiones":"Version history"}</summary>{versions.data?.versions.map((version)=><div className="version-compact" key={version.id}><span>v{version.versionNumber}</span><small>{version.accepted?(lang==="es"?"Aceptada":"Accepted"):version.sentAt?(lang==="es"?"Enviada":"Sent"):(lang==="es"?"Borrador":"Draft")}</small><strong>{usd(money(version.total))}</strong></div>)}</details>
    <div className="document-action-bar" role="toolbar" aria-label={lang==="es"?"Acciones de cotización":"Estimate actions"}><button onClick={()=>setEditing(true)}><GearIcon/><span>{lang==="es"?"Editar":"Edit"}</span></button><button onClick={async()=>{await api.updateQuoteAutomationStatus({id:quote.id,status:quote.accepted?"awaiting":"won",lostReason:null,lostNote:""});await refresh();}}><CheckIcon/><span>{quote.accepted?(lang==="es"?"Reabrir":"Reopen"):(lang==="es"?"Aceptar":"Accept")}</span></button><button onClick={()=>setMoreOpen(true)}><Icon><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></Icon><span>{lang==="es"?"Más":"More"}</span></button></div>
    {fullScreen&&<div className="document-overlay fullscreen-preview" role="dialog" aria-modal="true"><header className="document-overlay-head"><button onClick={()=>setFullScreen(false)}><BackIcon/>{t.close}</button><strong>{APP_INFO.name} · {lang==="es"?"Vista previa":"Preview"}</strong><span/></header><div className="fullscreen-paper"><QuotePaper quote={quote} settings={settings} lang={lang}/></div></div>}
    {editing&&<FinancialEditor lang={lang} kind="quote" document={quote} onCancel={()=>setEditing(false)} onSaved={async()=>{await refresh();setEditing(false);}} onDelete={()=>remove.mutate()}/>} 
    {designOpen&&<DocumentDesignOverlay lang={lang} kind="quote" document={quote} settings={settings} onClose={()=>setDesignOpen(false)} onConfirm={async(design,saveDefault)=>{await api.updateQuoteDesign({id:quote.id,...design});if(saveDefault)await api.saveDocumentDesignDefault(design);await refresh();await qc.invalidateQueries({queryKey:["settings"]});setDesignOpen(false);}}/>}
    {signatureOpen&&<SignatureDialog lang={lang} kind="quote" id={quote.id} onClose={()=>setSignatureOpen(false)} onSaved={async()=>{await qc.invalidateQueries({queryKey:["financial-signature","quote",quoteId]});setSignatureOpen(false);}}/>}
    {moreOpen&&<div className="sheet-backdrop" role="presentation" onClick={(e)=>{if(e.target===e.currentTarget)setMoreOpen(false);}}><section className="more-sheet" role="dialog" aria-modal="true" aria-label={lang==="es"?"Más acciones":"More actions"}><div className="sheet-handle"/><h2>{lang==="es"?"Opciones de cotización":"Estimate options"}</h2>{settings?.onlineSignatureEnabled !== false && <button onClick={()=>{setMoreOpen(false);setSignatureOpen(true);}}><Icon><path d="M4 18c5-7 8 3 16-8M5 21h14"/></Icon><span>{signature.data?.signature?(lang==="es"?"Actualizar firma":"Update client signature"):(lang==="es"?"Obtener firma del cliente":"Collect client signature")}</span></button>}{quote.convertedToInvoiceId?<button onClick={()=>onOpenInvoice(quote.convertedToInvoiceId as number)}><FileIcon/><span>{lang==="es"?"Ver factura creada":"View created invoice"}</span></button>:!confirmConvert?<button onClick={()=>setConfirmConvert(true)}><FileIcon/><span>{lang==="es"?"Convertir en factura":"Convert estimate to invoice"}</span></button>:<div className="sheet-delete-confirm"><strong>{lang==="es"?`¿Crear factura por ${usd(money(quote.total))} para ${quote.clientName}?`:`Create a ${usd(money(quote.total))} invoice for ${quote.clientName}?`}</strong><button className="primary-button" disabled={convert.isPending} onClick={()=>{setConfirmConvert(false);convert.mutate();}}>{lang==="es"?"Sí, crear factura":"Yes, create invoice"}</button><button onClick={()=>setConfirmConvert(false)}>{lang==="es"?"Cancelar":"Cancel"}</button></div>}<button disabled={!blob} onClick={()=>blob&&nativeShare(blob,filename,lang==="es"?"Cotización":"Estimate")}><ShareIcon/><span>{lang==="es"?"Compartir PDF":"Share PDF"}</span></button><button disabled={!blob} onClick={()=>blob&&downloadPdfAsImage(blob,filename)}><CameraIcon/><span>{lang==="es"?"Descargar como imagen":"Download as image"}</span></button><button className="duplicate-action" disabled={duplicate.isPending} onClick={()=>duplicate.mutate()}><Icon><path d="M8 8h11v11H8zM5 16H3V3h13v2"/></Icon><span>{lang==="es"?"Duplicar cotización":"Duplicate estimate"}</span></button>{!confirmDelete?<button className="danger-row" onClick={()=>setConfirmDelete(true)}><TrashIcon/><span>{lang==="es"?"Eliminar cotización":"Delete estimate"}</span></button>:<div className="sheet-delete-confirm"><strong>{lang==="es"?"¿Eliminar permanentemente?":"Delete permanently?"}</strong><button className="danger-button" onClick={()=>remove.mutate()}>{lang==="es"?"Sí, eliminar":"Yes, delete"}</button><button onClick={()=>setConfirmDelete(false)}>{lang==="es"?"Cancelar":"Cancel"}</button></div>}</section></div>}
  </main>;
}

function InvoicesScreen({
  lang,
  settings,
  onBack,
  setScreen,
}: {
  lang: Lang;
  settings: Settings | null;
  onBack: () => void;
  setScreen: (s: Screen) => void;
}) {
  const t = copy[lang];
  const qc = useQueryClient();
  const [tab, setTab] = useState<"invoices" | "estimates">("invoices");
  const [confirmConvertQuoteId, setConfirmConvertQuoteId] = useState<number | null>(null);
  const schedulesQuery = useQuery({ queryKey: ["recurring-schedules"], queryFn: () => api.listRecurringSchedules({}) });
  const cancelSchedule = useMutation({ mutationFn: (id: number) => api.cancelRecurringSchedule({ id }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["recurring-schedules"] }); } });
  const activeSchedules = (schedulesQuery.data?.schedules ?? []).filter((s) => s.active);
  const query = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api.listInvoices({}),
  });
  const quotes = useQuery({ queryKey: ["quotes"], queryFn: () => api.listQuotes({}) });
  const sortDocuments = <T extends { clientName: string; createdAt: string; dueDate?: string }>(rows: T[]) => [...rows].sort((a, b) => {
    if (settings?.invoiceGroupBy === "client") return a.clientName.localeCompare(b.clientName);
    if (settings?.invoiceGroupBy === "due_date") return (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31");
    return b.createdAt.localeCompare(a.createdAt);
  });
  const sortedInvoices = sortDocuments(query.data?.invoices ?? []);
  const sortedQuotes = sortDocuments((quotes.data?.quotes ?? []).map((quote) => ({ ...quote, dueDate: quote.expiryDate })));
  const estimateWord = settings?.convertToQuote ? (lang === "es" ? "Cotizaciones" : "Quotes") : (lang === "es" ? "Presupuestos" : "Estimates");
  const convertQuote = useMutation({ mutationFn: (id: number) => api.convertQuoteToJob({ id }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["quotes"] }); qc.invalidateQueries({ queryKey: ["jobs"] }); } });
  const quoteInvoice = useMutation({ mutationFn: (id: number) => api.convertQuoteToInvoice({ quoteId: id }), onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["invoices"] }); setScreen({ name: "invoicePreview", invoiceId: r.invoiceId }); } });
  const status = useMutation({
    mutationFn: ({ id, status }: { id: number; status: InvoiceStatus }) =>
      api.updateInvoiceStatus({ id, status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["invoices"] }),
  });
  const generate = useMutation({
    mutationFn: (id: number) => api.generateRecurringInvoice({ id }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setScreen({ name: "invoicePreview", invoiceId: r.invoiceId });
    },
  });
  const today = new Date().toISOString().slice(0, 10);
  const recurringDue = sortedInvoices.filter(
    (i) =>
      i.recurringFrequency !== "none" &&
      i.nextDueDate &&
      i.nextDueDate <= today,
  );
  const month = today.slice(0, 7);
  const invoicedMonth = sortedInvoices.filter((invoice) => invoice.issueDate.slice(0, 7) === month).reduce((sum, invoice) => sum + money(invoice.totalWithLateFee), 0);
  const balanceDue = sortedInvoices.reduce((sum, invoice) => sum + Number(invoice.balanceRemaining), 0);
  const estimatedMonth = sortedQuotes.filter((quote) => (quote.sentAt || quote.createdAt).slice(0, 7) === month).reduce((sum, quote) => sum + money(quote.total), 0);
  return (
    <main className="page">
      <PageHeader lang={lang} title={lang === "es" ? `Facturas y ${estimateWord.toLowerCase()}` : `Invoices & ${estimateWord.toLowerCase()}`} onBack={onBack} />
      {tab === "invoices"
        ? <OfflineCacheNote lang={lang} action="listInvoices" isLoading={query.isLoading} />
        : <OfflineCacheNote lang={lang} action="listQuotes" isLoading={quotes.isLoading} />}
      <nav className="document-tabs" aria-label={lang === "es" ? "Documentos" : "Documents"}><button className={tab === "invoices" ? "active" : ""} onClick={() => setTab("invoices")}>{lang === "es" ? "Facturas" : "Invoices"}</button><button className={tab === "estimates" ? "active" : ""} onClick={() => setTab("estimates")}>{estimateWord}</button></nav>
      <section className="document-hero"><span>{tab === "invoices" ? (lang === "es" ? "Facturado este mes" : "Invoiced this month") : (lang === "es" ? "Cotizado este mes" : "Estimated this month")}</span><strong>{usd(tab === "invoices" ? invoicedMonth : estimatedMonth)}</strong>{tab === "invoices" && <small>{lang === "es" ? "Saldo pendiente" : "Balance due"}: {usd(balanceDue)}</small>}</section>
      <div className="page-actions document-create">
        <button className="primary-button" onClick={() => setScreen(tab === "invoices" ? { name: "invoiceNew" } : { name: "quoteNew" })}><PlusIcon />{tab === "invoices" ? (lang === "es" ? "CREAR FACTURA" : "CREATE INVOICE") : (lang === "es" ? `CREAR ${estimateWord.toUpperCase()}` : `CREATE ${estimateWord.toUpperCase()}`)}</button>
      </div>
      {tab === "invoices" && recurringDue.length > 0 && (
        <section className="recurring-panel">
          <h2>{t.recurringDue}</h2>
          {recurringDue.map((invoice) => (
            <article key={invoice.id}>
              <span>
                <strong>{invoice.clientName}</strong>
                <small>
                  {invoice.nextDueDate} ·{" "}
                  {invoice.recurringFrequency === "weekly"
                    ? t.weekly
                    : t.monthly}
                </small>
              </span>
              <button
                className="small-button"
                onClick={() => generate.mutate(invoice.id)}
              >
                {t.generateNext}
              </button>
            </article>
          ))}
        </section>
      )}
      {tab === "invoices" && activeSchedules.length > 0 && (
        <section className="recurring-panel">
          <h2>{lang === "es" ? "Facturas recurrentes activas" : "Active recurring invoices"}</h2>
          {activeSchedules.map((s) => (
            <article key={s.id}>
              <span>
                <strong>{s.clientName}</strong>
                <small>
                  {s.frequency === "weekly" ? (lang === "es" ? "Semanal" : "Weekly") : (lang === "es" ? "Mensual" : "Monthly")} · {lang === "es" ? "Próxima" : "Next"}: {formatDate(s.nextRunDate, lang)} · {usd(money(s.total))}
                </small>
              </span>
              <button
                className="small-button"
                onClick={() => setScreen({ name: "invoicePreview", invoiceId: s.invoiceId })}
              >
                {lang === "es" ? "Ver" : "View"}
              </button>
              <button
                className="small-button danger-button"
                disabled={cancelSchedule.isPending}
                onClick={() => cancelSchedule.mutate(s.id)}
              >
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
            </article>
          ))}
        </section>
      )}
      {tab === "invoices" ? <section className="quote-list document-list">
        {sortedInvoices.map((invoice) => (
          <article key={invoice.id}>
            <div className="document-row-copy">
              <span className={`status-chip ${invoice.status}`}>{invoice.status === "paid" ? t.paid : invoice.status === "overdue" ? t.overdueStatus : invoice.status === "draft" ? t.draft : t.sent}</span>
              <h2>{invoice.clientName}</h2>
              <p>{invoice.jobType || t.invoices} · {usd(money(invoice.totalWithLateFee))}</p>
              <small>#{invoice.id} · {t.balanceRemaining}: {usd(Number(invoice.balanceRemaining))}{invoice.recurringFrequency !== "none" ? ` · ${t.recurring}` : ""}</small>
            </div>
            <div className="row-actions">
              <select value={invoice.status} onChange={(e) => status.mutate({ id: invoice.id, status: e.target.value as InvoiceStatus })} aria-label={`${t.invoiceStatus} #${invoice.id}`}><option value="draft">{t.draft}</option><option value="sent">{t.sent}</option><option value="paid">{t.paid}</option><option value="overdue">{t.overdueStatus}</option></select>
              <button onClick={() => setScreen({ name: "invoicePreview", invoiceId: invoice.id })}>{t.viewDocument}</button>
            </div>
          </article>
        ))}
        {query.data?.invoices.length === 0 && <div className="empty-state"><h2>{t.invoiceEmpty}</h2></div>}
      </section> : <section className="quote-list document-list">
        {sortedQuotes.map((quote) => (
          <article key={quote.id}>
            <div className="document-row-copy">
              <span className={`status-chip ${quote.accepted || quote.automationStatus === "won" ? "paid" : quote.automationStatus === "lost" ? "overdue" : "sent"}`}>{quote.accepted || quote.automationStatus === "won" ? (lang === "es" ? "Aceptada" : "Accepted") : quote.automationStatus === "lost" ? (lang === "es" ? "Perdida" : "Lost") : (lang === "es" ? "Pendiente" : "Pending")}</span>
              <h2>{quote.clientName}</h2><p>{quote.jobType || t.quoteBuilder} · {usd(money(quote.total))}</p><small>#{quote.id} · v{quote.versionNumber}{quote.expiryDate ? ` · ${formatDate(quote.expiryDate, lang)}` : ""}</small>
            </div>
            <div className="row-actions"><button onClick={() => setScreen({ name: "quotePreview", quoteId: quote.id })}>{t.previewPdf}</button>{quote.convertedToInvoiceId ? <button onClick={() => setScreen({ name: "invoicePreview", invoiceId: quote.convertedToInvoiceId as number })}>{lang === "es" ? "Ver factura" : "View invoice"}</button> : confirmConvertQuoteId === quote.id ? <><strong>{lang === "es" ? `¿Crear factura de ${usd(money(quote.total))}?` : `Create ${usd(money(quote.total))} invoice?`}</strong><button className="primary-button" disabled={quoteInvoice.isPending} onClick={() => { setConfirmConvertQuoteId(null); quoteInvoice.mutate(quote.id); }}>{lang === "es" ? "Sí, crear" : "Yes, create"}</button><button onClick={() => setConfirmConvertQuoteId(null)}>{lang === "es" ? "Cancelar" : "Cancel"}</button></> : <button onClick={() => setConfirmConvertQuoteId(quote.id)}>{t.convertInvoice}</button>}{!quote.jobId && <button onClick={() => convertQuote.mutate(quote.id)}>{t.convertJob}</button>}</div>
          </article>
        ))}
        {quotes.data?.quotes.length === 0 && <div className="empty-state"><h2>{t.quoteEmpty}</h2></div>}
      </section>}
    </main>
  );
}
function InvoiceBuilder({
  lang,
  settings,
  jobId,
  onBack,
}: {
  lang: Lang;
  settings: Settings | null;
  jobId?: number;
  onBack: () => void;
}) {
  const t = copy[lang];
  const qc = useQueryClient();
  const jobQuery = useQuery({ queryKey: ["job", jobId], enabled: Boolean(jobId), queryFn: () => api.getJob({ id: jobId ?? 0 }) });
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const [activeSheet, setActiveSheet] = useState<"details" | "discount" | "tax" | null>(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [error, setError] = useState("");
  const [discountEnabled, setDiscountEnabled] = useState(false);
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [form, setForm] = useState({
    invoiceNumber: "", quoteId: null as number | null, jobId: jobId ?? (null as number | null), clientId: null as number | null,
    clientName: "", clientPhone: "", clientEmail: "", jobAddress: "", shippingAddress: "", jobType: "",
    issueDate: new Date().toLocaleDateString("en-CA"), dueDate: "", status: "draft" as InvoiceStatus,
    recurringFrequency: "none" as "none" | "daily" | "weekly" | "monthly" | "quarterly", nextDueDate: "", recurringEndDate: "",
    theme: (settings?.defaultQuoteTheme ?? "classic") as QuoteTheme, font: (settings?.defaultDocumentFont ?? "helvetica") as DocumentFont,
    accentColor: settings?.accentColor ?? "#1f5a4a", showTaxLine: settings?.defaultShowTaxLine ?? true,
    showDiscountLine: settings?.defaultShowDiscountLine ?? true, showPaidLine: settings?.defaultShowPaidLine ?? true,
    showPaymentTerms: settings?.defaultShowPaymentTerms ?? true, showFooterNotes: settings?.defaultShowFooterNotes ?? true,
    showLogo: settings?.defaultShowLogo ?? true, showCompanyInfo: settings?.defaultShowCompanyInfo ?? true,
    customizeJson: settings?.defaultCustomizeJson ?? JSON.stringify(defaultDocumentCustomize("invoice", lang)),
    footnote: settings?.defaultFootnote ?? "", discountType: "percent" as AdjustmentType, discountValue: "0",
    taxType: "percent" as AdjustmentType, taxValue: "0",
    lineItems: [{ name: "", description: "", amount: "", quantity: 1, discount: "0", unit: "none" as "none" | "days" | "hours" }],
  });
  useEffect(() => {
    const job = jobQuery.data?.job;
    if (job && !form.clientName) setForm((v) => ({ ...v, clientId: job.clientId, clientName: job.clientName, clientPhone: job.clientPhone, clientEmail: job.clientEmail, jobAddress: job.jobAddress, jobType: job.jobType }));
  }, [jobQuery.data, form.clientName]);
  useEffect(() => {
    if (!form.invoiceNumber && invoicesQuery.data) {
      const highest = invoicesQuery.data.invoices.reduce((max, invoice) => Math.max(max, invoice.id), 0);
      setForm((v) => ({ ...v, invoiceNumber: `INV-${String(highest + 1).padStart(4, "0")}` }));
    }
  }, [invoicesQuery.data, form.invoiceNumber]);
  const totals = financialTotals(form.lineItems, form.discountType, discountEnabled ? form.discountValue : "0", form.taxType, taxEnabled ? form.taxValue : "0");
  const closeSheet = () => { setSheetClosing(true); window.setTimeout(() => { setActiveSheet(null); setSheetClosing(false); }, 180); };
  const validItems = form.lineItems.filter((item) => item.name.trim() || item.description.trim()).map((item) => ({ ...item, description: item.description.trim() || item.name.trim() }));
  const save = useMutation({
    mutationFn: () => api.saveInvoice({ ...form, lineItems: validItems, discountValue: discountEnabled ? form.discountValue : "0", taxValue: taxEnabled ? form.taxValue : "0", subtotal: usd(totals.subtotal), total: usd(totals.total) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["invoices"] }); qc.invalidateQueries({ queryKey: ["clients"] }); onBack(); },
    onError: () => setError(t.error),
  });
  const preview: FinancialDocument = { ...form, lineItems: validItems.length ? validItems : form.lineItems, discountValue: discountEnabled ? form.discountValue : "0", taxValue: taxEnabled ? form.taxValue : "0", subtotal: usd(totals.subtotal), total: usd(totals.total) };
  const updateItem = (index: number, patch: Partial<(typeof form.lineItems)[number]>) => setForm((current) => ({ ...current, lineItems: current.lineItems.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  const dateSummary = `${form.issueDate ? formatDate(form.issueDate, lang) : (lang === "es" ? "Fecha" : "Issue date")}  →  ${form.dueDate ? formatDate(form.dueDate, lang) : (lang === "es" ? "Sin vencimiento" : "No due date")}  ·  ${form.invoiceNumber || "INV-…"}`;
  return <main className="page form-page invoice-builder-page">
    <PageHeader lang={lang} title={t.newInvoice} onBack={onBack} actions={<button className="small-button preview-trigger" type="button" onClick={() => setPreviewOpen(true)}><FileIcon />{t.previewPdf}</button>} />
    <form className="job-form invoice-fly-form" onSubmit={(event) => { event.preventDefault(); if (!form.clientName.trim() || !validItems.length) { setError(t.required); return; } save.mutate(); }}>
      <ClientPicker lang={lang} value={form.clientName} onValueChange={(clientName) => setForm({ ...form, clientId: null, clientName })} onPick={(client) => setForm({ ...form, clientId: client.id, clientName: client.name, clientPhone: client.phone, clientEmail: client.email, jobAddress: client.address })} />
      <button className="invoice-summary-line" type="button" onClick={() => setActiveSheet("details")}><span>{dateSummary}</span><b>›</b></button>
      <details className="action-details editor-advanced"><summary>{lang === "es" ? "Detalles del cliente" : "Client details"}</summary><div className="compact-form">
        <div className="field-pair"><label><span>{t.phone}</span><input type="tel" value={form.clientPhone} onChange={(e) => setForm({ ...form, clientPhone: e.target.value })}/></label><label><span>{t.email}</span><input type="email" value={form.clientEmail} onChange={(e) => setForm({ ...form, clientEmail: e.target.value })}/></label></div>
        <label><span>{t.type}</span><input value={form.jobType} onChange={(e) => setForm({ ...form, jobType: e.target.value })}/></label>
        {settings?.addJobSiteAddress !== false && <label><span>{lang === "es" ? "Dirección del trabajo" : "Job site address"}</span><input value={form.jobAddress} onChange={(e) => setForm({ ...form, jobAddress: e.target.value })}/></label>}
        {settings?.addShippingAddress && <label><span>{lang === "es" ? "Dirección de envío" : "Shipping address"}</span><input value={form.shippingAddress} onChange={(e) => setForm({ ...form, shippingAddress: e.target.value })}/></label>}
      </div></details>
      <fieldset className="form-section invoice-items-section"><legend>{t.lineItems}</legend>
        {form.lineItems.map((item, index) => { const qtyLabel = item.unit === "days" ? (lang === "es" ? "Días" : "Days") : item.unit === "hours" ? (lang === "es" ? "Horas" : "Hours") : (lang === "es" ? "Cant." : "Qty"); const lineTotal = Math.max(0, money(item.amount) * item.quantity - money(item.discount)); return <article className="invoice-line-card" key={index}>
          <div className="invoice-line-head"><strong>{lang === "es" ? `Partida ${index + 1}` : `Item ${index + 1}`}</strong>{form.lineItems.length > 1 && <button type="button" aria-label={lang === "es" ? "Eliminar partida" : "Remove item"} onClick={() => setForm({ ...form, lineItems: form.lineItems.filter((_, i) => i !== index) })}>×</button>}</div>
          <label><span>{lang === "es" ? "Nombre" : "Name"}</span><input value={item.name} onChange={(e) => updateItem(index, { name: e.target.value })} placeholder={lang === "es" ? "Trabajo o material" : "Work or material"}/></label>
          <label><span>{lang === "es" ? "Descripción" : "Description"}</span><textarea rows={2} value={item.description} onChange={(e) => updateItem(index, { description: e.target.value })} placeholder={lang === "es" ? "Qué incluye" : "What’s included"}/></label>
          <div className="invoice-line-grid"><label><span>{lang === "es" ? "Precio" : "Price"}</span><input inputMode="decimal" value={item.amount} onChange={(e) => updateItem(index, { amount: e.target.value })} placeholder="$0.00"/></label><label><span>{qtyLabel}</span><input inputMode="decimal" type="number" min="0" step="any" value={item.quantity} onChange={(e) => updateItem(index, { quantity: Number(e.target.value) })}/></label></div>
          <div className="invoice-line-grid"><label><span>{lang === "es" ? "Descuento de partida" : "Item discount"}</span><input inputMode="decimal" value={item.discount} onChange={(e) => updateItem(index, { discount: e.target.value })} placeholder="$0.00"/></label><label><span>{lang === "es" ? "Unidad" : "Unit"}</span><select value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value as "none" | "days" | "hours" })}><option value="none">{lang === "es" ? "Ninguna" : "None"}</option><option value="days">{lang === "es" ? "Días" : "Days"}</option><option value="hours">{lang === "es" ? "Horas" : "Hours"}</option></select></label></div>
          <div className="invoice-line-total"><span>{lang === "es" ? "Total de partida" : "Item total"}</span><strong>{usd(lineTotal)}</strong></div>
        </article>})}
        <button className="secondary-button" type="button" onClick={() => setForm({ ...form, lineItems: [...form.lineItems, { name: "", description: "", amount: "", quantity: 1, discount: "0", unit: "none" }] })}><PlusIcon />{t.addLine}</button>
      </fieldset>
      <section className="invoice-totals-block"><div><span>{t.subtotal}</span><strong>{usd(totals.subtotal)}</strong></div>
        {!discountEnabled ? <button type="button" onClick={() => setActiveSheet("discount")}><span>＋ {t.discount}</span><b>›</b></button> : <button type="button" onClick={() => setActiveSheet("discount")}><span>{t.discount}</span><strong>-{usd(totals.discount)}</strong></button>}
        {!taxEnabled ? <button type="button" onClick={() => setActiveSheet("tax")}><span>＋ {t.tax}</span><b>›</b></button> : <button type="button" onClick={() => setActiveSheet("tax")}><span>{t.tax}</span><strong>{usd(totals.tax)}</strong></button>}
        <div className="invoice-grand-total"><span>{t.total}</span><strong>{usd(totals.total)}</strong></div>
      </section>
      <details className="action-details editor-advanced"><summary>{lang === "es" ? "Facturación avanzada" : "Advanced billing"}</summary><div className="compact-form">
        <label><span>{t.invoiceStatus}</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as InvoiceStatus })}><option value="draft">{t.draft}</option><option value="sent">{t.sent}</option><option value="paid">{t.paid}</option><option value="overdue">{t.overdueStatus}</option></select></label>
        <label><span>{t.recurring}</span><select value={form.recurringFrequency} onChange={(e) => setForm({ ...form, recurringFrequency: e.target.value as typeof form.recurringFrequency })}><option value="none">{t.none}</option><option value="daily">{lang === "es" ? "Diaria" : "Daily"}</option><option value="weekly">{t.weekly}</option><option value="monthly">{t.monthly}</option><option value="quarterly">{lang === "es" ? "Trimestral" : "Quarterly"}</option></select></label>
        {form.recurringFrequency !== "none" && <><label><span>{t.nextDue}</span><input type="date" value={form.nextDueDate} onChange={(e) => setForm({ ...form, nextDueDate: e.target.value })}/></label><label><span>{lang === "es" ? "Termina (opcional)" : "Ends (optional)"}</span><input type="date" value={form.recurringEndDate} onChange={(e) => setForm({ ...form, recurringEndDate: e.target.value })}/></label></>}
      </div></details>
      <label><span>{t.footnote}</span><textarea rows={3} value={form.footnote} onChange={(e) => setForm({ ...form, footnote: e.target.value })}/></label>
      {error && <p className="status error">{error}</p>}
      <button className="primary-button sticky-submit" disabled={save.isPending}>{save.isPending ? t.saving : t.saveInvoice}</button>
    </form>
    {activeSheet && <div className={`client-sheet-backdrop${sheetClosing ? " closing" : ""}`} role="presentation" onClick={(e) => { if (e.target === e.currentTarget) closeSheet(); }}><section className="client-sheet invoice-option-sheet" role="dialog" aria-modal="true" aria-label={activeSheet === "details" ? "Invoice Details" : activeSheet === "discount" ? t.discount : t.tax}><div className="sheet-handle"/><header><h2>{activeSheet === "details" ? (lang === "es" ? "Detalles de la factura" : "Invoice Details") : activeSheet === "discount" ? t.discount : t.tax}</h2><button type="button" aria-label={lang === "es" ? "Guardar y cerrar" : "Save and close"} onClick={closeSheet}>×</button></header>
      {activeSheet === "details" ? <div className="compact-form"><label><span>{t.issueDate}</span><input type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })}/></label><label><span>{t.dueDate}</span><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })}/></label><label><span>{lang === "es" ? "Número de factura" : "Invoice number"}</span><input value={form.invoiceNumber} onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}/><small>{lang === "es" ? "Asignado automáticamente; puedes cambiarlo." : "Assigned automatically — you can change it."}</small></label></div> : <div className="invoice-adjustment-sheet"><AdjustmentField lang={lang} label={activeSheet === "discount" ? t.discount : t.tax} type={activeSheet === "discount" ? form.discountType : form.taxType} value={activeSheet === "discount" ? form.discountValue : form.taxValue} onType={(value) => activeSheet === "discount" ? setForm({ ...form, discountType: value }) : setForm({ ...form, taxType: value })} onValue={(value) => activeSheet === "discount" ? setForm({ ...form, discountValue: value }) : setForm({ ...form, taxValue: value })}/><button type="button" className="primary-button" onClick={() => { activeSheet === "discount" ? setDiscountEnabled(true) : setTaxEnabled(true); closeSheet(); }}>{lang === "es" ? "Agregar" : "Add"} {activeSheet === "discount" ? t.discount.toLowerCase() : t.tax.toLowerCase()}</button><button type="button" className="text-button" onClick={() => { activeSheet === "discount" ? setDiscountEnabled(false) : setTaxEnabled(false); closeSheet(); }}>{lang === "es" ? "Quitar" : "Remove"}</button></div>}
    </section></div>}
    {previewOpen && <DocumentDesignOverlay lang={lang} kind="invoice" document={preview} settings={settings} onClose={() => setPreviewOpen(false)} onConfirm={async (design, saveDefault) => { setForm((current) => ({ ...current, ...design })); if (saveDefault) await api.saveDocumentDesignDefault(design); setPreviewOpen(false); }}/>} 
  </main>;
}
function InvoicePreview({
  lang,
  invoiceId,
  settings,
  onBack,
  setScreen,
  onOpenInvoice,
}: {
  lang: Lang;
  invoiceId: number;
  settings: Settings | null;
  onBack: () => void;
  setScreen: (screen: Screen) => void;
  onOpenInvoice: (id: number) => void;
}) {
  const t=copy[lang],qc=useQueryClient();
  const query=useQuery({queryKey:["invoices"],queryFn:()=>api.listInvoices({})});
  const invoice=query.data?.invoices.find((row)=>row.id===invoiceId);
  const signature=useQuery({queryKey:["financial-signature","invoice",invoiceId],queryFn:()=>api.getFinancialSignature({kind:"invoice",id:invoiceId})});
  const [blob,setBlob]=useState<Blob|null>(null);
  const [designOpen,setDesignOpen]=useState(false);
  const [fullScreen,setFullScreen]=useState(false);
  const [moreOpen,setMoreOpen]=useState(false);
  const [editing,setEditing]=useState(false);
  const [signatureOpen,setSignatureOpen]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [frequency,setFrequency]=useState<"none"|"daily"|"weekly"|"monthly"|"quarterly">("none");
  const [nextDue,setNextDue]=useState("");
  const [recurringEnd,setRecurringEnd]=useState("");
  useEffect(()=>{if(invoice){void buildInvoicePdf(invoice,settings,lang).then(setBlob);setFrequency(invoice.recurringFrequency);setNextDue(invoice.nextDueDate);setRecurringEnd(invoice.recurringEndDate);}},[invoice,settings,lang]);
  const refresh=async()=>{await qc.invalidateQueries({queryKey:["invoices"]});};
  const duplicate=useMutation({mutationFn:()=>api.duplicateInvoice({id:invoiceId}),onSuccess:async(r)=>{await refresh();setMoreOpen(false);onOpenInvoice(r.id);}});
  const remove=useMutation({mutationFn:()=>api.deleteInvoice({id:invoiceId}),onSuccess:async()=>{await refresh();onBack();}});
  const schedulesQuery=useQuery({queryKey:["recurring-schedules"],queryFn:()=>api.listRecurringSchedules({})});
  const [scheduleFrequency,setScheduleFrequency]=useState<"weekly"|"monthly">("monthly");
  const startSchedule=useMutation({mutationFn:()=>api.createRecurringSchedule({invoiceId,frequency:scheduleFrequency}),onSuccess:async()=>{await qc.invalidateQueries({queryKey:["recurring-schedules"]});}});
  const cancelSchedule=useMutation({mutationFn:(id:number)=>api.cancelRecurringSchedule({id}),onSuccess:async()=>{await qc.invalidateQueries({queryKey:["recurring-schedules"]});}});
  const invoiceSchedules=(schedulesQuery.data?.schedules??[]).filter((s)=>s.invoiceId===invoiceId&&s.active);
  if(!invoice)return <main className="page"><PageHeader lang={lang} title={t.invoices} onBack={onBack}/><div className="loading-block"/></main>;
  const filename=`${safeName(invoice.clientName)}-invoice-${invoice.id}.pdf`;
  const statusLabel=invoice.status==="paid"?t.paid:invoice.status==="overdue"?t.overdueStatus:invoice.status==="sent"?(lang==="es"?"Abierta":"Opened"):t.draft;
  return <main className="page financial-detail-page">
    <PageHeader lang={lang} title={`INV${String(invoice.id).padStart(4,"0")}`} onBack={onBack} actions={<button className="customize-button" onClick={()=>setDesignOpen(true)}>{lang==="es"?"Personalizar":"Customize"}</button>}/>
    <button className="document-preview-card" onClick={()=>setFullScreen(true)} aria-label={lang==="es"?"Abrir vista previa completa":"Open full-screen preview"}><QuotePaper quote={invoice} settings={settings} lang={lang} kind="invoice"/><span>{lang==="es"?"Toca para ampliar":"Tap to enlarge"}</span></button>
    <section className="document-detail-summary"><div><span>{t.total}</span><strong>{usd(money(invoice.totalWithLateFee))}</strong></div><span className={`status-chip ${invoice.status}`}>{statusLabel}</span><ViewedBadge lang={lang} kind="invoice" id={invoice.id} /><div className="record-links"><button onClick={() => invoice.clientId ? setScreen({ name: "client", clientId: invoice.clientId }) : setScreen({ name: "clients" })}>{invoice.clientName}</button>{invoice.jobId && <button onClick={() => setScreen({ name: "detail", jobId: invoice.jobId as number })}>{lang === "es" ? "Ver trabajo" : "View job"}</button>}</div>{signature.data?.signature&&<small className="signed-label"><CheckIcon/>{lang==="es"?"Firmada por":"Signed by"} {signature.data.signature.signerName}</small>}</section>
    <button className="primary-button send-document" disabled={!blob} onClick={async()=>{if(invoice.status==="draft")await api.updateInvoiceStatus({id:invoice.id,status:"sent"});await refresh();if(blob)await nativeShare(blob,filename,t.invoices);}}><ShareIcon/>{lang==="es"?"Enviar factura":"Send invoice"}</button>
    <DocumentLinkPanel lang={lang} kind="invoice" id={invoice.id} />
    {settings?.simpleMode !== true && (<details className="action-details document-details"><summary>{t.partialPayments} · {t.recurring}</summary><div className="payment-summary compact"><div><span>{t.paidToDate}</span><strong>{usd(Number(invoice.paidToDate))}</strong></div><div><span>{t.balanceRemaining}</span><strong>{usd(Number(invoice.balanceRemaining))}</strong></div></div>{invoice.payments.map((payment)=><div className="payment-row" key={payment.id}><span><strong>{usd(money(payment.amount))}</strong><small>{formatDate(payment.paymentDate,lang)} · {payment.method}</small></span></div>)}<div className="compact-form"><label><span>{t.frequency}</span><select value={frequency} onChange={(e)=>setFrequency(e.target.value as typeof frequency)}><option value="none">{t.none}</option><option value="daily">{lang==="es"?"Diaria":"Daily"}</option><option value="weekly">{t.weekly}</option><option value="monthly">{t.monthly}</option><option value="quarterly">{lang==="es"?"Trimestral":"Quarterly"}</option></select></label>{frequency!=="none"&&<><label><span>{t.nextDue}</span><input type="date" value={nextDue} onChange={(e)=>setNextDue(e.target.value)}/></label><label><span>{lang==="es"?"Termina":"Ends"}</span><input type="date" value={recurringEnd} onChange={(e)=>setRecurringEnd(e.target.value)}/></label></>}<button className="secondary-button" onClick={async()=>{await api.updateInvoiceRecurrence({id:invoice.id,recurringFrequency:frequency,nextDueDate:nextDue,recurringEndDate:recurringEnd});await refresh();}}>{t.save}</button></div></details>)}
    <details className="action-details document-details"><summary>{lang==="es"?"Factura recurrente automática":"Automatic recurring invoice"}</summary><div className="compact-form">{invoiceSchedules.length>0?invoiceSchedules.map((s)=><div className="payment-row" key={s.id}><span><strong>{s.frequency==="weekly"?(lang==="es"?"Semanal":"Weekly"):(lang==="es"?"Mensual":"Monthly")}</strong><small>{lang==="es"?"Próxima":"Next"}: {formatDate(s.nextRunDate,lang)}</small></span><button className="danger-button" disabled={cancelSchedule.isPending} onClick={()=>cancelSchedule.mutate(s.id)}>{lang==="es"?"Cancelar":"Cancel"}</button></div>):<><label><span>{t.frequency}</span><select value={scheduleFrequency} onChange={(e)=>setScheduleFrequency(e.target.value as "weekly"|"monthly")}><option value="weekly">{lang==="es"?"Semanal":"Weekly"}</option><option value="monthly">{lang==="es"?"Mensual":"Monthly"}</option></select></label><p className="privacy-note">{lang==="es"?"Se creará automáticamente una nueva factura con los mismos conceptos en cada ciclo.":"A new invoice with the same line items will be created automatically each cycle."}</p><button className="secondary-button" disabled={startSchedule.isPending} onClick={()=>startSchedule.mutate()}>{lang==="es"?"Activar recurrencia":"Make recurring"}</button></>}</div></details>
    <div className="document-action-bar" role="toolbar" aria-label={lang==="es"?"Acciones de factura":"Invoice actions"}><button onClick={()=>setEditing(true)}><GearIcon/><span>{lang==="es"?"Editar":"Edit"}</span></button><button className={invoice.status==="paid"?"active":""} onClick={async()=>{await api.toggleInvoicePaid({id:invoice.id,paid:invoice.status!=="paid"});await refresh();}}><CheckIcon/><span>{invoice.status==="paid"?(lang==="es"?"Pagada":"Paid"):(lang==="es"?"Marcar pagada":"Mark paid")}</span></button><button onClick={()=>setMoreOpen(true)}><Icon><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></Icon><span>{lang==="es"?"Más":"More"}</span></button></div>
    {fullScreen&&<div className="document-overlay fullscreen-preview" role="dialog" aria-modal="true"><header className="document-overlay-head"><button onClick={()=>setFullScreen(false)}><BackIcon/>{t.close}</button><strong>{APP_INFO.name} · {t.pdfPreview}</strong><span/></header><div className="fullscreen-paper"><QuotePaper quote={invoice} settings={settings} lang={lang} kind="invoice"/></div></div>}
    {editing&&<FinancialEditor lang={lang} kind="invoice" document={invoice} onCancel={()=>setEditing(false)} onSaved={async()=>{await refresh();setEditing(false);}} onDelete={()=>remove.mutate()}/>} 
    {designOpen&&<DocumentDesignOverlay lang={lang} kind="invoice" document={invoice} settings={settings} onClose={()=>setDesignOpen(false)} onConfirm={async(design,saveDefault)=>{await api.updateInvoiceDesign({id:invoice.id,...design});if(saveDefault)await api.saveDocumentDesignDefault(design);await refresh();await qc.invalidateQueries({queryKey:["settings"]});setDesignOpen(false);}}/>}
    {signatureOpen&&<SignatureDialog lang={lang} kind="invoice" id={invoice.id} onClose={()=>setSignatureOpen(false)} onSaved={async()=>{await qc.invalidateQueries({queryKey:["financial-signature","invoice",invoiceId]});setSignatureOpen(false);}}/>}
    {moreOpen&&<div className="sheet-backdrop" role="presentation" onClick={(e)=>{if(e.target===e.currentTarget)setMoreOpen(false);}}><section className="more-sheet" role="dialog" aria-modal="true" aria-label={lang==="es"?"Más acciones":"More actions"}><div className="sheet-handle"/><h2>{lang==="es"?"Opciones de factura":"Invoice options"}</h2><button disabled={invoice.payments.length===0} onClick={()=>{const receipt=buildPaymentReceipt(invoice,settings,lang);void nativeShare(receipt,`${safeName(invoice.clientName)}-receipt-${invoice.id}.pdf`,lang==="es"?"Recibo de pago":"Payment receipt");}}><Icon><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"/></Icon><span>{lang==="es"?"Enviar recibo de pago":"Send payment receipt"}</span></button><button disabled={!blob} onClick={()=>blob&&nativeShare(blob,filename,t.invoices)}><ShareIcon/><span>{lang==="es"?"Compartir PDF":"Share PDF"}</span></button><button disabled={!blob} onClick={()=>blob&&downloadPdfAsImage(blob,filename)}><CameraIcon/><span>{lang==="es"?"Descargar como imagen":"Download as image"}</span></button>{settings?.onlineSignatureEnabled !== false && <button onClick={()=>{setMoreOpen(false);setSignatureOpen(true);}}><Icon><path d="M4 18c5-7 8 3 16-8M5 21h14"/></Icon><span>{signature.data?.signature?(lang==="es"?"Actualizar firma":"Update client signature"):(lang==="es"?"Obtener firma del cliente":"Collect client signature")}</span></button>}<button className="duplicate-action" disabled={duplicate.isPending} onClick={()=>duplicate.mutate()}><Icon><path d="M8 8h11v11H8zM5 16H3V3h13v2"/></Icon><span>{lang==="es"?"Duplicar factura":"Duplicate invoice"}</span></button>{!confirmDelete?<button className="danger-row" onClick={()=>setConfirmDelete(true)}><TrashIcon/><span>{lang==="es"?"Eliminar factura":"Delete invoice"}</span></button>:<div className="sheet-delete-confirm"><strong>{lang==="es"?"¿Eliminar permanentemente?":"Delete permanently?"}</strong><button className="danger-button" onClick={()=>remove.mutate()}>{lang==="es"?"Sí, eliminar":"Yes, delete"}</button><button onClick={()=>setConfirmDelete(false)}>{lang==="es"?"Cancelar":"Cancel"}</button></div>}</section></div>}
  </main>;
}

const blankClient = {
  id: null as number | null,
  name: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  tags: [] as string[],
  referredByClientId: null as number | null,
};
function ClientForm({
  lang,
  initial = blankClient,
  onSaved,
  stickySave = false,
}: {
  lang: Lang;
  initial?: typeof blankClient;
  onSaved: (id: number) => void;
  stickySave?: boolean;
}) {
  const t = copy[lang];
  const [form, setForm] = useState(initial);
  const [tagDraft, setTagDraft] = useState("");
  const clients = useQuery({
    queryKey: ["clients", ""],
    queryFn: () => api.listClients({ search: "" }),
  });
  const save = useMutation({
    mutationFn: () => api.saveClient(form),
    onSuccess: (r) => onSaved(r.id),
  });
  const addTag = () => {
    const tag = tagDraft.trim();
    if (!tag || form.tags.some((item) => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) return;
    setForm({ ...form, tags: [...form.tags, tag] });
    setTagDraft("");
  };
  return (
    <form
      className="job-form client-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (form.name.trim()) save.mutate();
      }}
    >
      <label>
        <span>{t.client} *</span>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
      </label>
      <label>
        <span>{t.phone}</span>
        <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </label>
      <label>
        <span>{t.email}</span>
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </label>
      <label>
        <span>{t.address}</span>
        <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
      </label>
      <fieldset className="client-tags-field">
        <legend>{lang === "es" ? "Etiquetas" : "Tags"}</legend>
        <div className="client-tag-entry">
          <input
            value={tagDraft}
            maxLength={40}
            placeholder={lang === "es" ? "Ej. Cocina" : "e.g. Kitchen"}
            aria-label={lang === "es" ? "Nueva etiqueta" : "New tag"}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
            }}
          />
          <button type="button" className="secondary-button" onClick={addTag} disabled={!tagDraft.trim()}>{lang === "es" ? "Agregar" : "Add"}</button>
        </div>
        {form.tags.length > 0 && <div className="client-tag-chips" aria-label={lang === "es" ? "Etiquetas seleccionadas" : "Selected tags"}>
          {form.tags.map((tag) => <button type="button" key={tag} onClick={() => setForm({ ...form, tags: form.tags.filter((item) => item !== tag) })} aria-label={`${lang === "es" ? "Quitar" : "Remove"} ${tag}`}>{tag}<span aria-hidden="true">×</span></button>)}
        </div>}
      </fieldset>
      <label>
        <span>{t.notes}</span>
        <textarea rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </label>
      <label>
        <span>{t.referredBy}</span>
        <select value={form.referredByClientId ?? ""} onChange={(e) => setForm({ ...form, referredByClientId: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t.noReferrer}</option>
          {clients.data?.clients.filter((c) => c.id !== form.id).map((c) => <option value={c.id} key={c.id}>{c.name}</option>)}
        </select>
      </label>
      {save.error && <p className="status error">{actionErrorMessage(save.error)}</p>}
      <button className={`primary-button${stickySave ? " sticky-submit" : ""}`} disabled={save.isPending}>
        {save.isPending ? t.saving : t.save}
      </button>
    </form>
  );
}

function NewClientScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const qc = useQueryClient();
  return <main className="page form-page client-new-page">
    <PageHeader lang={lang} title={copy[lang].newClient} onBack={onBack} />
    <ClientForm lang={lang} stickySave onSaved={async () => {
      await qc.invalidateQueries({ queryKey: ["clients"] });
      onBack();
    }} />
  </main>;
}

type ClientSort = "alphabetical" | "balance" | "paid" | "invoices";
type SortDirection = "asc" | "desc";
function clientInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "?";
}
function ClientsScreen({
  lang,
  onBack,
  setScreen,
}: {
  lang: Lang;
  onBack: () => void;
  setScreen: (s: Screen) => void;
}) {
  const t = copy[lang];
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<ClientSort>("alphabetical");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [draftSortBy, setDraftSortBy] = useState<ClientSort>("alphabetical");
  const [draftDirection, setDraftDirection] = useState<SortDirection>("asc");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [activeSheet, setActiveSheet] = useState<"sort" | "filter" | null>(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  const query = useQuery({ queryKey: ["clients", ""], queryFn: () => api.listClients({ search: "" }) });
  const allClients = query.data?.clients ?? [];
  const term = search.trim().toLocaleLowerCase(lang === "es" ? "es" : "en");
  const visibleClients = allClients
    .filter((client) => !term || [client.name, client.phone, client.email, client.address, ...client.tags].some((value) => value.toLocaleLowerCase(lang === "es" ? "es" : "en").includes(term)))
    .filter((client) => selectedTags.length === 0 || selectedTags.every((tag) => client.tags.includes(tag)))
    .sort((a, b) => {
      let value = sortBy === "alphabetical" ? a.name.localeCompare(b.name) : sortBy === "balance" ? a.balanceDue - b.balanceDue : sortBy === "paid" ? a.totalPaid - b.totalPaid : a.invoiceCount - b.invoiceCount;
      if (value === 0 && sortBy !== "alphabetical") value = a.name.localeCompare(b.name);
      return direction === "asc" ? value : -value;
    });
  const tagCounts = Array.from(new Set(allClients.flatMap((client) => client.tags))).sort((a, b) => a.localeCompare(b)).map((tag) => ({ tag, count: allClients.filter((client) => client.tags.includes(tag)).length }));
  const openSheet = (sheet: "sort" | "filter") => {
    setSheetClosing(false);
    if (sheet === "sort") { setDraftSortBy(sortBy); setDraftDirection(direction); }
    else setDraftTags(selectedTags);
    setActiveSheet(sheet);
  };
  const closeSheet = () => {
    setSheetClosing(true);
    window.setTimeout(() => { setActiveSheet(null); setSheetClosing(false); }, 180);
  };
  return (
    <main className="page clients-page">
      <PageHeader lang={lang} title={t.clients} onBack={onBack} />
      <OfflineCacheNote lang={lang} action="listClients" isLoading={query.isLoading} />
      <div className="clients-toolbar">
        <label className="client-search"><Icon><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></Icon><span className="sr-only">{t.searchClients}</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t.searchClients} aria-label={t.searchClients} /></label>
        <button className="client-tool-button" type="button" onClick={() => openSheet("sort")} aria-label={lang === "es" ? "Ordenar clientes" : "Sort clients"}><Icon><path d="M8 6h12M8 12h8M8 18h4M4 4v16M2 18l2 2 2-2"/></Icon></button>
        <button className={`client-tool-button${selectedTags.length ? " active" : ""}`} type="button" onClick={() => openSheet("filter")} aria-label={lang === "es" ? "Filtrar por etiquetas" : "Filter by tags"}><Icon><path d="M4 5h16l-6 7v6l-4 2v-8z"/></Icon>{selectedTags.length > 0 && <b>{selectedTags.length}</b>}</button>
      </div>
      {selectedTags.length > 0 && <div className="active-client-filters">{selectedTags.map((tag) => <button key={tag} onClick={() => setSelectedTags(selectedTags.filter((item) => item !== tag))}>{tag}<span>×</span></button>)}</div>}
      <section className="client-list" aria-label={lang === "es" ? "Lista de clientes" : "Client list"}>
        {visibleClients.map((c) => (
          <button key={c.id} onClick={() => setScreen({ name: "client", clientId: c.id })}>
            <span className={`client-avatar tone-${c.id % 6}`}>{clientInitials(c.name)}</span>
            <span className="client-row-copy"><strong>{c.name}</strong><small>{c.invoiceCount} {c.invoiceCount === 1 ? (lang === "es" ? "Factura" : "Invoice") : (lang === "es" ? "Facturas" : "Invoices")}</small></span>
            <span className="client-row-money"><strong>{usd(c.totalInvoiced)}</strong><small>{c.paymentPercent}% {lang === "es" ? "pagado" : "paid"}</small></span>
          </button>
        ))}
      </section>
      {!query.isPending && visibleClients.length === 0 && <div className="empty-state"><h2>{allClients.length === 0 ? t.noClients : (lang === "es" ? "No hay clientes que coincidan." : "No matching clients.")}</h2></div>}
      <button className="primary-button add-client-fab" onClick={() => setScreen({ name: "clientNew" })}><PlusIcon />{lang === "es" ? "AGREGAR CLIENTE" : "ADD CLIENT"}</button>
      {activeSheet && <div className={`client-sheet-backdrop${sheetClosing ? " closing" : ""}`} role="presentation" onClick={(e) => { if (e.target === e.currentTarget) closeSheet(); }}>
        {activeSheet === "sort" ? <section className="client-sheet" role="dialog" aria-modal="true" aria-labelledby="client-sort-title">
          <div className="sheet-handle"/><header><h2 id="client-sort-title">{lang === "es" ? "Ordenar" : "Sorting"}</h2><button type="button" onClick={() => { setDraftSortBy("alphabetical"); setDraftDirection("asc"); }}>{lang === "es" ? "Restablecer" : "Reset"}</button></header>
          <fieldset className="sheet-options"><legend>{lang === "es" ? "Ordenar por" : "Sorted by"}</legend>{([
            ["alphabetical", lang === "es" ? "Orden alfabético" : "Sorted alphabetically"],
            ["balance", lang === "es" ? "Saldo pendiente" : "Sorted by balance due"],
            ["paid", lang === "es" ? "Total pagado" : "Sorted by total paid"],
            ["invoices", lang === "es" ? "Total de facturas" : "Sorted by total invoices"],
          ] as Array<[ClientSort,string]>).map(([value,label]) => <label key={value}><input type="radio" name="client-sort" value={value} checked={draftSortBy === value} onChange={() => setDraftSortBy(value)} /><span>{label}</span><i>{draftSortBy === value && <CheckIcon/>}</i></label>)}</fieldset>
          <div className="direction-toggle" role="group" aria-label={lang === "es" ? "Dirección" : "Direction"}><button type="button" className={draftDirection === "asc" ? "active" : ""} onClick={() => setDraftDirection("asc")}>{lang === "es" ? "Ascendente" : "Ascending"}</button><button type="button" className={draftDirection === "desc" ? "active" : ""} onClick={() => setDraftDirection("desc")}>{lang === "es" ? "Descendente" : "Descending"}</button></div>
          <button className="primary-button sheet-apply" type="button" onClick={() => { setSortBy(draftSortBy); setDirection(draftDirection); closeSheet(); }}>{lang === "es" ? "Aplicar orden" : "Apply sorting"}</button>
        </section> : <section className="client-sheet" role="dialog" aria-modal="true" aria-labelledby="client-filter-title">
          <div className="sheet-handle"/><header><h2 id="client-filter-title">{lang === "es" ? "Filtros" : "Filters"}</h2><button type="button" onClick={() => setDraftTags([])}>{lang === "es" ? "Borrar todo" : "Clear all"}</button></header>
          <p className="sheet-label">{lang === "es" ? "Etiquetas" : "Tags"}</p>
          {tagCounts.length > 0 ? <div className="filter-tag-grid">{tagCounts.map(({ tag, count }) => <button type="button" key={tag} className={draftTags.includes(tag) ? "active" : ""} onClick={() => setDraftTags(draftTags.includes(tag) ? draftTags.filter((item) => item !== tag) : [...draftTags, tag])}><span>{tag}</span><b>{count}</b></button>)}</div> : <p className="sheet-empty">{lang === "es" ? "Agrega etiquetas al crear o editar un cliente." : "Add tags when creating or editing a client."}</p>}
          <button className="primary-button sheet-apply" type="button" onClick={() => { setSelectedTags(draftTags); closeSheet(); }}>{lang === "es" ? "Aplicar filtros" : "Apply filters"}</button>
        </section>}
      </div>}
    </main>
  );
}
function ClientDetail({
  lang,
  clientId,
  onBack,
  setScreen,
}: {
  lang: Lang;
  clientId: number;
  onBack: () => void;
  setScreen: (s: Screen) => void;
}) {
  const t = copy[lang];
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["client", clientId],
    queryFn: () => api.getClient({ id: clientId }),
  });
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const remove = useMutation({
    mutationFn: () => api.deleteClient({ id: clientId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      onBack();
    },
  });
  const c = query.data?.client;
  const firstJob = query.data?.jobs.at(0);
  const clientInvoices = (invoices.data?.invoices ?? []).filter((invoice) => invoice.clientId === clientId);
  if (!c)
    return (
      <main className="page">
        <PageHeader lang={lang} title={t.clients} onBack={onBack} />
        <div className="loading-block" />
      </main>
    );
  return (
    <main className="page form-page">
      <PageHeader lang={lang} title={c.name} onBack={onBack} />
      <section className="client-money"><article><span>{lang === "es" ? "Facturado" : "Invoiced"}</span><strong>{usd(c.totalInvoiced)}</strong></article><article><span>{lang === "es" ? "Pagado" : "Paid"}</span><strong>{c.paymentPercent}%</strong></article></section>
      <nav className="client-links" aria-label={lang === "es" ? "Registros del cliente" : "Client records"}><button onClick={() => firstJob ? setScreen({ name: "detail", jobId: firstJob.id }) : setScreen({ name: "jobs" })}>{t.jobs} ({query.data?.jobs.length ?? 0})</button><button onClick={() => clientInvoices[0] ? setScreen({ name: "invoicePreview", invoiceId: clientInvoices[0].id }) : setScreen({ name: "invoices" })}>{t.invoices} ({clientInvoices.length})</button><button onClick={() => query.data?.quotes[0] ? setScreen({ name: "quotePreview", quoteId: query.data.quotes[0].id }) : setScreen({ name: "quoteNew", clientId })}>{lang === "es" ? "Presupuestos" : "Estimates"} ({query.data?.quotes.length ?? 0})</button></nav>
      <ClientForm
        lang={lang}
        initial={{
          id: c.id,
          name: c.name,
          phone: c.phone,
          email: c.email,
          address: c.address,
          notes: c.notes,
          tags: c.tags,
          referredByClientId: c.referredByClientId,
        }}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["client", clientId] });
          qc.invalidateQueries({ queryKey: ["clients"] });
        }}
      />
      <section className="client-history">
        <h2>{t.clientHistory}</h2>
        {query.data?.jobs.map((j) => (
          <button
            key={`j-${j.id}`}
            onClick={() => setScreen({ name: "detail", jobId: j.id })}
          >
            <span>
              <strong>{j.jobType}</strong>
              <small>
                {formatDate(j.jobDate, lang)} · {j.jobAddress}
              </small>
            </span>
            <BackIcon />
          </button>
        ))}
        {clientInvoices.map((invoice) => (
          <button key={`i-${invoice.id}`} onClick={() => setScreen({ name: "invoicePreview", invoiceId: invoice.id })}><span><strong>{t.invoices} #{invoice.id} · {usd(money(invoice.totalWithLateFee))}</strong><small>{lang === "es" ? "Saldo" : "Balance"}: {usd(Number(invoice.balanceRemaining))}</small></span><BackIcon /></button>
        ))}
        {query.data?.quotes.map((q) => (
          <button
            key={`q-${q.id}`}
            onClick={() => setScreen({ name: "quotePreview", quoteId: q.id })}
          >
            <span>
              <strong>
                {t.quoteBuilder} #{q.id} · {usd(money(q.total))}
              </strong>
              <small>{q.jobType || q.jobAddress}</small>
            </span>
            <BackIcon />
          </button>
        ))}
      </section>
      <button
        className="danger-button"
        onClick={() => remove.mutate()}
        disabled={remove.isPending}
      >
        <TrashIcon />
        {t.deleteClient}
      </button>
    </main>
  );
}

function FollowupsScreen({
  lang,
  settings,
  onBack,
}: {
  lang: Lang;
  settings: Settings | null;
  onBack: () => void;
}) {
  const t = copy[lang];
  const jobs = useQuery({
    queryKey: ["jobs", ""],
    queryFn: () => api.listJobs({ search: "" }),
  });
  const quotes = useQuery({
    queryKey: ["quotes"],
    queryFn: () => api.listQuotes({}),
  });
  const invoices = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api.listInvoices({}),
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdue = (jobs.data?.jobs ?? []).filter(
    (j) =>
      settings?.notificationsEnabled !== false &&
      settings?.paymentRemindersEnabled !== false &&
      j.amountDue && j.dueDate && new Date(`${j.dueDate}T00:00:00`) < today,
  );
  const overdueInvoices = (invoices.data?.invoices ?? []).filter(
    (i) => {
      const due = i.dueDate ? new Date(`${i.dueDate}T00:00:00`) : null;
      const daysLate = due ? Math.floor((today.getTime() - due.getTime()) / 86400000) : 0;
      return settings?.notificationsEnabled !== false && settings?.paymentRemindersEnabled !== false && settings?.overdueInvoiceRemindersEnabled !== false && i.status !== "paid" && Boolean(i.dueDate) && (i.status === "overdue" || daysLate >= (settings?.overdueReminderDays ?? 3));
    },
  );
  const follow = (quotes.data?.quotes ?? []).filter(
    (q) =>
      settings?.notificationsEnabled !== false &&
      !q.jobId &&
      q.sentAt &&
      Math.floor(
        (today.getTime() - new Date(`${q.sentAt}T00:00:00`).getTime()) /
          86400000,
      ) >= (settings?.quoteFollowUpDays ?? 3),
  );
  return (
    <main className="page">
      <PageHeader lang={lang} title={t.followups} onBack={onBack} />
      <section className="reminder-section">
        <h2>{t.overdue}</h2>
        {overdue.map((j) => {
          const message =
            lang === "es"
              ? `Hola ${j.clientName}, un recordatorio amable de que el saldo de ${usd(money(j.amountDue))} por ${j.jobType} está pendiente.${settings?.paymentInstructions ? ` ${settings.paymentInstructions}` : ""} Por favor avísame si tienes preguntas. — ${companySignature(settings)}`
              : `Hi ${j.clientName}, a friendly reminder that the ${usd(money(j.amountDue))} balance for ${j.jobType} is due.${settings?.paymentInstructions ? ` ${settings.paymentInstructions}` : ""} Please let me know if you have any questions. — ${companySignature(settings)}`;
          return (
            <article key={j.id}>
              <div>
                <strong>{j.clientName}</strong>
                <span>
                  {usd(money(j.amountDue))} · {formatDate(j.dueDate, lang)}
                </span>
              </div>
              {j.clientPhone ? (
                <a
                  className="small-button"
                  href={smsHref(j.clientPhone, message)}
                >
                  {t.openSms}
                </a>
              ) : (
                <small>{t.noPhone}</small>
              )}
            </article>
          );
        })}
        {overdueInvoices.map((invoice) => {
          const message =
            lang === "es"
              ? `Hola ${invoice.clientName}, un recordatorio amable de que la factura #${invoice.id} por ${usd(money(invoice.totalWithLateFee))} está vencida. ${settings?.paymentInstructions || ""} — ${companySignature(settings)}`
              : `Hi ${invoice.clientName}, a friendly reminder that invoice #${invoice.id} for ${usd(money(invoice.totalWithLateFee))} is overdue. ${settings?.paymentInstructions || ""} — ${companySignature(settings)}`;
          return (
            <article key={`invoice-${invoice.id}`}>
              <div>
                <strong>
                  {invoice.clientName} · #{invoice.id}
                </strong>
                <span>
                  {usd(money(invoice.totalWithLateFee))} ·{" "}
                  {formatDate(invoice.dueDate, lang)}
                </span>
              </div>
              {invoice.clientPhone ? (
                <a
                  className="small-button"
                  href={smsHref(invoice.clientPhone, message)}
                >
                  {t.openSms}
                </a>
              ) : (
                <small>{t.noPhone}</small>
              )}
            </article>
          );
        })}
      </section>
      <section className="reminder-section">
        <h2>{t.quoteFollowups}</h2>
        {follow.map((q) => {
          const days = Math.floor(
            (today.getTime() - new Date(`${q.sentAt}T00:00:00`).getTime()) /
              86400000,
          );
          const message =
            lang === "es"
              ? `Hola ${q.clientName}, solo quería dar seguimiento a la cotización de ${usd(money(q.total))} para ${q.jobType}. ¿Tienes alguna pregunta? — ${companySignature(settings)}`
              : `Hi ${q.clientName}, just following up on the ${usd(money(q.total))} quote for ${q.jobType}. Do you have any questions? — ${companySignature(settings)}`;
          return (
            <article key={q.id}>
              <div>
                <strong>{q.clientName}</strong>
                <span>{t.sentDays.replace("{days}", String(days))}</span>
              </div>
              {q.clientPhone ? (
                <a
                  className="small-button"
                  href={smsHref(q.clientPhone, message)}
                >
                  {t.followUp}
                </a>
              ) : (
                <small>{t.noPhone}</small>
              )}
            </article>
          );
        })}
      </section>
      {overdue.length + overdueInvoices.length + follow.length === 0 && (
        <div className="empty-state">
          <CheckIcon />
          <h2>{t.noActions}</h2>
        </div>
      )}
    </main>
  );
}
function GalleryScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const t = copy[lang];
  const jobs = useQuery({
    queryKey: ["jobs", ""],
    queryFn: () => api.listJobs({ search: "" }),
  });
  const ids = jobs.data?.jobs.map((j) => j.id) ?? [];
  const details = useQuery({
    queryKey: ["gallery-details", ids.join(",")],
    enabled: ids.length > 0,
    queryFn: () => Promise.all(ids.map((id) => api.getJob({ id }))),
  });
  const picks = (details.data ?? []).flatMap((d) =>
    d.photos
      .filter((p) => p.galleryPick && !p.excludeFromSocial)
      .map((p) => ({ ...p, job: d.job })),
  );
  const exportBundle = async () => {
    const files: Record<string, Uint8Array> = {};
    const cards: string[] = [];
    for (const [index, p] of picks.entries()) {
      const blob = await (await fetch(p.url)).blob();
      const ext = blob.type.includes("png") ? "png" : "jpg";
      const filename = `images/${String(index + 1).padStart(2, "0")}-${safeName(p.job?.jobType ?? "project")}.${ext}`;
      files[filename] = new Uint8Array(await blob.arrayBuffer());
      cards.push(
        `<figure><img src="${filename}" alt="${(p.caption || p.job?.jobType || "Project photo").replace(/"/g, "&quot;")}" loading="lazy"><figcaption>${p.caption || p.job?.jobType || ""}</figcaption></figure>`,
      );
    }
    const html = `<!-- Crewkat gallery: upload this file with the images folder -->\n<section class="crewkat-gallery">\n${cards.join("\n")}\n</section>`;
    files["gallery.html"] = strToU8(html);
    files["captions.txt"] = strToU8(
      picks
        .map((p, i) => `${i + 1}. ${p.caption || p.job?.jobType || ""}`)
        .join("\n"),
    );
    downloadBlob(
      new Blob([zipSync(files)], { type: "application/zip" }),
      "crewkat-website-gallery.zip",
    );
  };
  return (
    <main className="page">
      <PageHeader lang={lang} title={t.websiteGallery} onBack={onBack} />
      <div className="page-actions">
        <button
          className="primary-button"
          disabled={picks.length === 0}
          onClick={exportBundle}
        >
          {t.exportGallery}
        </button>
      </div>
      {picks.length === 0 ? (
        <div className="empty-state">
          <h2>{t.galleryEmpty}</h2>
        </div>
      ) : (
        <div className="gallery-grid">
          {picks.map((p) => (
            <figure key={p.id}>
              <img
                src={p.url}
                alt={p.caption || p.job?.jobType || "Gallery photo"}
              />
              <figcaption>{p.caption || p.job?.jobType}</figcaption>
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}

function JobToolScreen({
  lang,
  jobId,
  mode,
  photoId,
  settings,
  onBack,
}: {
  lang: Lang;
  jobId: number;
  mode: ToolMode;
  photoId?: number;
  settings: Settings | null;
  onBack: () => void;
}) {
  const t = copy[lang];
  const query = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob({ id: jobId }),
  });
  const titles: Record<ToolMode, string> = {
    contract: t.contract,
    change: t.change,
    punch: t.punch,
    progress: t.progress,
    annotate: t.annotations,
    texts: t.texts,
    deposit: t.depositRequest,
    time: t.timeTracking,
    receipts: t.receipts,
    crew: t.crewChecklist,
    voice: t.voiceNotes,
    completion: t.completionCertificate,
    beforeAfter: lang === "es" ? "Comparación antes/después" : "Before & after",
    subcontractors: lang === "es" ? "Subcontratistas" : "Subcontractors",
  };
  if (!query.data?.job)
    return (
      <main className="page">
        <PageHeader lang={lang} title={titles[mode]} onBack={onBack} />
        <div className="loading-block" />
      </main>
    );
  return (
    <main className="page tool-page">
      <PageHeader lang={lang} title={titles[mode]} onBack={onBack} />
      {mode === "contract" && (
        <DocumentSigner
          lang={lang}
          data={query.data}
          settings={settings}
          kind="contract"
        />
      )}
      {mode === "change" && (
        <DocumentSigner
          lang={lang}
          data={query.data}
          settings={settings}
          kind="change_order"
        />
      )}
      {mode === "punch" && <PunchList lang={lang} data={query.data} />}{" "}
      {mode === "progress" && (
        <ProgressUpdate lang={lang} data={query.data} settings={settings} />
      )}{" "}
      {mode === "annotate" && (
        <PhotoAnnotator lang={lang} data={query.data} photoId={photoId} />
      )}{" "}
      {mode === "texts" && (
        <TextTemplates lang={lang} job={query.data.job} settings={settings} />
      )}{" "}
      {mode === "deposit" && (
        <DepositRequest lang={lang} job={query.data.job} settings={settings} />
      )}{" "}
      {mode === "time" && <TimeTracker lang={lang} data={query.data} />}{" "}
      {mode === "receipts" && <ReceiptManager lang={lang} data={query.data} />}{" "}
      {mode === "crew" && <CrewChecklist lang={lang} data={query.data} />}{" "}
      {mode === "voice" && <VoiceNotes lang={lang} data={query.data} />}{" "}
      {mode === "completion" && (
        <CompletionCertificate
          lang={lang}
          data={query.data}
          settings={settings}
        />
      )}{" "}
      {mode === "beforeAfter" && (
        <BeforeAfterTool lang={lang} data={query.data} settings={settings} />
      )}{" "}
      {mode === "subcontractors" && (
        <SubcontractorTool lang={lang} jobId={jobId} />
      )}
    </main>
  );
}
function DocumentSigner({
  lang,
  data,
  settings,
  kind,
}: {
  lang: Lang;
  data: JobData;
  settings: Settings | null;
  kind: "contract" | "change_order";
}) {
  const t = copy[lang];
  const job = data.job;
  const client = useQueryClient();
  const [title, setTitle] = useState(
    kind === "contract" ? `${job?.jobType ?? ""} contract` : `Change order`,
  );
  const [bodyText, setBodyText] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [signerName, setSignerName] = useState(job?.clientName ?? "");
  const [signature, setSignature] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{
    blob: Blob;
    filename: string;
    title: string;
  } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      let originalDataBase64 = "";
      if (file) originalDataBase64 = (await fileToBase64(file)).dataBase64;
      return api.saveDocument({
        jobId: job?.id ?? 0,
        kind,
        title,
        bodyText,
        originalFilename: file?.name ?? "",
        originalDataBase64,
        description,
        amount,
        signerName,
        signatureDataBase64: signature,
        signedAt: new Date().toISOString(),
      });
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["job", job?.id] });
      setSignature("");
      setBodyText("");
      setDescription("");
      setAmount("");
      setFile(null);
    },
    onError: () => setError(t.error),
  });
  if (!job) return null;
  const docs = data.documents.filter((d) => d.kind === kind);
  return (
    <>
      <section className="legal-note">
        <strong>{t.yourDocument}</strong>
        <p>{t.noTemplates}</p>
      </section>
      <form
        className="tool-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (
            !title.trim() ||
            !signerName.trim() ||
            !signature ||
            (kind === "contract" && !file && !bodyText.trim()) ||
            (kind === "change_order" && !description.trim())
          ) {
            setError(t.required);
            return;
          }
          save.mutate();
        }}
      >
        <label>
          <span>{t.title}</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        {kind === "contract" ? (
          <>
            <label className="file-drop">
              <span>{t.uploadPdf}</span>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <small>{file?.name}</small>
            </label>
            <label>
              <span>{t.pasteText}</span>
              <textarea
                rows={8}
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              <span>{t.changeDescription}</span>
              <textarea
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label>
              <span>{t.amount}</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
          </>
        )}
        <label>
          <span>{t.signer}</span>
          <input
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
          />
        </label>
        <SignaturePad
          label={t.signature}
          clearLabel={t.clear}
          onChange={setSignature}
        />
        {error && <p className="status error">{error}</p>}
        <button className="primary-button" disabled={save.isPending}>
          {save.isPending ? t.saving : t.signSave}
        </button>
      </form>
      {docs.length > 0 && (
        <section className="saved-section">
          <h2>{t.signedDocuments}</h2>
          {docs.map((d) => (
            <article key={d.id}>
              <div>
                <strong>{d.title}</strong>
                <small>
                  {d.signerName} ·{" "}
                  {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                    dateStyle: "medium",
                  }).format(new Date(d.signedAt))}
                </small>
              </div>
              <div className="row-actions">
                <button
                  onClick={async () => {
                    const blob = await buildSignedDocumentPdf(
                      d,
                      job,
                      settings,
                      lang,
                    );
                    setPreview({
                      blob,
                      filename: `${safeName(job.clientName)}-${safeName(d.title)}-signed.pdf`,
                      title: d.title,
                    });
                  }}
                >
                  {t.viewDocument}
                </button>
                {d.signedPdfUrl ? (
                  <a
                    href={d.signedPdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn"
                  >
                    {lang === "es" ? "Ver copia firmada" : "View signed copy"}
                  </a>
                ) : null}
              </div>
              {d.clientSignedAt ? (
                <small className="signed-label">
                  <CheckIcon />
                  {lang === "es" ? "Cliente firmó" : "Client signed"}:{" "}
                  {d.clientSignerName}
                </small>
              ) : null}
              <DocumentLinkPanel lang={lang} kind={d.kind} id={d.id} />
            </article>
          ))}
        </section>
      )}
      {preview && (
        <div
          className="pdf-modal"
          role="dialog"
          aria-modal="true"
          aria-label={preview.title}
        >
          <div className="pdf-modal-head">
            <strong>{preview.title}</strong>
            <button onClick={() => setPreview(null)}>{t.close}</button>
          </div>
          <div className="packet-actions">
            <button
              className="primary-button"
              onClick={() =>
                nativeShare(preview.blob, preview.filename, preview.title)
              }
            >
              <ShareIcon />
              {t.sharePdf}
            </button>
            <button
              className="secondary-button"
              onClick={() => downloadBlob(preview.blob, preview.filename)}
            >
              <FileIcon />
              {t.downloadPdf}
            </button>
          </div>
          <PdfFrame blob={preview.blob} title={preview.title} />
        </div>
      )}
    </>
  );
}

async function buildSignedDocumentPdf(
  document: SignedDocument,
  job: Job,
  settings: Settings | null,
  lang: Lang,
) {
  const t = copy[lang];
  const sigBlob = await (await fetch(document.signatureUrl)).blob();
  const sigData = await blobDataUrl(sigBlob);
  const page = new jsPDF({ unit: "pt", format: "letter" });
  const w = page.internal.pageSize.getWidth();
  let y = 48;
  page.setFont("helvetica", "bold");
  page.setFontSize(18);
  page.setTextColor(31, 90, 74);
  page.text(settings?.companyName || "", 42, y);
  y += 38;
  page.setFontSize(22);
  page.setTextColor(24, 32, 30);
  page.text(document.title, 42, y);
  y += 25;
  page.setFont("helvetica", "normal");
  page.setFontSize(10);
  page.text(`${t.client}: ${job.clientName}`, 42, y);
  y += 16;
  page.text(`${t.address}: ${job.jobAddress}`, 42, y);
  y += 24;
  if (document.description) {
    page.setFont("helvetica", "bold");
    page.text(t.changeDescription, 42, y);
    y += 16;
    page.setFont("helvetica", "normal");
    const lines = page.splitTextToSize(
      document.description,
      w - 84,
    ) as string[];
    page.text(lines, 42, y);
    y += lines.length * 12 + 16;
  }
  if (document.amount) {
    page.setFont("helvetica", "bold");
    page.text(`${t.amount}: ${usd(money(document.amount))}`, 42, y);
    y += 26;
  }
  if (document.bodyText) {
    page.setFont("helvetica", "normal");
    page.setFontSize(9);
    const lines = page.splitTextToSize(document.bodyText, w - 84) as string[];
    for (const line of lines) {
      if (y > 680) {
        page.addPage();
        y = 48;
      }
      page.text(line, 42, y);
      y += 11;
    }
    y += 20;
  }
  if (y > 560) {
    page.addPage();
    y = 48;
  }
  page.setDrawColor(201, 209, 206);
  page.line(42, y, w - 42, y);
  y += 24;
  page.setFont("helvetica", "bold");
  page.text(t.signature, 42, y);
  page.addImage(sigData, "PNG", 42, y + 10, 230, 70);
  page.setFont("helvetica", "normal");
  page.text(document.signerName, 42, y + 94);
  page.text(
    new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(document.signedAt)),
    42,
    y + 110,
  );
  let blob = page.output("blob");
  if (document.originalUrl) {
    const original = await PDFDocument.load(
      await (await fetch(document.originalUrl)).arrayBuffer(),
    );
    const signaturePdf = await PDFDocument.load(await blob.arrayBuffer());
    const pages = await original.copyPages(
      signaturePdf,
      signaturePdf.getPageIndices(),
    );
    pages.forEach((p) => original.addPage(p));
    blob = new Blob([await original.save()], { type: "application/pdf" });
  }
  return blob;
}
function PunchList({ lang, data }: { lang: Lang; data: JobData }) {
  const t = copy[lang];
  const job = data.job;
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [customer, setCustomer] = useState(job?.clientName ?? "");
  const [contractor, setContractor] = useState("");
  const [customerSig, setCustomerSig] = useState("");
  const [contractorSig, setContractorSig] = useState("");
  const add = useMutation({
    mutationFn: () => api.addPunchItem({ jobId: job?.id ?? 0, text }),
    onSuccess: () => {
      setText("");
      client.invalidateQueries({ queryKey: ["job", job?.id] });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) =>
      api.togglePunchItem({ id, completed }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["job", job?.id] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deletePunchItem({ id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["job", job?.id] }),
  });
  const sign = useMutation({
    mutationFn: () =>
      api.savePunchSignoff({
        jobId: job?.id ?? 0,
        customerName: customer,
        customerSignatureDataBase64: customerSig,
        contractorName: contractor,
        contractorSignatureDataBase64: contractorSig,
        signedAt: new Date().toISOString(),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["job", job?.id] }),
  });
  if (!job) return null;
  return (
    <>
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) add.mutate();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.itemPlaceholder}
        />
        <button className="primary-button">{t.addItem}</button>
      </form>
      <section className="checklist">
        {data.punchItems.map((item) => (
          <label key={item.id}>
            <input
              type="checkbox"
              checked={item.completed}
              onChange={(e) =>
                toggle.mutate({ id: item.id, completed: e.target.checked })
              }
            />
            <span>{item.text}</span>
            <button
              type="button"
              onClick={() => remove.mutate(item.id)}
              aria-label="Delete"
            >
              <TrashIcon />
            </button>
          </label>
        ))}
      </section>
      {data.punchSignoff ? (
        <section className="complete-banner">
          <CheckIcon />
          <div>
            <strong>{t.completedSignoff}</strong>
            <span>
              {data.punchSignoff.customerName} +{" "}
              {data.punchSignoff.contractorName}
            </span>
          </div>
        </section>
      ) : (
        <form
          className="tool-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (
              customer &&
              contractor &&
              customerSig &&
              contractorSig &&
              data.punchItems.length
            )
              sign.mutate();
          }}
        >
          <label>
            <span>{t.customerName}</span>
            <input
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
          </label>
          <SignaturePad
            label={t.customerSignature}
            clearLabel={t.clear}
            onChange={setCustomerSig}
          />
          <label>
            <span>{t.contractorName}</span>
            <input
              value={contractor}
              onChange={(e) => setContractor(e.target.value)}
            />
          </label>
          <SignaturePad
            label={t.contractorSignature}
            clearLabel={t.clear}
            onChange={setContractorSig}
          />
          <button className="primary-button" disabled={sign.isPending}>
            {t.signOff}
          </button>
        </form>
      )}
    </>
  );
}
function ProgressUpdate({
  lang,
  data,
  settings,
}: {
  lang: Lang;
  data: JobData;
  settings: Settings | null;
}) {
  const t = copy[lang];
  const job = data.job;
  const client = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [day, setDay] = useState(1);
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [notice, setNotice] = useState("");
  const shareUpdate = async (
    dayNumber: number,
    updateNote: string,
    photoIds: number[],
  ) => {
    if (!job) return;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#eef1f0";
    ctx.fillRect(0, 0, 1080, 1080);
    const picks = data.photos
      .filter((p) => photoIds.includes(p.id) && !p.excludeFromSocial)
      .slice(0, 4);
    let y = 180;
    for (const [i, p] of picks.entries()) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.onerror = () => resolve();
        img.src = p.url;
      });
      const x = i % 2 === 0 ? 60 : 550;
      if (i === 2) y = 580;
      ctx.drawImage(img, x, y, 470, 360);
    }
    ctx.fillStyle = settings?.accentColor ?? "#1f5a4a";
    ctx.font = "700 58px system-ui";
    ctx.fillText(
      `${lang === "es" ? "Día" : "Day"} ${dayNumber} · ${job.jobType}`,
      60,
      90,
    );
    ctx.fillStyle = "#171a1c";
    ctx.font = "34px system-ui";
    const lines = updateNote.match(/.{1,48}(?:\s|$)/g) ?? [updateNote];
    lines
      .slice(0, 2)
      .forEach((line, i) => ctx.fillText(line.trim(), 60, 130 + i * 42));
    ctx.fillStyle = settings?.accentColor ?? "#1f5a4a";
    ctx.font = "700 28px system-ui";
    ctx.fillText(settings?.companyName || "", 60, 1040);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b ?? new Blob()), "image/jpeg", 0.9),
    );
    await nativeShare(
      blob,
      `${safeName(job.clientName)}-day-${dayNumber}.jpg`,
      `${lang === "es" ? "Día" : "Day"} ${dayNumber}`,
      updateNote,
    );
  };
  const save = useMutation({
    mutationFn: (status: "draft" | "sent") =>
      api.saveProgressUpdate({
        id: editingId,
        jobId: job?.id ?? 0,
        dayNumber: day,
        note,
        photoIds: selected,
        status,
      }),
    onSuccess: async (_r, status) => {
      client.invalidateQueries({ queryKey: ["job", job?.id] });
      if (status === "sent") await shareUpdate(day, note, selected);
      else setNotice(t.draftSaved);
      setEditingId(null);
      setNote("");
      setSelected([]);
    },
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deleteProgressUpdate({ id }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["job", job?.id] }),
  });
  if (!job) return null;
  const drafts = data.progressUpdates.filter((u) => u.status === "draft");
  const sent = data.progressUpdates.filter((u) => u.status === "sent");
  const resume = (u: JobData["progressUpdates"][number]) => {
    setEditingId(u.id);
    setDay(u.dayNumber);
    setNote(u.note);
    setSelected(u.photoIds);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  return (
    <>
      <form
        className="tool-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate("sent");
        }}
      >
        <label>
          <span>{t.dayNumber}</span>
          <input
            type="number"
            min="1"
            value={day}
            onChange={(e) => setDay(Number(e.target.value) || 1)}
          />
        </label>
        <label>
          <span>{t.updateNote}</span>
          <textarea
            rows={4}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <fieldset className="photo-picker">
          <legend>{t.chooseUpdatePhotos}</legend>
          <div>
            {data.photos
              .filter((p) => !p.excludeFromSocial)
              .map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={selected.includes(p.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, p.id]
                          : selected.filter((id) => id !== p.id),
                      )
                    }
                  />
                  <img src={p.url} alt={p.caption || p.stage} />
                </label>
              ))}
          </div>
        </fieldset>
        {notice && <p className="status success">{notice}</p>}
        <div className="dual-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => save.mutate("draft")}
            disabled={save.isPending}
          >
            {t.saveDraft}
          </button>
          <button className="primary-button" disabled={save.isPending}>
            {save.isPending ? t.saving : t.saveShare}
          </button>
        </div>
      </form>
      {drafts.length > 0 && (
        <section className="saved-section draft-section">
          <h2>{t.drafts}</h2>
          {drafts.map((u) => (
            <article key={u.id}>
              <div>
                <strong>
                  {job.clientName} · {lang === "es" ? "Día" : "Day"}{" "}
                  {u.dayNumber}
                </strong>
                <small>{u.note || "—"}</small>
                <small>
                  {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                    dateStyle: "medium",
                  }).format(new Date(u.updatedAt))}
                </small>
              </div>
              <div className="row-actions">
                <button onClick={() => resume(u)}>{t.resume}</button>
                <button
                  onClick={async () => {
                    await api.saveProgressUpdate({
                      id: u.id,
                      jobId: job.id,
                      dayNumber: u.dayNumber,
                      note: u.note,
                      photoIds: u.photoIds,
                      status: "sent",
                    });
                    await shareUpdate(u.dayNumber, u.note, u.photoIds);
                    client.invalidateQueries({ queryKey: ["job", job.id] });
                  }}
                >
                  {t.sendNow}
                </button>
                <button
                  aria-label={t.deleteDraft}
                  onClick={() => remove.mutate(u.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            </article>
          ))}
        </section>
      )}
      {sent.length > 0 && (
        <section className="saved-section">
          <h2>{t.savedUpdates}</h2>
          {sent.map((u) => (
            <article key={u.id}>
              <div>
                <strong>
                  {lang === "es" ? "Día" : "Day"} {u.dayNumber}
                </strong>
                <small>{u.note}</small>
              </div>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

const MARKUP_COLORS = ["#ef3d2f", "#ffc400", "#ffffff"] as const;

function PhotoAnnotator({
  lang,
  data,
  photoId,
}: {
  lang: Lang;
  data: JobData;
  photoId?: number;
}) {
  const t = copy[lang];
  const photo = data.photos.find((p) => p.id === photoId) ?? data.photos[0];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLImageElement | null>(null);
  const client = useQueryClient();
  const [mode, setMode] = useState<"pen" | "circle" | "arrow" | "text">("pen");
  const [color, setColor] = useState<(typeof MARKUP_COLORS)[number]>("#ef3d2f");
  const [textAnchor, setTextAnchor] = useState<{ x: number; y: number } | null>(null);
  const [textDraft, setTextDraft] = useState("");
  const [canUndo, setCanUndo] = useState(false);
  const drawing = useRef(false);
  const start = useRef({ x: 0, y: 0 });
  const snapshot = useRef<ImageData | null>(null);
  const history = useRef<ImageData[]>([]);
  useEffect(() => {
    if (!photo) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      baseRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")?.drawImage(img, 0, 0);
      history.current = [];
      setCanUndo(false);
    };
    img.src = photo.url;
  }, [photo]);
  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * c.width) / r.width,
      y: ((e.clientY - r.top) * c.height) / r.height,
    };
  };
  const pushHistory = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    history.current.push(ctx.getImageData(0, 0, c.width, c.height));
    if (history.current.length > 25) history.current.shift();
    setCanUndo(true);
  };
  const undo = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    const prev = history.current.pop();
    if (!c || !ctx) return;
    if (prev) ctx.putImageData(prev, 0, 0);
    setCanUndo(history.current.length > 0);
  };
  const clearAll = () => {
    const c = canvasRef.current;
    const img = baseRef.current;
    if (!c || !img) return;
    history.current = [];
    setCanUndo(false);
    c.getContext("2d")?.drawImage(img, 0, 0);
    setTextAnchor(null);
    setTextDraft("");
  };
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (mode === "text") {
      setTextAnchor(point(e));
      setTextDraft("");
      return;
    }
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    drawing.current = true;
    pushHistory();
    start.current = point(e);
    snapshot.current = ctx.getImageData(0, 0, c.width, c.height);
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const drawArrow = (
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) => {
    const a = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(24, ctx.lineWidth * 5);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - head * Math.cos(a - Math.PI / 6),
      y2 - head * Math.sin(a - Math.PI / 6),
    );
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - head * Math.cos(a + Math.PI / 6),
      y2 - head * Math.sin(a + Math.PI / 6),
    );
    ctx.stroke();
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || mode === "text") return;
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const p = point(e);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(5, c.width / 180);
    ctx.lineCap = "round";
    if (mode !== "pen" && snapshot.current)
      ctx.putImageData(snapshot.current, 0, 0);
    if (mode === "pen") {
      ctx.beginPath();
      ctx.moveTo(start.current.x, start.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      start.current = p;
    } else if (mode === "circle") {
      ctx.beginPath();
      ctx.ellipse(
        (start.current.x + p.x) / 2,
        (start.current.y + p.y) / 2,
        Math.abs(p.x - start.current.x) / 2,
        Math.abs(p.y - start.current.y) / 2,
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    } else drawArrow(ctx, start.current.x, start.current.y, p.x, p.y);
  };
  const commitText = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    const anchor = textAnchor;
    const value = textDraft.trim();
    setTextAnchor(null);
    setTextDraft("");
    if (!c || !ctx || !anchor || !value) return;
    pushHistory();
    const size = Math.max(28, c.width / 18);
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.lineWidth = Math.max(2, size / 12);
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.fillStyle = color;
    ctx.strokeText(value, anchor.x, anchor.y);
    ctx.fillText(value, anchor.x, anchor.y);
  };
  const save = useMutation({
    mutationFn: async () => {
      if (!photo) throw new Error();
      const c = canvasRef.current;
      if (!c) throw new Error();
      const blob = await new Promise<Blob>((resolve) =>
        c.toBlob((b) => resolve(b ?? new Blob()), "image/png"),
      );
      const file = new File(
        [blob],
        `markup-${photo.filename.replace(/\.[^.]+$/, "")}.png`,
        { type: "image/png" },
      );
      const data64 = await fileToBase64(file);
      return api.addPhoto({
        jobId: photo.jobId,
        stage: photo.stage,
        caption: `${photo.caption}${photo.caption ? " \u2014 " : ""}${lang === "es" ? "Con anotaciones" : "Marked up"}`,
        filename: file.name,
        contentType: "image/png",
        capturedAt: new Date().toISOString(),
        dataBase64: data64.dataBase64,
        annotatedFromId: photo.id,
      });
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["job", photo?.jobId] }),
  });
  if (!photo)
    return (
      <div className="empty-state">
        <h2>{t.selectPhoto}</h2>
      </div>
    );
  return (
    <>
      <div className="annotation-toolbar">
        <button
          className={mode === "pen" ? "active" : ""}
          onClick={() => setMode("pen")}
        >
          {t.pen}
        </button>
        <button
          className={mode === "circle" ? "active" : ""}
          onClick={() => setMode("circle")}
        >
          {t.circle}
        </button>
        <button
          className={mode === "arrow" ? "active" : ""}
          onClick={() => setMode("arrow")}
        >
          {t.arrow}
        </button>
        <button
          className={mode === "text" ? "active" : ""}
          onClick={() => setMode("text")}
        >
          {lang === "es" ? "Texto" : "Text"}
        </button>
      </div>
      <div className="annotation-colors" role="group" aria-label={lang === "es" ? "Color" : "Color"}>
        {MARKUP_COLORS.map((swatch) => (
          <button
            key={swatch}
            className={`color-swatch${color === swatch ? " active" : ""}`}
            style={{ background: swatch }}
            aria-label={swatch}
            onClick={() => setColor(swatch)}
          />
        ))}
        <button className="secondary-button" disabled={!canUndo} onClick={undo}>
          {lang === "es" ? "Deshacer" : "Undo"}
        </button>
        <button className="secondary-button" onClick={clearAll}>
          {lang === "es" ? "Borrar todo" : "Clear"}
        </button>
      </div>
      <div className="annotation-stage">
        <canvas
          ref={canvasRef}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
        />
        {textAnchor && canvasRef.current && (
          <form
            className="annotation-text-input"
            style={{
              left: `${(textAnchor.x / canvasRef.current.width) * 100}%`,
              top: `${(textAnchor.y / canvasRef.current.height) * 100}%`,
            }}
            onSubmit={(e) => {
              e.preventDefault();
              commitText();
            }}
          >
            <input
              autoFocus
              value={textDraft}
              maxLength={80}
              placeholder={lang === "es" ? "Escribe el texto" : "Type text"}
              onChange={(e) => setTextDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setTextAnchor(null);
                  setTextDraft("");
                }
              }}
            />
            <div>
              <button type="submit" className="primary-button">
                {lang === "es" ? "Agregar" : "Add"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setTextAnchor(null);
                  setTextDraft("");
                }}
              >
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
            </div>
          </form>
        )}
      </div>
      <button
        className="primary-button full-button"
        onClick={() => save.mutate()}
        disabled={save.isPending}
      >
        {save.isPending ? t.saving : t.saveCopy}
      </button>
    </>
  );
}
function TextTemplates({
  lang,
  job,
  settings,
}: {
  lang: Lang;
  job: Job;
  settings: Settings | null;
}) {
  const t = copy[lang];
  const [eta, setEta] = useState("");
  const appointment = job.appointmentAt
    ? new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(job.appointmentAt))
    : formatDate(job.jobDate, lang);
  const signature = companySignature(settings);
  const templates = [
    {
      title: t.appointmentConfirm,
      text:
        lang === "es"
          ? `Hola ${job.clientName}, confirmamos nuestra cita para ${appointment} en ${job.jobAddress}. Toca para confirmar. — ${signature}`
          : `Hi ${job.clientName}, confirming our appointment for ${appointment} at ${job.jobAddress}. Tap to confirm. — ${signature}`,
    },
    {
      title: t.onMyWay,
      text:
        lang === "es"
          ? `Hola ${job.clientName}, voy en camino para ${job.jobType}. Llegaré aproximadamente ${eta || "pronto"}. — ${signature}`
          : `Hi ${job.clientName}, I’m on my way for ${job.jobType}. My ETA is ${eta || "soon"}. — ${signature}`,
    },
    {
      title: t.missedCall,
      text:
        lang === "es"
          ? `Hola ${job.clientName}, perdí tu llamada. Te devolveré la llamada lo antes posible. — ${signature}`
          : `Hi ${job.clientName}, I missed your call. I’ll call you back as soon as possible. — ${signature}`,
    },
  ];
  return (
    <>
      <p className="upgrade-note">{t.smsUpgrade}</p>
      <label className="eta-field">
        <span>{t.eta}</span>
        <input
          value={eta}
          onChange={(e) => setEta(e.target.value)}
          placeholder="25 min / 3:30 PM"
        />
      </label>
      <section className="template-list">
        {templates.map((item) => (
          <article key={item.title}>
            <h2>{item.title}</h2>
            <p>{item.text}</p>
            {job.clientPhone ? (
              <a
                className="primary-button"
                href={smsHref(job.clientPhone, item.text)}
              >
                {t.openSms}
              </a>
            ) : (
              <span className="status error">{t.noPhone}</span>
            )}
          </article>
        ))}
      </section>
    </>
  );
}
function DepositRequest({
  lang,
  job,
  settings,
}: {
  lang: Lang;
  job: Job;
  settings: Settings | null;
}) {
  const t = copy[lang];
  const message =
    lang === "es"
      ? `Solicitud de depósito\n\nCliente: ${job.clientName}\nTrabajo: ${job.jobType}\nMonto: ${job.depositAmount || "—"}\n\n${settings?.paymentInstructions || job.paymentNotes}\n\n${companySignature(settings)}`
      : `Deposit request\n\nClient: ${job.clientName}\nJob: ${job.jobType}\nAmount: ${job.depositAmount || "—"}\n\n${settings?.paymentInstructions || job.paymentNotes}\n\n${companySignature(settings)}`;
  const share = async () => {
    if (navigator.share)
      await navigator
        .share({ title: t.depositRequest, text: message })
        .catch(() => undefined);
    else await copyText(message);
  };
  return (
    <section className="request-card">
      <p className="eyebrow">{t.depositRequest}</p>
      <h2>{job.depositAmount || "—"}</h2>
      <dl>
        <div>
          <dt>{t.client}</dt>
          <dd>{job.clientName}</dd>
        </div>
        <div>
          <dt>{t.type}</dt>
          <dd>{job.jobType}</dd>
        </div>
        <div>
          <dt>{t.paymentInstructions}</dt>
          <dd>{settings?.paymentInstructions || job.paymentNotes || "—"}</dd>
        </div>
      </dl>
      <button className="primary-button" onClick={share}>
        <ShareIcon />
        {t.shareRequest}
      </button>
      {job.clientPhone && (
        <a
          className="secondary-button"
          href={smsHref(job.clientPhone, message)}
        >
          {t.openSms}
        </a>
      )}
    </section>
  );
}

function ProofPacket({
  lang,
  jobId,
  settings,
  onBack,
}: {
  lang: Lang;
  jobId: number;
  settings: Settings | null;
  onBack: () => void;
}) {
  const t = copy[lang];
  const query = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob({ id: jobId }),
  });
  const [busy, setBusy] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const job = query.data?.job;
  const changeOrders =
    query.data?.documents.filter((d) => d.kind === "change_order") ?? [];
  const changeTotal = changeOrders.reduce((sum, d) => sum + money(d.amount), 0);
  const grandTotal = money(job?.amountDue ?? "") + changeTotal;
  const build = async () => {
    if (!job || !query.data) throw new Error();
    const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
    const w = doc.internal.pageSize.getWidth();
    const h = doc.internal.pageSize.getHeight();
    const margin = 42;
    const [ar, ag, ab] = hexRgb(settings?.accentColor ?? "#1f5a4a");
    const logoData = await loadImageDataUrl(settings?.logoUrl ?? null);
    let y = 48;
    const header = () => {
      if (logoData) {
        try {
          doc.addImage(
            logoData,
            logoData.startsWith("data:image/png") ? "PNG" : "JPEG",
            margin,
            y - 18,
            58,
            36,
            undefined,
            "FAST",
          );
        } catch {
          /* text brand remains */
        }
      }
      const textX = logoData ? margin + 68 : margin;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(17);
      doc.setTextColor(ar, ag, ab);
      doc.text(settings?.companyName || "", textX, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.text(
        [settings?.licenseNumber, companyContact(settings)]
          .filter(Boolean)
          .join(" · "),
        textX,
        y + 14,
      );
      doc.setDrawColor(ar, ag, ab);
      doc.line(margin, y + 27, w - margin, y + 27);
      y += 48;
    };
    const space = (n: number) => {
      if (y + n < h - 42) return;
      doc.addPage();
      y = 48;
      header();
    };
    header();
    doc.setFont("helvetica", "bold");
    doc.setTextColor(24, 32, 30);
    doc.setFontSize(24);
    doc.text(t.proof, margin, y);
    y += 30;
    doc.setFillColor(238, 241, 240);
    doc.roundedRect(margin, y, w - margin * 2, 100, 5, 5, "F");
    doc.setFontSize(10);
    doc.text(`${t.client}: ${job.clientName}`, margin + 14, y + 22);
    doc.text(`${t.type}: ${job.jobType}`, margin + 14, y + 42);
    doc.text(`${t.address}: ${job.jobAddress}`, margin + 14, y + 62);
    doc.text(
      `${t.date}: ${formatDate(job.jobDate, lang)}`,
      margin + 14,
      y + 82,
    );
    y += 122;
    if (job.amountDue || changeOrders.length) {
      doc.setFontSize(15);
      doc.text(t.invoice, margin, y);
      y += 20;
      doc.setFontSize(10);
      if (job.amountDue) {
        doc.text(`${t.amountDue}: ${usd(money(job.amountDue))}`, margin, y);
        y += 16;
      }
      for (const order of changeOrders) {
        doc.text(`${order.title}: ${usd(money(order.amount))}`, margin, y);
        y += 16;
      }
      doc.setFontSize(13);
      doc.text(
        `${t.total}: ${grandTotal.toLocaleString("en-US", { style: "currency", currency: "USD" })}`,
        margin,
        y,
      );
      y += 28;
      if (settings?.paymentInstructions) {
        const paymentLines = doc.splitTextToSize(
          `${t.paymentInstructions}: ${settings.paymentInstructions}`,
          w - margin * 2,
        ) as string[];
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(70, 78, 76);
        doc.text(paymentLines, margin, y);
        y += paymentLines.length * 12 + 12;
      }
    }
    doc.setFontSize(15);
    doc.text(t.documentation, margin, y);
    y += 20;
    for (const stage of ["before", "during", "after"] as const) {
      const photos = query.data.photos.filter((p) => p.stage === stage);
      if (!photos.length) continue;
      space(35);
      doc.setFontSize(12);
      doc.setTextColor(31, 90, 74);
      doc.text(`${t[stage]} (${photos.length})`, margin, y);
      y += 16;
      for (const p of photos) {
        space(225);
        try {
          const blob = await (await fetch(p.url)).blob();
          doc.addImage(
            await blobDataUrl(blob),
            blob.type.includes("png") ? "PNG" : "JPEG",
            margin,
            y,
            w - margin * 2,
            175,
            undefined,
            "MEDIUM",
          );
          y += 186;
        } catch {
          y += 30;
        }
        doc.setTextColor(54, 66, 63);
        doc.setFontSize(9);
        doc.text(
          p.caption ||
            `${t.captured}: ${new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { dateStyle: "medium" }).format(new Date(p.capturedAt))}`,
          margin,
          y,
        );
        y += 24;
      }
    }
    if (query.data.punchItems.length) {
      space(80 + query.data.punchItems.length * 16);
      doc.setTextColor(24, 32, 30);
      doc.setFontSize(15);
      doc.setFont("helvetica", "bold");
      doc.text(t.punch, margin, y);
      y += 22;
      doc.setFontSize(10);
      for (const item of query.data.punchItems) {
        doc.text(`${item.completed ? "✓" : "□"} ${item.text}`, margin, y);
        y += 16;
      }
      if (query.data.punchSignoff) {
        y += 5;
        doc.text(
          `${t.completedSignoff}: ${query.data.punchSignoff.customerName} + ${query.data.punchSignoff.contractorName}`,
          margin,
          y,
        );
        y += 22;
      }
    }
    if (settings?.reviewUrl) {
      space(60);
      doc.setTextColor(31, 90, 74);
      doc.setFontSize(10);
      doc.text(t.reviewAsk, margin, y);
      y += 15;
      doc.textWithLink(settings.reviewUrl, margin, y, {
        url: settings.reviewUrl,
      });
    }
    return doc.output("blob");
  };
  useEffect(() => {
    if (job && query.data) void build().then(setPreviewBlob);
  }, [job, query.data, settings, lang]);
  const make = async (share: boolean) => {
    if (!job || !previewBlob) return;
    setBusy(true);
    try {
      const name = `${safeName(job.clientName)}-${safeName(job.jobType)}-proof-packet.pdf`;
      if (share) await nativeShare(previewBlob, name, t.proof);
      else downloadBlob(previewBlob, name);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="proof-page">
      <PageHeader lang={lang} title={t.proof} onBack={onBack} />
      <div className="packet-actions">
        <button
          className="primary-button"
          onClick={() => make(true)}
          disabled={busy || !previewBlob}
        >
          <ShareIcon />
          {busy ? t.pdfWait : t.sharePdf}
        </button>
        <button
          className="secondary-button"
          onClick={() => make(false)}
          disabled={busy || !previewBlob}
        >
          <FileIcon />
          {t.downloadPdf}
        </button>
      </div>
      <PdfFrame blob={previewBlob} title={t.pdfPreview} />
    </main>
  );
}

function BeforeAfterTool({
  lang,
  data,
  settings,
}: {
  lang: Lang;
  data: JobData;
  settings: Settings | null;
}) {
  const job = data.job;
  const before = data.photos.filter(
    (p) => p.stage === "before" && !p.excludeFromSocial,
  );
  const after = data.photos.filter(
    (p) => p.stage === "after" && !p.excludeFromSocial,
  );
  const [beforeId, setBeforeId] = useState(before[0]?.id ?? 0);
  const [afterId, setAfterId] = useState(after[0]?.id ?? 0);
  const [branded, setBranded] = useState(true);
  const [preview, setPreview] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const saved = useQuery({
    queryKey: ["share-images", job?.id],
    enabled: Boolean(job),
    queryFn: () => api.listShareImages({ jobId: job?.id ?? 0 }),
  });
  if (!job) return null;
  const make = async () => {
    const left = before.find((p) => p.id === beforeId);
    const right = after.find((p) => p.id === afterId);
    if (!left || !right) return;
    setBusy(true);
    try {
      const [lb, rb] = await Promise.all([
        fetch(left.url).then((r) => r.blob()),
        fetch(right.url).then((r) => r.blob()),
      ]);
      const [li, ri] = await Promise.all([
        createImageBitmap(lb),
        createImageBitmap(rb),
      ]);
      const canvas = document.createElement("canvas");
      canvas.width = 1600;
      canvas.height = branded ? 1000 : 900;
      const c = canvas.getContext("2d");
      if (!c) return;
      const drawCover = (img: ImageBitmap, x: number) => {
        const targetW = 800,
          targetH = 900,
          scale = Math.max(targetW / img.width, targetH / img.height),
          sw = targetW / scale,
          sh = targetH / scale;
        c.drawImage(
          img,
          (img.width - sw) / 2,
          (img.height - sh) / 2,
          sw,
          sh,
          x,
          0,
          targetW,
          targetH,
        );
      };
      drawCover(li, 0);
      drawCover(ri, 800);
      c.fillStyle = "rgba(0,0,0,.72)";
      c.fillRect(0, 0, 1600, 70);
      c.fillStyle = "#fff";
      c.font = "700 30px system-ui";
      c.textAlign = "center";
      c.fillText(lang === "es" ? "ANTES" : "BEFORE", 400, 46);
      c.fillText(lang === "es" ? "DESPUÉS" : "AFTER", 1200, 46);
      if (branded) {
        c.fillStyle = "#171a1c";
        c.fillRect(0, 900, 1600, 100);
        c.fillStyle = "#fff";
        c.textAlign = "left";
        c.font = "700 34px system-ui";
        c.fillText(settings?.companyName || job.jobType, 50, 960);
        c.textAlign = "right";
        c.font = "500 24px system-ui";
        c.fillText(
          [settings?.licenseNumber, settings?.phone]
            .filter(Boolean)
            .join(" · "),
          1550,
          960,
        );
      }
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.92),
      );
      if (!blob) return;
      setPreview(blob);
      const b64 = (await blobDataUrl(blob)).split(",")[1] ?? "";
      await api.saveShareImage({
        jobId: job.id,
        beforePhotoId: beforeId,
        afterPhotoId: afterId,
        branded,
        filename: `${safeName(job.clientName)}-before-after.jpg`,
        dataBase64: b64,
      });
      qc.invalidateQueries({ queryKey: ["share-images", job.id] });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="operations-panel comparison-tool">
      <p className="privacy-note">
        {lang === "es"
          ? "Elige una foto de cada etapa. La imagen terminada se guarda aquí; compartir abre el menú del teléfono."
          : "Choose one photo from each stage. The finished image is saved here; Share opens your phone’s share sheet."}
      </p>
      {before.length && after.length ? (
        <>
          <div className="comparison-pickers">
            <label>
              <span>{lang === "es" ? "Antes" : "Before"}</span>
              <select
                value={beforeId}
                onChange={(e) => setBeforeId(Number(e.target.value))}
              >
                {before.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.caption || `#${p.id}`}
                  </option>
                ))}
              </select>
              <img
                src={before.find((p) => p.id === beforeId)?.url}
                alt={
                  lang === "es"
                    ? "Foto seleccionada de antes"
                    : "Selected before photo"
                }
              />
            </label>
            <label>
              <span>{lang === "es" ? "Después" : "After"}</span>
              <select
                value={afterId}
                onChange={(e) => setAfterId(Number(e.target.value))}
              >
                {after.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.caption || `#${p.id}`}
                  </option>
                ))}
              </select>
              <img
                src={after.find((p) => p.id === afterId)?.url}
                alt={
                  lang === "es"
                    ? "Foto seleccionada de después"
                    : "Selected after photo"
                }
              />
            </label>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={branded}
              onChange={(e) => setBranded(e.target.checked)}
            />
            <span>
              {lang === "es"
                ? "Agregar nombre, licencia y teléfono"
                : "Add company name, license, and phone"}
            </span>
          </label>
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void make()}
          >
            {busy
              ? lang === "es"
                ? "Creando…"
                : "Creating…"
              : lang === "es"
                ? "Crear y guardar"
                : "Create & save"}
          </button>
        </>
      ) : (
        <div className="empty-state">
          <h2>
            {lang === "es"
              ? "Agrega al menos una foto de Antes y una de Después."
              : "Add at least one Before and one After photo."}
          </h2>
        </div>
      )}
      {preview && (
        <div className="comparison-result">
          <img
            src={URL.createObjectURL(preview)}
            alt={
              lang === "es" ? "Comparación generada" : "Generated comparison"
            }
          />
          <div className="packet-actions">
            <button
              className="primary-button"
              onClick={() =>
                nativeShare(
                  preview,
                  `${safeName(job.clientName)}-before-after.jpg`,
                  job.jobType,
                )
              }
            >
              <ShareIcon />
              {lang === "es" ? "Compartir" : "Share"}
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                downloadBlob(
                  preview,
                  `${safeName(job.clientName)}-before-after.jpg`,
                )
              }
            >
              <FileIcon />
              {lang === "es" ? "Descargar" : "Download"}
            </button>
          </div>
        </div>
      )}
      {(saved.data?.images.length ?? 0) > 0 && (
        <div className="saved-comparisons">
          <h2>{lang === "es" ? "Guardadas" : "Saved"}</h2>
          {saved.data?.images.map((img) => (
            <figure key={img.id}>
              <img src={img.url} alt={img.filename} />
              <figcaption>
                {formatDate(img.createdAt.slice(0, 10), lang)}
                {img.branded
                  ? ` · ${lang === "es" ? "Con marca" : "Branded"}`
                  : ""}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}

function SubcontractorTool({ lang, jobId }: { lang: Lang; jobId: number }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["subcontractors", jobId],
    queryFn: () => api.listSubcontractors({ jobId }),
  });
  const [form, setForm] = useState({
    id: null as number | null,
    jobId,
    name: "",
    trade: "",
    phone: "",
    agreedAmount: "",
    paidToDate: "",
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["subcontractors", jobId] });
    qc.invalidateQueries({ queryKey: ["job-operations", jobId] });
  };
  return (
    <section className="operations-panel">
      <div className="toolkit-summary">
        <article>
          <span>{lang === "es" ? "Acordado" : "Agreed"}</span>
          <strong>{usd(query.data?.totalAgreed ?? 0)}</strong>
        </article>
        <article>
          <span>{lang === "es" ? "Pendiente" : "Balance"}</span>
          <strong>{usd(query.data?.totalBalance ?? 0)}</strong>
        </article>
      </div>
      <form
        className="compact-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.name) return;
          await api.saveSubcontractor(form);
          setForm({
            id: null,
            jobId,
            name: "",
            trade: "",
            phone: "",
            agreedAmount: "",
            paidToDate: "",
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
            <span>{lang === "es" ? "Oficio" : "Trade"}</span>
            <input
              value={form.trade}
              onChange={(e) => setForm({ ...form, trade: e.target.value })}
            />
          </label>
        </div>
        <label>
          <span>{lang === "es" ? "Teléfono" : "Phone"}</span>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </label>
        <div className="field-pair">
          <label>
            <span>{lang === "es" ? "Monto acordado" : "Agreed amount"}</span>
            <input
              inputMode="decimal"
              value={form.agreedAmount}
              onChange={(e) =>
                setForm({ ...form, agreedAmount: e.target.value })
              }
            />
          </label>
          <label>
            <span>{lang === "es" ? "Pagado hasta hoy" : "Paid to date"}</span>
            <input
              inputMode="decimal"
              value={form.paidToDate}
              onChange={(e) => setForm({ ...form, paidToDate: e.target.value })}
            />
          </label>
        </div>
        <button className="primary-button">
          {lang === "es" ? "Guardar" : "Save"}
        </button>
      </form>
      <div className="tool-records">
        {query.data?.subcontractors.map((row) => (
          <article key={row.id}>
            <div>
              <strong>
                {row.name} · {row.trade}
              </strong>
              <span>
                {lang === "es" ? "Saldo" : "Balance"}: {usd(row.balance)}
              </span>
              <small>
                {lang === "es" ? "Acordado" : "Agreed"}{" "}
                {usd(money(row.agreedAmount))} ·{" "}
                {lang === "es" ? "Pagado" : "Paid"} {usd(money(row.paidToDate))}
              </small>
            </div>
            <div className="row-actions">
              <button
                onClick={() =>
                  setForm({
                    id: row.id,
                    jobId,
                    name: row.name,
                    trade: row.trade,
                    phone: row.phone,
                    agreedAmount: row.agreedAmount,
                    paidToDate: row.paidToDate,
                  })
                }
              >
                {lang === "es" ? "Editar" : "Edit"}
              </button>
              <button
                aria-label={`${lang === "es" ? "Eliminar" : "Delete"} ${row.name}`}
                onClick={async () => {
                  await api.deleteSubcontractor({ id: row.id });
                  refresh();
                }}
              >
                <TrashIcon />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function formatDuration(totalSeconds: number, lang: Lang) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${hours} ${copy[lang].hours} ${minutes} ${copy[lang].minutes}`;
}

function TimeTracker({ lang, data }: { lang: Lang; data: JobData }) {
  const t = copy[lang];
  const qc = useQueryClient();
  const job = data.job;
  const [note, setNote] = useState("");
  const [crewMember, setCrewMember] = useState("");
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((v) => v + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const active = data.timeEntries.find((entry) => !entry.endedAt);
  const total = data.timeEntries.reduce(
    (sum, entry) =>
      sum +
      (entry.endedAt
        ? entry.durationSeconds
        : Math.max(
            0,
            Math.floor(
              (Date.now() - new Date(entry.startedAt).getTime()) / 1000,
            ),
          )),
    0,
  );
  const start = useMutation({
    mutationFn: () => api.startTimer({ jobId: job?.id ?? 0, crewMember, note }),
    onSuccess: () => {
      setNote("");
      qc.invalidateQueries({ queryKey: ["job", job?.id] });
    },
  });
  const stop = useMutation({
    mutationFn: () => api.stopTimer({ id: active?.id ?? 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job", job?.id] }),
  });
  if (!job) return null;
  return (
    <section className="operations-panel">
      <div className="metric-hero">
        <span>{t.totalHours}</span>
        <strong>{formatDuration(total, lang)}</strong>
        {active && (
          <small>
            {t.running} ·{" "}
            {formatDuration(
              Math.max(
                0,
                Math.floor(
                  (Date.now() - new Date(active.startedAt).getTime()) / 1000,
                ),
              ),
              lang,
            )}
          </small>
        )}
      </div>
      <div className="field-pair">
        <label>
          <span>{lang === "es" ? "Miembro del equipo" : "Crew member"}</span>
          <input
            value={crewMember}
            onChange={(e) => setCrewMember(e.target.value)}
            disabled={Boolean(active)}
            placeholder={lang === "es" ? "Nombre" : "Name"}
          />
        </label>
        <label>
          <span>{t.timeNote}</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={Boolean(active)}
          />
        </label>
      </div>
      {active ? (
        <button className="stop-button" onClick={() => stop.mutate()}>
          {t.clockOut}
        </button>
      ) : (
        <button
          className="primary-button full-button"
          onClick={() => start.mutate()}
        >
          {t.clockIn}
        </button>
      )}
      <div className="operation-list">
        {data.timeEntries.map((entry) => (
          <article key={entry.id}>
            <span>
              <strong>
                {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(entry.startedAt))}
              </strong>
              <small>
                {entry.crewMember ||
                  (lang === "es" ? "Sin asignar" : "Unassigned")}{" "}
                · {entry.note || "—"} ·{" "}
                {entry.endedAt
                  ? formatDuration(entry.durationSeconds, lang)
                  : t.running}
              </small>
            </span>
            <button
              aria-label={t.delete}
              onClick={async () => {
                await api.deleteTimeEntry({ id: entry.id });
                qc.invalidateQueries({ queryKey: ["job", job.id] });
              }}
            >
              <TrashIcon />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReceiptManager({ lang, data }: { lang: Lang; data: JobData }) {
  const t = copy[lang];
  const qc = useQueryClient();
  const job = data.job;
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const total = data.receipts.reduce((sum, r) => sum + money(r.amount), 0);
  const save = useMutation({
    mutationFn: async () => {
      if (!file || !job) throw new Error();
      const encoded = await fileToBase64(file);
      return api.addReceipt({
        jobId: job.id,
        vendor,
        amount,
        purchaseDate,
        note,
        filename: file.name,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
        dataBase64: encoded.dataBase64,
      });
    },
    onSuccess: () => {
      setVendor("");
      setAmount("");
      setNote("");
      setFile(null);
      qc.invalidateQueries({ queryKey: ["job", job?.id] });
    },
  });
  if (!job) return null;
  return (
    <section className="operations-panel">
      <div className="metric-hero">
        <span>{t.materialsTotal}</span>
        <strong>{usd(total)}</strong>
        <small>
          {data.receipts.length} {t.receipts.toLowerCase()}
        </small>
      </div>
      <form
        className="compact-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (file && money(amount) >= 0) save.mutate();
        }}
      >
        <button
          type="button"
          className="camera-button"
          onClick={() => input.current?.click()}
        >
          <CameraIcon />
          {file ? file.name : t.receiptPhoto}
        </button>
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="field-pair">
          <label>
            <span>{t.vendor}</span>
            <input value={vendor} onChange={(e) => setVendor(e.target.value)} />
          </label>
          <label>
            <span>{t.amount}</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        </div>
        <label>
          <span>{t.purchaseDate}</span>
          <input
            type="date"
            value={purchaseDate}
            onChange={(e) => setPurchaseDate(e.target.value)}
          />
        </label>
        <label>
          <span>{t.notes}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <button className="primary-button" disabled={save.isPending}>
          {save.isPending ? t.saving : t.save}
        </button>
      </form>
      <div className="receipt-grid">
        {data.receipts.map((r) => (
          <article key={r.id}>
            <img src={r.url} alt={`${t.receipts}: ${r.vendor}`} />
            <div>
              <strong>{r.vendor || t.receipts}</strong>
              <span>{usd(money(r.amount))}</span>
              <small>
                {formatDate(r.purchaseDate, lang)} {r.note && `· ${r.note}`}
              </small>
            </div>
            <button
              aria-label={t.delete}
              onClick={async () => {
                await api.deleteReceipt({ id: r.id });
                qc.invalidateQueries({ queryKey: ["job", job.id] });
              }}
            >
              <TrashIcon />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function CrewChecklist({ lang, data }: { lang: Lang; data: JobData }) {
  const t = copy[lang];
  const qc = useQueryClient();
  const job = data.job;
  const [text, setText] = useState("");
  if (!job) return null;
  const save = async (id: number | null, value: string, completed: boolean) => {
    if (!value.trim()) return;
    await api.saveCrewTask({ id, jobId: job.id, text: value, completed });
    setText("");
    qc.invalidateQueries({ queryKey: ["job", job.id] });
  };
  return (
    <section className="operations-panel">
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          void save(null, text, false);
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.taskName}
        />
        <button className="primary-button">{t.addItem}</button>
      </form>
      <div className="crew-list">
        {data.crewTasks.map((task) => (
          <article key={task.id}>
            <input
              aria-label={`${t.done}: ${task.text}`}
              type="checkbox"
              checked={task.completed}
              onChange={(e) => void save(task.id, task.text, e.target.checked)}
            />
            <input
              aria-label={t.rename}
              defaultValue={task.text}
              onBlur={(e) =>
                e.target.value.trim() !== task.text &&
                void save(task.id, e.target.value, task.completed)
              }
            />
            <button
              aria-label={t.delete}
              onClick={async () => {
                await api.deleteCrewTask({ id: task.id });
                qc.invalidateQueries({ queryKey: ["job", job.id] });
              }}
            >
              <TrashIcon />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function VoiceNotes({ lang, data }: { lang: Lang; data: JobData }) {
  const t = copy[lang];
  const qc = useQueryClient();
  const job = data.job;
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const upload = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const [title, setTitle] = useState("");
  const [draft, setDraft] = useState<{ blob: Blob; seconds: number } | null>(
    null,
  );
  const [error, setError] = useState("");
  const begin = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunks.current, {
          type: rec.mimeType || "audio/webm",
        });
        setDraft({
          blob,
          seconds: Math.max(
            1,
            Math.round((Date.now() - started.current) / 1000),
          ),
        });
        stream.getTracks().forEach((track) => track.stop());
      };
      started.current = Date.now();
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setError(t.permissionsError);
    }
  };
  const stop = () => {
    recorder.current?.stop();
    setRecording(false);
  };
  const saveDraft = async (blob: Blob, seconds: number) => {
    if (!job) return;
    const file = new File(
      [blob],
      `voice-${Date.now()}.${blob.type.includes("mp4") ? "m4a" : "webm"}`,
      { type: blob.type || "audio/webm" },
    );
    const encoded = await fileToBase64(file);
    await api.addVoiceNote({
      jobId: job.id,
      title,
      filename: file.name,
      contentType: file.type,
      durationSeconds: seconds,
      dataBase64: encoded.dataBase64,
    });
    setDraft(null);
    setTitle("");
    qc.invalidateQueries({ queryKey: ["job", job.id] });
  };
  if (!job) return null;
  return (
    <section className="operations-panel">
      <label>
        <span>{t.noteTitle}</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="record-actions">
        <button
          className={recording ? "stop-button" : "primary-button"}
          onClick={recording ? stop : begin}
        >
          {recording ? t.stopRecording : t.record}
        </button>
        <button
          className="secondary-button"
          onClick={() => upload.current?.click()}
        >
          {t.uploadAudio}
        </button>
        <input
          ref={upload}
          className="sr-only"
          type="file"
          accept="audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) setDraft({ blob: file, seconds: 0 });
          }}
        />
      </div>
      {recording && <p className="recording-indicator">● {t.recording}</p>}
      {error && <p className="status error">{error}</p>}
      {draft && (
        <div className="voice-draft">
          <audio controls src={URL.createObjectURL(draft.blob)} />
          <button
            className="primary-button"
            onClick={() => void saveDraft(draft.blob, draft.seconds)}
          >
            {t.addRecording}
          </button>
        </div>
      )}
      <div className="operation-list">
        {data.voiceNotes.map((note) => (
          <article key={note.id}>
            <span>
              <strong>{note.title || t.voiceNotes}</strong>
              <small>
                {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(note.createdAt))}
              </small>
              <audio controls src={note.url} />
            </span>
            <button
              aria-label={t.delete}
              onClick={async () => {
                await api.deleteVoiceNote({ id: note.id });
                qc.invalidateQueries({ queryKey: ["job", job.id] });
              }}
            >
              <TrashIcon />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

function CompletionCertificate({
  lang,
  data,
  settings,
}: {
  lang: Lang;
  data: JobData;
  settings: Settings | null;
}) {
  const t = copy[lang];
  const qc = useQueryClient();
  const job = data.job;
  const [date, setDate] = useState(
    data.certificate?.completionDate ?? new Date().toISOString().slice(0, 10),
  );
  const [terms, setTerms] = useState(
    data.certificate?.warrantyTerms ?? settings?.warrantyTerms ?? "",
  );
  const [blob, setBlob] = useState<Blob | null>(null);
  if (!job) return null;
  const build = async () => {
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const [r, g, b] = hexRgb(settings?.accentColor ?? "#1f5a4a");
    doc.setDrawColor(r, g, b);
    doc.setLineWidth(4);
    doc.rect(28, 28, 556, 736);
    doc.setTextColor(r, g, b);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(17);
    doc.text(settings?.companyName || "", 306, 74, { align: "center" });
    doc.setTextColor(25, 31, 30);
    doc.setFontSize(28);
    doc.text(t.completionCertificate, 306, 132, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`${t.client}: ${job.clientName}`, 72, 205);
    doc.text(`${t.type}: ${job.jobType}`, 72, 230);
    doc.text(`${t.address}: ${job.jobAddress}`, 72, 255);
    doc.text(`${t.completionDate}: ${formatDate(date, lang)}`, 72, 280);
    doc.setFont("helvetica", "bold");
    doc.text(t.warrantyTerms, 72, 335);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(terms || "—", 468) as string[];
    doc.text(lines, 72, 360);
    doc.setFontSize(9);
    doc.setTextColor(80, 88, 86);
    doc.text(
      [settings?.licenseNumber, companyContact(settings)]
        .filter(Boolean)
        .join(" · "),
      306,
      730,
      { align: "center" },
    );
    return doc.output("blob");
  };
  const save = async () => {
    await api.saveCertificate({
      jobId: job.id,
      completionDate: date,
      warrantyTerms: terms,
    });
    setBlob(await build());
    qc.invalidateQueries({ queryKey: ["job", job.id] });
  };
  return (
    <section className="operations-panel">
      <div className="certificate-form">
        <label>
          <span>{t.completionDate}</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          <span>{t.warrantyTerms}</span>
          <textarea
            rows={8}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
          />
        </label>
        <button className="primary-button" onClick={() => void save()}>
          {t.saveCertificate}
        </button>
      </div>
      {blob && (
        <>
          <div className="packet-actions">
            <button
              className="primary-button"
              onClick={() =>
                nativeShare(
                  blob,
                  `${safeName(job.clientName)}-completion-certificate.pdf`,
                  t.completionCertificate,
                )
              }
            >
              <ShareIcon />
              {t.sharePdf}
            </button>
            <button
              className="secondary-button"
              onClick={() =>
                downloadBlob(
                  blob,
                  `${safeName(job.clientName)}-completion-certificate.pdf`,
                )
              }
            >
              <FileIcon />
              {t.downloadPdf}
            </button>
          </div>
          <PdfFrame blob={blob} title={t.completionCertificate} />
        </>
      )}
    </section>
  );
}

function ReferralsScreen({
  lang,
  onBack,
  setScreen,
}: {
  lang: Lang;
  onBack: () => void;
  setScreen: (s: Screen) => void;
}) {
  const t = copy[lang];
  const query = useQuery({
    queryKey: ["clients", ""],
    queryFn: () => api.listClients({ search: "" }),
  });
  const clients = query.data?.clients ?? [];
  const referred = clients.filter((c) => c.referredByClientId);
  return (
    <main className="page">
      <PageHeader lang={lang} title={t.referrals} onBack={onBack} />
      <section className="referral-leaders">
        {clients
          .filter((c) => c.referralCount > 0)
          .sort((a, b) => b.referralCount - a.referralCount)
          .map((c) => (
            <button
              key={c.id}
              onClick={() => setScreen({ name: "client", clientId: c.id })}
            >
              <span className="referral-count">{c.referralCount}</span>
              <span>
                <strong>{c.name}</strong>
                <small>{t.referralCount}</small>
              </span>
              <BackIcon />
            </button>
          ))}
      </section>
      <section className="referral-chain">
        <h2>{t.referrals}</h2>
        {referred.map((c) => (
          <button
            key={c.id}
            onClick={() => setScreen({ name: "client", clientId: c.id })}
          >
            <span>
              <strong>{c.referredByName}</strong>
              <small>→ {c.name}</small>
            </span>
            <BackIcon />
          </button>
        ))}
      </section>
      {referred.length === 0 && (
        <div className="empty-state">
          <h2>{t.noReferrer}</h2>
        </div>
      )}
    </main>
  );
}

function TodayScreen({
  lang,
  settings,
  setScreen,
  toggleLanguage,
}: {
  lang: Lang;
  settings: Settings | null;
  setScreen: (s: Screen) => void;
  toggleLanguage: () => void;
}) {
  const qc = useQueryClient();
  const auth = useContext(AuthContext);
  const now = new Date();
  const today = now.toLocaleDateString("en-CA");
  const query = useQuery({
    queryKey: ["automation-center", today],
    queryFn: () => api.getAutomationCenter({ today }),
  });
  const jobsQuery = useQuery({ queryKey: ["jobs", ""], queryFn: () => api.listJobs({ search: "" }) });
  const invoicesQuery = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  const appointmentsQuery = useQuery({ queryKey: ["appointments"], queryFn: () => api.listAppointments({}) });
  const inboxQuery = useQuery({ queryKey: ["marketplace-inbox"], queryFn: () => api.getMarketplaceInbox({}), refetchInterval: 10000 });
  const notificationsHomeQuery = useQuery({ queryKey: ["marketplace-notifications"], queryFn: () => api.listNotifications({}), refetchInterval: 30000 });
  const pinsQuery = useQuery({ queryKey: ["home-pins"], queryFn: () => api.listPinnedTools({}) });
  const pinnedTools = pinsQuery.data?.tools ?? [];
  const unpinMutation = useMutation({
    mutationFn: (toolId: string) => api.unpinTool({ toolId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["home-pins"] }),
  });
  const openPinnedTool = (pin: { screen: string; tab: string | null }) => {
    const target = pinnedScreenTarget(pin);
    if (auth?.user.tier !== "premium" && isProToolScreen(target)) setScreen({ name: "tools" });
    else setScreen(target);
  };
  const d = query.data;
  const fieldIntel = useQuery({
    queryKey: ["field-intelligence-today", today],
    queryFn: () => api.getFieldIntelligence({ today, periodStart: today, periodEnd: today }),
    enabled: settings !== null && settings.simpleMode !== true,
  }).data;
  const expansion = useQuery({
    queryKey: ["expansion-suite", today],
    queryFn: () => api.getExpansionSuite({ today }),
    enabled: settings !== null && settings.simpleMode !== true,
  }).data;
  const [lostQuote, setLostQuote] = useState<number | null>(null);
  const [lossReason, setLossReason] = useState<
    "price" | "timing" | "competitor" | "no_response" | "other"
  >("price");
  const [lossNote, setLossNote] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["automation-center"] });
    qc.invalidateQueries({ queryKey: ["quotes"] });
  };
  const log = (
    kind:
      | "quote_chase"
      | "payment"
      | "review"
      | "reengagement"
      | "quote_expiry"
      | "crew",
    entityId: number,
    stage: string,
  ) => {
    void api.logAutomationSend({ kind, entityId, stage }).then(refresh);
  };
  const sig = companySignature(settings);
  const quoteMessage = (q: NonNullable<typeof d>["quoteChase"][number]) =>
    lang === "es"
      ? `Hola ${q.clientName}, quería dar seguimiento a la cotización #${q.id} por ${usd(money(q.total))}. ¿Tiene alguna pregunta? — ${sig}`
      : `Hi ${q.clientName}, I wanted to follow up on quote #${q.id} for ${usd(money(q.total))}. Do you have any questions? — ${sig}`;
  const paymentMessage = (
    i: NonNullable<typeof d>["paymentEscalations"][number],
  ) =>
    i.stage === 3
      ? lang === "es"
        ? `Hola ${i.clientName}, un recordatorio amable de que queda un saldo de ${usd(i.balance)}. Avíseme si necesita otra copia de la factura. — ${sig}`
        : `Hi ${i.clientName}, a friendly reminder that ${usd(i.balance)} remains due. Let me know if you need another copy of the invoice. — ${sig}`
      : i.stage === 14
        ? lang === "es"
          ? `Hola ${i.clientName}, la factura #${i.id} tiene ${i.daysOverdue} días de atraso con un saldo de ${usd(i.balance)}. Por favor indíquenos cuándo podemos esperar el pago. — ${sig}`
          : `Hi ${i.clientName}, invoice #${i.id} is ${i.daysOverdue} days overdue with ${usd(i.balance)} remaining. Please let us know when we can expect payment. — ${sig}`
        : lang === "es"
          ? `AVISO FINAL: La factura #${i.id} tiene ${i.daysOverdue} días de atraso. Saldo pendiente: ${usd(i.balance)}. Contáctenos hoy para resolverlo. — ${sig}`
          : `FINAL NOTICE: Invoice #${i.id} is ${i.daysOverdue} days overdue. Balance due: ${usd(i.balance)}. Please contact us today to resolve it. — ${sig}`;
  const expiryMessage = (q: NonNullable<typeof d>["quoteExpiry"][number]) =>
    lang === "es"
      ? `Hola ${q.clientName}, su cotización #${q.id} por ${usd(money(q.total))} ${q.daysUntil < 0 ? "venció" : "vence pronto"}. Puedo renovarla o responder cualquier pregunta. — ${sig}`
      : `Hi ${q.clientName}, your quote #${q.id} for ${usd(money(q.total))} ${q.daysUntil < 0 ? "has expired" : "expires soon"}. I can renew it or answer any questions. — ${sig}`;
  const reviewMessage = (r: NonNullable<typeof d>["reviews"][number]) =>
    lang === "es"
      ? `Hola ${r.clientName}, gracias por confiar en nosotros con su ${r.jobType}. Si está satisfecho, una reseña rápida significaría mucho para nuestro pequeño negocio: ${settings?.reviewUrl || ""} — ${sig}`
      : `Hi ${r.clientName}, thanks for trusting us with your ${r.jobType}. If you’re happy with how it turned out, a quick review would mean the world to our small business: ${settings?.reviewUrl || ""} — ${sig}`;
  const reengageMessage = (r: NonNullable<typeof d>["reengagement"][number]) =>
    lang === "es"
      ? `Hola ${r.clientName}, han pasado ${r.months} meses desde su ${r.jobType}. Solo quería saber cómo está todo y si podemos ayudarle con algo más. — ${sig}`
      : `Hi ${r.clientName}, it’s been ${r.months} months since your ${r.jobType}. Just checking in to see how everything is holding up and whether we can help with anything else. — ${sig}`;
  const crewText = () => {
    const lines = (d?.crew ?? []).flatMap((c) => [
      `${new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(c.startsAt))} — ${c.jobType}, ${c.jobAddress}`,
      ...c.tasks.map((x) => `• ${x}`),
    ]);
    return lang === "es"
      ? `Plan de hoy — ${formatDate(today, lang)}\n${lines.join("\n") || "No hay citas programadas."}`
      : `Today’s plan — ${formatDate(today, lang)}\n${lines.join("\n") || "No appointments scheduled."}`;
  };
  const recurringProcessed = useRef("");
  useEffect(() => {
    if (!settings || settings.simpleMode) return;
    if (recurringProcessed.current === today) return;
    recurringProcessed.current = today;
    void api.processRecurringInvoices({ runDate: today }).then((r) => {
      if (r.generated > 0) {
        qc.invalidateQueries({ queryKey: ["invoices"] });
        qc.invalidateQueries({ queryKey: ["automation-center"] });
      }
    });
  }, [today, qc, settings?.simpleMode]);
  const proAttentionCount = fieldIntel ? fieldIntel.today.poAwaiting + fieldIntel.today.maintenanceDue + fieldIntel.today.credentialWarnings + fieldIntel.today.costAlerts + fieldIntel.today.hotLeads : 0;
  const paymentEscalations = (settings?.notificationsEnabled === false || settings?.paymentRemindersEnabled === false || settings?.overdueInvoiceRemindersEnabled === false) ? [] : (d?.paymentEscalations ?? []).filter((item) => item.daysOverdue >= (settings?.overdueReminderDays ?? 3));
  const quoteChase = settings?.notificationsEnabled === false ? [] : (d?.quoteChase ?? []);
  const actionCount = d
    ? d.appointments.length +
      paymentEscalations.length +
      quoteChase.length +
      d.materials.length +
      d.quoteExpiry.length +
      d.reviews.length +
      d.reengagement.length +
      d.reminders.length +
      (expansion?.warranties.filter((w) => w.status !== "active").length ?? 0) +
      (expansion?.plans.filter((p) => p.active && p.nextDueDate <= today)
        .length ?? 0) +
      proAttentionCount
    : 0;
  const allJobs = jobsQuery.data?.jobs ?? [];
  const openJobs = allJobs.filter((job) => !job.completedAt);
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const activeThisWeekIds = new Set<number>();
  for (const job of openJobs) {
    const updatedAt = new Date(job.updatedAt);
    if (updatedAt >= weekStart && updatedAt < weekEnd) activeThisWeekIds.add(job.id);
  }
  for (const appointment of appointmentsQuery.data?.appointments ?? []) {
    const startsAt = new Date(appointment.startsAt);
    if (appointment.jobId && startsAt >= weekStart && startsAt < weekEnd) activeThisWeekIds.add(appointment.jobId);
  }
  const activeThisWeek = activeThisWeekIds.size || openJobs.length;
  const recentJobs = openJobs.slice(0, 2);
  const latestInvoice = invoicesQuery.data?.invoices[0] ?? null;
  // Chunk D: the Home Marketplace link badge covers messages + notifications.
  const unreadMarketplace = (inboxQuery.data?.unreadCount ?? 0) + (notificationsHomeQuery.data?.unreadCount ?? 0);
  const hour = now.getHours();
  const greeting = lang === "es"
    ? hour < 12 ? "Buenos días" : hour < 18 ? "Buenas tardes" : "Buenas noches"
    : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateHeading = new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { weekday: "long", month: "short", day: "numeric" }).format(now);
  const userInitial = (auth?.user.name.trim().charAt(0) || "C").toUpperCase();
  const compactJobDate = (date: string) => {
    if (date === today) return lang === "es" ? "Hoy" : "Today";
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (date === tomorrow.toLocaleDateString("en-CA")) return lang === "es" ? "Mañana" : "Tomorrow";
    return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
  };
  const invoiceStatusLabel = (status: InvoiceStatus) => status === "paid"
    ? (lang === "es" ? "Pagada" : "Paid")
    : status === "overdue"
      ? (lang === "es" ? "Vencida" : "Overdue")
      : status === "sent"
        ? (lang === "es" ? "Enviada" : "Sent")
        : (lang === "es" ? "Borrador" : "Draft");
  if (!d)
    return (
      <main className="page today-page" aria-busy="true">
        <header className="home-header">
          <div><span>{dateHeading}</span><strong>{greeting}</strong></div>
          <div className="home-header-actions">
            <button className="lang-toggle" onClick={toggleLanguage} aria-label={copy[lang].language}>{lang === "en" ? "ES" : "EN"}</button>
            <button className="home-avatar" type="button" onClick={() => setScreen({ name: "settings" })} aria-label={lang === "es" ? "Abrir configuración" : "Open settings"}>{userInitial}</button>
          </div>
        </header>
        <div className="home-summary-card home-summary-loading"><span>{lang === "es" ? "Trabajos abiertos" : "Open jobs"}</span><strong>—</strong><small>{lang === "es" ? "Cargando actividad…" : "Loading activity…"}</small></div>
        <div className="loading-block" aria-label={lang === "es" ? "Cargando inicio" : "Loading home"} />
      </main>
    );
  return (
    <main className="page today-page">
      <header className="home-header">
        <div>
          <span>{dateHeading}</span>
          <strong>{greeting}</strong>
        </div>
        <div className="home-header-actions">
          <button className="lang-toggle" onClick={toggleLanguage} aria-label={copy[lang].language}>{lang === "en" ? "ES" : "EN"}</button>
          <button className="home-avatar" type="button" onClick={() => setScreen({ name: "settings" })} aria-label={lang === "es" ? "Abrir configuración" : "Open settings"}>{userInitial}</button>
        </div>
      </header>
      <section className="home-summary-card" aria-label={lang === "es" ? "Resumen de trabajos" : "Job summary"}>
        <span>{lang === "es" ? "Trabajos abiertos" : "Open jobs"}</span>
        <strong>{openJobs.length}</strong>
        <small>{activeThisWeek} {lang === "es" ? (activeThisWeek === 1 ? "activo esta semana" : "activos esta semana") : (activeThisWeek === 1 ? "active this week" : "active this week")}</small>
      </section>
      <section className="home-jobs-section">
        <header><h2>{lang === "es" ? "Trabajos" : "Jobs"}</h2><button type="button" onClick={() => setScreen({ name: "jobs" })}>{lang === "es" ? "Ver todo" : "View all"}</button></header>
        <div className="home-job-list">
          {recentJobs.map((job, index) => <button type="button" key={job.id} className="home-job-card" onClick={() => setScreen({ name: "detail", jobId: job.id })}>
            <span className={`home-job-icon${index % 2 === 1 ? " alternate" : ""}`}><Icon><path d="M4 7h16v13H4zM8 7V4h8v3M4 11h16" /></Icon></span>
            <span><strong>{job.clientName}</strong><small>{job.jobType} · {compactJobDate(job.jobDate)}</small></span>
            <BackIcon />
          </button>)}
          {jobsQuery.data && recentJobs.length === 0 && <button type="button" className="home-job-card home-job-empty" onClick={() => setScreen({ name: "new" })}>
            <span className="home-job-icon"><PlusIcon /></span><span><strong>{lang === "es" ? "Crea tu primer trabajo" : "Create your first job"}</strong><small>{lang === "es" ? "Agrega el cliente, alcance y fecha" : "Add the client, scope, and date"}</small></span><BackIcon />
          </button>}
        </div>
      </section>
      {latestInvoice && <button type="button" className="home-invoice-card" onClick={() => setScreen({ name: "invoicePreview", invoiceId: latestInvoice.id })}>
        <span><small>{lang === "es" ? "Factura" : "Invoice"} {latestInvoice.invoiceNumber}</small><strong>{usd(money(latestInvoice.totalWithLateFee))}</strong></span>
        <b className={`status-chip ${latestInvoice.status}`}>{invoiceStatusLabel(latestInvoice.status)}</b>
      </button>}
      <section className="home-quick-access" aria-label={lang === "es" ? "Acceso rápido" : "Quick access"}>
        <button type="button" onClick={() => setScreen({ name: "clients" })}><span className="home-access-icon"><Icon><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3-7 8-7s8 3 8 7"/></Icon></span><span><strong>{lang === "es" ? "Clientes" : "Clients"}</strong><small>{lang === "es" ? "Contactos e historial" : "Contacts & history"}</small></span><BackIcon /></button>
        <button type="button" className="home-marketplace-link" onClick={() => setScreen({ name: "marketplace" })}><span className="home-access-icon alternate"><Icon><path d="M4 10h16v10H4zM3 10l2-6h14l2 6M8 10v2M16 10v2M9 20v-5h6v5" /></Icon>{unreadMarketplace > 0 && <b aria-label={`${unreadMarketplace} ${lang === "es" ? "mensajes sin leer" : "unread messages"}`}>{Math.min(unreadMarketplace, 99)}</b>}</span><span><strong>{lang === "es" ? "Mercado" : "Marketplace"}</strong><small>{lang === "es" ? "Trabajos y conexiones" : "Work & connections"}</small></span><BackIcon /></button>
        <button type="button" onClick={() => setScreen({ name: "tools" })}><span className="home-access-icon"><Icon><path d="M14 6a4 4 0 0 0-5 5L3 17l4 4 6-6a4 4 0 0 0 5-5l-3 3-4-4z"/></Icon></span><span><strong>{lang === "es" ? "Herramientas" : "Tools"}</strong><small>{lang === "es" ? "Calculadoras y utilidades" : "Calculators & utilities"}</small></span><BackIcon /></button>
      </section>
      {pinnedTools.length > 0 && (
        <section className="home-pinned" aria-label={lang === "es" ? "Fijados" : "Pinned"}>
          <header>
            <h2>{lang === "es" ? "Fijados" : "Pinned"}</h2>
            <button type="button" onClick={() => setScreen({ name: "tools" })}>{lang === "es" ? "Todas las herramientas" : "All tools"}</button>
          </header>
          <div className="home-pinned-grid">
            {pinnedTools.map((pin) => (
              <div key={pin.toolId} className="home-pin-tile">
                <button type="button" className="home-pin-open" onClick={() => openPinnedTool(pin)}>
                  <span className="home-pin-icon"><Icon><path d={pin.iconPath} /></Icon></span>
                  <strong>{lang === "es" ? pin.titleEs : pin.titleEn}</strong>
                </button>
                <button type="button" className="home-pin-remove" aria-label={lang === "es" ? "Quitar" : "Unpin"} title={lang === "es" ? "Quitar" : "Unpin"} disabled={unpinMutation.isPending} onClick={() => unpinMutation.mutate(pin.toolId)}>×</button>
              </div>
            ))}
          </div>
        </section>
      )}
      <button type="button" className="home-attention-card" onClick={() => { const target = document.querySelector(".automation-group, .today-clear, .today-field-strip"); target?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
        <span><strong>{actionCount}</strong><small>{lang === "es" ? "acciones que merecen atención" : "actions worth your attention"}</small></span><BackIcon />
      </button>
      <TodayMoneySnapshot lang={lang} />
      {!settings?.simpleMode && fieldIntel && (
        proAttentionCount > 0 ? <section className="today-field-strip">
          <div className="section-heading"><div><span>PRO</span><h2>{lang === "es" ? "Operaciones que necesitan atención" : "Operations needing attention"}</h2></div><button onClick={() => setScreen({ name: "fieldIntelligence" })}>{lang === "es" ? "Abrir" : "Open"}<BackIcon /></button></div>
          <div className="today-field-counts">
            {fieldIntel.today.poAwaiting > 0 && <button onClick={() => setScreen({ name: "fieldIntelligence", tab: "purchasing" })}><Icon><path d="M5 4h14v16H5zM8 8h8M8 12h8" /></Icon><strong>{fieldIntel.today.poAwaiting}</strong>{lang === "es" ? "Pedidos esperando al proveedor" : "Orders waiting on suppliers"}</button>}
            {fieldIntel.today.maintenanceDue > 0 && <button onClick={() => setScreen({ name: "fieldIntelligence", tab: "equipment" })}><Icon><path d="M14 6a4 4 0 0 0-5 5L4 16l4 4 5-5a4 4 0 0 0 5-5l-3 3-4-4z" /></Icon><strong>{fieldIntel.today.maintenanceDue}</strong>{lang === "es" ? "Cuidado del equipo" : "Equipment upkeep"}</button>}
            {fieldIntel.today.credentialWarnings > 0 && <button onClick={() => setScreen({ name: "fieldIntelligence", tab: "credentials" })}><Icon><path d="M6 3h12v18H6zM9 8h6M9 12h6M9 16h4" /></Icon><strong>{fieldIntel.today.credentialWarnings}</strong>{lang === "es" ? "Licencias y certificados" : "Licenses & certificates"}</button>}
            {fieldIntel.today.costAlerts > 0 && <button onClick={() => setScreen({ name: "fieldIntelligence", tab: "costs" })}><Icon><path d="M4 19V9M10 19V5M16 19v-8M22 19H2" /></Icon><strong>{fieldIntel.today.costAlerts}</strong>{lang === "es" ? "Alertas de presupuesto" : "Budget alerts"}</button>}
            {fieldIntel.today.hotLeads > 0 && <button onClick={() => setScreen({ name: "operations", tab: "leads" })}><Icon><path d="M5 5h14M7 10h10M9 15h6M11 20h2" /></Icon><strong>{fieldIntel.today.hotLeads}</strong>{lang === "es" ? "Mejores prospectos" : "Best leads"}</button>}
          </div>
        </section> : <button className="today-pro-clear" type="button" onClick={() => setScreen({ name: "tools" })}><span><strong>PRO</strong>{lang === "es" ? "Operaciones al día" : "Operations are all caught up"}</span><BackIcon /></button>
      )}
      {actionCount === 0 && (
        <div className="empty-state today-clear">
          <CheckIcon />
          <h2>{lang === "es" ? "Todo al día" : "You’re all caught up"}</h2>
          <p>
            {lang === "es"
              ? "No hay seguimientos ni fechas límite para hoy."
              : "No follow-ups or deadlines need attention today."}
          </p>
        </div>
      )}
      {paymentEscalations.length > 0 && (
        <AutomationGroup
          title={lang === "es" ? "Cobros atrasados" : "Overdue payments"}
          count={paymentEscalations.length}
          tone="danger"
        >
          {paymentEscalations.map((i) => (
            <article className="automation-card" key={i.id}>
              <div className="urgency-badge">
                {lang === "es" ? `Día ${i.stage}` : `Day ${i.stage}`}
              </div>
              <h3>{i.clientName}</h3>
              <p>
                {usd(i.balance)} · {i.daysOverdue}{" "}
                {lang === "es" ? "días de atraso" : "days overdue"}
              </p>
              {i.lastSentAt && (
                <small>
                  {lang === "es" ? "Etapa ya enviada" : "Stage already sent"}
                </small>
              )}
              <div className="automation-actions">
                {i.clientPhone ? (
                  <a
                    className="primary-button"
                    href={smsHref(i.clientPhone, paymentMessage(i))}
                    onClick={() => log("payment", i.id, String(i.stage))}
                  >
                    {lang === "es" ? "Abrir texto" : "Open text"}
                  </a>
                ) : (
                  <span className="status error">{copy[lang].noPhone}</span>
                )}
                <button
                  onClick={() =>
                    setScreen({ name: "invoicePreview", invoiceId: i.id })
                  }
                >
                  {lang === "es" ? "Factura" : "Invoice"}
                </button>
              </div>
            </article>
          ))}
        </AutomationGroup>
      )}
      {d.materials.length > 0 && (
        <AutomationGroup
          title={
            lang === "es" ? "Materiales por ordenar" : "Materials to order"
          }
          count={d.materials.length}
          tone="warning"
        >
          {d.materials.map((m) => (
            <article className="automation-card" key={m.selectionId}>
              <div className="urgency-badge">
                {m.daysUntil < 0
                  ? lang === "es"
                    ? "Atrasado"
                    : "Missed"
                  : m.daysUntil === 0
                    ? lang === "es"
                      ? "Hoy"
                      : "Today"
                    : `${m.daysUntil}d`}
              </div>
              <h3>{m.item}</h3>
              <p>
                {m.clientName} · {m.category}
              </p>
              <strong>
                {lang === "es"
                  ? `Ordenar antes de ${formatDate(m.orderByDate, lang)} o se retrasa el trabajo`
                  : `Order by ${formatDate(m.orderByDate, lang)} or the job slips`}
              </strong>
              <button
                onClick={() => setScreen({ name: "jobOps", jobId: m.jobId })}
              >
                {lang === "es" ? "Abrir selección" : "Open selection"}
              </button>
            </article>
          ))}
        </AutomationGroup>
      )}
      {d.appointments.length > 0 && (
        <AutomationGroup
          title={lang === "es" ? "Citas de hoy" : "Today’s appointments"}
          count={d.appointments.length}
        >
          {d.appointments.map((a) => (
            <article className="automation-card" key={a.id}>
              <time>
                {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                }).format(new Date(a.startsAt))}
              </time>
              <h3>{a.clientName}</h3>
              <p>{a.notes || "—"}</p>
              {a.exteriorWork && (
                <WeatherBadge appointmentId={a.id} lang={lang} />
              )}
              <div className="automation-actions">
                {a.clientPhone && (
                  <a
                    href={smsHref(
                      a.clientPhone,
                      lang === "es"
                        ? `Hola ${a.clientName}, confirmamos nuestra cita de hoy a las ${new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit" }).format(new Date(a.startsAt))}. — ${sig}`
                        : `Hi ${a.clientName}, confirming our appointment today at ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(a.startsAt))}. — ${sig}`,
                    )}
                  >
                    {lang === "es"
                      ? "Confirmar por texto"
                      : "Text confirmation"}
                  </a>
                )}
                {a.jobId && (
                  <button
                    onClick={() =>
                      setScreen({ name: "detail", jobId: a.jobId as number })
                    }
                  >
                    {lang === "es" ? "Trabajo" : "Job"}
                  </button>
                )}
              </div>
            </article>
          ))}
        </AutomationGroup>
      )}
      {d.quoteExpiry.length > 0 && (
        <AutomationGroup
          title={
            lang === "es" ? "Cotizaciones por vencer" : "Quote expiry watch"
          }
          count={d.quoteExpiry.length}
          tone="warning"
        >
          {d.quoteExpiry.map((q) => (
            <article className="automation-card" key={q.id}>
              <div className="urgency-badge">
                {q.daysUntil < 0
                  ? lang === "es"
                    ? "Vencida"
                    : "Expired"
                  : q.daysUntil === 0
                    ? lang === "es"
                      ? "Vence hoy"
                      : "Expires today"
                    : lang === "es"
                      ? `Vence en ${q.daysUntil}d`
                      : `Expires in ${q.daysUntil}d`}
              </div>
              <h3>
                {q.clientName} · {usd(money(q.total))}
              </h3>
              <div className="automation-actions">
                {q.clientPhone && (
                  <a
                    href={smsHref(q.clientPhone, expiryMessage(q))}
                    onClick={() =>
                      log("quote_expiry", q.id, String(q.daysUntil))
                    }
                  >
                    {lang === "es" ? "Seguimiento" : "Follow up"}
                  </a>
                )}
                <button
                  onClick={async () => {
                    await api.renewQuote({ id: q.id, today });
                    refresh();
                  }}
                >
                  {lang === "es" ? "Renovar 30 días" : "Renew 30 days"}
                </button>
                <button
                  onClick={() =>
                    setScreen({ name: "quotePreview", quoteId: q.id })
                  }
                >
                  {lang === "es" ? "Ver" : "View"}
                </button>
              </div>
            </article>
          ))}
        </AutomationGroup>
      )}
      {quoteChase.length > 0 && (
        <AutomationGroup
          title={lang === "es" ? "Cola de cotizaciones" : "Quote chase queue"}
          count={quoteChase.length}
        >
          {quoteChase.map((q, index) => (
            <article
              className={`automation-card${index === 0 ? " top-pick" : ""}`}
              key={q.id}
            >
              {index === 0 && (
                <div className="text-first">
                  {lang === "es" ? "Enviar texto primero" : "Text first"}
                </div>
              )}
              <h3>
                {q.clientName} · {usd(money(q.total))}
              </h3>
              <p>
                {q.daysWaiting}{" "}
                {lang === "es" ? "días esperando" : "days waiting"} ·{" "}
                {lang === "es" ? "prioridad" : "priority"}{" "}
                {Math.round(q.score).toLocaleString()}
              </p>
              <div className="automation-actions">
                {q.clientPhone ? (
                  <a
                    className="primary-button"
                    href={smsHref(q.clientPhone, quoteMessage(q))}
                    onClick={() =>
                      log("quote_chase", q.id, String(q.daysWaiting))
                    }
                  >
                    {lang === "es" ? "Abrir texto" : "Open text"}
                  </a>
                ) : (
                  <span className="status error">{copy[lang].noPhone}</span>
                )}
                <button
                  onClick={async () => {
                    await api.updateQuoteAutomationStatus({
                      id: q.id,
                      status: "won",
                      lostReason: null,
                      lostNote: "",
                    });
                    refresh();
                  }}
                >
                  {lang === "es" ? "Ganada" : "Won"}
                </button>
                <button onClick={() => setLostQuote(q.id)}>
                  {lang === "es" ? "Perdida" : "Lost"}
                </button>
                <button onClick={() => setScreen({ name: "quotePreview", quoteId: q.id })}>
                  {lang === "es" ? "Ver presupuesto" : "View estimate"}
                </button>
              </div>
            </article>
          ))}
        </AutomationGroup>
      )}
      {d.reminders.length + d.reviews.length + d.reengagement.length > 0 && (
        <AutomationGroup
          title={lang === "es" ? "Recordatorios" : "Reminders"}
          count={d.reminders.length + d.reviews.length + d.reengagement.length}
        >
          {d.reminders.map((r) => (
            <article className="automation-card" key={`n${r.id}`}>
              <h3>{r.note}</h3>
              <p>{formatDate(r.reminderDate, lang)}</p>
              {r.jobId && (
                <button
                  onClick={() =>
                    setScreen({ name: "detail", jobId: r.jobId as number })
                  }
                >
                  {lang === "es" ? "Abrir trabajo" : "Open job"}
                </button>
              )}
            </article>
          ))}
          {d.reviews.map((r) => (
            <article className="automation-card" key={`r${r.jobId}`}>
              <div className="urgency-badge">
                {lang === "es" ? "Pedir reseña" : "Ask for review"}
              </div>
              <h3>{r.clientName}</h3>
              <p>{r.jobType}</p>
              {r.clientPhone ? (
                <a
                  className="primary-button"
                  href={smsHref(r.clientPhone, reviewMessage(r))}
                  onClick={() => log("review", r.jobId, "next_day")}
                >
                  {lang === "es" ? "Abrir texto" : "Open text"}
                </a>
              ) : (
                <span className="status error">{copy[lang].noPhone}</span>
              )}
            </article>
          ))}
          {d.reengagement.map((r) => (
            <article
              className="automation-card"
              key={`e${r.jobId}-${r.months}`}
            >
              <div className="urgency-badge">
                {r.months} {lang === "es" ? "meses" : "months"}
              </div>
              <h3>{r.clientName}</h3>
              <p>
                {lang === "es" ? "Volver a contactar" : "Re-engage"} ·{" "}
                {r.jobType}
              </p>
              {r.clientPhone ? (
                <a
                  className="primary-button"
                  href={smsHref(r.clientPhone, reengageMessage(r))}
                  onClick={() => log("reengagement", r.jobId, String(r.months))}
                >
                  {lang === "es" ? "Abrir texto" : "Open text"}
                </a>
              ) : (
                <span className="status error">{copy[lang].noPhone}</span>
              )}
            </article>
          ))}
        </AutomationGroup>
      )}
      <section className="crew-compose">
        <div>
          <span>
            {lang === "es"
              ? "Mensaje matutino del equipo"
              : "Crew morning message"}
          </span>
          <strong>
            {d.crew.length} {lang === "es" ? "trabajos de hoy" : "jobs today"}
          </strong>
        </div>
        {d.crew.length > 0 && (
          <a
            className="primary-button"
            href={smsHref("", crewText())}
            onClick={() => log("crew", Number(today.replace(/-/g, "")), today)}
          >
            {lang === "es" ? "Redactar texto" : "Compose text"}
          </a>
        )}
      </section>
      {expansion &&
        expansion.warranties.filter((w) => w.status !== "active").length >
          0 && (
          <AutomationGroup
            title={lang === "es" ? "Garantías" : "Warranties"}
            count={
              expansion.warranties.filter((w) => w.status !== "active").length
            }
            tone="warning"
          >
            {expansion.warranties
              .filter((w) => w.status !== "active")
              .map((w) => (
                <article className="automation-card" key={`w${w.id}`}>
                  <div className="urgency-badge">
                    {w.status === "expired"
                      ? lang === "es"
                        ? "Vencida"
                        : "Expired"
                      : lang === "es"
                        ? "Por vencer"
                        : "Expiring"}
                  </div>
                  <h3>{w.clientName}</h3>
                  <p>
                    {w.jobLabel} · {formatDate(w.expiryDate, lang)}
                  </p>
                  {w.clientPhone && (
                    <a
                      className="primary-button"
                      href={smsHref(
                        w.clientPhone,
                        lang === "es"
                          ? `Hola ${w.clientName}, solo quería revisar cómo está todo antes de que venza su garantía el ${formatDate(w.expiryDate, lang)}.`
                          : `Hi ${w.clientName}, just checking how everything is holding up before your warranty expires on ${formatDate(w.expiryDate, lang)}.`,
                      )}
                    >
                      {lang === "es" ? "Abrir texto" : "Open text"}
                    </a>
                  )}
                </article>
              ))}
          </AutomationGroup>
        )}
      {expansion &&
        expansion.plans.filter((p) => p.active && p.nextDueDate <= today)
          .length > 0 && (
          <AutomationGroup
            title={
              lang === "es" ? "Cuidado del equipo pendiente" : "Equipment upkeep due"
            }
            count={
              expansion.plans.filter((p) => p.active && p.nextDueDate <= today)
                .length
            }
          >
            {expansion.plans
              .filter((p) => p.active && p.nextDueDate <= today)
              .map((p) => (
                <article className="automation-card" key={`mp${p.id}`}>
                  <h3>
                    {p.clientName} · {p.title}
                  </h3>
                  <p>
                    {formatDate(p.nextDueDate, lang)} · {p.tasks}
                  </p>
                  <button onClick={() => setScreen({ name: "expansion" })}>
                    {lang === "es" ? "Abrir mantenimiento" : "Open maintenance"}
                  </button>
                </article>
              ))}
          </AutomationGroup>
        )}
      {lostQuote !== null && (
        <div className="sheet-backdrop" role="presentation">
          <form
            className="loss-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={lang === "es" ? "Motivo de pérdida" : "Loss reason"}
            onSubmit={async (e) => {
              e.preventDefault();
              await api.updateQuoteAutomationStatus({
                id: lostQuote,
                status: "lost",
                lostReason: lossReason,
                lostNote: lossNote,
              });
              setLostQuote(null);
              setLossNote("");
              refresh();
            }}
          >
            <h2>
              {lang === "es" ? "¿Por qué se perdió?" : "Why was it lost?"}
            </h2>
            <label>
              <span>{lang === "es" ? "Motivo" : "Reason"}</span>
              <select
                value={lossReason}
                onChange={(e) =>
                  setLossReason(e.target.value as typeof lossReason)
                }
              >
                <option value="price">
                  {lang === "es" ? "Precio muy alto" : "Price too high"}
                </option>
                <option value="timing">
                  {lang === "es" ? "Momento / calendario" : "Timing"}
                </option>
                <option value="competitor">
                  {lang === "es" ? "Eligió competidor" : "Chose competitor"}
                </option>
                <option value="no_response">
                  {lang === "es" ? "Sin respuesta" : "No response"}
                </option>
                <option value="other">
                  {lang === "es" ? "Otro" : "Other"}
                </option>
              </select>
            </label>
            <label>
              <span>{lang === "es" ? "Nota opcional" : "Optional note"}</span>
              <textarea
                rows={3}
                value={lossNote}
                onChange={(e) => setLossNote(e.target.value)}
              />
            </label>
            <div className="dual-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setLostQuote(null)}
              >
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
              <button className="primary-button">
                {lang === "es" ? "Guardar pérdida" : "Save loss"}
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
function AutomationGroup({
  title,
  count,
  tone = "default",
  children,
}: {
  title: string;
  count: number;
  tone?: "default" | "warning" | "danger";
  children: ReactNode;
}) {
  return (
    <section className={`automation-group tone-${tone}`}>
      <header>
        <span className="automation-group-icon" aria-hidden="true">
          {tone === "danger" ? <Icon><path d="M12 3 2 21h20zM12 9v5M12 17h.01" /></Icon> : tone === "warning" ? <Icon><path d="M5 4h14v16H5zM8 9h8M8 13h5" /></Icon> : <Icon><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2" /></Icon>}
        </span>
        <h2>{title}</h2>
        <span>{count}</span>
      </header>
      <div>{children}</div>
    </section>
  );
}

function TodayMoneySnapshot({ lang }: { lang: Lang }) {
  const dashboard = useQuery({ queryKey: ["dashboard"], queryFn: () => api.getDashboard({}) });
  const invoices = useQuery({ queryKey: ["invoices"], queryFn: () => api.listInvoices({}) });
  if (!dashboard.data || !invoices.data) return <div className="money-snapshot loading-block"/>;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const month = today.toLocaleDateString("en-CA").slice(0, 7);
  const dueThisWeek = invoices.data.invoices.filter((invoice) => invoice.status !== "paid" && invoice.dueDate && new Date(`${invoice.dueDate}T00:00:00`) >= today && new Date(`${invoice.dueDate}T00:00:00`) <= weekEnd).reduce((sum, invoice) => sum + Number(invoice.balanceRemaining), 0);
  const monthInvoiced = invoices.data.invoices.filter((invoice) => invoice.issueDate.slice(0, 7) === month).reduce((sum, invoice) => sum + money(invoice.totalWithLateFee), 0);
  return <section className="money-snapshot" aria-label={lang === "es" ? "Resumen de dinero" : "Money snapshot"}>
    <article><Icon><path d="M4 7h16v12H4zM7 7V5h10v2M8 12h8" /></Icon><span>{lang === "es" ? "Por cobrar" : "Money to collect"}</span><strong>{usd(dashboard.data.outstanding)}</strong></article>
    <article><Icon><path d="M5 5h14v15H5zM8 3v4M16 3v4M8 11h8M8 15h5" /></Icon><span>{lang === "es" ? "Vence esta semana" : "Due this week"}</span><strong>{usd(dueThisWeek)}</strong></article>
    <article><Icon><path d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" /></Icon><span>{lang === "es" ? "Facturado este mes" : "Billed this month"}</span><strong>{usd(monthInvoiced)}</strong></article>
  </section>;
}

type RevenueDetail = {
  id: number;
  invoiceId: number;
  clientName: string;
  amount: number;
  date: string;
};
type EstimateDetail = {
  id: number;
  clientName: string;
  total: number;
  date: string;
  status: "awaiting" | "won" | "lost";
};
type MonthlyReport = {
  month: string;
  revenue: number;
  estimated: number;
  estimateCount: number;
  payments: RevenueDetail[];
  estimates: EstimateDetail[];
};
type ReportKind = "revenue" | "estimates" | "comparison";

function validMonth(value: string) {
  return /^\d{4}-\d{2}/.test(value) ? value.slice(0, 7) : "";
}
function shiftMonthKey(key: string, amount: number) {
  const date = new Date(`${key}-01T12:00:00`);
  date.setMonth(date.getMonth() + amount);
  return date.toLocaleDateString("en-CA").slice(0, 7);
}
function monthLabel(key: string, lang: Lang, short = false) {
  return new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
    month: short ? "short" : "long",
    year: short ? "2-digit" : "numeric",
  }).format(new Date(`${key}-01T12:00:00`));
}
function compactMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function HistoryPanel({
  lang,
  kind,
  months,
}: {
  lang: Lang;
  kind: ReportKind;
  months: MonthlyReport[];
}) {
  const [windowEnd, setWindowEnd] = useState(months.length - 1);
  const [selected, setSelected] = useState(
    months[months.length - 1]?.month ?? "",
  );
  const start = Math.max(0, windowEnd - 5);
  const visible = months.slice(start, windowEnd + 1);
  const detail =
    months.find((month) => month.month === selected) ??
    visible[visible.length - 1];
  const canEarlier = start > 0;
  const canLater = windowEnd < months.length - 1;
  const move = (direction: -1 | 1) => {
    const nextEnd = Math.max(
      0,
      Math.min(months.length - 1, windowEnd + direction * 6),
    );
    const nextStart = Math.max(0, nextEnd - 5);
    setWindowEnd(nextEnd);
    setSelected(months[direction < 0 ? nextStart : nextEnd]?.month ?? selected);
  };
  const title =
    kind === "revenue"
      ? lang === "es"
        ? "Historial de ingresos"
        : "Revenue history"
      : kind === "estimates"
        ? lang === "es"
          ? "Historial de cotizaciones"
          : "Estimates history"
        : lang === "es"
          ? "Cotizaciones vs. ingresos cerrados"
          : "Estimates vs. closed revenue";
  const description =
    kind === "revenue"
      ? lang === "es"
        ? "Pagos recibidos por mes"
        : "Payments received by month"
      : kind === "estimates"
        ? lang === "es"
          ? "Valor y cantidad emitida por mes"
          : "Quoted value and count issued by month"
        : lang === "es"
          ? "Valor cotizado frente al dinero cobrado"
          : "Quoted value beside money collected";
  const hasValues =
    kind === "revenue"
      ? months.some((m) => m.revenue > 0)
      : kind === "estimates"
        ? months.some((m) => m.estimated > 0)
        : months.some((m) => m.revenue > 0 || m.estimated > 0);
  return (
    <section className="history-panel" aria-labelledby={`${kind}-heading`}>
      <div className="history-heading">
        <div>
          <h2 id={`${kind}-heading`}>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="history-nav">
          <button
            onClick={() => move(-1)}
            disabled={!canEarlier}
            aria-label={
              lang === "es" ? "Ver meses anteriores" : "View earlier months"
            }
          >
            <BackIcon />
          </button>
          <button
            onClick={() => move(1)}
            disabled={!canLater}
            aria-label={
              lang === "es" ? "Ver meses siguientes" : "View later months"
            }
          >
            <BackIcon />
          </button>
        </div>
      </div>
      <p className="history-range">
        {visible[0] ? monthLabel(visible[0].month, lang) : "—"} —{" "}
        {visible[visible.length - 1]
          ? monthLabel(visible[visible.length - 1]?.month ?? "", lang)
          : "—"}
      </p>
      {hasValues ? (
        <div
          className="chart-frame"
          role="img"
          aria-label={`${title}. ${description}.`}
        >
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={visible}
              margin={{ top: 12, right: 4, left: -12, bottom: 0 }}
            >
              <CartesianGrid
                stroke="var(--border)"
                strokeDasharray="3 3"
                vertical={false}
              />
              <XAxis
                dataKey="month"
                tickFormatter={(value: string) => monthLabel(value, lang, true)}
                stroke="var(--dim)"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                domain={[0, "auto"]}
                tickFormatter={(value: number) => compactMoney(value)}
                stroke="var(--dim)"
                tick={{ fontSize: 10 }}
                width={58}
              />
              <Tooltip
                labelFormatter={(value) => monthLabel(String(value), lang)}
                formatter={(value, name) => [
                  usd(Number(value)),
                  name === "revenue"
                    ? lang === "es"
                      ? "Ingresos cerrados"
                      : "Closed revenue"
                    : lang === "es"
                      ? "Cotizaciones"
                      : "Estimates",
                ]}
              />
              {kind === "comparison" && (
                <Legend
                  formatter={(value) =>
                    value === "revenue"
                      ? lang === "es"
                        ? "Ingresos cerrados"
                        : "Closed revenue"
                      : lang === "es"
                        ? "Cotizaciones"
                        : "Estimates"
                  }
                />
              )}{" "}
              {(kind === "revenue" || kind === "comparison") && (
                <Bar
                  dataKey="revenue"
                  fill="var(--green)"
                  radius={[4, 4, 0, 0]}
                  name="revenue"
                />
              )}
              {(kind === "estimates" || kind === "comparison") && (
                <Bar
                  dataKey="estimated"
                  fill="var(--accent)"
                  radius={[4, 4, 0, 0]}
                  name="estimated"
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="report-empty">
          {lang === "es"
            ? "Aún no hay datos guardados para este historial."
            : "No saved data for this history yet."}
        </div>
      )}
      <div
        className="month-picker"
        aria-label={lang === "es" ? "Elegir mes" : "Choose month"}
      >
        {visible.map((month) => (
          <button
            key={month.month}
            className={month.month === detail?.month ? "active" : ""}
            onClick={() => setSelected(month.month)}
            aria-pressed={month.month === detail?.month}
          >
            <span>{monthLabel(month.month, lang, true)}</span>
            {kind === "revenue" ? (
              <strong>{compactMoney(month.revenue)}</strong>
            ) : kind === "estimates" ? (
              <>
                <strong>{compactMoney(month.estimated)}</strong>
                <small>
                  {month.estimateCount} {lang === "es" ? "cotiz." : "quotes"}
                </small>
              </>
            ) : (
              <strong>
                {compactMoney(month.estimated)} / {compactMoney(month.revenue)}
              </strong>
            )}
          </button>
        ))}
      </div>
      {detail && <MonthDetail lang={lang} kind={kind} month={detail} />}
    </section>
  );
}

function MonthDetail({
  lang,
  kind,
  month,
}: {
  lang: Lang;
  kind: ReportKind;
  month: MonthlyReport;
}) {
  const closeRate =
    month.estimated > 0 ? (month.revenue / month.estimated) * 100 : null;
  const statusLabel = (status: EstimateDetail["status"]) =>
    status === "won"
      ? lang === "es"
        ? "Ganada"
        : "Won"
      : status === "lost"
        ? lang === "es"
          ? "Perdida"
          : "Lost"
        : lang === "es"
          ? "Pendiente"
          : "Pending";
  return (
    <div className="month-detail">
      <h3>{monthLabel(month.month, lang)}</h3>
      {kind === "comparison" && (
        <div className="comparison-summary">
          <span>
            {lang === "es" ? "Cotizado" : "Estimated"}
            <strong>{usd(month.estimated)}</strong>
          </span>
          <span>
            {lang === "es" ? "Ingresos cerrados" : "Closed revenue"}
            <strong>{usd(month.revenue)}</strong>
          </span>
          <span>
            {lang === "es" ? "Tasa de cierre" : "Close rate"}
            <strong>
              {closeRate === null ? "—" : `${closeRate.toFixed(1)}%`}
            </strong>
          </span>
        </div>
      )}
      {kind === "revenue" &&
        (month.payments.length > 0 ? (
          <div className="report-detail-list">
            {month.payments.map((payment) => (
              <article key={payment.id}>
                <div>
                  <strong>{payment.clientName}</strong>
                  <small>
                    {lang === "es" ? "Factura" : "Invoice"} #{payment.invoiceId}{" "}
                    · {formatDate(payment.date, lang)}
                  </small>
                </div>
                <strong>{usd(payment.amount)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p className="detail-empty">
            {lang === "es"
              ? "No se recibieron pagos este mes."
              : "No payments received this month."}
          </p>
        ))}
      {kind === "estimates" &&
        (month.estimates.length > 0 ? (
          <div className="report-detail-list">
            {month.estimates.map((estimate) => (
              <article key={estimate.id}>
                <div>
                  <strong>{estimate.clientName}</strong>
                  <small>
                    #{estimate.id} · {formatDate(estimate.date, lang)} ·{" "}
                    <span className={`quote-state ${estimate.status}`}>
                      {statusLabel(estimate.status)}
                    </span>
                  </small>
                </div>
                <strong>{usd(estimate.total)}</strong>
              </article>
            ))}
          </div>
        ) : (
          <p className="detail-empty">
            {lang === "es"
              ? "No se emitieron cotizaciones este mes."
              : "No estimates issued this month."}
          </p>
        ))}
    </div>
  );
}

function ReportsScreen({ lang, onBack }: { lang: Lang; onBack: () => void }) {
  const quotesQuery = useQuery({
    queryKey: ["quotes"],
    queryFn: () => api.listQuotes({}),
  });
  const invoicesQuery = useQuery({
    queryKey: ["invoices"],
    queryFn: () => api.listInvoices({}),
  });
  const growth = useQuery({
    queryKey: ["growth-toolkit"],
    queryFn: () => api.getGrowthToolkit({}),
  });
  if (!quotesQuery.data || !invoicesQuery.data)
    return (
      <main className="page reports-page">
        <PageHeader
          lang={lang}
          title={lang === "es" ? "Informes" : "Reports"}
          onBack={onBack}
        />
        <div className="loading-block" />
      </main>
    );
  const quoteDates = quotesQuery.data.quotes
    .map((quote) => validMonth(quote.sentAt || quote.createdAt))
    .filter(Boolean);
  const payments = invoicesQuery.data.invoices.flatMap((invoice) =>
    invoice.payments.map((payment) => ({
      id: payment.id,
      invoiceId: invoice.id,
      clientName: invoice.clientName,
      amount: money(payment.amount),
      date: payment.paymentDate,
    })),
  );
  const paymentDates = payments
    .map((payment) => validMonth(payment.date))
    .filter(Boolean);
  const current = new Date().toLocaleDateString("en-CA").slice(0, 7);
  const keys = [...quoteDates, ...paymentDates, current].sort();
  const first = keys[0] ?? current;
  const last = keys[keys.length - 1] ?? current;
  const monthKeys: string[] = [];
  for (
    let key = first, guard = 0;
    key <= last && guard < 1200;
    key = shiftMonthKey(key, 1), guard += 1
  )
    monthKeys.push(key);
  const months: MonthlyReport[] = monthKeys.map((month) => {
    const monthPayments = payments.filter(
      (payment) => validMonth(payment.date) === month,
    );
    const estimates = quotesQuery.data.quotes
      .filter((quote) => validMonth(quote.sentAt || quote.createdAt) === month)
      .map((quote) => ({
        id: quote.id,
        clientName: quote.clientName,
        total: money(quote.total),
        date: quote.sentAt || quote.createdAt.slice(0, 10),
        status: quote.automationStatus,
      }));
    return {
      month,
      revenue: monthPayments.reduce((sum, payment) => sum + payment.amount, 0),
      estimated: estimates.reduce((sum, quote) => sum + quote.total, 0),
      estimateCount: estimates.length,
      payments: monthPayments,
      estimates,
    };
  });
  return (
    <main className="page reports-page">
      <PageHeader
        lang={lang}
        title={lang === "es" ? "Informes" : "Reports"}
        onBack={onBack}
      />
      <p className="reports-intro">
        {lang === "es"
          ? "Desliza en el tiempo con las flechas y toca un mes para ver los documentos que forman cada total."
          : "Move through time with the arrows and tap a month to see the records behind each total."}
      </p>
      <section className="toolkit-summary report-summary">
        <article>
          <span>
            {lang === "es" ? "Millaje este mes" : "Mileage this month"}
          </span>
          <strong>{growth.data?.monthlyMileage.toFixed(1) ?? "0.0"} mi</strong>
        </article>
        <article>
          <span>
            {lang === "es" ? "Gastos este mes" : "Expenses this month"}
          </span>
          <strong>{usd(growth.data?.monthlyExpenses ?? 0)}</strong>
        </article>
      </section>
      <section className="analysis-list report-analysis">
        <h2>{lang === "es" ? "Estimado vs. real" : "Estimate vs. actual"}</h2>
        {growth.data?.estimateActual.slice(0, 5).map((row) => (
          <article key={row.jobId}>
            <div>
              <strong>{row.clientName}</strong>
              <small>{row.jobType}</small>
            </div>
            <dl>
              <div>
                <dt>{lang === "es" ? "Estimado" : "Estimated"}</dt>
                <dd>{usd(row.quoted)}</dd>
              </div>
              <div>
                <dt>{lang === "es" ? "Real" : "Actual"}</dt>
                <dd>{usd(row.invoiced)}</dd>
              </div>
              <div>
                <dt>{lang === "es" ? "Diferencia" : "Variance"}</dt>
                <dd>
                  {row.variance >= 0 ? "+" : ""}
                  {usd(row.variance)}
                </dd>
              </div>
            </dl>
          </article>
        ))}
      </section>
      <HistoryPanel lang={lang} kind="comparison" months={months} />
      <HistoryPanel lang={lang} kind="revenue" months={months} />
      <HistoryPanel lang={lang} kind="estimates" months={months} />
    </main>
  );
}

function WeatherBadge({
  appointmentId,
  lang,
}: {
  appointmentId: number;
  lang: Lang;
}) {
  const query = useQuery({
    queryKey: ["weather", appointmentId],
    queryFn: () => api.getWeatherOutlook({ appointmentId }),
    staleTime: 30 * 60 * 1000,
  });
  if (query.isLoading)
    return (
      <small className="weather-badge">
        {lang === "es" ? "Consultando clima…" : "Checking weather…"}
      </small>
    );
  const w = query.data;
  if (!w?.available)
    return (
      <small className="weather-badge unavailable">
        {lang === "es" ? "Pronóstico no disponible" : "Forecast unavailable"}
      </small>
    );
  return (
    <small className={`weather-badge ${w.rainLikely ? "rain" : ""}`}>
      <strong>
        {w.rainLikely
          ? lang === "es"
            ? "Posible lluvia"
            : "Rain possible"
          : lang === "es"
            ? "Trabajo exterior"
            : "Exterior"}
      </strong>
      {w.summary} · {w.precipitationChance ?? 0}% · {w.high ?? "—"}/
      {w.low ?? "—"}
      {w.unit}
      <em>
        {w.source && `${w.source} · `}
        {lang === "es" ? "Actualizado" : "As of"}{" "}
        {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(w.asOf))}
      </em>
    </small>
  );
}

function BusinessToolsScreen({
  lang,
  onBack,
  initialTab,
}: {
  lang: Lang;
  onBack: () => void;
  initialTab?: "price" | "templates" | "mileage" | "expenses" | "analysis";
}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["growth-toolkit"],
    queryFn: () => api.getGrowthToolkit({}),
  });
  const suppliers =
    useQuery({
      queryKey: ["expansion-suite", new Date().toLocaleDateString("en-CA")],
      queryFn: () =>
        api.getExpansionSuite({
          today: new Date().toLocaleDateString("en-CA"),
        }),
    }).data?.suppliers ?? [];
  const [tab] = useState<
    "price" | "templates" | "mileage" | "expenses" | "analysis"
  >(initialTab ?? "price");
  const today = new Date().toLocaleDateString("en-CA");
  const [price, setPrice] = useState({
    id: null as number | null,
    name: "",
    description: "",
    unitPrice: "",
  });
  const [template, setTemplate] = useState({
    id: null as number | null,
    name: "",
    lineItems: [{ description: "", amount: "" }],
  });
  const [trip, setTrip] = useState({
    id: null as number | null,
    tripDate: today,
    fromLocation: "",
    toLocation: "",
    miles: "",
    jobId: null as number | null,
    purpose: "",
  });
  const [expense, setExpense] = useState({
    id: null as number | null,
    expenseDate: today,
    vendor: "",
    amount: "",
    category: "materials",
    jobId: null as number | null,
    supplierId: null as number | null,
    note: "",
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["growth-toolkit"] });
  const labels =
    lang === "es"
      ? {
          title: "Herramientas del negocio",
          price: "Precios guardados",
          templates: "Plantillas",
          mileage: "Millaje",
          expenses: "Gastos",
          analysis: "Estimado vs. real",
          save: "Guardar",
          del: "Eliminar",
          edit: "Editar",
          name: "Nombre",
          desc: "Descripción",
          amount: "Monto",
          date: "Fecha",
          job: "Trabajo opcional",
          none: "Sin trabajo",
          empty: "Aún no hay registros.",
          vendor: "Proveedor",
          category: "Categoría",
          from: "Origen",
          to: "Destino",
          miles: "Millas",
          purpose: "Propósito",
          quoted: "Estimado",
          invoiced: "Real facturado",
          variance: "Diferencia",
        }
      : {
          title: "Business toolkit",
          price: "Saved prices",
          templates: "Quote templates",
          mileage: "Mileage",
          expenses: "Expenses",
          analysis: "Estimate vs. actual",
          save: "Save",
          del: "Delete",
          edit: "Edit",
          name: "Name",
          desc: "Description",
          amount: "Amount",
          date: "Date",
          job: "Optional job",
          none: "No job",
          empty: "No records yet.",
          vendor: "Vendor",
          category: "Category",
          from: "From",
          to: "To",
          miles: "Miles",
          purpose: "Purpose",
          quoted: "Estimated",
          invoiced: "Actual invoiced",
          variance: "Variance",
        };
  return (
    <main className="page toolkit-page">
      <PageHeader lang={lang} title={labels[tab]} onBack={onBack} />
      {tab === "price" && (
        <section className="toolkit-section">
          <form
            className="compact-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!price.name) return;
              await api.savePriceBookItem(price);
              setPrice({ id: null, name: "", description: "", unitPrice: "" });
              refresh();
            }}
          >
            <div className="field-pair">
              <label>
                <span>{labels.name}</span>
                <input
                  value={price.name}
                  onChange={(e) => setPrice({ ...price, name: e.target.value })}
                />
              </label>
              <label>
                <span>{labels.amount}</span>
                <input
                  inputMode="decimal"
                  value={price.unitPrice}
                  onChange={(e) =>
                    setPrice({ ...price, unitPrice: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              <span>{labels.desc}</span>
              <input
                value={price.description}
                onChange={(e) =>
                  setPrice({ ...price, description: e.target.value })
                }
              />
            </label>
            <button className="primary-button">{labels.save}</button>
          </form>
          <div className="tool-records">
            {query.data?.priceBook.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <span>{usd(money(row.unitPrice))}</span>
                  <small>{row.description}</small>
                </div>
                <div className="row-actions">
                  <button
                    onClick={() =>
                      setPrice({
                        id: row.id,
                        name: row.name,
                        description: row.description,
                        unitPrice: row.unitPrice,
                      })
                    }
                  >
                    {labels.edit}
                  </button>
                  <button
                    aria-label={`${labels.del} ${row.name}`}
                    onClick={async () => {
                      await api.deletePriceBookItem({ id: row.id });
                      refresh();
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </article>
            ))}
            {query.data?.priceBook.length === 0 && (
              <p className="detail-empty">{labels.empty}</p>
            )}
          </div>
        </section>
      )}
      {tab === "templates" && (
        <section className="toolkit-section">
          <form
            className="compact-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                !template.name ||
                !template.lineItems.some((i) => i.description)
              )
                return;
              await api.saveQuoteTemplate({
                ...template,
                lineItems: template.lineItems.filter((i) => i.description),
              });
              setTemplate({
                id: null,
                name: "",
                lineItems: [{ description: "", amount: "" }],
              });
              refresh();
            }}
          >
            <label>
              <span>{labels.name}</span>
              <input
                value={template.name}
                onChange={(e) =>
                  setTemplate({ ...template, name: e.target.value })
                }
              />
            </label>
            {template.lineItems.map((item, i) => (
              <div className="line-item" key={i}>
                <input
                  aria-label={`${labels.desc} ${i + 1}`}
                  value={item.description}
                  onChange={(e) =>
                    setTemplate({
                      ...template,
                      lineItems: template.lineItems.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`${labels.amount} ${i + 1}`}
                  inputMode="decimal"
                  value={item.amount}
                  onChange={(e) =>
                    setTemplate({
                      ...template,
                      lineItems: template.lineItems.map((x, j) =>
                        j === i ? { ...x, amount: e.target.value } : x,
                      ),
                    })
                  }
                />
              </div>
            ))}
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setTemplate({
                  ...template,
                  lineItems: [
                    ...template.lineItems,
                    { description: "", amount: "" },
                  ],
                })
              }
            >
              <PlusIcon />
              {lang === "es" ? "Partida" : "Line item"}
            </button>
            <button className="primary-button">{labels.save}</button>
          </form>
          <div className="tool-records">
            {query.data?.templates.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.name}</strong>
                  <small>
                    {row.lineItems.length}{" "}
                    {lang === "es" ? "partidas" : "items"}
                  </small>
                </div>
                <div className="row-actions">
                  <button
                    onClick={() =>
                      setTemplate({
                        id: row.id,
                        name: row.name,
                        lineItems: row.lineItems.map((i) => ({ ...i })),
                      })
                    }
                  >
                    {labels.edit}
                  </button>
                  <button
                    aria-label={`${labels.del} ${row.name}`}
                    onClick={async () => {
                      await api.deleteQuoteTemplate({ id: row.id });
                      refresh();
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {tab === "mileage" && (
        <section className="toolkit-section">
          <form
            className="compact-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!trip.miles) return;
              await api.saveMileageTrip(trip);
              setTrip({
                id: null,
                tripDate: today,
                fromLocation: "",
                toLocation: "",
                miles: "",
                jobId: null,
                purpose: "",
              });
              refresh();
            }}
          >
            <div className="field-pair">
              <label>
                <span>{labels.date}</span>
                <input
                  type="date"
                  value={trip.tripDate}
                  onChange={(e) =>
                    setTrip({ ...trip, tripDate: e.target.value })
                  }
                />
              </label>
              <label>
                <span>{labels.miles}</span>
                <input
                  inputMode="decimal"
                  value={trip.miles}
                  onChange={(e) => setTrip({ ...trip, miles: e.target.value })}
                />
              </label>
            </div>
            <div className="field-pair">
              <label>
                <span>{labels.from}</span>
                <input
                  value={trip.fromLocation}
                  onChange={(e) =>
                    setTrip({ ...trip, fromLocation: e.target.value })
                  }
                />
              </label>
              <label>
                <span>{labels.to}</span>
                <input
                  value={trip.toLocation}
                  onChange={(e) =>
                    setTrip({ ...trip, toLocation: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              <span>{labels.job}</span>
              <select
                value={trip.jobId ?? ""}
                onChange={(e) =>
                  setTrip({
                    ...trip,
                    jobId: e.target.value ? Number(e.target.value) : null,
                  })
                }
              >
                <option value="">{labels.none}</option>
                {query.data?.jobs.map((j) => (
                  <option value={j.id} key={j.id}>
                    {j.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{labels.purpose}</span>
              <input
                value={trip.purpose}
                onChange={(e) => setTrip({ ...trip, purpose: e.target.value })}
              />
            </label>
            <button className="primary-button">{labels.save}</button>
          </form>
          <div className="tool-records">
            {query.data?.mileage.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>
                    {row.miles} mi · {row.purpose || row.toLocation}
                  </strong>
                  <span>
                    {formatDate(row.tripDate, lang)}
                    {row.jobName ? ` · ${row.jobName}` : ""}
                  </span>
                  <small>
                    {[row.fromLocation, row.toLocation]
                      .filter(Boolean)
                      .join(" → ")}
                  </small>
                </div>
                <div className="row-actions">
                  <button
                    onClick={() =>
                      setTrip({
                        id: row.id,
                        tripDate: row.tripDate,
                        fromLocation: row.fromLocation,
                        toLocation: row.toLocation,
                        miles: row.miles,
                        jobId: row.jobId,
                        purpose: row.purpose,
                      })
                    }
                  >
                    {labels.edit}
                  </button>
                  <button
                    aria-label={`${labels.del} ${row.purpose}`}
                    onClick={async () => {
                      await api.deleteMileageTrip({ id: row.id });
                      refresh();
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {tab === "expenses" && (
        <section className="toolkit-section">
          <form
            className="compact-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!expense.amount) return;
              await api.saveBusinessExpense(expense);
              setExpense({
                id: null,
                expenseDate: today,
                vendor: "",
                amount: "",
                category: "materials",
                jobId: null,
                supplierId: null,
                note: "",
              });
              refresh();
            }}
          >
            <div className="field-pair">
              <label>
                <span>{labels.date}</span>
                <input
                  type="date"
                  value={expense.expenseDate}
                  onChange={(e) =>
                    setExpense({ ...expense, expenseDate: e.target.value })
                  }
                />
              </label>
              <label>
                <span>{labels.amount}</span>
                <input
                  inputMode="decimal"
                  value={expense.amount}
                  onChange={(e) =>
                    setExpense({ ...expense, amount: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              <span>{labels.vendor}</span>
              <input
                value={expense.vendor}
                onChange={(e) =>
                  setExpense({ ...expense, vendor: e.target.value })
                }
              />
            </label>
            <div className="field-pair">
              <label>
                <span>{labels.category}</span>
                <select
                  value={expense.category}
                  onChange={(e) =>
                    setExpense({ ...expense, category: e.target.value })
                  }
                >
                  <option value="materials">
                    {lang === "es" ? "Materiales" : "Materials"}
                  </option>
                  <option value="fuel">
                    {lang === "es" ? "Combustible" : "Fuel"}
                  </option>
                  <option value="tools">
                    {lang === "es" ? "Herramientas" : "Tools"}
                  </option>
                  <option value="insurance">
                    {lang === "es" ? "Seguro" : "Insurance"}
                  </option>
                  <option value="other">
                    {lang === "es" ? "Otro" : "Other"}
                  </option>
                </select>
              </label>
              <label>
                <span>{labels.job}</span>
                <select
                  value={expense.jobId ?? ""}
                  onChange={(e) =>
                    setExpense({
                      ...expense,
                      jobId: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                >
                  <option value="">{labels.none}</option>
                  {query.data?.jobs.map((j) => (
                    <option value={j.id} key={j.id}>
                      {j.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              <span>
                {lang === "es"
                  ? "Proveedor del directorio"
                  : "Directory supplier"}
              </span>
              <select
                value={expense.supplierId ?? ""}
                onChange={(e) => {
                  const id = e.target.value ? Number(e.target.value) : null;
                  const supplier = suppliers.find((s) => s.id === id);
                  setExpense({
                    ...expense,
                    supplierId: id,
                    vendor: supplier?.name ?? expense.vendor,
                  });
                }}
              >
                <option value="">
                  {lang === "es" ? "Sin vincular" : "Not linked"}
                </option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{lang === "es" ? "Nota" : "Note"}</span>
              <input
                value={expense.note}
                onChange={(e) =>
                  setExpense({ ...expense, note: e.target.value })
                }
              />
            </label>
            <button className="primary-button">{labels.save}</button>
          </form>
          <div className="tool-records">
            {query.data?.expenses.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>
                    {row.vendor || row.category} · {usd(money(row.amount))}
                  </strong>
                  <span>
                    {formatDate(row.expenseDate, lang)}
                    {row.jobName ? ` · ${row.jobName}` : ""}
                  </span>
                  <small>{row.note}</small>
                </div>
                <div className="row-actions">
                  <button
                    onClick={() =>
                      setExpense({
                        id: row.id,
                        expenseDate: row.expenseDate,
                        vendor: row.vendor,
                        amount: row.amount,
                        category: row.category,
                        jobId: row.jobId,
                        supplierId: row.supplierId,
                        note: row.note,
                      })
                    }
                  >
                    {labels.edit}
                  </button>
                  <button
                    aria-label={`${labels.del} ${row.vendor}`}
                    onClick={async () => {
                      await api.deleteBusinessExpense({ id: row.id });
                      refresh();
                    }}
                  >
                    <TrashIcon />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {tab === "analysis" && (
        <section className="toolkit-section">
          <div className="analysis-list">
            {query.data?.estimateActual.map((row) => (
              <article key={row.jobId}>
                <div>
                  <strong>{row.clientName}</strong>
                  <small>{row.jobType}</small>
                </div>
                <dl>
                  <div>
                    <dt>{labels.quoted}</dt>
                    <dd>{usd(row.quoted)}</dd>
                  </div>
                  <div>
                    <dt>{labels.invoiced}</dt>
                    <dd>{usd(row.invoiced)}</dd>
                  </div>
                  <div>
                    <dt>{labels.variance}</dt>
                    <dd className={row.variance > 0 ? "negative" : "positive"}>
                      {row.variance >= 0 ? "+" : ""}
                      {usd(row.variance)}
                      {row.variancePercent !== null
                        ? ` (${row.variancePercent.toFixed(1)}%)`
                        : ""}
                    </dd>
                  </div>
                </dl>
              </article>
            ))}
            {query.data?.estimateActual.length === 0 && (
              <p className="detail-empty">{labels.empty}</p>
            )}
          </div>
        </section>
      )}
    </main>
  );
}

function OperationsScreen({
  lang,
  settings,
  onBack,
  setScreen,
  initialTab,
}: {
  lang: Lang;
  settings: Settings | null;
  onBack: () => void;
  setScreen: (s: Screen) => void;
  initialTab?: "calendar" | "leads";
}) {
  const qc = useQueryClient();
  const [tab] = useState<"calendar" | "leads">(initialTab ?? "calendar");
  const [view, setView] = useState<"day" | "week">("week");
  const appointments = useQuery({
    queryKey: ["appointments"],
    queryFn: () => api.listAppointments({}),
  });
  const leads = useQuery({
    queryKey: ["leads"],
    queryFn: () => api.listLeads({}),
  });
  const jobs = useQuery({
    queryKey: ["jobs", ""],
    queryFn: () => api.listJobs({ search: "" }),
  });
  const clients = useQuery({
    queryKey: ["clients", ""],
    queryFn: () => api.listClients({ search: "" }),
  });
  const [showAppointment, setShowAppointment] = useState(false);
  const [showLead, setShowLead] = useState(false);
  const [focusDate, setFocusDate] = useState(
    new Date().toLocaleDateString("en-CA"),
  );
  const [appointment, setAppointment] = useState({
    id: null as number | null,
    jobId: null as number | null,
    clientId: null as number | null,
    clientName: "",
    clientPhone: "",
    startsAt: `${new Date().toLocaleDateString("en-CA")}T09:00`,
    notes: "",
    exteriorWork: false,
  });
  const [lead, setLead] = useState({
    name: "",
    phone: "",
    source: "",
    notes: "",
    projectSize: "medium" as "small" | "medium" | "large",
    engagement: "normal" as "slow" | "normal" | "fast",
    serviceType: "",
  });
  const saveAppointment = useMutation({
    mutationFn: () => api.saveAppointment(appointment),
    onSuccess: () => {
      setShowAppointment(false);
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const saveLead = useMutation({
    mutationFn: () => api.saveLead(lead),
    onSuccess: () => {
      setLead({
        name: "",
        phone: "",
        source: "",
        notes: "",
        projectSize: "medium",
        engagement: "normal",
        serviceType: "",
      });
      setShowLead(false);
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
  const start = new Date(`${focusDate}T00:00:00`);
  const end = new Date(start);
  if (view === "week") end.setDate(end.getDate() + 7);
  else end.setDate(end.getDate() + 1);
  const visible = (appointments.data?.appointments ?? []).filter((a) => {
    const date = new Date(a.startsAt);
    return date >= start && date < end;
  });
  const stages = ["new", "contacted", "quoted", "won", "lost"] as const;
  const chooseJob = (id: number) => {
    const j = jobs.data?.jobs.find((row) => row.id === id);
    if (j)
      setAppointment({
        ...appointment,
        jobId: j.id,
        clientId: j.clientId,
        clientName: j.clientName,
        clientPhone: j.clientPhone,
      });
  };
  const reminder = (
    a: NonNullable<typeof appointments.data>["appointments"][number],
  ) =>
    lang === "es"
      ? `Hola ${a.clientName}, confirmamos su cita para ${new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(a.startsAt))}. — ${companySignature(settings)}`
      : `Hi ${a.clientName}, confirming your appointment for ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(a.startsAt))}. — ${companySignature(settings)}`;
  return (
    <main className="page operations-home">
      <PageHeader
        lang={lang}
        title={tab === "calendar" ? (lang === "es" ? "Calendario" : "Schedule") : (lang === "es" ? "Prospectos" : "Leads")}
        onBack={onBack}
      />
      {tab === "calendar" ? (
        <>
          <div className="calendar-toolbar">
            <div>
              <button
                className={view === "day" ? "active" : ""}
                onClick={() => setView("day")}
              >
                {lang === "es" ? "Día" : "Day"}
              </button>
              <button
                className={view === "week" ? "active" : ""}
                onClick={() => setView("week")}
              >
                {lang === "es" ? "Semana" : "Week"}
              </button>
            </div>
            <input
              type="date"
              value={focusDate}
              onChange={(e) => setFocusDate(e.target.value)}
              aria-label={lang === "es" ? "Fecha" : "Date"}
            />
            <button
              className="primary-button"
              onClick={() => setShowAppointment(!showAppointment)}
            >
              <PlusIcon />
              {lang === "es" ? "Cita" : "Appointment"}
            </button>
          </div>
          {showAppointment && (
            <form
              className="compact-form operation-editor"
              onSubmit={(e) => {
                e.preventDefault();
                if (appointment.clientName && appointment.startsAt)
                  saveAppointment.mutate();
              }}
            >
              <label>
                <span>
                  {lang === "es" ? "Trabajo (opcional)" : "Job (optional)"}
                </span>
                <select
                  value={appointment.jobId ?? ""}
                  onChange={(e) =>
                    e.target.value
                      ? chooseJob(Number(e.target.value))
                      : setAppointment({ ...appointment, jobId: null })
                  }
                >
                  <option value="">—</option>
                  {jobs.data?.jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.clientName} · {j.jobType}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{copy[lang].chooseClient}</span>
                <select
                  value={appointment.clientId ?? ""}
                  onChange={(e) => {
                    const c = clients.data?.clients.find(
                      (row) => row.id === Number(e.target.value),
                    );
                    if (c)
                      setAppointment({
                        ...appointment,
                        clientId: c.id,
                        clientName: c.name,
                        clientPhone: c.phone,
                      });
                  }}
                >
                  <option value="">—</option>
                  {clients.data?.clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="field-pair">
                <label>
                  <span>{copy[lang].client}</span>
                  <input
                    value={appointment.clientName}
                    onChange={(e) =>
                      setAppointment({
                        ...appointment,
                        clientName: e.target.value,
                      })
                    }
                  />
                </label>
                <label>
                  <span>{copy[lang].phone}</span>
                  <input
                    value={appointment.clientPhone}
                    onChange={(e) =>
                      setAppointment({
                        ...appointment,
                        clientPhone: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <label>
                <span>{copy[lang].appointment}</span>
                <input
                  type="datetime-local"
                  value={appointment.startsAt}
                  onChange={(e) =>
                    setAppointment({ ...appointment, startsAt: e.target.value })
                  }
                />
              </label>
              <label>
                <span>{copy[lang].notes}</span>
                <textarea
                  rows={3}
                  value={appointment.notes}
                  onChange={(e) =>
                    setAppointment({ ...appointment, notes: e.target.value })
                  }
                />
              </label>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={appointment.exteriorWork}
                  onChange={(e) =>
                    setAppointment({
                      ...appointment,
                      exteriorWork: e.target.checked,
                    })
                  }
                />
                <span>
                  {lang === "es"
                    ? "Trabajo exterior — mostrar pronóstico"
                    : "Exterior work — show forecast"}
                </span>
              </label>
              <button className="primary-button">{copy[lang].save}</button>
            </form>
          )}
          <section className="calendar-list">
            {visible.map((a) => (
              <article key={a.id}>
                <time>
                  {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  }).format(new Date(a.startsAt))}
                </time>
                <div>
                  <strong>{a.clientName}</strong>
                  <p>{a.notes || "—"}</p>
                  {a.exteriorWork && (
                    <WeatherBadge appointmentId={a.id} lang={lang} />
                  )}
                </div>
                <div className="row-actions">
                  {a.clientPhone && (
                    <a
                      className="small-button"
                      href={smsHref(a.clientPhone, reminder(a))}
                    >
                      {lang === "es" ? "Texto" : "Text"}
                    </a>
                  )}
                  {a.jobId && (
                    <button
                      onClick={() =>
                        setScreen({ name: "detail", jobId: a.jobId as number })
                      }
                    >
                      {lang === "es" ? "Trabajo" : "Job"}
                    </button>
                  )}
                </div>
              </article>
            ))}
            {visible.length === 0 && (
              <div className="empty-state">
                <h2>
                  {lang === "es"
                    ? "No hay citas en este período."
                    : "No appointments in this period."}
                </h2>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="lead-toolbar">
            <div>
              <strong>{lang === "es" ? "Tasa de ganancia" : "Win rate"}</strong>
              <span>{leads.data?.winRate ?? 0}%</span>
            </div>
            <button
              className="primary-button"
              onClick={() => setShowLead(!showLead)}
            >
              <PlusIcon />
              {lang === "es" ? "Prospecto" : "Lead"}
            </button>
          </div>
          {showLead && (
            <form
              className="compact-form operation-editor"
              onSubmit={(e) => {
                e.preventDefault();
                if (lead.name) saveLead.mutate();
              }}
            >
              <label>
                <span>{copy[lang].client}</span>
                <input
                  value={lead.name}
                  onChange={(e) => setLead({ ...lead, name: e.target.value })}
                />
              </label>
              <div className="field-pair">
                <label>
                  <span>{copy[lang].phone}</span>
                  <input
                    value={lead.phone}
                    onChange={(e) =>
                      setLead({ ...lead, phone: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>{lang === "es" ? "Fuente" : "Source"}</span>
                  <input
                    value={lead.source}
                    onChange={(e) =>
                      setLead({ ...lead, source: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                <span>
                  {lang === "es" ? "Tipo de servicio" : "Service type"}
                </span>
                <input
                  value={lead.serviceType}
                  onChange={(e) =>
                    setLead({ ...lead, serviceType: e.target.value })
                  }
                  placeholder={
                    lang === "es"
                      ? "Cocina, baño, pintura…"
                      : "Kitchen, bathroom, painting…"
                  }
                />
              </label>
              <div className="field-pair">
                <label>
                  <span>
                    {lang === "es" ? "Tamaño del proyecto" : "Project size"}
                  </span>
                  <select
                    value={lead.projectSize}
                    onChange={(e) =>
                      setLead({
                        ...lead,
                        projectSize: e.target.value as typeof lead.projectSize,
                      })
                    }
                  >
                    <option value="small">
                      {lang === "es" ? "Pequeño" : "Small"}
                    </option>
                    <option value="medium">
                      {lang === "es" ? "Mediano" : "Medium"}
                    </option>
                    <option value="large">
                      {lang === "es" ? "Grande" : "Large"}
                    </option>
                  </select>
                </label>
                <label>
                  <span>
                    {lang === "es" ? "Interés / respuesta" : "Engagement"}
                  </span>
                  <select
                    value={lead.engagement}
                    onChange={(e) =>
                      setLead({
                        ...lead,
                        engagement: e.target.value as typeof lead.engagement,
                      })
                    }
                  >
                    <option value="slow">
                      {lang === "es" ? "Lento" : "Slow"}
                    </option>
                    <option value="normal">
                      {lang === "es" ? "Normal" : "Normal"}
                    </option>
                    <option value="fast">
                      {lang === "es" ? "Rápido" : "Fast"}
                    </option>
                  </select>
                </label>
              </div>
              <label>
                <span>{copy[lang].notes}</span>
                <textarea
                  value={lead.notes}
                  onChange={(e) => setLead({ ...lead, notes: e.target.value })}
                />
              </label>
              <button className="primary-button">{copy[lang].save}</button>
            </form>
          )}
          <section className="kanban-board">
            {stages.map((stage) => (
              <div className="kanban-column" key={stage}>
                <h2>
                  <span>{stageLabel(stage, lang)}</span>
                  <small>
                    {leads.data?.leads.filter((l) => l.stage === stage)
                      .length ?? 0}
                  </small>
                </h2>
                {leads.data?.leads
                  .filter((l) => l.stage === stage)
                  .map((l) => (
                    <article
                      className={l.score >= 75 ? "hot-lead" : ""}
                      key={l.id}
                    >
                      <div className="lead-score">
                        <strong>{l.name}</strong>
                        <span>
                          {l.score}/100
                          {l.score >= 75
                            ? ` · ${lang === "es" ? "Caliente" : "Hot"}`
                            : ""}
                        </span>
                      </div>
                      <small>
                        {[l.phone, l.source, l.serviceType]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                      <small>
                        {lang === "es" ? "Proyecto" : "Project"}:{" "}
                        {l.projectSize} ·{" "}
                        {lang === "es" ? "Respuesta" : "Response"}:{" "}
                        {l.engagement}
                      </small>
                      {l.notes && <p>{l.notes}</p>}
                      <select
                        aria-label={`${l.name} ${stageLabel(stage, lang)}`}
                        value={l.stage}
                        onChange={async (e) => {
                          await api.updateLeadStage({
                            id: l.id,
                            stage: e.target.value as typeof stage,
                          });
                          qc.invalidateQueries({ queryKey: ["leads"] });
                          qc.invalidateQueries({ queryKey: ["dashboard"] });
                        }}
                      >
                        {stages.map((s) => (
                          <option value={s} key={s}>
                            {stageLabel(s, lang)}
                          </option>
                        ))}
                      </select>
                      {l.stage !== "won" && l.stage !== "lost" && (
                        <button
                          className="small-button"
                          onClick={async () => {
                            const r = await api.prepareLeadQuote({ id: l.id });
                            qc.invalidateQueries({ queryKey: ["leads"] });
                            setScreen({
                              name: "quoteNew",
                              clientId: r.clientId,
                            });
                          }}
                        >
                          {lang === "es" ? "Crear cotización" : "Create quote"}
                        </button>
                      )}
                    </article>
                  ))}
              </div>
            ))}
          </section>
        </>
      )}
    </main>
  );
}
function stageLabel(
  stage: "new" | "contacted" | "quoted" | "won" | "lost",
  lang: Lang,
) {
  const en = {
    new: "New",
    contacted: "Contacted",
    quoted: "Quoted",
    won: "Won",
    lost: "Lost",
  };
  const es = {
    new: "Nuevo",
    contacted: "Contactado",
    quoted: "Cotizado",
    won: "Ganado",
    lost: "Perdido",
  };
  return (lang === "es" ? es : en)[stage];
}

function JobOperationsScreen({
  lang,
  jobId,
  settings,
  onBack,
  setScreen,
}: {
  lang: Lang;
  jobId: number;
  settings: Settings | null;
  onBack: () => void;
  setScreen: (s: Screen) => void;
}) {
  const qc = useQueryClient();
  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => api.getJob({ id: jobId }),
  });
  const query = useQuery({
    queryKey: ["job-operations", jobId],
    queryFn: () => api.getJobOperations({ jobId }),
  });
  const [open, setOpen] = useState<
    "selections" | "logs" | "notes" | "payments"
  >("selections");
  const [selection, setSelection] = useState({
    category: "",
    item: "",
    vendor: "",
    approvalStatus: "pending" as "pending" | "approved" | "rejected",
    leadTimeDays: 0,
  });
  const [selectionFile, setSelectionFile] = useState<File | null>(null);
  const [log, setLog] = useState({
    logDate: new Date().toLocaleDateString("en-CA"),
    crew: "",
    hours: "",
    photoIds: [] as number[],
    notes: "",
  });
  const [note, setNote] = useState({ note: "", reminderDate: "" });
  const [milestone, setMilestone] = useState({
    label: "",
    amount: "",
    percentage: "",
    dueDate: "",
  });
  const job = jobQuery.data?.job;
  const data = query.data;
  if (!job || !data)
    return (
      <main className="page">
        <PageHeader lang={lang} title="…" onBack={onBack} />
        <div className="loading-block" />
      </main>
    );
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["job-operations", jobId] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  };
  const shareSelections = async () => {
    const text = [
      `${job.clientName} — ${job.jobType}`,
      ...data.selections.map(
        (s) =>
          `${s.category}: ${s.item}${s.vendor ? ` (${s.vendor})` : ""} — ${s.approvalStatus}`,
      ),
    ].join("\n");
    if (navigator.share)
      await navigator
        .share({ title: lang === "es" ? "Selecciones" : "Selections", text })
        .catch(() => undefined);
    else await copyText(text);
  };
  return (
    <main className="page job-ops-page">
      <PageHeader
        lang={lang}
        title={lang === "es" ? "Operaciones del trabajo" : "Job operations"}
        onBack={onBack}
      />
      <section className="profit-card">
        <h2>{lang === "es" ? "Rentabilidad" : "Profitability"}</h2>
        <div>
          <span>
            {lang === "es" ? "Estimado" : "Estimated"}
            <strong>{usd(data.profitability.quoted)}</strong>
          </span>
          <span>
            {lang === "es" ? "Facturado" : "Invoiced"}
            <strong>{usd(data.profitability.invoiced)}</strong>
          </span>
          <span>
            {lang === "es" ? "Diferencia" : "Variance"}
            <strong>
              {data.profitability.variance >= 0 ? "+" : ""}
              {usd(data.profitability.variance)}
              {data.profitability.variancePercent !== null
                ? ` · ${data.profitability.variancePercent.toFixed(1)}%`
                : ""}
            </strong>
          </span>
          <span>
            {lang === "es" ? "Materiales" : "Materials"}
            <strong>{usd(data.profitability.materials)}</strong>
          </span>
          <span>
            {lang === "es" ? "Gastos" : "Expenses"}
            <strong>{usd(data.profitability.expenses)}</strong>
          </span>
          <span>
            {lang === "es" ? "Subcontratistas" : "Subcontractors"}
            <strong>{usd(data.profitability.subcontractors)}</strong>
          </span>
          <span>
            {lang === "es" ? "Mano de obra" : "Labor"}
            <strong>{usd(data.profitability.laborCost)}</strong>
          </span>
          <span className="profit-total">
            {lang === "es" ? "Ganancia" : "Profit"}
            <strong>
              {usd(data.profitability.profit)} ·{" "}
              {data.profitability.margin.toFixed(1)}%
            </strong>
          </span>
        </div>
        <small>
          {data.profitability.laborHours.toFixed(1)}h ×{" "}
          {usd(money(settings?.hourlyCostRate ?? "0"))}/h
        </small>
      </section>
      <div className="job-ops-tabs">
        {(["selections", "logs", "notes", "payments"] as const).map((key) => (
          <button
            className={open === key ? "active" : ""}
            onClick={() => setOpen(key)}
            key={key}
          >
            {key === "selections"
              ? lang === "es"
                ? "Selecciones"
                : "Selections"
              : key === "logs"
                ? lang === "es"
                  ? "Diario"
                  : "Daily log"
                : key === "notes"
                  ? lang === "es"
                    ? "Notas privadas"
                    : "Private notes"
                  : lang === "es"
                    ? "Pagos"
                    : "Payments"}
          </button>
        ))}
      </div>
      {open === "selections" && (
        <section className="operation-module">
          <div className="module-heading">
            <h2>
              {lang === "es" ? "Selecciones del cliente" : "Client selections"}
            </h2>
            <button
              className="small-button"
              onClick={() => void shareSelections()}
            >
              <ShareIcon />
              {lang === "es" ? "Compartir resumen" : "Share summary"}
            </button>
          </div>
          <form
            className="compact-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!selection.category || !selection.item) return;
              let encoded = { dataBase64: "" };
              if (selectionFile) encoded = await fileToBase64(selectionFile);
              await api.saveSelection({
                jobId,
                ...selection,
                photoFilename: selectionFile?.name ?? "",
                photoContentType: (selectionFile?.type ?? "") as
                  "" | "image/jpeg" | "image/png" | "image/webp",
                photoDataBase64: encoded.dataBase64,
              });
              setSelection({
                category: "",
                item: "",
                vendor: "",
                approvalStatus: "pending",
                leadTimeDays: 0,
              });
              setSelectionFile(null);
              refresh();
            }}
          >
            <div className="field-pair">
              <label>
                <span>{lang === "es" ? "Categoría" : "Category"}</span>
                <input
                  value={selection.category}
                  onChange={(e) =>
                    setSelection({ ...selection, category: e.target.value })
                  }
                />
              </label>
              <label>
                <span>
                  {lang === "es" ? "Artículo / acabado" : "Item / finish"}
                </span>
                <input
                  value={selection.item}
                  onChange={(e) =>
                    setSelection({ ...selection, item: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="field-pair">
              <label>
                <span>{lang === "es" ? "Proveedor" : "Vendor"}</span>
                <input
                  value={selection.vendor}
                  onChange={(e) =>
                    setSelection({ ...selection, vendor: e.target.value })
                  }
                />
              </label>
              <label>
                <span>
                  {lang === "es" ? "Plazo (días)" : "Lead time (days)"}
                </span>
                <input
                  type="number"
                  min="0"
                  max="730"
                  value={selection.leadTimeDays}
                  onChange={(e) =>
                    setSelection({
                      ...selection,
                      leadTimeDays: Number(e.target.value) || 0,
                    })
                  }
                />
              </label>
            </div>
            <label>
              <span>{lang === "es" ? "Foto opcional" : "Optional photo"}</span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setSelectionFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <button className="primary-button">{copy[lang].save}</button>
          </form>
          <div className="selection-list">
            {data.selections.map((s) => (
              <article key={s.id}>
                {s.photoUrl && (
                  <img src={s.photoUrl} alt={`${s.category}: ${s.item}`} />
                )}
                <div>
                  <strong>{s.category}</strong>
                  <span>{s.item}</span>
                  <small>{s.vendor}</small>
                  <label className="lead-time-inline">
                    <span>{lang === "es" ? "Plazo" : "Lead time"}</span>
                    <input
                      aria-label={`${s.item} ${lang === "es" ? "plazo en días" : "lead time days"}`}
                      type="number"
                      min="0"
                      max="730"
                      defaultValue={s.leadTimeDays}
                      onBlur={async (e) => {
                        await api.updateSelectionLeadTime({
                          id: s.id,
                          leadTimeDays: Number(e.target.value) || 0,
                        });
                        refresh();
                      }}
                    />
                    <small>
                      {s.leadTimeDays > 0
                        ? lang === "es"
                          ? `${s.leadTimeDays} días antes del inicio`
                          : `${s.leadTimeDays} days before start`
                        : lang === "es"
                          ? "Sin plazo"
                          : "No lead time"}
                    </small>
                  </label>
                </div>
                <select
                  value={s.approvalStatus}
                  onChange={async (e) => {
                    await api.updateSelectionStatus({
                      id: s.id,
                      approvalStatus: e.target.value as typeof s.approvalStatus,
                    });
                    refresh();
                  }}
                >
                  <option value="pending">
                    {lang === "es" ? "Pendiente" : "Pending"}
                  </option>
                  <option value="approved">
                    {lang === "es" ? "Aprobado" : "Approved"}
                  </option>
                  <option value="rejected">
                    {lang === "es" ? "Rechazado" : "Rejected"}
                  </option>
                </select>
              </article>
            ))}
          </div>
        </section>
      )}
      {open === "logs" && (
        <section className="operation-module">
          <h2>{lang === "es" ? "Registro diario" : "Daily log"}</h2>
          <form
            className="compact-form"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.saveDailyLog({ jobId, ...log });
              setLog({ ...log, crew: "", hours: "", photoIds: [], notes: "" });
              refresh();
            }}
          >
            <div className="field-pair">
              <label>
                <span>{copy[lang].date}</span>
                <input
                  type="date"
                  value={log.logDate}
                  onChange={(e) => setLog({ ...log, logDate: e.target.value })}
                />
              </label>
              <label>
                <span>{lang === "es" ? "Horas" : "Hours"}</span>
                <input
                  inputMode="decimal"
                  value={log.hours}
                  onChange={(e) => setLog({ ...log, hours: e.target.value })}
                />
              </label>
            </div>
            <label>
              <span>{lang === "es" ? "Personal en obra" : "Crew on site"}</span>
              <input
                value={log.crew}
                onChange={(e) => setLog({ ...log, crew: e.target.value })}
              />
            </label>
            <fieldset className="photo-picker">
              <legend>{lang === "es" ? "Fotos del día" : "Day photos"}</legend>
              <div>
                {jobQuery.data?.photos.map((p) => (
                  <label key={p.id}>
                    <img src={p.url} alt={p.caption || p.stage} />
                    <input
                      type="checkbox"
                      checked={log.photoIds.includes(p.id)}
                      onChange={(e) =>
                        setLog({
                          ...log,
                          photoIds: e.target.checked
                            ? [...log.photoIds, p.id]
                            : log.photoIds.filter((id) => id !== p.id),
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <label>
              <span>{copy[lang].notes}</span>
              <textarea
                rows={4}
                value={log.notes}
                onChange={(e) => setLog({ ...log, notes: e.target.value })}
              />
            </label>
            <button className="primary-button">{copy[lang].save}</button>
          </form>
          <div className="timeline-list">
            {data.dailyLogs.map((l) => (
              <article key={l.id}>
                <time>{formatDate(l.logDate, lang)}</time>
                <div>
                  <strong>
                    {l.crew || "—"} · {l.hours || "0"}h
                  </strong>
                  <p>{l.notes || "—"}</p>
                  <small>
                    {l.photoIds.length} {copy[lang].photos}
                  </small>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      {open === "notes" && (
        <section className="operation-module">
          <h2>{lang === "es" ? "Notas internas" : "Internal notes"}</h2>
          <p className="privacy-note">
            {lang === "es"
              ? "Privadas: nunca aparecen en los PDF del cliente."
              : "Private: never shown on client-facing PDFs."}
          </p>
          <form
            className="compact-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!note.note) return;
              await api.saveInternalNote({
                jobId,
                clientId: job.clientId,
                ...note,
              });
              setNote({ note: "", reminderDate: "" });
              refresh();
            }}
          >
            <label>
              <span>{copy[lang].notes}</span>
              <textarea
                rows={3}
                value={note.note}
                onChange={(e) => setNote({ ...note, note: e.target.value })}
              />
            </label>
            <label>
              <span>
                {lang === "es" ? "Fecha de recordatorio" : "Reminder date"}
              </span>
              <input
                type="date"
                value={note.reminderDate}
                onChange={(e) =>
                  setNote({ ...note, reminderDate: e.target.value })
                }
              />
            </label>
            <button className="primary-button">{copy[lang].save}</button>
          </form>
          <div className="private-note-list">
            {data.internalNotes.map((n) => (
              <label key={n.id}>
                <input
                  type="checkbox"
                  checked={n.completed}
                  onChange={async (e) => {
                    await api.toggleInternalNote({
                      id: n.id,
                      completed: e.target.checked,
                    });
                    refresh();
                  }}
                />
                <span className={n.completed ? "complete" : ""}>
                  <strong>{n.note}</strong>
                  <small>
                    {n.reminderDate ? formatDate(n.reminderDate, lang) : ""}
                  </small>
                </span>
              </label>
            ))}
          </div>
        </section>
      )}
      {open === "payments" && (
        <section className="operation-module">
          <h2>{lang === "es" ? "Programa de pagos" : "Payment schedule"}</h2>
          <form
            className="compact-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!milestone.label) return;
              await api.saveMilestone({ jobId, ...milestone });
              setMilestone({
                label: "",
                amount: "",
                percentage: "",
                dueDate: "",
              });
              refresh();
            }}
          >
            <label>
              <span>{lang === "es" ? "Hito" : "Milestone"}</span>
              <input
                value={milestone.label}
                onChange={(e) =>
                  setMilestone({ ...milestone, label: e.target.value })
                }
                placeholder={
                  lang === "es"
                    ? "Depósito, progreso, final"
                    : "Deposit, progress, final"
                }
              />
            </label>
            <div className="field-pair">
              <label>
                <span>{copy[lang].amount}</span>
                <input
                  inputMode="decimal"
                  value={milestone.amount}
                  onChange={(e) =>
                    setMilestone({ ...milestone, amount: e.target.value })
                  }
                />
              </label>
              <label>
                <span>
                  {lang === "es"
                    ? "Porcentaje opcional"
                    : "Optional percentage"}
                </span>
                <input
                  inputMode="decimal"
                  value={milestone.percentage}
                  onChange={(e) =>
                    setMilestone({ ...milestone, percentage: e.target.value })
                  }
                />
              </label>
            </div>
            <label>
              <span>{copy[lang].dueDate}</span>
              <input
                type="date"
                value={milestone.dueDate}
                onChange={(e) =>
                  setMilestone({ ...milestone, dueDate: e.target.value })
                }
              />
            </label>
            <button className="primary-button">{copy[lang].save}</button>
          </form>
          <div className="milestone-list">
            {data.milestones.map((m) => (
              <article key={m.id}>
                <div>
                  <strong>{m.label}</strong>
                  <span>
                    {usd(money(m.amount))}
                    {m.percentage ? ` · ${m.percentage}%` : ""}
                  </span>
                  <small>{m.dueDate ? formatDate(m.dueDate, lang) : ""}</small>
                </div>
                <div className="row-actions">
                  <select
                    value={m.status}
                    onChange={async (e) => {
                      await api.updateMilestoneStatus({
                        id: m.id,
                        status: e.target.value as typeof m.status,
                      });
                      refresh();
                    }}
                  >
                    <option value="pending">
                      {lang === "es" ? "Pendiente" : "Pending"}
                    </option>
                    <option value="paid">{copy[lang].paid}</option>
                  </select>
                  {m.invoiceId ? (
                    <button
                      onClick={() =>
                        setScreen({
                          name: "invoicePreview",
                          invoiceId: m.invoiceId as number,
                        })
                      }
                    >
                      {lang === "es" ? "Ver factura" : "View invoice"}
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        const r = await api.invoiceMilestone({ id: m.id });
                        refresh();
                        setScreen({
                          name: "invoicePreview",
                          invoiceId: r.invoiceId,
                        });
                      }}
                    >
                      {lang === "es" ? "Crear factura" : "Create invoice"}
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

type ExpansionTab =
  | "losses"
  | "warranties"
  | "videos"
  | "crew"
  | "scanner"
  | "tax"
  | "suppliers"
  | "plans";
function ExpansionSuiteScreen({
  lang,
  settings,
  onBack,
  initialTab,
}: {
  lang: Lang;
  settings: Settings | null;
  onBack: () => void;
  initialTab?: ExpansionTab;
}) {
  const today = new Date().toLocaleDateString("en-CA");
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["expansion-suite", today],
    queryFn: () => api.getExpansionSuite({ today }),
  });
  const [tab] = useState<ExpansionTab>(initialTab ?? "warranties");
  const data = query.data;
  const refresh = () => qc.invalidateQueries({ queryKey: ["expansion-suite"] });
  const names: Record<ExpansionTab, string> =
    lang === "es"
      ? {
          losses: "Ganadas/perdidas",
          warranties: "Garantías",
          videos: "Videos",
          crew: "Horas",
          scanner: "Escáner",
          tax: "Impuestos",
          suppliers: "Proveedores",
          plans: "Cuidado del equipo",
        }
      : {
          losses: "Win/loss",
          warranties: "Warranties",
          videos: "Videos",
          crew: "Crew hours",
          scanner: "Scanner",
          tax: "Tax file download",
          suppliers: "Suppliers",
          plans: "Equipment upkeep",
        };
  return (
    <main className="page expansion-page">
      <PageHeader
        lang={lang}
        title={names[tab]}
        onBack={onBack}
      />
      {!data ? (
        <div className="loading-block" />
      ) : (
        <>
          {tab === "losses" && (
            <LossReport lang={lang} rows={data.lossReport} />
          )}{" "}
          {tab === "warranties" && (
            <WarrantyManager lang={lang} data={data} refresh={refresh} />
          )}{" "}
          {tab === "videos" && (
            <SlideshowManager
              lang={lang}
              data={data}
              settings={settings}
              refresh={refresh}
            />
          )}{" "}
          {tab === "crew" && (
            <CrewHoursReport lang={lang} rows={data.crewHours} />
          )}{" "}
          {tab === "scanner" && (
            <ScannerTool lang={lang} data={data} refresh={refresh} />
          )}{" "}
          {tab === "tax" && <TaxExport lang={lang} />}{" "}
          {tab === "suppliers" && (
            <SupplierManager lang={lang} data={data} refresh={refresh} />
          )}{" "}
          {tab === "plans" && (
            <MaintenanceManager lang={lang} data={data} refresh={refresh} />
          )}
        </>
      )}
    </main>
  );
}
function LossReport({
  lang,
  rows,
}: {
  lang: Lang;
  rows: Array<{ reason: string; count: number; value: number }>;
}) {
  const label = (r: string) =>
    ({
      price: lang === "es" ? "Precio muy alto" : "Price too high",
      timing: lang === "es" ? "Calendario" : "Timing",
      competitor: lang === "es" ? "Eligió competidor" : "Chose competitor",
      no_response: lang === "es" ? "Sin respuesta" : "No response",
      other: lang === "es" ? "Otro" : "Other",
    })[r] ?? r;
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <section className="toolkit-section">
      <div className="metric-hero">
        <span>
          {lang === "es" ? "Valor total perdido" : "Total value lost"}
        </span>
        <strong>{usd(total)}</strong>
        <small>
          {rows.reduce((s, r) => s + r.count, 0)}{" "}
          {lang === "es" ? "cotizaciones" : "quotes"}
        </small>
      </div>
      <div className="loss-bars">
        {rows.map((r) => (
          <article key={r.reason}>
            <div>
              <strong>{label(r.reason)}</strong>
              <span>
                {r.count} · {usd(r.value)}
              </span>
            </div>
            <progress
              max={Math.max(1, ...rows.map((x) => x.value))}
              value={r.value}
            />
          </article>
        ))}
      </div>
      <p className="privacy-note">
        {lang === "es"
          ? "Marca una cotización como Perdida en Hoy para registrar el motivo."
          : "Mark a quote Lost in Today to capture the reason."}
      </p>
    </section>
  );
}
function WarrantyManager({
  lang,
  data,
  refresh,
}: {
  lang: Lang;
  data: ApiResponse<typeof api, "getExpansionSuite">;
  refresh: () => void;
}) {
  const today = new Date().toLocaleDateString("en-CA");
  const [form, setForm] = useState({
    id: null as number | null,
    jobId: data.jobs[0]?.id ?? 0,
    terms: "",
    startDate: today,
    durationMonths: 12,
  });
  return (
    <section className="toolkit-section">
      <form
        className="compact-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!form.jobId) return;
          await api.saveWarranty(form);
          setForm({
            id: null,
            jobId: data.jobs[0]?.id ?? 0,
            terms: "",
            startDate: today,
            durationMonths: 12,
          });
          refresh();
        }}
      >
        <label>
          <span>{lang === "es" ? "Trabajo" : "Job"}</span>
          <select
            value={form.jobId}
            onChange={(e) =>
              setForm({ ...form, jobId: Number(e.target.value) })
            }
          >
            {data.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{lang === "es" ? "Términos" : "Terms"}</span>
          <textarea
            rows={3}
            value={form.terms}
            onChange={(e) => setForm({ ...form, terms: e.target.value })}
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
            <span>
              {lang === "es" ? "Duración (meses)" : "Duration (months)"}
            </span>
            <input
              type="number"
              min="1"
              max="240"
              value={form.durationMonths}
              onChange={(e) =>
                setForm({
                  ...form,
                  durationMonths: Number(e.target.value) || 1,
                })
              }
            />
          </label>
        </div>
        <button className="primary-button">
          {lang === "es" ? "Guardar garantía" : "Save warranty"}
        </button>
      </form>
      <div className="tool-records warranty-records">
        {data.warranties.map((w) => {
          const msg =
            lang === "es"
              ? `Hola ${w.clientName}, solo quería revisar cómo está todo antes de que venza la garantía el ${formatDate(w.expiryDate, lang)}. — ${w.jobLabel}`
              : `Hi ${w.clientName}, just checking how everything is holding up before the warranty expires on ${formatDate(w.expiryDate, lang)}. — ${w.jobLabel}`;
          return (
            <article key={w.id}>
              <div>
                <strong>{w.jobLabel}</strong>
                <span className={`warranty-status ${w.status}`}>
                  {w.status === "active"
                    ? lang === "es"
                      ? "Activa"
                      : "Active"
                    : w.status === "expiring"
                      ? lang === "es"
                        ? "Por vencer"
                        : "Expiring"
                      : lang === "es"
                        ? "Vencida"
                        : "Expired"}
                </span>
                <small>
                  {formatDate(w.startDate, lang)} →{" "}
                  {formatDate(w.expiryDate, lang)} · {w.durationMonths}{" "}
                  {lang === "es" ? "meses" : "months"}
                </small>
                <small>{w.terms || "—"}</small>
              </div>
              <div className="row-actions">
                <button
                  onClick={() =>
                    setForm({
                      id: w.id,
                      jobId: w.jobId,
                      terms: w.terms,
                      startDate: w.startDate,
                      durationMonths: w.durationMonths,
                    })
                  }
                >
                  {lang === "es" ? "Editar" : "Edit"}
                </button>
                {w.clientPhone && (
                  <a href={smsHref(w.clientPhone, msg)}>
                    {lang === "es" ? "Texto" : "Text"}
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
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
          const blob = new Blob([text], { type: "text/plain" });
          await nativeShare(
            blob,
            "crew-hours-week.txt",
            lang === "es" ? "Horas del equipo" : "Crew hours",
            text,
          );
        }}
      >
        <ShareIcon />
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
  data: ApiResponse<typeof api, "getExpansionSuite">;
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
  data: ApiResponse<typeof api, "getExpansionSuite">;
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
                {formatDate(p.nextDueDate, lang)} · {p.intervalMonths}{" "}
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
function TaxExport({ lang }: { lang: Lang }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const d = await api.getTaxExport({ year });
      const csv = [
        "Month,Type,Category,Date,Description,Amount",
        ...d.rows.map((r) =>
          [
            r.month,
            r.type,
            r.category,
            r.date,
            `\"${r.description.replace(/\"/g, '\"\"')}\"`,
            r.amount.toFixed(2),
          ].join(","),
        ),
      ].join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      await nativeShare(
        blob,
        `crewkat-tax-export-${year}.csv`,
        `${lang === "es" ? "Archivo para impuestos" : "Tax file download"} ${year}`,
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="toolkit-section">
      <div className="metric-hero">
        <span>
          {lang === "es"
            ? "Exportación para el contador"
            : "Accountant-ready export"}
        </span>
        <strong>{year}</strong>
        <small>
          {lang === "es"
            ? "Ingresos recibidos, gastos del negocio y materiales por mes y categoría"
            : "Payments received, business expenses, and job materials by month and category"}
        </small>
      </div>
      <label>
        <span>{lang === "es" ? "Año" : "Year"}</span>
        <input
          type="number"
          min="2000"
          max="2100"
          value={year}
          onChange={(e) =>
            setYear(Number(e.target.value) || new Date().getFullYear())
          }
        />
      </label>
      <button
        className="primary-button full-button"
        disabled={busy}
        onClick={() => void run()}
      >
        <ShareIcon />
        {busy
          ? lang === "es"
            ? "Preparando…"
            : "Preparing…"
          : lang === "es"
            ? "Crear y compartir CSV"
            : "Create & share CSV"}
      </button>
    </section>
  );
}

function ScannerTool({
  lang,
  data,
  refresh,
}: {
  lang: Lang;
  data: ApiResponse<typeof api, "getExpansionSuite">;
  refresh: () => void;
}) {
  const today = new Date().toLocaleDateString("en-CA");
  const [jobId, setJobId] = useState<number | null>(data.jobs[0]?.id ?? null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"receipt" | "contract" | "other">("receipt");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [vendor, setVendor] = useState("");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(today);
  const [category, setCategory] = useState("materials");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const process = async () => {
    if (!file || !title || (kind === "receipt" && (!expenseDate || !amount)))
      return;
    setBusy(true);
    setError("");
    try {
      const bitmap = await createImageBitmap(file);
      const max = 1800;
      const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const c = canvas.getContext("2d");
      if (!c) return;
      c.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const img = c.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < img.data.length; i += 4) {
        const r = img.data[i] ?? 0,
          g = img.data[i + 1] ?? 0,
          b = img.data[i + 2] ?? 0;
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const clean =
          gray > 225
            ? 255
            : gray < 45
              ? 18
              : Math.max(0, Math.min(255, (gray - 128) * 1.35 + 128));
        img.data[i] = clean;
        img.data[i + 1] = clean;
        img.data[i + 2] = clean;
      }
      c.putImageData(img, 0, 0);
      const jpeg = canvas.toDataURL("image/jpeg", 0.92);
      setPreview(jpeg);
      const pdf = new jsPDF({
        orientation: canvas.width > canvas.height ? "landscape" : "portrait",
        unit: "pt",
        format: "letter",
      });
      const pw = pdf.internal.pageSize.getWidth(),
        ph = pdf.internal.pageSize.getHeight(),
        ratio = Math.min((pw - 36) / canvas.width, (ph - 36) / canvas.height);
      pdf.addImage(
        jpeg,
        "JPEG",
        (pw - canvas.width * ratio) / 2,
        (ph - canvas.height * ratio) / 2,
        canvas.width * ratio,
        canvas.height * ratio,
        undefined,
        "FAST",
      );
      const blob = pdf.output("blob");
      const b64 = (await blobDataUrl(blob)).split(",")[1] ?? "";
      await api.saveScannedDocument({
        jobId,
        expenseId: null,
        title,
        kind,
        filename: `${safeName(title)}.pdf`,
        dataBase64: b64,
        expenseDate: kind === "receipt" ? expenseDate : "",
        vendor: kind === "receipt" ? vendor : "",
        amount: kind === "receipt" ? amount : "",
        category: kind === "receipt" ? category : "",
        note: kind === "receipt" ? note : "",
      });
      refresh();
      setFile(null);
      setTitle("");
      setVendor("");
      setAmount("");
      setExpenseDate(today);
      setCategory("materials");
      setNote("");
    } catch {
      setError(
        lang === "es"
          ? "No se pudo guardar el escaneo."
          : "Could not save the scan.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="toolkit-section">
      <p className="privacy-note">
        {lang === "es"
          ? "El escáner mejora el contraste y guarda un PDF limpio. Los recibos también crean un gasto del negocio enlazado."
          : "The scanner boosts contrast and saves a clean PDF. Receipt scans also create a linked business expense."}
      </p>
      <form
        className="compact-form"
        onSubmit={(e) => {
          e.preventDefault();
          void process();
        }}
      >
        <label>
          <span>{lang === "es" ? "Trabajo" : "Job"}</span>
          <select
            value={jobId ?? ""}
            onChange={(e) =>
              setJobId(e.target.value ? Number(e.target.value) : null)
            }
          >
            <option value="">{lang === "es" ? "General" : "General"}</option>
            {data.jobs.map((j) => (
              <option value={j.id} key={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </label>
        <div className="field-pair">
          <label>
            <span>{lang === "es" ? "Título" : "Title"}</span>
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            <span>{lang === "es" ? "Tipo" : "Type"}</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="receipt">
                {lang === "es" ? "Recibo" : "Receipt"}
              </option>
              <option value="contract">
                {lang === "es" ? "Contrato" : "Contract"}
              </option>
              <option value="other">{lang === "es" ? "Otro" : "Other"}</option>
            </select>
          </label>
        </div>
        {kind === "receipt" && (
          <>
            <div className="field-pair">
              <label>
                <span>
                  {lang === "es" ? "Fecha del gasto" : "Expense date"}
                </span>
                <input
                  required
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                />
              </label>
              <label>
                <span>{lang === "es" ? "Monto" : "Amount"}</span>
                <input
                  required
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            </div>
            <div className="field-pair">
              <label>
                <span>{lang === "es" ? "Proveedor" : "Vendor"}</span>
                <input
                  value={vendor}
                  onChange={(e) => setVendor(e.target.value)}
                />
              </label>
              <label>
                <span>{lang === "es" ? "Categoría" : "Category"}</span>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                />
              </label>
            </div>
            <label>
              <span>{lang === "es" ? "Nota" : "Note"}</span>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </>
        )}
        <label className="camera-button">
          <CameraIcon />
          {file?.name ??
            (lang === "es" ? "Capturar documento" : "Capture document")}
          <input
            className="sr-only"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {error && <p className="status error">{error}</p>}
        <button
          className="primary-button"
          disabled={
            busy ||
            !file ||
            !title ||
            (kind === "receipt" && (!expenseDate || !amount))
          }
        >
          {busy
            ? lang === "es"
              ? "Limpiando…"
              : "Cleaning…"
            : lang === "es"
              ? "Crear PDF limpio"
              : "Create clean PDF"}
        </button>
      </form>
      {preview && (
        <img
          className="scan-preview"
          src={preview}
          alt={lang === "es" ? "Vista previa del escaneo" : "Scan preview"}
        />
      )}
      <div className="tool-records">
        {data.scans.map((s) => (
          <article key={s.id}>
            <div>
              <strong>{s.title}</strong>
              <span>
                {s.kind} · {formatDate(s.createdAt.slice(0, 10), lang)}
                {s.expenseId
                  ? ` · ${lang === "es" ? "Gasto enlazado" : "Expense linked"}`
                  : ""}
              </span>
            </div>
            <a
              className="small-button"
              href={s.url}
              target="_blank"
              rel="noreferrer"
            >
              {lang === "es" ? "Abrir PDF" : "Open PDF"}
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
function SlideshowManager({
  lang,
  data,
  settings,
  refresh,
}: {
  lang: Lang;
  data: ApiResponse<typeof api, "getExpansionSuite">;
  settings: Settings | null;
  refresh: () => void;
}) {
  const [jobId, setJobId] = useState(data.jobs[0]?.id ?? 0);
  const [caption, setCaption] = useState("");
  const [branded, setBranded] = useState(true);
  const [busy, setBusy] = useState(false);
  const make = async () => {
    if (!jobId) return;
    setBusy(true);
    try {
      const detail = await api.getJob({ id: jobId });
      const job = detail.job;
      if (!job || detail.photos.length === 0) return;
      const ordered = [
        ...detail.photos.filter((p) => !p.excludeFromSocial),
      ].sort((a, b) => {
        const stage = { before: 0, during: 1, after: 2 };
        return (
          stage[a.stage] - stage[b.stage] ||
          a.capturedAt.localeCompare(b.capturedAt)
        );
      });
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 720;
      const c = canvas.getContext("2d");
      if (!c) return;
      const stream = canvas.captureStream(30);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      const done = new Promise<Blob>((resolve) => {
        recorder.onstop = () =>
          resolve(new Blob(chunks, { type: "video/webm" }));
      });
      recorder.start();
      for (const p of ordered) {
        const blob = await fetch(p.url).then((r) => r.blob());
        const img = await createImageBitmap(blob);
        for (let frame = 0; frame < 45; frame++) {
          c.fillStyle = "#101615";
          c.fillRect(0, 0, 720, 720);
          const scale = Math.max(720 / img.width, 720 / img.height);
          const sw = 720 / scale,
            sh = 720 / scale;
          c.drawImage(
            img,
            (img.width - sw) / 2,
            (img.height - sh) / 2,
            sw,
            sh,
            0,
            0,
            720,
            720,
          );
          c.fillStyle = "rgba(0,0,0,.58)";
          c.fillRect(0, 0, 720, 70);
          c.fillStyle = "#fff";
          c.font = "700 28px system-ui";
          c.fillText(p.stage.toUpperCase(), 28, 44);
          if (branded) {
            c.fillStyle = "rgba(0,0,0,.68)";
            c.fillRect(0, 650, 720, 70);
            c.fillStyle = "#fff";
            c.font = "700 22px system-ui";
            c.fillText(settings?.companyName || job.jobType, 24, 684);
            c.font = "16px system-ui";
            c.fillText(
              [settings?.licenseNumber, settings?.phone]
                .filter(Boolean)
                .join(" · "),
              24,
              707,
            );
          }
          await new Promise((r) => setTimeout(r, 33));
        }
        img.close();
      }
      recorder.stop();
      const video = await done;
      const filename = `${safeName(job.clientName)}-progress.webm`;
      const b64 = (await blobDataUrl(video)).split(",")[1] ?? "";
      await api.saveSlideshowVideo({
        jobId,
        caption,
        branded,
        filename,
        contentType: "video/webm",
        dataBase64: b64,
        photoIds: ordered.map((p) => p.id),
      });
      refresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="toolkit-section">
      <p className="privacy-note">
        {lang === "es"
          ? "Ordena automáticamente las fotos Antes → Durante → Después por fecha. El video se guarda aquí y compartir abre el menú del teléfono."
          : "Automatically orders Before → During → After photos by date. The video is saved here and Share opens your phone’s share sheet."}
      </p>
      <form
        className="compact-form"
        onSubmit={(e) => {
          e.preventDefault();
          void make();
        }}
      >
        <label>
          <span>{lang === "es" ? "Trabajo" : "Job"}</span>
          <select
            value={jobId}
            onChange={(e) => setJobId(Number(e.target.value))}
          >
            {data.jobs.map((j) => (
              <option value={j.id} key={j.id}>
                {j.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{lang === "es" ? "Descripción" : "Caption"}</span>
          <textarea
            rows={3}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={branded}
            onChange={(e) => setBranded(e.target.checked)}
          />
          <span>
            {lang === "es"
              ? "Agregar marca de la empresa"
              : "Add company branding"}
          </span>
        </label>
        <button className="primary-button" disabled={busy || !jobId}>
          {busy
            ? lang === "es"
              ? "Creando video…"
              : "Creating video…"
            : lang === "es"
              ? "Crear y guardar video"
              : "Create & save video"}
        </button>
      </form>
      <div className="video-grid">
        {data.videos.map((v) => (
          <article key={v.id}>
            <video controls preload="metadata" src={v.url} />
            <div>
              <strong>{v.jobLabel}</strong>
              <small>
                {v.caption || formatDate(v.createdAt.slice(0, 10), lang)}
              </small>
              <button
                className="small-button"
                onClick={async () => {
                  const blob = await fetch(v.url).then((r) => r.blob());
                  await nativeShare(blob, v.filename, v.jobLabel, v.caption);
                }}
              >
                <ShareIcon />
                {lang === "es" ? "Compartir / guardar" : "Share / save"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PortalOwnerPanel({ lang, jobId }: { lang: Lang; jobId: number }) {
  const qc = useQueryClient();
  const [expiryDays, setExpiryDays] = useState<PortalExpiryDays>(90);
  const [neverConfirmed, setNeverConfirmed] = useState(false);
  const [issuedToken, setIssuedToken] = useState("");
  const [issuedRoute, setIssuedRoute] = useState("");
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState("");
  const t = lang === "es"
    ? {
        title: "Portal del cliente",
        intro: "Comparta un enlace privado para que el cliente vea avances, citas, selecciones y órdenes de cambio.",
        loading: "Cargando información del enlace…",
        unavailable: "No se pudo cargar la información del enlace.",
        noLink: "Este trabajo todavía no tiene un enlace activo.",
        linkEnding: "Enlace terminado en",
        expires: "Vence",
        never: "Nunca — no recomendado",
        viewed: (count: number) => `Visto ${count} ${count === 1 ? "vez" : "veces"}`,
        lastViewed: "Última vista",
        neverViewed: "Nunca",
        expired: "Vencido — cree un enlace nuevo antes de compartirlo.",
        expiryLabel: "Vencimiento del próximo enlace",
        days30: "30 días",
        days90: "90 días (predeterminado)",
        days365: "365 días",
        neverOption: "Nunca",
        expiryHelp: "Esta opción se usará al crear o rotar el enlace.",
        neverWarning: "Un enlace sin vencimiento seguirá funcionando hasta que lo revoque. No se recomienda.",
        neverConfirm: "Entiendo el riesgo y quiero un enlace sin vencimiento.",
        create: "Crear enlace",
        creating: "Creando…",
        copy: "Copiar enlace",
        copied: "Enlace copiado.",
        copyUnavailable: "Por seguridad, el enlace completo solo aparece después de crearlo o rotarlo.",
        rotate: "Rotar",
        rotating: "Rotando…",
        revoke: "Revocar",
        revoking: "Revocando…",
        code: "Código del portal — se muestra una sola vez",
        issued: "Enlace nuevo listo. Cópielo ahora; el código solo se muestra una vez.",
        rotated: "Enlace rotado. El enlace anterior dejó de funcionar; copie el nuevo ahora.",
        revoked: "Enlace revocado.",
        failed: "No se pudo actualizar el enlace. Inténtelo de nuevo.",
      }
    : {
        title: "Client portal",
        intro: "Share a private link so the client can see progress, visits, selections, and change orders.",
        loading: "Loading link information…",
        unavailable: "Link information could not be loaded.",
        noLink: "This job does not have an active link yet.",
        linkEnding: "Link ending in",
        expires: "Expires",
        never: "Never — not recommended",
        viewed: (count: number) => `Viewed ${count} ${count === 1 ? "time" : "times"}`,
        lastViewed: "Last viewed",
        neverViewed: "Never",
        expired: "Expired — create a new link before sharing it.",
        expiryLabel: "Next link expiration",
        days30: "30 days",
        days90: "90 days (default)",
        days365: "365 days",
        neverOption: "Never",
        expiryHelp: "This choice is used when creating or rotating the link.",
        neverWarning: "A link with no expiration will work until you revoke it. This is not recommended.",
        neverConfirm: "I understand the risk and want a link with no expiration.",
        create: "Create link",
        creating: "Creating…",
        copy: "Copy link",
        copied: "Link copied.",
        copyUnavailable: "For security, the full link is available only right after creation or rotation.",
        rotate: "Rotate",
        rotating: "Rotating…",
        revoke: "Revoke",
        revoking: "Revoking…",
        code: "Portal code — shown once",
        issued: "New link ready. Copy it now; the code is shown only once.",
        rotated: "Link rotated. The previous link no longer works; copy the new one now.",
        revoked: "Link revoked.",
        failed: "The link could not be updated. Try again.",
      };
  const info = useQuery({
    queryKey: ["portal-link", jobId],
    queryFn: () => api.getPortalLinkInfo({ jobId }),
    retry: false,
  });
  const link = info.data?.link ?? null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["portal-link", jobId] });
  const rememberIssuedLink = (result: { token: string; route: string }, message: string) => {
    setIssuedToken(result.token);
    setIssuedRoute(result.route);
    setCopied(false);
    setMsg(message);
    void refresh();
  };
  const create = useMutation({
    mutationFn: () => api.createPortalLink({ jobId, expiresInDays: expiryDays }),
    onSuccess: (result) => rememberIssuedLink(result, t.issued),
    onError: () => setMsg(t.failed),
  });
  const rotate = useMutation({
    mutationFn: () => api.rotatePortalLink({ jobId, expiresInDays: expiryDays }),
    onSuccess: (result) => rememberIssuedLink(result, t.rotated),
    onError: () => setMsg(t.failed),
  });
  const revoke = useMutation({
    mutationFn: () => api.revokePortalLink({ jobId }),
    onSuccess: () => {
      setIssuedToken("");
      setIssuedRoute("");
      setCopied(false);
      setMsg(t.revoked);
      void refresh();
    },
    onError: () => setMsg(t.failed),
  });
  const requiresNeverConfirmation = expiryDays === 0 && !neverConfirmed;
  const busy = create.isPending || rotate.isPending || revoke.isPending;
  const shareUrl = issuedRoute ? `https://crewkat.com/${issuedRoute}` : "";
  const formatPortalDateTime = (value: string) =>
    new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  return (
    <details className="action-details portal-owner">
      <summary>{t.title}</summary>
      <div className="compact-form portal-link-panel">
        <p>{t.intro}</p>
        {info.isLoading && <p className="dim">{t.loading}</p>}
        {info.isError && <p className="status error">{t.unavailable}</p>}
        {!info.isLoading && !info.isError && !link && (
          <p className="portal-link-empty">{t.noLink}</p>
        )}
        {link && (
          <div className={`portal-link-facts${link.expired ? " is-expired" : ""}`}>
            {link.expired && <strong className="portal-link-expired">{t.expired}</strong>}
            <div>
              <span>{t.linkEnding}</span>
              <strong className="portal-link-hint">…{link.hint}</strong>
            </div>
            <div>
              <span>{t.expires}</span>
              <strong>{link.expiresAt ? formatDate(link.expiresAt.slice(0, 10), lang) : t.never}</strong>
            </div>
            <div>
              <span>{t.viewed(link.viewCount)}</span>
              <strong>{t.lastViewed}: {link.lastViewedAt ? formatPortalDateTime(link.lastViewedAt) : t.neverViewed}</strong>
            </div>
          </div>
        )}
        <label>
          <span>{t.expiryLabel}</span>
          <select
            value={expiryDays}
            onChange={(event) => {
              const value = event.target.value;
              const next: PortalExpiryDays = value === "30" ? 30 : value === "365" ? 365 : value === "0" ? 0 : 90;
              setExpiryDays(next);
              setNeverConfirmed(false);
            }}
          >
            <option value={30}>{t.days30}</option>
            <option value={90}>{t.days90}</option>
            <option value={365}>{t.days365}</option>
            <option value={0}>{t.neverOption}</option>
          </select>
          <small>{t.expiryHelp}</small>
        </label>
        {expiryDays === 0 && (
          <div className="portal-never-warning" role="group" aria-label={t.neverWarning}>
            <strong>{t.neverWarning}</strong>
            <label className="check-row">
              <input
                type="checkbox"
                checked={neverConfirmed}
                onChange={(event) => setNeverConfirmed(event.target.checked)}
              />
              <span>{t.neverConfirm}</span>
            </label>
          </div>
        )}
        {!link && !info.isLoading && (
          <button
            type="button"
            className="primary-button"
            onClick={() => create.mutate()}
            disabled={busy || requiresNeverConfirmation}
          >
            {create.isPending ? t.creating : t.create}
          </button>
        )}
        {issuedToken && (
          <label className="portal-issued-code">
            <span>{t.code}</span>
            <input readOnly value={issuedToken} onFocus={(event) => event.target.select()} />
          </label>
        )}
        {link && (
          <div className="portal-link-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={!shareUrl || busy}
              title={shareUrl ? undefined : t.copyUnavailable}
              onClick={async () => {
                if (!shareUrl) return;
                const ok = await copyText(shareUrl);
                setCopied(ok);
                if (ok) setMsg(t.copied);
              }}
            >
              {copied ? `✓ ${t.copy}` : t.copy}
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy || requiresNeverConfirmation}
              onClick={() => rotate.mutate()}
            >
              {rotate.isPending ? t.rotating : t.rotate}
            </button>
            <button
              type="button"
              className="secondary-button danger-button"
              disabled={busy}
              onClick={() => revoke.mutate()}
            >
              {revoke.isPending ? t.revoking : t.revoke}
            </button>
          </div>
        )}
        {link && !shareUrl && <small className="dim">{t.copyUnavailable}</small>}
        {msg && <p className="status">{msg}</p>}
      </div>
    </details>
  );
}
type ClientDoc = ApiResponse<typeof api, "resolveDocumentLink">;
type DocumentLinkKind = "invoice" | "quote" | "contract" | "change_order";

async function buildClientSignedContractPdf(
  doc: ClientDoc,
  signatureBase64: string,
  signerName: string,
  lang: Lang,
) {
  const pdf = new jsPDF({ unit: "pt", format: "letter" });
  const w = pdf.internal.pageSize.getWidth();
  const margin = 42;
  const c = doc.company;
  pdf.setFillColor(23, 26, 28);
  pdf.rect(0, 0, w, 56, "F");
  const logo = await loadImageDataUrl(c.logoUrl);
  if (logo) {
    try {
      pdf.addImage(
        logo,
        logo.startsWith("data:image/png") ? "PNG" : "JPEG",
        margin,
        12,
        40,
        25,
        undefined,
        "FAST",
      );
    } catch {
      /* text branding stays */
    }
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(9);
  pdf.setTextColor(255, 255, 255);
  pdf.text(c.name || "", w - margin, 22, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(214, 218, 217);
  const bits = [c.phone, c.licenseNumber, c.website].filter(Boolean);
  if (bits.length) pdf.text(bits.join("  ·  "), w - margin, 33, { align: "right" });
  let y = 82;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(17);
  pdf.setTextColor(24, 32, 30);
  const titleLines = pdf.splitTextToSize(doc.title, w - margin * 2) as string[];
  pdf.text(titleLines, margin, y);
  y += titleLines.length * 20 + 6;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(70, 78, 76);
  if (doc.clientName) {
    pdf.text(doc.clientName, margin, y);
    y += 13;
  }
  const sub = [doc.jobType, doc.jobAddress].filter((s) => s && s.trim()).join("  ·  ");
  if (sub) {
    const subLines = (pdf.splitTextToSize(sub, w - margin * 2) as string[]).slice(0, 2);
    pdf.text(subLines, margin, y);
    y += subLines.length * 11 + 8;
  }
  if (doc.description) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor(24, 32, 30);
    const descLines = pdf.splitTextToSize(doc.description, w - margin * 2) as string[];
    pdf.text(descLines, margin, y);
    y += descLines.length * 13 + 6;
  }
  if (doc.bodyText) {
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    pdf.setTextColor(24, 32, 30);
    const bodyLines = pdf.splitTextToSize(doc.bodyText, w - margin * 2) as string[];
    pdf.text(bodyLines, margin, y);
    y += bodyLines.length * 12 + 10;
  }
  if (doc.amount && money(doc.amount) > 0) {
    pdf.setFillColor(23, 26, 28);
    pdf.rect(margin, y - 12, 210, 22, "F");
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(12);
    pdf.setTextColor(255, 255, 255);
    pdf.text(
      `${lang === "es" ? "Monto" : "Amount"}: ${usd(money(doc.amount))}`,
      margin + 8,
      y + 3,
    );
    y += 30;
  }
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(24, 32, 30);
  pdf.text(lang === "es" ? "Firma del cliente" : "Client signature", margin, y);
  y += 14;
  try {
    pdf.addImage(
      `data:image/png;base64,${signatureBase64}`,
      "PNG",
      margin,
      y,
      150,
      46,
      undefined,
      "FAST",
    );
  } catch {
    /* typed name below still records the signature */
  }
  y += 56;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.text(signerName, margin, y);
  y += 14;
  pdf.setFontSize(8);
  pdf.setTextColor(70, 78, 76);
  pdf.text(new Date().toLocaleString(lang === "es" ? "es-US" : "en-US"), margin, y);
  return pdf.output("blob");
}

function ClientDocumentScreen({ token }: { token: string }) {
  const [lang, setLang] = useState<Lang>("en");
  const t = copy[lang];
  const [signerName, setSignerName] = useState("");
  const [signature, setSignature] = useState("");
  const [signError, setSignError] = useState("");
  const q = useQuery({
    queryKey: ["client-document", token],
    queryFn: () =>
      api.resolveDocumentLink({
        token,
        userAgent:
          typeof navigator === "undefined"
            ? ""
            : navigator.userAgent.slice(0, 300),
      }),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const sign = useMutation({
    mutationFn: async () => {
      const doc = q.data;
      if (!doc) throw new Error(t.linkInvalid);
      const name = signerName.trim();
      if (!name) throw new Error(t.required);
      if (!signature) throw new Error(t.signatureDrawHint);
      const pdfBlob = await buildClientSignedContractPdf(doc, signature, name, lang);
      const pdfDataUrl = await blobDataUrl(pdfBlob);
      return api.submitDocumentSignature({
        token,
        signerName: name,
        signatureDataBase64: signature,
        signedPdfDataBase64: pdfDataUrl.split(",")[1] ?? "",
        userAgent:
          typeof navigator === "undefined"
            ? ""
            : navigator.userAgent.slice(0, 300),
      });
    },
    onSuccess: () => {
      setSignError("");
      q.refetch();
    },
    onError: (e) => setSignError(e instanceof Error ? e.message : t.linkInvalid),
  });
  const langToggle = (
    <div className="client-lang-toggle">
      <button
        type="button"
        className={lang === "en" ? "active" : ""}
        onClick={() => setLang("en")}
      >
        EN
      </button>
      <button
        type="button"
        className={lang === "es" ? "active" : ""}
        onClick={() => setLang("es")}
      >
        ES
      </button>
    </div>
  );
  if (q.isLoading)
    return (
      <main className="page public-page">
        {langToggle}
        <div className="loading-block" />
      </main>
    );
  if (q.isError || !q.data)
    return (
      <main className="page public-page">
        {langToggle}
        <section className="empty-state">
          <h1>{t.linkInvalid}</h1>
          <p>{t.linkInvalidHint}</p>
        </section>
      </main>
    );
  const doc = q.data;
  const c = doc.company;
  const financialKind = doc.kind === "invoice" || doc.kind === "quote" ? doc.kind : null;
  const previewDoc: FinancialDocument | null = financialKind
    ? {
        id: doc.documentId,
        clientName: doc.clientName,
        jobAddress: doc.jobAddress,
        jobType: doc.jobType,
        lineItems: doc.lineItems,
        subtotal: doc.subtotal,
        discountType: "fixed",
        discountValue: "0",
        taxType: "fixed",
        taxValue: "0",
        total: doc.total,
        footnote: doc.footnote,
        theme: "classic",
        font: "helvetica",
        accentColor: "#1f5a4a",
        showTaxLine: false,
        showDiscountLine: false,
        showPaidLine: false,
        showPaymentTerms: false,
        showFooterNotes: !!doc.footnote,
        showLogo: !!c.logoUrl,
        showCompanyInfo: true,
        customizeJson: JSON.stringify(defaultDocumentCustomize(financialKind, lang)),
      }
    : null;
  const previewSettings = {
    logoUrl: c.logoUrl,
    companyName: c.name,
    phone: c.phone,
    email: c.email,
    website: c.website,
    licenseNumber: c.licenseNumber,
    address: "",
  } as unknown as Settings;
  return (
    <main className="page public-page client-doc-page">
      {langToggle}
      <header className="client-doc-company">
        {c.logoUrl && <img src={c.logoUrl} alt={c.name} />}
        <div>
          <strong>{c.name}</strong>
          <small>
            {[c.phone, c.licenseNumber].filter(Boolean).join(" · ")}
          </small>
        </div>
      </header>
      {previewDoc && financialKind ? (
        <QuotePaper
          quote={previewDoc}
          settings={previewSettings}
          lang={lang}
          kind={financialKind}
        />
      ) : (
        <article className="quote-paper">
          <div className="quote-paper-title-row">
            <h2>{doc.title}</h2>
          </div>
          <section className="quote-paper-client">
            <strong>
              {t.forLabel}: {doc.clientName || "—"}
            </strong>
            <span>
              {[doc.jobType, doc.jobAddress].filter((s) => s && s.trim()).join(" · ")}
            </span>
          </section>
          {doc.description && (
            <p className="client-doc-description">{doc.description}</p>
          )}
          {doc.bodyText && (
            <div className="client-doc-body">{doc.bodyText}</div>
          )}
          {doc.amount && money(doc.amount) > 0 && (
            <p className="client-doc-amount">
              {lang === "es" ? "Monto" : "Amount"}: {usd(money(doc.amount))}
            </p>
          )}
          <p className="dim small">
            {doc.contractorSignerName}
            {doc.dateValue ? ` · ${formatDate(doc.dateValue, lang)}` : ""}
          </p>
        </article>
      )}
      {doc.signable && !doc.alreadySigned && (
        <section className="client-sign-section">
          <h2>{t.signHere}</h2>
          <label>
            <span>{t.signerName}</span>
            <input
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder={t.signerNamePlaceholder}
              autoComplete="name"
            />
          </label>
          <p className="dim">{t.signatureDrawHint}</p>
          <SignaturePad
            label={t.signDocument}
            clearLabel={t.clear}
            onChange={setSignature}
          />
          {signError && <p className="status error">{signError}</p>}
          <button
            type="button"
            className="primary-button"
            disabled={sign.isPending || !signerName.trim() || !signature}
            onClick={() => sign.mutate()}
          >
            {sign.isPending ? t.signing : t.signAndFinish}
          </button>
          <p className="dim small">{t.linkSecureNote}</p>
        </section>
      )}
      {doc.signable && doc.alreadySigned && (
        <section className="empty-state">
          <h2>✓ {t.alreadySigned}</h2>
          <p>{t.signedThanks}</p>
        </section>
      )}
    </main>
  );
}

function ViewedBadge({
  lang,
  kind,
  id,
}: {
  lang: Lang;
  kind: DocumentLinkKind;
  id: number;
}) {
  const t = copy[lang];
  const info = useQuery({
    queryKey: ["document-link", kind, id],
    queryFn: () => api.getDocumentLinkInfo({ kind, id }),
  });
  const link = info.data?.link;
  if (!link) return null;
  const viewed = link.viewCount > 0;
  return (
    <span
      className={`viewed-badge${viewed ? " is-viewed" : ""}`}
      title={
        viewed && link.firstViewedAt
          ? `${t.firstViewed}: ${formatDate(link.firstViewedAt.slice(0, 10), lang)}`
          : t.notViewed
      }
    >
      <span aria-hidden="true">👁</span>{" "}
      {viewed
        ? `${t.viewed}${link.viewCount > 1 ? ` · ${link.viewCount}` : ""}`
        : t.notViewed}
    </span>
  );
}

function DocumentLinkPanel({
  lang,
  kind,
  id,
}: {
  lang: Lang;
  kind: DocumentLinkKind;
  id: number;
}) {
  const t = copy[lang];
  const qc = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const info = useQuery({
    queryKey: ["document-link", kind, id],
    queryFn: () => api.getDocumentLinkInfo({ kind, id }),
  });
  const link = info.data?.link ?? null;
  const refresh = () =>
    qc.invalidateQueries({ queryKey: ["document-link", kind, id] });
  const create = useMutation({
    mutationFn: () => api.createDocumentLink({ kind, id }),
    onSuccess: (res) => {
      setToken(res.token);
      setCopied(false);
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: () => api.revokeDocumentLink({ kind, id }),
    onSuccess: () => {
      setToken(null);
      refresh();
    },
  });
  const url = token
    ? `${window.location.origin}${window.location.pathname}#doc=${token}`
    : null;
  const copyLink = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(true);
  };
  return (
    <details className="doc-link-panel">
      <summary>
        🔗 {t.clientLink}
        {link && link.viewCount > 0 ? ` · 👁 ${t.viewed}` : ""}
      </summary>
      <div className="doc-link-body">
        <p className="dim">{t.clientLinkIntro}</p>
        {link ? (
          <>
            <p className="doc-link-status">
              {link.viewCount > 0
                ? `👁 ${t.viewed} · ${link.viewCount} ${t.viewCount}`
                : `👁 ${t.notViewed}`}
              {` · ${t.linkExpires}: ${formatDate(link.expiresAt.slice(0, 10), lang)}`}
            </p>
            {url && (
              <div className="doc-link-url">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.target.select()}
                  aria-label={t.copyClientLink}
                />
                <button type="button" className="btn" onClick={copyLink}>
                  {copied ? `✓ ${t.linkCopied}` : t.copyClientLink}
                </button>
              </div>
            )}
            {url && <p className="dim small">{t.linkCopyOnce}</p>}
            <div className="doc-link-actions">
              <button
                type="button"
                className="btn"
                disabled={create.isPending}
                onClick={() => create.mutate()}
              >
                {t.resendClientLink}
              </button>
              <button
                type="button"
                className="btn danger"
                disabled={revoke.isPending}
                onClick={() => {
                  if (window.confirm(t.revokeConfirm)) revoke.mutate();
                }}
              >
                {t.revokeClientLink}
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className="btn primary"
            disabled={create.isPending}
            onClick={() => create.mutate()}
          >
            {t.createClientLink}
          </button>
        )}
      </div>
    </details>
  );
}

function ClientPortalScreen({ lang, token }: { lang: Lang; token: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["client-portal", token],
    queryFn: () => api.getPortalData({ token }),
    retry: false,
  });
  const [signer, setSigner] = useState("");
  const [sig, setSig] = useState("");
  const [note, setNote] = useState("");
  if (q.isLoading)
    return (
      <main className="page public-page">
        <div className="loading-block" />
      </main>
    );
  if (q.isError || !q.data) {
    const errorMessage = q.error instanceof Error ? q.error.message : String(q.error ?? "");
    const expired = errorMessage.toLowerCase().includes("has expired");
    return (
      <main className="page public-page">
        <section className="empty-state">
          {expired ? (
            <>
              <h1>{lang === "es" ? "Enlace expirado" : "Link expired"}</h1>
              <p>
                {lang === "es"
                  ? "Este enlace ha expirado. Solicite un enlace nuevo a su contratista."
                  : "This link has expired. Ask your contractor for a new one."}
              </p>
            </>
          ) : (
            <>
              <h1>
                {lang === "es"
                  ? "Este enlace ya no está activo"
                  : "This link is no longer active"}
              </h1>
              <p>
                {lang === "es"
                  ? "Solicite un enlace nuevo a su contratista."
                  : "Ask your contractor for a new link."}
              </p>
            </>
          )}
        </section>
      </main>
    );
  }
  const d = q.data;
  const stage = (s: string) =>
    s === "before"
      ? lang === "es"
        ? "Antes"
        : "Before"
      : s === "during"
        ? lang === "es"
          ? "Durante"
          : "During"
        : lang === "es"
          ? "Después"
          : "After";
  return (
    <main className="page public-page">
      <header className="public-hero">
        <p>{d.job.jobType}</p>
        <h1>{lang === "es" ? "Su proyecto" : "Your project"}</h1>
        <span>{d.job.jobAddress}</span>
      </header>
      <section className="portal-section">
        <h2>{lang === "es" ? "Fotos de avance" : "Progress photos"}</h2>
        {(["before", "during", "after"] as const).map((s) => (
          <div key={s}>
            <h3>{stage(s)}</h3>
            <div className="photo-grid">
              {d.photos
                .filter((p) => p.stage === s)
                .map((p) => (
                  <figure key={p.id}>
                    <img src={p.url} alt={p.caption || stage(s)} />
                    {p.caption && <figcaption>{p.caption}</figcaption>}
                  </figure>
                ))}
            </div>
          </div>
        ))}
      </section>
      <section className="portal-section">
        <h2>{lang === "es" ? "Próximas visitas" : "Upcoming visits"}</h2>
        {d.appointments.map((a) => (
          <article className="tool-record" key={a.id}>
            <strong>
              {new Intl.DateTimeFormat(lang === "es" ? "es-US" : "en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(a.startsAt))}
            </strong>
            <span>{a.notes}</span>
          </article>
        ))}
        {!d.appointments.length && (
          <p>
            {lang === "es"
              ? "No hay visitas programadas."
              : "No visits scheduled."}
          </p>
        )}
      </section>
      <section className="portal-section">
        <h2>{lang === "es" ? "Selecciones" : "Selections"}</h2>
        {d.selections.map((s) => (
          <article className="tool-record" key={s.id}>
            <strong>
              {s.category}: {s.item}
            </strong>
            <span>{s.vendor}</span>
            <div className="row-actions">
              <button
                onClick={async () => {
                  await api.portalUpdateSelection({
                    token,
                    selectionId: s.id,
                    status: "approved",
                  });
                  qc.invalidateQueries({ queryKey: ["client-portal", token] });
                }}
              >
                {lang === "es" ? "Aprobar" : "Approve"}
              </button>
              <button
                onClick={async () => {
                  await api.portalUpdateSelection({
                    token,
                    selectionId: s.id,
                    status: "rejected",
                  });
                  qc.invalidateQueries({ queryKey: ["client-portal", token] });
                }}
              >
                {lang === "es" ? "Rechazar" : "Decline"}
              </button>
            </div>
            <small>{s.approvalStatus}</small>
          </article>
        ))}
      </section>
      <section className="portal-section">
        <h2>{lang === "es" ? "Órdenes de cambio" : "Change orders"}</h2>
        {d.changeOrders.map((o) => (
          <details className="action-details" key={o.id}>
            <summary>
              {o.title} · {usd(money(o.amount))}
            </summary>
            <p>{o.description}</p>
            {o.clientSignedAt ? (
              <p className="status">
                {lang === "es" ? "Firmada por" : "Signed by"}{" "}
                {o.clientSignerName}
              </p>
            ) : (
              <div className="compact-form">
                <label>
                  <span>
                    {lang === "es" ? "Nombre del firmante" : "Signer name"}
                  </span>
                  <input
                    value={signer}
                    onChange={(e) => setSigner(e.target.value)}
                  />
                </label>
                <SignaturePad
                  label={lang === "es" ? "Firma" : "Signature"}
                  clearLabel={lang === "es" ? "Borrar" : "Clear"}
                  onChange={setSig}
                />
                <label>
                  <span>
                    {lang === "es" ? "Nota opcional" : "Optional note"}
                  </span>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={!signer || !sig}
                  onClick={async () => {
                    await api.portalSignChangeOrder({
                      token,
                      documentId: o.id,
                      signerName: signer,
                      signatureDataBase64: sig,
                    });
                    setSigner("");
                    setSig("");
                    setNote("");
                    qc.invalidateQueries({
                      queryKey: ["client-portal", token],
                    });
                  }}
                >
                  {lang === "es" ? "Firmar orden" : "Sign change order"}
                </button>
              </div>
            )}
          </details>
        ))}
      </section>
    </main>
  );
}
function BookingRequestScreen({ lang }: { lang: Lang }) {
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    address: "",
    serviceType: "",
    projectDetails: "",
    preferredContactTime: "",
    company: "",
  });
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const submit = useMutation({
    mutationFn: () => api.submitEstimateRequest(form),
    onSuccess: () => setDone(true),
    onError: () =>
      setError(
        lang === "es"
          ? "Revise la información e inténtelo de nuevo."
          : "Check the information and try again.",
      ),
  });
  if (done)
    return (
      <main className="page public-page">
        <section className="empty-state">
          <CheckIcon />
          <h1>{lang === "es" ? "Solicitud recibida" : "Request received"}</h1>
          <p>
            {lang === "es"
              ? "Nos comunicaremos con usted pronto."
              : "We’ll be in touch soon."}
          </p>
        </section>
      </main>
    );
  return (
    <main className="page public-page">
      <header className="public-hero">
        <h1>
          {lang === "es" ? "Solicite un estimado" : "Request an estimate"}
        </h1>
        <p>
          {lang === "es"
            ? "Cuéntenos sobre su proyecto."
            : "Tell us about your project."}
        </p>
      </header>
      <form
        className="job-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError("");
          submit.mutate();
        }}
      >
        <label>
          <span>{lang === "es" ? "Nombre" : "Name"} *</span>
          <input
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <div className="field-pair">
          <label>
            <span>{lang === "es" ? "Teléfono" : "Phone"} *</span>
            <input
              required
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label>
            <span>{lang === "es" ? "Correo electrónico" : "Email"}</span>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
        </div>
        <label>
          <span>
            {lang === "es" ? "Dirección del proyecto" : "Project address"}
          </span>
          <input
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </label>
        <label>
          <span>{lang === "es" ? "Tipo de servicio" : "Service type"} *</span>
          <input
            required
            value={form.serviceType}
            onChange={(e) => setForm({ ...form, serviceType: e.target.value })}
          />
        </label>
        <label>
          <span>
            {lang === "es" ? "Detalles del proyecto" : "Project details"} *
          </span>
          <textarea
            required
            rows={5}
            value={form.projectDetails}
            onChange={(e) =>
              setForm({ ...form, projectDetails: e.target.value })
            }
          />
        </label>
        <label>
          <span>
            {lang === "es" ? "Mejor hora para contactar" : "Best contact time"}
          </span>
          <input
            value={form.preferredContactTime}
            onChange={(e) =>
              setForm({ ...form, preferredContactTime: e.target.value })
            }
          />
        </label>
        <label className="honeypot" aria-hidden="true">
          <span>Website</span>
          <input
            tabIndex={-1}
            autoComplete="off"
            value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
        </label>
        {error && <p className="status error">{error}</p>}
        <button
          className="primary-button sticky-submit"
          disabled={submit.isPending}
        >
          {submit.isPending
            ? lang === "es"
              ? "Enviando…"
              : "Sending…"
            : lang === "es"
              ? "Enviar solicitud"
              : "Send request"}
        </button>
      </form>
    </main>
  );
}

type ToolboxTab =
  "loan" | "materials" | "angle" | "convert" | "area" | "yards" | "board" | "drywall" | "roofing" | "tile" | "margin" | "paint" | "flooring" | "fence" | "block" | "gravel" | "stairs" | "insulation" | "gutter" | "rate" | "punchlist";
type ToolHistoryEntry = { id: number; value: string };

function useToolHistory(key: ToolboxTab) {
  const storageKey = `crewkat-tool-history-${key}`;
  const [entries, setEntries] = useState<ToolHistoryEntry[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]") as ToolHistoryEntry[];
      return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
    } catch { return []; }
  });
  const add = (value: string) => {
    const next = [{ id: Date.now(), value }, ...entries.filter((entry) => entry.value !== value)].slice(0, 5);
    setEntries(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  };
  return { entries, add };
}

function ResultHistory({ lang, tool, value }: { lang: Lang; tool: ToolboxTab; value: string }) {
  const { entries, add } = useToolHistory(tool);
  const [copied, setCopied] = useState<number | null>(null);
  const copyResult = async (entry: ToolHistoryEntry) => {
    try { await navigator.clipboard.writeText(entry.value); }
    catch {
      const area = document.createElement("textarea"); area.value = entry.value; document.body.appendChild(area); area.select(); document.execCommand("copy"); area.remove();
    }
    setCopied(entry.id);
    window.setTimeout(() => setCopied(null), 1300);
  };
  return <section className="result-history" aria-label={lang === "es" ? "Resultados recientes" : "Recent results"}>
    <header><div><strong>{lang === "es" ? "Resultados recientes" : "Recent results"}</strong><small>{lang === "es" ? "Toca un resultado para copiarlo" : "Tap a result to copy it"}</small></div><button type="button" onClick={() => add(value)}>{lang === "es" ? "Guardar" : "Save result"}</button></header>
    {entries.length === 0 ? <p>{lang === "es" ? "Guarda un cálculo para verlo aquí." : "Save a calculation to keep it here."}</p> : <div>{entries.map((entry) => <button type="button" key={entry.id} onClick={() => void copyResult(entry)}><span>{entry.value}</span><small>{copied === entry.id ? (lang === "es" ? "Copiado" : "Copied") : (lang === "es" ? "Copiar" : "Copy")}</small></button>)}</div>}
  </section>;
}

function NumInput({
  label,
  value,
  onChange,
  step = "any",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min="0"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}
function ToolboxScreen({ lang, onBack, initialTab }: { lang: Lang; onBack: () => void; initialTab?: ToolboxTab }) {
  const tab = initialTab ?? "loan";
  const labels: Record<ToolboxTab, string> = {
    loan: lang === "es" ? "Préstamo" : "Loan payment",
    materials: lang === "es" ? "Materiales" : "Material guide",
    angle: lang === "es" ? "Ángulos" : "Angles",
    convert: lang === "es" ? "Convertir" : "Unit converter",
    area: lang === "es" ? "Medidas" : "Measurements",
    yards: lang === "es" ? "Concreto" : "Concrete",
    board: lang === "es" ? "Madera" : "Lumber",
    drywall: lang === "es" ? "Paneles de yeso" : "Drywall sheets",
    roofing: lang === "es" ? "Techos" : "Roofing squares",
    tile: lang === "es" ? "Cajas de loseta" : "Tile boxes",
    margin: lang === "es" ? "Margen y recargo" : "Markup & margin",
    paint: lang === "es" ? "Estimador de pintura" : "Paint estimator",
    flooring: lang === "es" ? "Cajas de piso" : "Flooring boxes",
    fence: lang === "es" ? "Cerca y deck" : "Fence & deck",
    block: lang === "es" ? "Bloques y adoquines" : "Block & pavers",
    gravel: lang === "es" ? "Grava y tierra" : "Gravel & soil",
    stairs: lang === "es" ? "Zanca de escalera" : "Stair stringer",
    insulation: lang === "es" ? "Aislante en rollos" : "Insulation batts",
    gutter: lang === "es" ? "Canalones y bajantes" : "Gutter & downspouts",
    rate: lang === "es" ? "Tarifa facturable" : "Billable rate",
    punchlist: lang === "es" ? "Lista de pendientes" : "Punch list",
  };
  return <div className="toolbox-modal-backdrop" role="presentation" onClick={onBack}>
    <section className="toolbox-window" role="dialog" aria-modal="true" aria-labelledby="toolbox-title" onClick={(event) => event.stopPropagation()}>
      <header className="toolbox-window-head"><div className="toolbox-head-icon"><Icon><path d="M4 19h16M6 16l4-5 3 2 5-7" /></Icon></div><div><small>{lang === "es" ? "Herramienta de estimación" : "Estimating tool"}</small><h1 id="toolbox-title">{labels[tab]}</h1></div><button type="button" aria-label={lang === "es" ? "Cerrar herramienta" : "Close tool"} onClick={onBack}>×</button></header>
      <div className="toolbox-window-body">
        {tab === "loan" && <LoanCalculator lang={lang} />}
        {tab === "materials" && <MaterialReference lang={lang} />}
        {tab === "angle" && <AngleCalculator lang={lang} />}
        {tab === "convert" && <UnitConverter lang={lang} />}
        {tab === "area" && <AreaCalculator lang={lang} />}
        {tab === "yards" && <YardsCalculator lang={lang} />}
        {tab === "board" && <BoardFeetCalculator lang={lang} />}
        {tab === "drywall" && <DrywallCalculator lang={lang} />}
        {tab === "roofing" && <RoofingCalculator lang={lang} />}
        {tab === "tile" && <TileCalculator lang={lang} />}
        {tab === "margin" && <MarginCalculator lang={lang} />}
        {tab === "paint" && <PaintCalculator lang={lang} />}
        {tab === "flooring" && <FlooringCalculator lang={lang} />}
        {tab === "fence" && <FenceCalculator lang={lang} />}
        {tab === "block" && <BlockCalculator lang={lang} />}
        {tab === "gravel" && <GravelCalculator lang={lang} />}
        {tab === "stairs" && <StairCalculator lang={lang} />}
        {tab === "insulation" && <InsulationCalculator lang={lang} />}
        {tab === "gutter" && <GutterCalculator lang={lang} />}
        {tab === "rate" && <RateBuilderCalculator lang={lang} />}
        {tab === "punchlist" && <PunchListPanel lang={lang} />}
      </div>
    </section>
  </div>;
}
function LoanCalculator({ lang }: { lang: Lang }) {
  const [price, setPrice] = useState("10000"),
    [down, setDown] = useState("0"),
    [apr, setApr] = useState("8"),
    [months, setMonths] = useState("60");
  const principal = Math.max(0, money(price) - money(down)),
    n = Math.max(1, Math.round(money(months))),
    r = money(apr) / 1200;
  const payment = principal
      ? r
        ? (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1)
        : principal / n
      : 0,
    total = payment * n,
    interest = total - principal;
  let balance = principal;
  const years: {
    year: number;
    principal: number;
    interest: number;
    balance: number;
  }[] = [];
  for (let m = 1; m <= n; m++) {
    const int = balance * r;
    const prin = Math.min(balance, payment - int);
    balance = Math.max(0, balance - prin);
    const yi = Math.floor((m - 1) / 12);
    const row = years[yi] ?? {
      year: yi + 1,
      principal: 0,
      interest: 0,
      balance: 0,
    };
    row.principal += prin;
    row.interest += int;
    row.balance = balance;
    years[yi] = row;
  }
  return (
    <section className="calculator-panel">
      <h2>{lang === "es" ? "Préstamo de equipo" : "Equipment loan"}</h2>
      <div className="field-pair">
        <NumInput
          label={lang === "es" ? "Precio de compra" : "Purchase price"}
          value={price}
          onChange={setPrice}
        />
        <NumInput
          label={lang === "es" ? "Pago inicial" : "Down payment"}
          value={down}
          onChange={setDown}
        />
        <NumInput label="APR %" value={apr} onChange={setApr} />
        <NumInput
          label={lang === "es" ? "Plazo (meses)" : "Term (months)"}
          value={months}
          onChange={setMonths}
          step="1"
        />
      </div>
      <div className="calculator-results">
        <div>
          <span>{lang === "es" ? "Pago mensual" : "Monthly payment"}</span>
          <strong>{usd(payment)}</strong>
        </div>
        <div>
          <span>{lang === "es" ? "Interés total" : "Total interest"}</span>
          <strong>{usd(interest)}</strong>
        </div>
        <div>
          <span>
            {lang === "es" ? "Costo total del equipo" : "Total equipment cost"}
          </span>
          <strong>{usd(total + money(down))}</strong>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{lang === "es" ? "Año" : "Year"}</th>
              <th>{lang === "es" ? "Capital" : "Principal"}</th>
              <th>{lang === "es" ? "Interés" : "Interest"}</th>
              <th>{lang === "es" ? "Saldo" : "Balance"}</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y.year}>
                <td>{y.year}</td>
                <td>{usd(y.principal)}</td>
                <td>{usd(y.interest)}</td>
                <td>{usd(y.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ResultHistory lang={lang} tool="loan" value={`${lang === "es" ? "Pago mensual" : "Monthly payment"}: ${usd(payment)} · ${lang === "es" ? "Interés" : "Interest"}: ${usd(interest)}`} />
    </section>
  );
}
type MaterialDraft = {
  id: number | null;
  nameEn: string;
  nameEs: string;
  unitEn: string;
  unitEs: string;
  price: string;
};
function MaterialReference({ lang }: { lang: Lang }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["material-costs"],
    queryFn: () => api.listMaterialCosts({}),
  });
  const empty: MaterialDraft = {
    id: null,
    nameEn: "",
    nameEs: "",
    unitEn: "",
    unitEs: "",
    price: "",
  };
  const [draft, setDraft] = useState<MaterialDraft | null>(null);
  const save = useMutation({
    mutationFn: (d: MaterialDraft) => api.saveMaterialCost(d),
    onSuccess: () => {
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["material-costs"] });
    },
  });
  return (
    <section className="calculator-panel">
      <div className="section-heading">
        <div>
          <h2>
            {lang === "es"
              ? "Referencia de materiales"
              : "Material cost reference"}
          </h2>
          <p>
            {lang === "es"
              ? "Precios editables para planificar. Verifique antes de cotizar."
              : "Editable planning prices. Verify before quoting."}
          </p>
        </div>
        <button className="primary-button" onClick={() => setDraft(empty)}>
          <PlusIcon />
          {lang === "es" ? "Material" : "Material"}
        </button>
      </div>
      {q.data?.lastUpdated && (
        <p className="updated-stamp">
          {lang === "es" ? "Actualizado" : "Updated"}:{" "}
          {formatDate(q.data.lastUpdated.slice(0, 10), lang)}
        </p>
      )}
      {draft && (
        <form
          className="compact-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <div className="field-pair">
            <label>
              <span>{lang === "es" ? "Nombre en inglés" : "English name"}</span>
              <input
                required
                value={draft.nameEn}
                onChange={(e) => setDraft({ ...draft, nameEn: e.target.value })}
              />
            </label>
            <label>
              <span>
                {lang === "es" ? "Nombre en español" : "Spanish name"}
              </span>
              <input
                required
                value={draft.nameEs}
                onChange={(e) => setDraft({ ...draft, nameEs: e.target.value })}
              />
            </label>
            <label>
              <span>{lang === "es" ? "Unidad en inglés" : "English unit"}</span>
              <input
                required
                value={draft.unitEn}
                onChange={(e) => setDraft({ ...draft, unitEn: e.target.value })}
              />
            </label>
            <label>
              <span>
                {lang === "es" ? "Unidad en español" : "Spanish unit"}
              </span>
              <input
                required
                value={draft.unitEs}
                onChange={(e) => setDraft({ ...draft, unitEs: e.target.value })}
              />
            </label>
          </div>
          <NumInput
            label={lang === "es" ? "Precio" : "Price"}
            value={draft.price}
            onChange={(v) => setDraft({ ...draft, price: v })}
          />
          <div className="row-actions">
            <button className="primary-button">
              {lang === "es" ? "Guardar" : "Save"}
            </button>
            <button type="button" onClick={() => setDraft(null)}>
              {lang === "es" ? "Cancelar" : "Cancel"}
            </button>
          </div>
        </form>
      )}
      <div className="material-list">
        {q.data?.items.map((i) => (
          <article className="tool-record" key={i.id}>
            <span>
              <strong>{lang === "es" ? i.nameEs : i.nameEn}</strong>
              <small>{lang === "es" ? i.unitEs : i.unitEn}</small>
            </span>
            <b>{usd(money(i.price))}</b>
            <div className="row-actions">
              <button
                aria-label={
                  lang === "es" ? `Editar ${i.nameEs}` : `Edit ${i.nameEn}`
                }
                onClick={() => setDraft({ ...i, id: i.id })}
              >
                {lang === "es" ? "Editar" : "Edit"}
              </button>
              <button
                aria-label={
                  lang === "es" ? `Eliminar ${i.nameEs}` : `Delete ${i.nameEn}`
                }
                onClick={async () => {
                  await api.deleteMaterialCost({ id: i.id });
                  qc.invalidateQueries({ queryKey: ["material-costs"] });
                }}
              >
                <TrashIcon />
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
function AngleCalculator({ lang }: { lang: Lang }) {
  const [rise, setRise] = useState("6"),
    [run, setRun] = useState("12"),
    [angleIn, setAngleIn] = useState("26.565");
  const r = money(rise),
    x = money(run),
    angle = x ? (Math.atan(r / x) * 180) / Math.PI : 0,
    rev = x * Math.tan((money(angleIn) * Math.PI) / 180);
  return (
    <section className="calculator-panel">
      <h2>{lang === "es" ? "Ángulo y pendiente" : "Angle & pitch"}</h2>
      <div className="field-pair">
        <NumInput
          label={lang === "es" ? "Subida" : "Rise"}
          value={rise}
          onChange={setRise}
        />
        <NumInput
          label={lang === "es" ? "Recorrido" : "Run"}
          value={run}
          onChange={setRun}
        />
      </div>
      <div className="calculator-results">
        <div>
          <span>{lang === "es" ? "Pendiente" : "Pitch"}</span>
          <strong>{x ? ((r / x) * 12).toFixed(2) : "0"}/12</strong>
        </div>
        <div>
          <span>{lang === "es" ? "Ángulo" : "Angle"}</span>
          <strong>{angle.toFixed(1)}°</strong>
        </div>
      </div>
      <h3>{lang === "es" ? "Cálculo inverso" : "Reverse calculation"}</h3>
      <NumInput
        label={lang === "es" ? "Ángulo (grados)" : "Angle (degrees)"}
        value={angleIn}
        onChange={setAngleIn}
      />
      <p className="result-callout">
        {lang === "es" ? "Subida con este recorrido" : "Rise at this run"}:{" "}
        <strong>{rev.toFixed(2)}</strong>
      </p>
      <div className="quick-reference">
        <strong>
          {lang === "es" ? "Referencia de vigas" : "Rafter quick reference"}
        </strong>
        <span>4/12 ≈ 18.4° · 6/12 ≈ 26.6° · 8/12 ≈ 33.7° · 12/12 = 45°</span>
      </div>
      <ResultHistory lang={lang} tool="angle" value={`${lang === "es" ? "Pendiente" : "Pitch"}: ${x ? ((r / x) * 12).toFixed(2) : "0"}/12 · ${angle.toFixed(1)}°`} />
    </section>
  );
}

const conversionGroups = {
  imperial: { inches: 1, feet: 12, yards: 36 },
  metric: { mm: 1, cm: 10, m: 1000 },
  area: { sqft: 1, sqm: 10.7639104 },
  volume: { cuft: 1, cuyd: 27 },
  liquid: { gallons: 1, liters: 0.2641720524 },
  weight: { lbs: 1, kg: 2.2046226218 },
  smallWeight: { oz: 1, grams: 0.0352739619 },
} as const;
type ConversionGroup = keyof typeof conversionGroups;
function UnitConverter({ lang }: { lang: Lang }) {
  const [group, setGroup] = useState<ConversionGroup>("imperial"),
    [value, setValue] = useState("1"),
    [from, setFrom] = useState("feet"),
    [to, setTo] = useState("inches");
  const units = Object.keys(conversionGroups[group]);
  useEffect(() => {
    setFrom(units[0] ?? "");
    setTo(units[1] ?? units[0] ?? "");
  }, [group]);
  const factors = conversionGroups[group] as Record<string, number>;
  const result = (money(value) * (factors[from] ?? 1)) / (factors[to] ?? 1);
  const groupNames: Record<ConversionGroup, string> = {
    imperial: lang === "es" ? "Longitud imperial" : "Imperial length",
    metric: lang === "es" ? "Longitud métrica" : "Metric length",
    area: lang === "es" ? "Área" : "Area",
    volume: lang === "es" ? "Volumen" : "Volume",
    liquid: lang === "es" ? "Líquidos" : "Liquid",
    weight: lang === "es" ? "Peso" : "Weight",
    smallWeight: lang === "es" ? "Peso pequeño" : "Small weight",
  };
  return (
    <section className="calculator-panel">
      <h2>{lang === "es" ? "Convertidor" : "Converter"}</h2>
      <label>
        <span>{lang === "es" ? "Tipo" : "Type"}</span>
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value as ConversionGroup)}
        >
          {(Object.keys(conversionGroups) as ConversionGroup[]).map((k) => (
            <option key={k} value={k}>
              {groupNames[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="converter-row">
        <NumInput
          label={lang === "es" ? "Valor" : "Value"}
          value={value}
          onChange={setValue}
        />
        <label>
          <span>{lang === "es" ? "De" : "From"}</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
        <label>
          <span>{lang === "es" ? "A" : "To"}</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {units.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="result-callout">
        <strong>
          {Number.isFinite(result)
            ? result.toLocaleString(undefined, { maximumFractionDigits: 4 })
            : "0"}
        </strong>{" "}
        {to}
      </p>
      <div className="quick-reference">
        <strong>
          {lang === "es" ? "Referencia rápida" : "Quick reference"}
        </strong>
        <span>
          12 in = 1 ft · 3 ft = 1 yd · 25.4 mm = 1 in · 1 m² = 10.7639 ft² · 27
          ft³ = 1 yd³ · 1 gal = 3.785 L · 1 lb = 0.4536 kg · 1 oz = 28.35 g
        </span>
      </div>
      <ResultHistory lang={lang} tool="convert" value={`${value} ${from} = ${Number.isFinite(result) ? result.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "0"} ${to}`} />
    </section>
  );
}
type AreaRow = { id: number; name: string; length: string; width: string };
function AreaCalculator({ lang }: { lang: Lang }) {
  const [name, setName] = useState(""),
    [length, setLength] = useState(""),
    [width, setWidth] = useState(""),
    [rows, setRows] = useState<AreaRow[]>([]);
  const [paint, setPaint] = useState({
    length: "",
    height: "",
    doors: "0",
    windows: "0",
    coverage: "350",
  });
  const total = rows.reduce((s, r) => s + money(r.length) * money(r.width), 0),
    gross = money(paint.length) * money(paint.height),
    net = Math.max(
      0,
      gross - money(paint.doors) * 21 - money(paint.windows) * 15,
    ),
    gallons = net / Math.max(1, money(paint.coverage));
  return (
    <section className="calculator-panel">
      <h2>{lang === "es" ? "Pies cuadrados" : "Square footage"}</h2>
      <form
        className="compact-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (money(length) && money(width)) {
            setRows([
              ...rows,
              {
                id: Date.now(),
                name: name || (lang === "es" ? "Área" : "Area"),
                length,
                width,
              },
            ]);
            setName("");
            setLength("");
            setWidth("");
          }
        }}
      >
        <label>
          <span>{lang === "es" ? "Nombre del área" : "Area name"}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="field-pair">
          <NumInput
            label={lang === "es" ? "Largo (pies)" : "Length (ft)"}
            value={length}
            onChange={setLength}
          />
          <NumInput
            label={lang === "es" ? "Ancho (pies)" : "Width (ft)"}
            value={width}
            onChange={setWidth}
          />
        </div>
        <button className="primary-button">
          <PlusIcon />
          {lang === "es" ? "Agregar área" : "Add area"}
        </button>
      </form>
      <div className="takeoff-list">
        {rows.map((r) => (
          <article key={r.id}>
            <span>{r.name}</span>
            <strong>{(money(r.length) * money(r.width)).toFixed(2)} ft²</strong>
            <button
              aria-label={lang === "es" ? "Eliminar área" : "Delete area"}
              onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
            >
              <TrashIcon />
            </button>
          </article>
        ))}
      </div>
      <p className="result-callout">
        {lang === "es" ? "Total" : "Total"}:{" "}
        <strong>{total.toFixed(2)} ft²</strong>
      </p>
      <details className="action-details">
        <summary>
          {lang === "es"
            ? "Estimador de pintura de pared"
            : "Wall paint estimator"}
        </summary>
        <div className="compact-form">
          <div className="field-pair">
            <NumInput
              label={
                lang === "es"
                  ? "Largo total de pared (pies)"
                  : "Total wall length (ft)"
              }
              value={paint.length}
              onChange={(v) => setPaint({ ...paint, length: v })}
            />
            <NumInput
              label={lang === "es" ? "Altura (pies)" : "Height (ft)"}
              value={paint.height}
              onChange={(v) => setPaint({ ...paint, height: v })}
            />
            <NumInput
              label={
                lang === "es"
                  ? "Puertas estándar (21 ft²)"
                  : "Standard doors (21 ft²)"
              }
              value={paint.doors}
              onChange={(v) => setPaint({ ...paint, doors: v })}
              step="1"
            />
            <NumInput
              label={
                lang === "es"
                  ? "Ventanas estándar (15 ft²)"
                  : "Standard windows (15 ft²)"
              }
              value={paint.windows}
              onChange={(v) => setPaint({ ...paint, windows: v })}
              step="1"
            />
            <NumInput
              label={
                lang === "es"
                  ? "Cobertura por galón (ft²)"
                  : "Coverage per gallon (ft²)"
              }
              value={paint.coverage}
              onChange={(v) => setPaint({ ...paint, coverage: v })}
            />
          </div>
          <p className="result-callout">
            {lang === "es" ? "Pared neta" : "Net wall"}: {net.toFixed(1)} ft² ·{" "}
            {lang === "es" ? "Galones" : "Gallons"}:{" "}
            <strong>
              {gallons.toFixed(2)} ({Math.ceil(gallons)}{" "}
              {lang === "es" ? "para comprar" : "to buy"})
            </strong>
          </p>
        </div>
      </details>
      <ResultHistory lang={lang} tool="area" value={`${lang === "es" ? "Área total" : "Total area"}: ${total.toFixed(2)} ft² · ${lang === "es" ? "Pintura" : "Paint"}: ${Math.ceil(gallons)} gal`} />
    </section>
  );
}
function YardsCalculator({ lang }: { lang: Lang }) {
  const [l, setL] = useState("10"),
    [w, setW] = useState("12"),
    [d, setD] = useState("4"),
    [waste, setWaste] = useState("10");
  const cf = (money(l) * money(w) * money(d)) / 12,
    cy = cf / 27,
    withWaste = cy * (1 + money(waste) / 100),
    cfWaste = withWaste * 27;
  return (
    <section className="calculator-panel">
      <h2>{lang === "es" ? "Yardas cúbicas" : "Cubic yards"}</h2>
      <p>
        {lang === "es"
          ? "Para concreto, tierra, mantillo o grava."
          : "For concrete, dirt, mulch, or gravel."}
      </p>
      <div className="field-pair">
        <NumInput
          label={lang === "es" ? "Largo (pies)" : "Length (ft)"}
          value={l}
          onChange={setL}
        />
        <NumInput
          label={lang === "es" ? "Ancho (pies)" : "Width (ft)"}
          value={w}
          onChange={setW}
        />
        <NumInput
          label={lang === "es" ? "Profundidad (pulgadas)" : "Depth (inches)"}
          value={d}
          onChange={setD}
        />
        <NumInput
          label={lang === "es" ? "Desperdicio %" : "Waste %"}
          value={waste}
          onChange={setWaste}
        />
      </div>
      <div className="calculator-results">
        <div>
          <span>{lang === "es" ? "Pies cúbicos" : "Cubic feet"}</span>
          <strong>{cf.toFixed(2)}</strong>
        </div>
        <div>
          <span>
            {lang === "es"
              ? "Yardas antes de desperdicio"
              : "Yards before waste"}
          </span>
          <strong>{cy.toFixed(2)}</strong>
        </div>
        <div>
          <span>
            {lang === "es" ? "Yardas con desperdicio" : "Yards with waste"}
          </span>
          <strong>{withWaste.toFixed(2)}</strong>
        </div>
      </div>
      <p className="result-callout">
        {lang === "es" ? "Bolsas de concreto" : "Concrete bags"}:{" "}
        <strong>{Math.ceil(cfWaste / 0.45)} × 60 lb</strong> ·{" "}
        <strong>{Math.ceil(cfWaste / 0.6)} × 80 lb</strong>
      </p>
      <ResultHistory lang={lang} tool="yards" value={`${withWaste.toFixed(2)} yd³ · ${Math.ceil(cfWaste / 0.6)} × 80 lb`} />
    </section>
  );
}
type BoardRow = {
  id: number;
  qty: number;
  t: string;
  w: string;
  l: string;
  bf: number;
};
function BoardFeetCalculator({ lang }: { lang: Lang }) {
  const [t, setT] = useState("1"),
    [w, setW] = useState("6"),
    [l, setL] = useState("8"),
    [qty, setQty] = useState("1"),
    [rows, setRows] = useState<BoardRow[]>([]);
  const each = (money(t) * money(w) * money(l)) / 12;
  return (
    <section className="calculator-panel">
      <h2>{lang === "es" ? "Pies tabla" : "Board feet"}</h2>
      <div className="field-pair">
        <NumInput
          label={lang === "es" ? "Espesor (pulgadas)" : "Thickness (in)"}
          value={t}
          onChange={setT}
        />
        <NumInput
          label={lang === "es" ? "Ancho (pulgadas)" : "Width (in)"}
          value={w}
          onChange={setW}
        />
        <NumInput
          label={lang === "es" ? "Largo (pies)" : "Length (ft)"}
          value={l}
          onChange={setL}
        />
        <NumInput
          label={lang === "es" ? "Cantidad" : "Quantity"}
          value={qty}
          onChange={setQty}
          step="1"
        />
      </div>
      <p className="result-callout">
        {lang === "es" ? "Por pieza" : "Per piece"}:{" "}
        <strong>{each.toFixed(2)} BF</strong>
      </p>
      <button
        className="primary-button"
        onClick={() =>
          setRows([
            ...rows,
            {
              id: Date.now(),
              qty: Math.max(1, Math.round(money(qty))),
              t,
              w,
              l,
              bf: each * Math.max(1, Math.round(money(qty))),
            },
          ])
        }
      >
        <PlusIcon />
        {lang === "es" ? "Agregar a lista" : "Add to takeoff"}
      </button>
      <div className="takeoff-list">
        {rows.map((r) => (
          <article key={r.id}>
            <span>
              {r.qty} × {r.t} × {r.w} × {r.l}
            </span>
            <strong>{r.bf.toFixed(2)} BF</strong>
            <button
              aria-label={lang === "es" ? "Eliminar madera" : "Delete lumber"}
              onClick={() => setRows(rows.filter((x) => x.id !== r.id))}
            >
              <TrashIcon />
            </button>
          </article>
        ))}
      </div>
      <p className="result-callout">
        {lang === "es" ? "Total" : "Total"}:{" "}
        <strong>{rows.reduce((s, r) => s + r.bf, 0).toFixed(2)} BF</strong>
      </p>
      <ResultHistory lang={lang} tool="board" value={`${Math.max(1, Math.round(money(qty)))} × ${t} × ${w} × ${l} = ${(each * Math.max(1, Math.round(money(qty)))).toFixed(2)} BF`} />
    </section>
  );
}

function DrywallCalculator({ lang }: { lang: Lang }) {
  const [area, setArea] = useState("1000"), [waste, setWaste] = useState("10"), [sheetSize, setSheetSize] = useState("32");
  const adjusted = money(area) * (1 + money(waste) / 100);
  const sheets = Math.ceil(adjusted / Math.max(1, money(sheetSize)));
  const screws = Math.ceil(sheets * 32);
  const compound = Math.ceil(adjusted / 450);
  const result = `${sheets} ${lang === "es" ? "hojas" : "sheets"} · ${screws} ${lang === "es" ? "tornillos" : "screws"} · ${compound} ${lang === "es" ? "cubetas de compuesto" : "buckets of compound"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Paneles de yeso" : "Drywall takeoff"}</h2><p>{lang === "es" ? "Estimado rápido para pared o techo." : "Quick wall or ceiling estimate."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Área (ft²)" : "Area (ft²)"} value={area} onChange={setArea}/><NumInput label={lang === "es" ? "Desperdicio %" : "Waste %"} value={waste} onChange={setWaste}/><label><span>{lang === "es" ? "Tamaño de hoja" : "Sheet size"}</span><select value={sheetSize} onChange={(e)=>setSheetSize(e.target.value)}><option value="32">4 × 8 · 32 ft²</option><option value="40">4 × 10 · 40 ft²</option><option value="48">4 × 12 · 48 ft²</option></select></label></div><div className="calculator-results"><div><span>{lang === "es" ? "Hojas" : "Sheets"}</span><strong>{sheets}</strong></div><div><span>{lang === "es" ? "Tornillos" : "Screws"}</span><strong>{screws}</strong></div><div><span>{lang === "es" ? "Compuesto" : "Compound"}</span><strong>{compound}</strong></div></div><ResultHistory lang={lang} tool="drywall" value={result}/></section>;
}

function RoofingCalculator({ lang }: { lang: Lang }) {
  const [area, setArea] = useState("2400"), [waste, setWaste] = useState("12"), [bundlesPerSquare, setBundlesPerSquare] = useState("3");
  const squares = money(area) * (1 + money(waste) / 100) / 100;
  const bundles = Math.ceil(squares * Math.max(1, money(bundlesPerSquare)));
  const result = `${squares.toFixed(2)} ${lang === "es" ? "cuadrados" : "squares"} · ${bundles} ${lang === "es" ? "paquetes" : "bundles"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Techos" : "Roofing takeoff"}</h2><p>{lang === "es" ? "Calcula cuadrados y paquetes de tejas." : "Calculate roofing squares and shingle bundles."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Área del techo (ft²)" : "Roof area (ft²)"} value={area} onChange={setArea}/><NumInput label={lang === "es" ? "Desperdicio %" : "Waste %"} value={waste} onChange={setWaste}/><NumInput label={lang === "es" ? "Paquetes por cuadrado" : "Bundles per square"} value={bundlesPerSquare} onChange={setBundlesPerSquare}/></div><div className="calculator-results"><div><span>{lang === "es" ? "Cuadrados" : "Squares"}</span><strong>{squares.toFixed(2)}</strong></div><div><span>{lang === "es" ? "Paquetes" : "Bundles"}</span><strong>{bundles}</strong></div></div><ResultHistory lang={lang} tool="roofing" value={result}/></section>;
}

function TileCalculator({ lang }: { lang: Lang }) {
  const [area, setArea] = useState("180"), [waste, setWaste] = useState("10"), [coverage, setCoverage] = useState("12");
  const needed = money(area) * (1 + money(waste) / 100);
  const boxes = Math.ceil(needed / Math.max(0.01, money(coverage)));
  const result = `${needed.toFixed(1)} ft² · ${boxes} ${lang === "es" ? "cajas" : "boxes"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Cajas de loseta" : "Tile box estimator"}</h2><p>{lang === "es" ? "Calcula cobertura con desperdicio." : "Calculate coverage with waste."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Área (ft²)" : "Area (ft²)"} value={area} onChange={setArea}/><NumInput label={lang === "es" ? "Desperdicio %" : "Waste %"} value={waste} onChange={setWaste}/><NumInput label={lang === "es" ? "Cobertura por caja (ft²)" : "Coverage per box (ft²)"} value={coverage} onChange={setCoverage}/></div><div className="calculator-results"><div><span>{lang === "es" ? "Cobertura necesaria" : "Coverage needed"}</span><strong>{needed.toFixed(1)} ft²</strong></div><div><span>{lang === "es" ? "Cajas" : "Boxes"}</span><strong>{boxes}</strong></div></div><ResultHistory lang={lang} tool="tile" value={result}/></section>;
}

function MarginCalculator({ lang }: { lang: Lang }) {
  const [cost, setCost] = useState("1000"), [percent, setPercent] = useState("25"), [mode, setMode] = useState<"markup" | "margin">("markup");
  const c = money(cost), p = Math.min(99.9, Math.max(0, money(percent))) / 100;
  const price = mode === "margin" ? c / Math.max(0.001, 1 - p) : c * (1 + p);
  const profit = price - c;
  const actualMargin = price ? profit / price * 100 : 0;
  const result = `${lang === "es" ? "Precio" : "Price"}: ${usd(price)} · ${lang === "es" ? "Ganancia" : "Profit"}: ${usd(profit)} · ${lang === "es" ? "Margen" : "Margin"}: ${actualMargin.toFixed(1)}%`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Margen y recargo" : "Markup & margin"}</h2><div className="segmented-control" role="group" aria-label={lang === "es" ? "Método" : "Method"}><button type="button" className={mode === "markup" ? "active" : ""} onClick={()=>setMode("markup")}>{lang === "es" ? "Recargo" : "Markup"}</button><button type="button" className={mode === "margin" ? "active" : ""} onClick={()=>setMode("margin")}>{lang === "es" ? "Margen" : "Margin"}</button></div><div className="field-pair"><NumInput label={lang === "es" ? "Costo" : "Cost"} value={cost} onChange={setCost}/><NumInput label={`${mode === "markup" ? (lang === "es" ? "Recargo" : "Markup") : (lang === "es" ? "Margen" : "Margin")} %`} value={percent} onChange={setPercent}/></div><div className="calculator-results"><div><span>{lang === "es" ? "Precio de venta" : "Selling price"}</span><strong>{usd(price)}</strong></div><div><span>{lang === "es" ? "Ganancia" : "Profit"}</span><strong>{usd(profit)}</strong></div><div><span>{lang === "es" ? "Margen real" : "Actual margin"}</span><strong>{actualMargin.toFixed(1)}%</strong></div></div><ResultHistory lang={lang} tool="margin" value={result}/></section>;
}

function PaintCalculator({ lang }: { lang: Lang }) {
  const [area, setArea] = useState("1000"), [coats, setCoats] = useState("2"), [coverage, setCoverage] = useState("350");
  const gallons = (money(area) * Math.max(1, Math.round(money(coats)))) / Math.max(1, money(coverage));
  const buy = Math.ceil(gallons);
  const result = `${buy} gal`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Estimador de pintura" : "Paint estimator"}</h2><p>{lang === "es" ? "Calcula galones según el área y las manos de pintura." : "Estimate gallons from wall area and coats."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Área de pared (ft²)" : "Wall area (ft²)"} value={area} onChange={setArea}/><NumInput label={lang === "es" ? "Manos de pintura" : "Coats"} value={coats} onChange={setCoats} step="1"/><NumInput label={lang === "es" ? "Cobertura por galón (ft²)" : "Coverage per gallon (ft²)"} value={coverage} onChange={setCoverage}/></div><div className="calculator-results"><div><span>{lang === "es" ? "Galones calculados" : "Calculated gallons"}</span><strong>{gallons.toFixed(2)} gal</strong></div><div><span>{lang === "es" ? "Comprar (redondeado)" : "Buy (rounded up)"}</span><strong>{buy} gal</strong></div></div><ResultHistory lang={lang} tool="paint" value={`${area} ft² × ${coats} ${lang === "es" ? "manos" : "coats"} = ${result}`}/></section>;
}

function FlooringCalculator({ lang }: { lang: Lang }) {
  const [area, setArea] = useState("500"), [perBox, setPerBox] = useState("20"), [waste, setWaste] = useState("10");
  const needed = money(area) * (1 + money(waste) / 100);
  const boxes = needed > 0 && money(perBox) > 0 ? Math.ceil(needed / money(perBox)) : 0;
  const result = `${boxes} ${lang === "es" ? "cajas" : "boxes"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Cajas de piso" : "Flooring box estimator"}</h2><p>{lang === "es" ? "Calcula cajas incluyendo desperdicio." : "Estimate boxes including waste."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Área del piso (ft²)" : "Floor area (ft²)"} value={area} onChange={setArea}/><NumInput label={lang === "es" ? "Cobertura por caja (ft²)" : "Coverage per box (ft²)"} value={perBox} onChange={setPerBox}/><NumInput label={lang === "es" ? "Desperdicio %" : "Waste %"} value={waste} onChange={setWaste}/></div><div className="calculator-results"><div><span>{lang === "es" ? "Área con desperdicio" : "Area with waste"}</span><strong>{needed.toFixed(1)} ft²</strong></div><div><span>{lang === "es" ? "Cajas" : "Boxes"}</span><strong>{boxes}</strong></div></div><ResultHistory lang={lang} tool="flooring" value={`${area} ft², ${waste}% ${lang === "es" ? "desperdicio" : "waste"} = ${result}`}/></section>;
}

function FenceCalculator({ lang }: { lang: Lang }) {
  const [feet, setFeet] = useState("100"), [picketW, setPicketW] = useState("5.5"), [gap, setGap] = useState("0.5"), [spacing, setSpacing] = useState("8"), [rails, setRails] = useState("2");
  const totalIn = money(feet) * 12;
  const pickets = totalIn > 0 && money(picketW) + money(gap) > 0 ? Math.ceil(totalIn / (money(picketW) + money(gap))) : 0;
  const spans = money(spacing) > 0 ? Math.floor(money(feet) / money(spacing)) : 0;
  const posts = money(feet) > 0 ? spans + 1 : 0;
  const railsTotal = spans * Math.max(0, Math.round(money(rails)));
  const result = `${pickets} ${lang === "es" ? "estacas" : "pickets"} · ${posts} ${lang === "es" ? "postes" : "posts"} · ${railsTotal} ${lang === "es" ? "rieles" : "rails"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Cerca y deck" : "Fence & deck estimator"}</h2><p>{lang === "es" ? "Estacas, postes y rieles para cercas." : "Pickets, posts, and rails for fences."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Largo total (ft)" : "Total length (ft)"} value={feet} onChange={setFeet}/><NumInput label={lang === "es" ? "Ancho de estaca (in)" : "Picket width (in)"} value={picketW} onChange={setPicketW}/><NumInput label={lang === "es" ? "Espacio entre estacas (in)" : "Gap between pickets (in)"} value={gap} onChange={setGap}/><NumInput label={lang === "es" ? "Separación de postes (ft)" : "Post spacing (ft)"} value={spacing} onChange={setSpacing}/><NumInput label={lang === "es" ? "Rieles por tramo" : "Rails per span"} value={rails} onChange={setRails} step="1"/></div><div className="calculator-results"><div><span>{lang === "es" ? "Estacas" : "Pickets"}</span><strong>{pickets}</strong></div><div><span>{lang === "es" ? "Postes" : "Posts"}</span><strong>{posts}</strong></div><div><span>{lang === "es" ? "Rieles" : "Rails"}</span><strong>{railsTotal}</strong></div></div><ResultHistory lang={lang} tool="fence" value={`${feet} ft = ${result}`}/></section>;
}

function BlockCalculator({ lang }: { lang: Lang }) {
  const [mode, setMode] = useState<"wall" | "patio">("wall");
  const [area, setArea] = useState("100"), [l, setL] = useState("16"), [w, setW] = useState("8"), [waste, setWaste] = useState("5");
  const face = money(l) * money(w);
  const count = face > 0 && money(area) > 0 ? Math.ceil((money(area) * 144) / face * (1 + money(waste) / 100)) : 0;
  const unit = mode === "wall" ? (lang === "es" ? "bloques" : "blocks") : (lang === "es" ? "adoquines" : "pavers");
  return <section className="calculator-panel"><h2>{lang === "es" ? "Bloques y adoquines" : "Block & paver estimator"}</h2><div className="segmented-control" role="group" aria-label={lang === "es" ? "Modo" : "Mode"}><button type="button" className={mode === "wall" ? "active" : ""} onClick={()=>setMode("wall")}>{lang === "es" ? "Bloque de muro" : "Wall block"}</button><button type="button" className={mode === "patio" ? "active" : ""} onClick={()=>setMode("patio")}>{lang === "es" ? "Patio de adoquines" : "Patio pavers"}</button></div><div className="field-pair"><NumInput label={lang === "es" ? "Área (ft²)" : "Area (ft²)"} value={area} onChange={setArea}/><NumInput label={mode === "wall" ? (lang === "es" ? "Largo del bloque (in)" : "Block length (in)") : (lang === "es" ? "Largo del adoquín (in)" : "Paver length (in)")} value={l} onChange={setL}/><NumInput label={mode === "wall" ? (lang === "es" ? "Alto del bloque (in)" : "Block height (in)") : (lang === "es" ? "Ancho del adoquín (in)" : "Paver width (in)")} value={w} onChange={setW}/><NumInput label={lang === "es" ? "Desperdicio %" : "Waste %"} value={waste} onChange={setWaste}/></div><p className="result-callout">{lang === "es" ? "Necesitas" : "You need"}:{" "}<strong>{count} {unit}</strong></p><ResultHistory lang={lang} tool="block" value={`${area} ft² (${mode === "wall" ? (lang === "es" ? "muro" : "wall") : (lang === "es" ? "patio" : "patio")}) = ${count} ${unit}`}/></section>;
}

function GravelCalculator({ lang }: { lang: Lang }) {
  const [l, setL] = useState("10"), [w, setW] = useState("10"), [depth, setDepth] = useState("4"), [waste, setWaste] = useState("5"), [tonsPerYard, setTonsPerYard] = useState("1.4");
  const yards = (money(l) * money(w) * (money(depth) / 12)) / 27;
  const yardsWithWaste = yards * (1 + money(waste) / 100);
  const tons = yardsWithWaste * money(tonsPerYard);
  const result = `${yardsWithWaste.toFixed(2)} yd³ · ${tons.toFixed(2)} ${lang === "es" ? "ton" : "tons"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Grava y tierra" : "Gravel & soil estimator"}</h2><p>{lang === "es" ? "Yardas cúbicas y toneladas por dimensiones." : "Cubic yards and tons from dimensions."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Largo (ft)" : "Length (ft)"} value={l} onChange={setL}/><NumInput label={lang === "es" ? "Ancho (ft)" : "Width (ft)"} value={w} onChange={setW}/><NumInput label={lang === "es" ? "Profundidad (in)" : "Depth (in)"} value={depth} onChange={setDepth}/><NumInput label={lang === "es" ? "Desperdicio %" : "Waste %"} value={waste} onChange={setWaste}/><NumInput label={lang === "es" ? "Toneladas por yarda³" : "Tons per yd³"} value={tonsPerYard} onChange={setTonsPerYard}/></div><div className="calculator-results"><div><span>{lang === "es" ? "Yardas cúbicas" : "Cubic yards"}</span><strong>{yardsWithWaste.toFixed(2)} yd³</strong></div><div><span>{lang === "es" ? "Toneladas" : "Tons"}</span><strong>{tons.toFixed(2)}</strong></div></div><ResultHistory lang={lang} tool="gravel" value={`${l}×${w} ft × ${depth} in = ${result}`}/></section>;
}

function StairCalculator({ lang }: { lang: Lang }) {
  const [rise, setRise] = useState("36"), [run, setRun] = useState("48");
  const risers = Math.max(1, Math.round(money(rise) / 7.5));
  const riserH = money(rise) / risers;
  const treadD = money(run) / risers;
  const result = `${risers} @ ${riserH.toFixed(2)} in ${lang === "es" ? "contrahuellas" : "risers"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Zanca de escalera" : "Stair stringer layout"}</h2><p>{lang === "es" ? "Calcula contrahuellas y huellas (ideal: 7.5 in de contrahuella)." : "Lay out risers and treads (target: 7.5 in riser)."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Altura total (in)" : "Total rise (in)"} value={rise} onChange={setRise}/><NumInput label={lang === "es" ? "Largo total (in)" : "Total run (in)"} value={run} onChange={setRun}/></div><div className="calculator-results"><div><span>{lang === "es" ? "Contrahuellas" : "Risers"}</span><strong>{risers}</strong></div><div><span>{lang === "es" ? "Altura de contrahuella" : "Riser height"}</span><strong>{riserH.toFixed(2)} in</strong></div><div><span>{lang === "es" ? "Profundidad de huella" : "Tread depth"}</span><strong>{treadD.toFixed(2)} in</strong></div></div><ResultHistory lang={lang} tool="stairs" value={`${rise} in ${lang === "es" ? "subida" : "rise"} = ${result}`}/></section>;
}

function InsulationCalculator({ lang }: { lang: Lang }) {
  const [area, setArea] = useState("500"), [coverage, setCoverage] = useState("10.67"), [waste, setWaste] = useState("5");
  const batts = money(coverage) > 0 ? Math.ceil((money(area) * (1 + money(waste) / 100)) / money(coverage)) : 0;
  const result = `${batts} ${lang === "es" ? "rollos" : "batts"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Aislante en rollos" : "Insulation batt estimator"}</h2><p>{lang === "es" ? "Rollos según área de pared o ático." : "Batts for wall or attic area."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Área (ft²)" : "Area (ft²)"} value={area} onChange={setArea}/><NumInput label={lang === "es" ? "Cobertura por rollo (ft²)" : "Coverage per batt (ft²)"} value={coverage} onChange={setCoverage}/><NumInput label={lang === "es" ? "Desperdicio %" : "Waste %"} value={waste} onChange={setWaste}/></div><p className="result-callout">{lang === "es" ? "Necesitas" : "You need"}:{" "}<strong>{result}</strong></p><ResultHistory lang={lang} tool="insulation" value={`${area} ft² = ${result}`}/></section>;
}

function GutterCalculator({ lang }: { lang: Lang }) {
  const [feet, setFeet] = useState("100"), [spacing, setSpacing] = useState("40"), [elbows, setElbows] = useState("2");
  const downspouts = money(feet) > 0 && money(spacing) > 0 ? Math.max(2, Math.ceil(money(feet) / money(spacing))) : 0;
  const elbowsTotal = downspouts * Math.max(0, Math.round(money(elbows)));
  const result = `${money(feet)} ft ${lang === "es" ? "canalón" : "gutter"} · ${downspouts} ${lang === "es" ? "bajantes" : "downspouts"} · ${elbowsTotal} ${lang === "es" ? "codos" : "elbows"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Canalones y bajantes" : "Gutter & downspout estimator"}</h2><p>{lang === "es" ? "Pies de canalón, bajantes y codos por pies de alero." : "Gutter feet, downspouts, and elbows by eave length."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Pies de alero (ft)" : "Eave length (ft)"} value={feet} onChange={setFeet}/><NumInput label={lang === "es" ? "Separación de bajantes (ft)" : "Downspout spacing (ft)"} value={spacing} onChange={setSpacing}/><NumInput label={lang === "es" ? "Codos por bajante" : "Elbows per downspout"} value={elbows} onChange={setElbows} step="1"/></div><div className="calculator-results"><div><span>{lang === "es" ? "Canalón" : "Gutter"}</span><strong>{money(feet)} ft</strong></div><div><span>{lang === "es" ? "Bajantes" : "Downspouts"}</span><strong>{downspouts}</strong></div><div><span>{lang === "es" ? "Codos" : "Elbows"}</span><strong>{elbowsTotal}</strong></div></div><ResultHistory lang={lang} tool="gutter" value={result}/></section>;
}

function RateBuilderCalculator({ lang }: { lang: Lang }) {
  const [wages, setWages] = useState("25"), [burden, setBurden] = useState("25"), [overhead, setOverhead] = useState("15"), [profit, setProfit] = useState("20");
  const trueCost = money(wages) * (1 + money(burden) / 100) + money(overhead);
  const profitPct = Math.min(99, Math.max(0, money(profit))) / 100;
  const rate = trueCost / Math.max(0.01, 1 - profitPct);
  const profitPerHr = rate - trueCost;
  const result = `${usd(rate)}/${lang === "es" ? "hora" : "hr"}`;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Tarifa facturable" : "Billable rate builder"}</h2><p>{lang === "es" ? "Convierte salarios y gastos en tarifa por hora." : "Turn wages and costs into an hourly rate."}</p><div className="field-pair"><NumInput label={lang === "es" ? "Salario por hora ($)" : "Hourly wage ($)"} value={wages} onChange={setWages}/><NumInput label={lang === "es" ? "Cargas laborales %" : "Labor burden %"} value={burden} onChange={setBurden}/><NumInput label={lang === "es" ? "Gastos generales por hora ($)" : "Overhead per hour ($)"} value={overhead} onChange={setOverhead}/><NumInput label={lang === "es" ? "Ganancia %" : "Profit %"} value={profit} onChange={setProfit}/></div><div className="calculator-results"><div><span>{lang === "es" ? "Costo real por hora" : "True cost per hour"}</span><strong>{usd(trueCost)}</strong></div><div><span>{lang === "es" ? "Tarifa facturable" : "Billable rate"}</span><strong>{usd(rate)}</strong></div><div><span>{lang === "es" ? "Ganancia por hora" : "Profit per hour"}</span><strong>{usd(profitPerHr)}</strong></div></div><ResultHistory lang={lang} tool="rate" value={`${lang === "es" ? "Tarifa" : "Rate"}: ${result}`}/></section>;
}

function PunchListPanel({ lang }: { lang: Lang }) {
  const client = useQueryClient();
  const [jobId, setJobId] = useState("");
  const [text, setText] = useState("");
  const jobsQuery = useQuery({ queryKey: ["jobs", "punchlist-picker"], queryFn: () => api.listJobs({ search: "" }) });
  const itemsQuery = useQuery({
    queryKey: ["punch-items", jobId],
    queryFn: () => api.listPunchItems({ jobId: Number(jobId) }),
    enabled: !!jobId,
  });
  const invalidate = () => client.invalidateQueries({ queryKey: ["punch-items", jobId] });
  const add = useMutation({
    mutationFn: () => api.addPunchItem({ jobId: Number(jobId), text }),
    onSuccess: () => { setText(""); invalidate(); },
  });
  const toggle = useMutation({
    mutationFn: ({ id, completed }: { id: number; completed: boolean }) => api.togglePunchItem({ id, completed }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.deletePunchItem({ id }),
    onSuccess: invalidate,
  });
  const items = itemsQuery.data?.items ?? [];
  const doneCount = items.filter((i) => i.completed).length;
  return <section className="calculator-panel"><h2>{lang === "es" ? "Lista de pendientes" : "Punch list"}</h2><p>{lang === "es" ? "Elige un trabajo y lleva la cuenta de los pendientes." : "Pick a job and track its punch items."}</p><div className="field-pair"><label><span>{lang === "es" ? "Trabajo" : "Job"}</span><select value={jobId} onChange={(e) => setJobId(e.target.value)}><option value="">{lang === "es" ? "Seleccione" : "Choose"}</option>{jobsQuery.data?.jobs.map((j) => <option key={j.id} value={j.id}>{j.clientName} · {j.jobType}</option>)}</select></label></div>{jobId && <><div className="punch-add"><input value={text} onChange={(e) => setText(e.target.value)} placeholder={lang === "es" ? "Agregar pendiente…" : "Add a punch item…"} maxLength={500}/><button type="button" className="primary-button" disabled={!text.trim() || add.isPending} onClick={() => add.mutate()}><PlusIcon />{lang === "es" ? "Agregar" : "Add"}</button></div><p className="result-callout">{doneCount} / {items.length} {lang === "es" ? "completados" : "done"}</p><div className="punch-list">{items.map((item) => <article key={item.id} className={item.completed ? "punch-done" : ""}><button type="button" aria-label={item.completed ? (lang === "es" ? "Marcar pendiente" : "Mark open") : (lang === "es" ? "Marcar completado" : "Mark done")} onClick={() => toggle.mutate({ id: item.id, completed: !item.completed })}><CheckIcon /></button><span>{item.text}</span><button type="button" aria-label={lang === "es" ? "Eliminar pendiente" : "Delete punch item"} onClick={() => remove.mutate(item.id)}><TrashIcon /></button></article>)}</div>{items.length === 0 && <p>{lang === "es" ? "No hay pendientes todavía. Agrega el primero arriba." : "No punch items yet. Add the first one above."}</p>}</>}<ResultHistory lang={lang} tool="punchlist" value={`${doneCount}/${items.length} ${lang === "es" ? "completados" : "done"}`}/></section>;
}

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

function BookingLinkPanel({ lang }: { lang: Lang }) {
  const snippet =
    '<iframe src="PASTE_SHARED_ARTIFACT_URL_HERE?booking=1" title="Estimate request" width="100%" height="720"></iframe>';
  return (
    <details className="action-details crew-clock-panel">
      <summary>
        {lang === "es"
          ? "Formulario público de estimado"
          : "Public estimate form"}
      </summary>
      <div className="compact-form">
        <p>
          {lang === "es"
            ? "Use ?booking=1 al final del enlace compartido de Crewkat para Facebook o su sitio web."
            : "Add ?booking=1 to the end of the shared Crewkat link for Facebook or your website."}
        </p>
        <label>
          <span>{lang === "es" ? "Código para insertar" : "Embed code"}</span>
          <textarea readOnly rows={4} value={snippet} />
        </label>
      </div>
    </details>
  );
}
