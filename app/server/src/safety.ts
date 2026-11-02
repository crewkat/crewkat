// Safety (0096, SimplySub steals Item 3 — OFFICE ONLY): the toolbox-talk
// library, credential expiry math, and the branded session-proof PDF.
//
// The talk library is CONTENT DATA, not database rows: 24 original talks
// written for Crewkat (never copied from any vendor), each a one-screen
// read of concise bullet points in English AND Spanish. Talks are not
// user-editable in v1; a session either points at a library slug (its
// title + bullets are snapshotted onto the session row at run time, so
// a later library edit never rewrites history) or carries a custom
// title + body the presenter typed for that one session.
//
// Credentials here are the NEW per-team-member records (member_credentials
// table) — contractor license / OSHA cards / CPR etc. held by a person.
// They are distinct from the legacy `credentials` table (business /
// subcontractor paperwork read by Field Intelligence); nothing here
// reads or writes that table.

import { jsPDF } from "jspdf";

export interface SafetyTalk {
  slug: string;
  titleEn: string;
  titleEs: string;
  bulletsEn: string[];
  bulletsEs: string[];
}

export const SAFETY_TALKS: SafetyTalk[] = [
  {
    slug: "ladder-safety",
    titleEn: "Ladder safety",
    titleEs: "Seguridad en escaleras",
    bulletsEn: [
      "Pick the right ladder for the job and check its duty rating covers you plus your tools and materials.",
      "Inspect before every use: rails, rungs, feet, spreaders and locks. Tag out and remove any damaged ladder.",
      "Set up on firm, level ground at a 4-to-1 angle — one foot out for every four feet up — and tie off or have someone foot the base when needed.",
      "Extend an extension ladder at least 3 feet above the landing and never stand on the top two rungs.",
      "Keep three points of contact while climbing; face the ladder and keep your belt buckle between the rails.",
      "Never carry tools in your hands while climbing — use a tool belt or hoist materials with a rope.",
      "Keep ladders away from doors, traffic and overhead power lines; never use a metal ladder near live electrical work.",
      "One person per ladder, and never move or 'walk' a ladder with someone on it.",
    ],
    bulletsEs: [
      "Elija la escalera correcta para el trabajo y verifique que su capacidad cubra su peso más herramientas y materiales.",
      "Inspeccione antes de cada uso: rieles, peldaños, patas, tirantes y seguros. Retire y marque cualquier escalera dañada.",
      "Colóquela sobre suelo firme y nivelado con un ángulo de 4 a 1 — un pie hacia afuera por cada cuatro de altura — y amárrela o pida que alguien sujete la base.",
      "Extienda la escalera de extensión al menos 3 pies por encima del punto de apoyo y nunca se pare en los dos peldaños superiores.",
      "Mantenga tres puntos de contacto al subir; mire hacia la escalera y mantenga la hebilla del cinturón entre los rieles.",
      "Nunca lleve herramientas en las manos al subir — use un cinturón de herramientas o suba los materiales con una cuerda.",
      "Mantenga las escaleras alejadas de puertas, tráfico y cables eléctricos aéreos; nunca use una escalera de metal cerca de trabajo eléctrico activo.",
      "Una sola persona por escalera, y nunca mueva ni 'camine' una escalera con alguien encima.",
    ],
  },
  {
    slug: "fall-protection",
    titleEn: "Fall protection",
    titleEs: "Protección contra caídas",
    bulletsEn: [
      "Fall protection is required when working 6 feet or more above a lower level — guardrails, safety nets, or a personal fall arrest system.",
      "Inspect your harness and lanyard before every use: webbing, stitching, buckles and connectors. Remove damaged gear from service.",
      "Anchor to a point that can support 5,000 pounds per attached worker, and keep the anchor above your dorsal D-ring when possible.",
      "Plan your fall clearance before you tie off — your lanyard, deceleration distance and height must fit above the level below.",
      "Keep 100% tie-off when moving between anchor points; use twin-leg lanyards where anchors are spaced out.",
      "Cover or guard every floor hole and skylight, and mark openings so nobody steps through by mistake.",
      "Never use a ladder, bucket or scaffold rail as an anchor unless it is rated for fall arrest.",
      "If someone falls and is hanging in a harness, call 911 and start the rescue plan immediately — suspension trauma can begin in minutes.",
    ],
    bulletsEs: [
      "Se requiere protección contra caídas al trabajar a 6 pies o más sobre un nivel inferior — barandas, redes de seguridad o un sistema personal de detención de caídas.",
      "Inspeccione su arnés y línea de vida antes de cada uso: cintas, costuras, hebillas y conectores. Retire del servicio el equipo dañado.",
      "Anclese a un punto capaz de soportar 5,000 libras por trabajador conectado, y mantenga el anclaje por encima del anillo dorsal cuando sea posible.",
      "Planifique su distancia libre de caída antes de amarrarse — la línea, la distancia de desaceleración y su altura deben caber sobre el nivel inferior.",
      "Mantenga el amarre al 100% al moverse entre puntos de anclaje; use líneas dobles donde los anclajes estén separados.",
      "Cubra o proteja cada hueco en el piso y tragaluz, y marque las aberturas para que nadie pase por error.",
      "Nunca use una escalera, un balde o una baranda de andamio como anclaje a menos que esté clasificado para detención de caídas.",
      "Si alguien cae y queda colgando del arnés, llame al 911 e inicie el plan de rescate de inmediato — el trauma por suspensión puede comenzar en minutos.",
    ],
  },
  {
    slug: "ppe",
    titleEn: "PPE — personal protective equipment",
    titleEs: "EPP — equipo de protección personal",
    bulletsEn: [
      "Wear the PPE the task calls for: eye and face protection, gloves, hearing protection, respirators, hard hats and hi-vis as assigned.",
      "Safety glasses are the default on site; add goggles or a face shield for grinding, cutting, chipping and chemical splash risks.",
      "Match gloves to the hazard — cut-resistant for sharp stock, chemical-resistant for solvents, leather for rough material handling.",
      "Use hearing protection whenever you must shout to be heard at arm's length, and around saws, breakers and compressors.",
      "A respirator only works with the right cartridge, a clean seal and a fit test — facial hair that breaks the seal breaks the protection.",
      "Inspect PPE before each use, clean it after, and store it out of sun and dust. Replace anything cracked, torn or worn out.",
      "PPE is the last line of defense, not the first: fix the hazard with guards, ventilation and distance whenever you can.",
    ],
    bulletsEs: [
      "Use el EPP que la tarea requiera: protección para ojos y cara, guantes, protección auditiva, respiradores, casco y ropa de alta visibilidad según se asigne.",
      "Las gafas de seguridad son la norma en la obra; agregue gafas herméticas o careta para esmerilar, cortar, picar y riesgos de salpicaduras químicas.",
      "Elija los guantes según el riesgo — resistentes a cortes para material filoso, resistentes a químicos para solventes, cuero para manejo de material áspero.",
      "Use protección auditiva siempre que deba gritar para que le escuchen a un brazo de distancia, y cerca de sierras, martillos demoledores y compresores.",
      "Un respirador solo funciona con el cartucho correcto, un sello limpio y una prueba de ajuste — la barba que rompe el sello rompe la protección.",
      "Inspeccione el EPP antes de cada uso, límpielo después y guárdelo lejos del sol y el polvo. Reemplace todo lo que esté roto, rajado o desgastado.",
      "El EPP es la última línea de defensa, no la primera: elimine el riesgo con guardas, ventilación y distancia siempre que pueda.",
    ],
  },
  {
    slug: "heat-illness",
    titleEn: "Heat illness",
    titleEs: "Enfermedades por calor",
    bulletsEn: [
      "Know the signs: heat cramps, then exhaustion (heavy sweating, nausea, dizziness, headache), then heat stroke — hot dry skin, confusion, collapse. Heat stroke is a 911 emergency.",
      "Drink water before you feel thirsty — about a cup every 15–20 minutes in heavy heat, up to a quart an hour.",
      "Build up to full work in heat over several days; new and returning workers are at the highest risk in their first days.",
      "Use shade and scheduled rest breaks, and rotate heavy tasks to cooler parts of the day when the schedule allows.",
      "Watch your buddy: confusion, slurred speech or stumbling in the heat means stop work, move to shade, cool them and get help.",
      "Cool a heat-stroke victim fast — wet the whole body and fan, or use ice on the neck, armpits and groin — while waiting for EMS.",
      "Limit alcohol the night before and speak up about medicines or conditions that raise heat risk; nobody gets disciplined for reporting symptoms.",
      "Light-colored, loose clothing and a hat help; skip energy drinks and extra caffeine on the hottest days.",
    ],
    bulletsEs: [
      "Conozca las señales: calambres por calor, luego agotamiento (sudor abundante, náuseas, mareos, dolor de cabeza) y después golpe de calor — piel caliente y seca, confusión, desmayo. El golpe de calor es una emergencia: llame al 911.",
      "Beba agua antes de sentir sed — aproximadamente una taza cada 15–20 minutos con calor intenso, hasta un cuarto de galón por hora.",
      "Adáptese al trabajo con calor de forma gradual durante varios días; los trabajadores nuevos o que regresan tienen el mayor riesgo en sus primeros días.",
      "Use la sombra y descansos programados, y pase las tareas pesadas a las horas más frescas del día cuando el horario lo permita.",
      "Vigile a su compañero: confusión, dificultad para hablar o tropiezos con calor significan detener el trabajo, llevarlo a la sombra, refrescarlo y buscar ayuda.",
      "Enfríe rápido a una víctima de golpe de calor — moje todo el cuerpo y abanique, o ponga hielo en cuello, axilas e ingle — mientras llega la ayuda médica.",
      "Limite el alcohol la noche anterior y avise sobre medicamentos o condiciones que aumenten el riesgo por calor; nadie será sancionado por reportar síntomas.",
      "La ropa clara y holgada y un sombrero ayudan; evite las bebidas energéticas y el exceso de cafeína en los días más calurosos.",
    ],
  },
  {
    slug: "electrical-safety",
    titleEn: "Electrical safety",
    titleEs: "Seguridad eléctrica",
    bulletsEn: [
      "Treat every circuit as live until it is tested dead. Only qualified electricians open panels and work on energized equipment.",
      "Lock out and tag out before servicing tools, equipment or circuits — and verify with a tester before touching conductors.",
      "Use GFCI protection for all temporary power on site; test GFCIs daily and replace cords with damaged insulation or missing ground pins.",
      "Keep at least 10 feet from overhead power lines — more for higher voltages — and treat downed lines as energized.",
      "Never use electrical tape as a repair; damaged cords come out of service until properly fixed or replaced.",
      "Keep panels, disconnects and breaker boxes accessible with 3 feet of clear working space.",
      "Water and electricity don't mix: keep cords, tools and connections out of standing water, and dry hands before handling plugs.",
      "If someone receives a shock, don't touch them until the power is off; call 911 and report every shock, even a 'small' one.",
    ],
    bulletsEs: [
      "Trate todo circuito como activo hasta comprobar que no tiene energía. Solo electricistas calificados abren paneles y trabajan en equipos energizados.",
      "Bloquee y etiquete antes de dar servicio a herramientas, equipos o circuitos — y verifique con un probador antes de tocar conductores.",
      "Use protección GFCI en toda la energía temporal de la obra; pruebe los GFCI a diario y reemplace cables con aislamiento dañado o sin clavija de tierra.",
      "Manténgase al menos a 10 pies de los cables eléctricos aéreos — más para voltajes mayores — y trate los cables caídos como energizados.",
      "Nunca use cinta aislante como reparación; los cables dañados salen de servicio hasta repararlos o reemplazarlos correctamente.",
      "Mantenga paneles, interruptores y cajas de breakers accesibles con 3 pies de espacio libre de trabajo.",
      "El agua y la electricidad no se mezclan: mantenga cables, herramientas y conexiones fuera del agua estancada y séquese las manos antes de tocar enchufes.",
      "Si alguien recibe una descarga, no lo toque hasta cortar la energía; llame al 911 y reporte toda descarga, aunque parezca pequeña.",
    ],
  },
  {
    slug: "silica-dust",
    titleEn: "Silica dust",
    titleEs: "Polvo de sílice",
    bulletsEn: [
      "Cutting, grinding, mixing or demolishing concrete, block, tile and stone creates respirable silica dust that permanently damages lungs.",
      "Water is the first control: wet-cut, wet-sweep and use mist so dust never becomes airborne.",
      "Use vacuum attachments with HEPA filters and shrouds fitted to the tool for grinding, mixing and drilling.",
      "Never dry-sweep or use compressed air to clean dusty surfaces or clothing where silica dust is present.",
      "Work upwind outdoors when you can, and keep bystanders and other trades out of the dust area.",
      "Wear the assigned respirator for high-dust tasks — at minimum a properly fitted respirator rated for silica work.",
      "Wash hands and face before eating, drinking or smoking, and change out of dusty clothes before heading home to family.",
      "Tell your supervisor if a dust control stops working — a dry blade or clogged vacuum means stop and fix it, not push through.",
    ],
    bulletsEs: [
      "Cortar, esmerilar, mezclar o demoler concreto, bloque, loseta y piedra crea polvo de sílice respirable que daña los pulmones de forma permanente.",
      "El agua es el primer control: corte en húmedo, barra en húmedo y use neblina para que el polvo nunca se levante.",
      "Use aspiradoras con filtros HEPA y cubiertas ajustadas a la herramienta para esmerilar, mezclar y perforar.",
      "Nunca barra en seco ni use aire comprimido para limpiar superficies o ropa con polvo de sílice.",
      "Trabaje a favor del viento al aire libre cuando pueda, y mantenga a otras personas fuera de la zona de polvo.",
      "Use el respirador asignado para tareas con mucho polvo — como mínimo un respirador bien ajustado y clasificado para trabajo con sílice.",
      "Lávese las manos y la cara antes de comer, beber o fumar, y cámbiese la ropa con polvo antes de volver a casa con su familia.",
      "Avise a su supervisor si un control de polvo deja de funcionar — una hoja seca o una aspiradora tapada significa detenerse y corregir, no seguir adelante.",
    ],
  },
  {
    slug: "housekeeping-trip-hazards",
    titleEn: "Housekeeping & trip hazards",
    titleEs: "Orden, limpieza y riesgos de tropiezo",
    bulletsEn: [
      "A clean site is a safe site: stack materials neatly, keep walkways and stairs clear, and never leave debris 'for later'.",
      "Run cords and hoses overhead or along walls; cover unavoidable crossings and never stretch a cord across a walkway unprotected.",
      "Pick up offcuts, strap scraps and nail-studded boards as you go — bend nails over or pull them from scrap lumber.",
      "Keep exits, panels, extinguishers and first-aid points clear at all times.",
      "Store flammables, solvents and oily rags in their proper closed containers, away from heat and ignition sources.",
      "Clean spills immediately and flag wet or uneven floors until they are fixed or dry.",
      "End each day with a 10-minute reset: tools put away, trash in the dumpster, materials staged for tomorrow.",
    ],
    bulletsEs: [
      "Una obra limpia es una obra segura: apile los materiales con orden, mantenga pasillos y escaleras libres y nunca deje escombros 'para después'.",
      "Pase los cables y mangueras por arriba o pegados a las paredes; proteja los cruces inevitables y nunca deje un cable atravesando un pasillo sin protección.",
      "Recoja recortes, sobrantes y tablas con clavos sobre la marcha — doble los clavos o sáquelos de la madera de desecho.",
      "Mantenga libres en todo momento las salidas, paneles, extintores y puntos de primeros auxilios.",
      "Guarde inflamables, solventes y trapos con aceite en sus recipientes cerrados adecuados, lejos del calor y de fuentes de ignición.",
      "Limpie los derrames de inmediato y señale los pisos mojados o desnivelados hasta que se corrijan o sequen.",
      "Termine cada día con 10 minutos de orden: herramientas guardadas, basura en el contenedor y materiales listos para mañana.",
    ],
  },
  {
    slug: "power-tools",
    titleEn: "Power tools",
    titleEs: "Herramientas eléctricas",
    bulletsEn: [
      "Use the right tool for the task and never defeat or remove a guard — guards go back on before the tool is used again.",
      "Inspect cords, plugs, blades and bits before use; a tool that sparks, smokes or has a damaged cord comes out of service.",
      "Disconnect power before changing blades or bits, making adjustments, or clearing a jam.",
      "Let blades reach full speed before cutting and stop completely before you set the tool down.",
      "Clamp small work — never hold a piece by hand near a spinning blade, and keep both hands on the tool where it is designed for two.",
      "Keep cords behind you and out of the cutting path; use battery tools where cords create a trip or cut risk.",
      "No loose clothing, jewelry or gloves near rotating parts; tie back long hair.",
      "Report any tool that 'feels wrong' — vibration, noise or smell changes are early warnings, not quirks.",
    ],
    bulletsEs: [
      "Use la herramienta correcta para la tarea y nunca elimine ni anule una guarda — las guardas se reinstalan antes de volver a usar la herramienta.",
      "Inspeccione cables, enchufes, hojas y brocas antes de usar; una herramienta que echa chispas, humo o tiene el cable dañado sale de servicio.",
      "Desconecte la energía antes de cambiar hojas o brocas, hacer ajustes o desatascar la herramienta.",
      "Deje que la hoja alcance su velocidad completa antes de cortar y espere a que se detenga por completo antes de soltar la herramienta.",
      "Sujete las piezas pequeñas con prensa — nunca sostenga una pieza con la mano cerca de una hoja girando, y use ambas manos donde la herramienta está diseñada para dos.",
      "Mantenga los cables detrás de usted y fuera de la trayectoria de corte; use herramientas de batería donde los cables creen riesgo de tropiezo o corte.",
      "Nada de ropa suelta, joyas o guantes cerca de partes giratorias; recoja el cabello largo.",
      "Reporte cualquier herramienta que 'se sienta mal' — cambios en vibración, ruido u olor son advertencias tempranas, no detalles sin importancia.",
    ],
  },
  {
    slug: "hand-tools",
    titleEn: "Hand tools",
    titleEs: "Herramientas manuales",
    bulletsEn: [
      "Choose the correct size and type: a wrench that slips and a screwdriver used as a chisel both cause injuries.",
      "Keep cutting edges sharp — a dull blade needs more force and slips more easily — and carry sharp tools in sheaths or pouches, never pockets.",
      "Cut away from your body and keep your free hand out of the cutting path.",
      "Inspect handles before use: split, cracked or mushroomed striking faces get repaired or replaced, not taped.",
      "Pull a wrench toward you when possible instead of pushing, and keep your footing in case it slips.",
      "Never use cheater bars or extensions the tool wasn't made for, and never use a tool as a hammer unless it is one.",
      "Put tools back in the box or belt when done — a tool left on a ladder top or floor edge becomes someone else's accident.",
    ],
    bulletsEs: [
      "Elija el tamaño y tipo correctos: una llave que resbala y un destornillador usado como cincel causan lesiones.",
      "Mantenga los filos afilados — una hoja sin filo requiere más fuerza y resbala más fácil — y lleve las herramientas filosas en fundas o bolsas, nunca en los bolsillos.",
      "Corte alejando la herramienta de su cuerpo y mantenga la mano libre fuera de la trayectoria de corte.",
      "Inspeccione los mangos antes de usar: las caras de golpe rajadas, rotas o deformadas se reparan o reemplazan, no se encintan.",
      "Jale la llave hacia usted cuando sea posible en vez de empujarla, y mantenga buen apoyo por si resbala.",
      "Nunca use extensiones o palancas para las que la herramienta no fue hecha, y nunca use una herramienta como martillo a menos que lo sea.",
      "Guarde las herramientas en la caja o el cinturón al terminar — una herramienta olvidada sobre una escalera o el borde del piso será el accidente de otro.",
    ],
  },
  {
    slug: "trenching-excavation",
    titleEn: "Trenching & excavation awareness",
    titleEs: "Zanjas y excavaciones — concientización",
    bulletsEn: [
      "A trench collapse can bury a worker in seconds — never enter an unprotected trench 5 feet deep or more.",
      "Protective systems (sloping, shoring or shielding) are designed and checked by the competent person — do not improvise them.",
      "The competent person inspects the excavation daily and after rain or any change in conditions before anyone enters.",
      "Keep spoil piles, materials and equipment at least 2 feet back from the edge, and barricade open excavations.",
      "Use a ladder, ramp or stairway for access at least every 25 feet of travel inside the trench.",
      "Stay out of trenches where water is accumulating, and never work under loads being lifted over the excavation.",
      "Call 811 and confirm locates before digging; hand-dig carefully near marked utilities.",
      "If soil looks cracked, slumped or layered differently than expected, get out and tell the competent person.",
    ],
    bulletsEs: [
      "El derrumbe de una zanja puede enterrar a un trabajador en segundos — nunca entre a una zanja sin protección de 5 pies de profundidad o más.",
      "Los sistemas de protección (taludes, apuntalamiento o blindaje) son diseñados y revisados por la persona competente — no los improvise.",
      "La persona competente inspecciona la excavación a diario y después de lluvia o cualquier cambio en las condiciones antes de que alguien entre.",
      "Mantenga la tierra excavada, los materiales y el equipo al menos a 2 pies del borde, y ponga barricadas en las excavaciones abiertas.",
      "Use una escalera, rampa o escalinata de acceso al menos cada 25 pies de recorrido dentro de la zanja.",
      "No permanezca en zanjas donde se acumula agua, y nunca trabaje bajo cargas que se estén levantando sobre la excavación.",
      "Llame al 811 y confirme las localizaciones antes de excavar; excave a mano con cuidado cerca de los servicios marcados.",
      "Si la tierra se ve agrietada, hundida o con capas diferentes a lo esperado, salga y avise a la persona competente.",
    ],
  },
  {
    slug: "driving-jobsite-vehicles",
    titleEn: "Driving & jobsite vehicles",
    titleEs: "Manejo y vehículos en la obra",
    bulletsEn: [
      "Seat belts every trip, every seat — and no phone in hand while driving. Pull over to read a text or an address.",
      "Walk around the vehicle before backing; use a spotter whenever your view is blocked, and agree on hand signals first.",
      "Back-in parking where possible so the first move of the day is forward, with a clear view.",
      "Slow down on site: watch for workers on foot, uneven ground, overhead obstructions and stacked materials.",
      "Secure every load — tools, ladders and material — so nothing shifts or falls in traffic or on site.",
      "Never ride in the bed, on running boards, or on forks or buckets; riders sit in seats with belts.",
      "Report every vehicle incident, scrape or near-miss the same day, however small it looks.",
      "Fatigue and rushing cause most driving incidents: plan the route, leave margin, and never let a schedule talk you into speeding.",
    ],
    bulletsEs: [
      "Cinturón de seguridad en cada viaje y cada asiento — y nada de teléfono en la mano al manejar. Deténgase para leer un mensaje o una dirección.",
      "Rodee el vehículo caminando antes de retroceder; use un guía siempre que su vista esté bloqueada y acuerden las señales con las manos primero.",
      "Estaciónese de reversa cuando sea posible para que el primer movimiento del día sea hacia adelante, con vista despejada.",
      "Reduzca la velocidad en la obra: vigile a los trabajadores a pie, el terreno irregular, obstrucciones elevadas y materiales apilados.",
      "Asegure toda la carga — herramientas, escaleras y material — para que nada se mueva o caiga en el tráfico o en la obra.",
      "Nunca viaje en la caja, en los estribos, ni en horquillas o baldes; los pasajeros van en asientos con cinturón.",
      "Reporte el mismo día todo incidente vehicular, roce o casi-accidente, por pequeño que parezca.",
      "El cansancio y la prisa causan la mayoría de los incidentes al manejar: planifique la ruta, deje margen y nunca deje que un horario lo empuje a exceder la velocidad.",
    ],
  },
  {
    slug: "lifting-back-safety",
    titleEn: "Lifting & back safety",
    titleEs: "Levantamiento y cuidado de la espalda",
    bulletsEn: [
      "Plan the lift before you start: check the weight, the path and where the load will land.",
      "Use carts, dollies, hoists and team lifts for heavy or awkward items — ask for help instead of testing your back.",
      "Lift with your legs: feet shoulder-width, back straight, load close to your body, and a firm grip.",
      "Never twist while carrying — turn with your feet. Set the load down with the same leg-driven motion.",
      "Team lifts need one caller: agree on the lift, the path and the set-down before anyone picks up.",
      "Break heavy loads into smaller ones when you can, and stage materials close to where they will be installed.",
      "Report back pain or strain early — small strains treated early rarely become lost-time injuries.",
    ],
    bulletsEs: [
      "Planifique el levantamiento antes de empezar: revise el peso, el camino y dónde se colocará la carga.",
      "Use carritos, plataformas con ruedas, polipastos y levantamientos en equipo para objetos pesados o incómodos — pida ayuda en vez de probar su espalda.",
      "Levante con las piernas: pies al ancho de los hombros, espalda recta, carga pegada al cuerpo y agarre firme.",
      "Nunca gire el cuerpo mientras carga — gire con los pies. Baje la carga con el mismo movimiento de piernas.",
      "Los levantamientos en equipo necesitan una sola persona que dirija: acuerden el levantamiento, el camino y la bajada antes de cargar.",
      "Divida las cargas pesadas en partes más pequeñas cuando pueda, y coloque los materiales cerca de donde se instalarán.",
      "Reporte temprano el dolor o la tensión en la espalda — las lesiones pequeñas tratadas a tiempo rara vez se vuelven incapacidades.",
    ],
  },
  {
    slug: "scaffolding-awareness",
    titleEn: "Scaffolding awareness",
    titleEs: "Andamios — concientización",
    bulletsEn: [
      "Only trained, authorized workers erect, alter or dismantle scaffolds — and a competent person inspects them before each shift.",
      "Check the inspection tag before climbing; a scaffold without a current tag is off limits.",
      "Scaffold must be fully planked with guardrails, midrails and toe boards when working 10 feet or more above a lower level.",
      "Keep platforms clear: no material stockpiles, no leaning ladders against rails, no standing on buckets or boxes for extra height.",
      "Climb the built-in access ladder or stairs — never cross-braces — and keep three points of contact.",
      "Never move a rolling scaffold with anyone on it, and lock casters before working.",
      "Stay at least 10 feet from power lines, and never overload a platform beyond its rated capacity.",
      "Report loose planks, missing pins or bent frames immediately — do not 'make do' with a damaged scaffold.",
    ],
    bulletsEs: [
      "Solo trabajadores capacitados y autorizados arman, modifican o desarman andamios — y una persona competente los inspecciona antes de cada turno.",
      "Revise la etiqueta de inspección antes de subir; un andamio sin etiqueta vigente está prohibido.",
      "El andamio debe estar totalmente entablado, con barandas, barandas intermedias y rodapiés al trabajar a 10 pies o más sobre un nivel inferior.",
      "Mantenga las plataformas libres: nada de acopios de material, escaleras apoyadas en las barandas, ni pararse sobre baldes o cajas para ganar altura.",
      "Suba por la escalera o escalinata incorporada — nunca por los travesaños — y mantenga tres puntos de contacto.",
      "Nunca mueva un andamio rodante con alguien encima, y bloquee las ruedas antes de trabajar.",
      "Manténgase al menos a 10 pies de los cables eléctricos y nunca sobrecargue una plataforma más allá de su capacidad nominal.",
      "Reporte de inmediato tablas sueltas, pasadores faltantes o marcos doblados — no se conforme con un andamio dañado.",
    ],
  },
  {
    slug: "roofing-safety",
    titleEn: "Roofing safety",
    titleEs: "Seguridad en techos",
    bulletsEn: [
      "Fall protection on roofs: guardrails, nets or a personal fall arrest system — on steep roofs, tie off before stepping out of the access point.",
      "Check the deck before loading it: rotted or spongy areas get marked and avoided until repaired.",
      "Use the roof bracket, ladder or lift to move material — never carry bundles up a ladder by hand.",
      "Watch the weather: wet, icy or windy roofs are stop-work conditions, not challenges.",
      "Keep a clean roof: tear-off debris goes down the chute or designated drop zone — never toss material without a spotter and a barricaded area below.",
      "Guard skylights and openings — they do not hold a person's weight, even when they look solid.",
      "Plan heat into the day: roofing amplifies sun exposure, so water, shade breaks and an early start matter.",
      "Set ladders on firm ground, extended 3 feet above the eave, and tie them off so they cannot slip.",
    ],
    bulletsEs: [
      "Protección contra caídas en techos: barandas, redes o sistema personal de detención de caídas — en techos inclinados, amárrese antes de salir del punto de acceso.",
      "Revise la superficie del techo antes de cargarla: las zonas podridas o blandas se marcan y se evitan hasta repararlas.",
      "Use el soporte de techo, la escalera o el elevador para mover material — nunca suba paquetes a mano por la escalera.",
      "Vigile el clima: techos mojados, con hielo o con viento son condición de detener el trabajo, no un reto.",
      "Mantenga el techo limpio: los escombros van por el conducto o la zona de caída designada — nunca lance material sin un vigía y un área con barricadas abajo.",
      "Proteja los tragaluces y aberturas — no soportan el peso de una persona, aunque parezcan sólidos.",
      "Incluya el calor en la planificación del día: el techo amplifica la exposición al sol, así que el agua, los descansos a la sombra y empezar temprano importan.",
      "Coloque las escaleras sobre suelo firme, extendidas 3 pies por encima del alero, y amárrelas para que no resbalen.",
    ],
  },
  {
    slug: "concrete-masonry",
    titleEn: "Concrete & masonry",
    titleEs: "Concreto y mampostería",
    bulletsEn: [
      "Wet concrete is caustic: gloves, long sleeves and eye protection are mandatory, and wash skin contact off right away — cement burns get worse the longer they sit.",
      "Use wet-cutting and vacuum controls for silica dust when sawing, mixing or demoing concrete and block.",
      "Guard rebar: cap exposed vertical and horizontal bar ends that anyone could fall or step onto.",
      "Shoring and formwork are engineered — never remove forms or shores early or alter them without the go-ahead.",
      "Chute and pump work: stay clear of the pump hopper and hose whip zones, and never stand where a swinging chute can reach you.",
      "Lift block and bags with your legs and team help; masonry units are heavier than they look and most strains happen at the end of the day.",
      "Keep mixer and saw guards in place, and lock out equipment before clearing a jam or cleaning the drum.",
    ],
    bulletsEs: [
      "El concreto fresco es cáustico: guantes, mangas largas y protección para los ojos son obligatorios, y lave el contacto con la piel de inmediato — las quemaduras de cemento empeoran cuanto más tiempo pasan.",
      "Use corte en húmedo y controles de aspirado para el polvo de sílice al cortar, mezclar o demoler concreto y bloque.",
      "Proteja la varilla: tape los extremos expuestos verticales y horizontales sobre los que alguien pueda caer o pisar.",
      "El apuntalamiento y la cimbra son trabajo de ingeniería — nunca retire cimbras o puntales antes de tiempo ni los modifique sin autorización.",
      "Trabajo con canalones y bombas: manténgase fuera de la tolva de la bomba y de las zonas de latigazo de la manguera, y nunca se pare donde un canalón en movimiento pueda alcanzarlo.",
      "Levante bloques y sacos con las piernas y ayuda del equipo; las piezas de mampostería pesan más de lo que parecen y la mayoría de las lesiones ocurren al final del día.",
      "Mantenga las guardas de mezcladoras y sierras en su lugar, y bloquee el equipo antes de desatascarlo o limpiar el tambor.",
    ],
  },
  {
    slug: "painting-chemicals",
    titleEn: "Painting & chemicals",
    titleEs: "Pintura y productos químicos",
    bulletsEn: [
      "Read the label and the safety data sheet before opening a new product — they state the PPE, ventilation and first aid for that exact chemical.",
      "Ventilate enclosed spaces when spraying or using solvents; keep ignition sources away from flammable vapors.",
      "Wear chemical-resistant gloves and eye protection for mixing, spraying and cleanup; add a respirator for spraying and strong solvents.",
      "Never mix products — especially bleach with ammonia or acids — and never pour chemicals into unlabeled or food containers.",
      "Label every secondary container with the product name and hazard, the day it is filled.",
      "Store paints and solvents closed, upright and away from heat; oily rags go in a closed metal container to prevent spontaneous fires.",
      "Know where the eyewash and first-aid kit are before you start; skin and eye exposures get flushed with water for at least 15 minutes.",
      "Dispose of leftover paint, solvents and wash water by the project rules — never into soil, storm drains or site trash unless approved.",
    ],
    bulletsEs: [
      "Lea la etiqueta y la hoja de datos de seguridad antes de abrir un producto nuevo — indican el EPP, la ventilación y los primeros auxilios para ese químico exacto.",
      "Ventile los espacios cerrados al rociar o usar solventes; mantenga las fuentes de ignición lejos de los vapores inflamables.",
      "Use guantes resistentes a químicos y protección para los ojos al mezclar, rociar y limpiar; agregue respirador para rociado y solventes fuertes.",
      "Nunca mezcle productos — en especial cloro con amoníaco o ácidos — y nunca vierta químicos en recipientes sin etiqueta o de alimentos.",
      "Etiquete cada recipiente secundario con el nombre del producto y el riesgo, el mismo día en que lo llena.",
      "Guarde pinturas y solventes cerrados, en posición vertical y lejos del calor; los trapos con aceite van en un recipiente metálico cerrado para evitar incendios espontáneos.",
      "Sepa dónde están el lavaojos y el botiquín antes de empezar; las exposiciones en piel y ojos se enjuagan con agua por al menos 15 minutos.",
      "Deseche la pintura, los solventes y el agua de lavado sobrantes según las reglas del proyecto — nunca en el suelo, drenajes pluviales o basura de la obra sin aprobación.",
    ],
  },
  {
    slug: "fire-safety-extinguishers",
    titleEn: "Fire safety & extinguishers",
    titleEs: "Seguridad contra incendios y extintores",
    bulletsEn: [
      "Know the fire extinguisher locations on site before hot work starts — and keep them unblocked at all times.",
      "PASS: Pull the pin, Aim at the base of the fire, Squeeze the handle, Sweep side to side. Only fight a small, contained fire, with your exit behind you.",
      "If the fire grows, spreads or fills the area with smoke: get out, close doors behind you, and call 911. No tool or material is worth going back for.",
      "Hot work (grinding, cutting, soldering, roofing torches) needs a clear area, combustibles moved or covered, and a fire watch during and after the work.",
      "Keep fuel, solvents and propane stored upright, capped and away from ignition sources and building exits.",
      "Oily and solvent-soaked rags go into closed metal cans — they can self-ignite in a pile or trash bin.",
      "Never block exits, stairways or electrical panels with material, and keep the site address posted for responders.",
      "Report any extinguisher you use or find discharged or expired so it is recharged or replaced the same day.",
    ],
    bulletsEs: [
      "Conozca la ubicación de los extintores en la obra antes de empezar trabajo en caliente — y manténgalos despejados en todo momento.",
      "Método PASS: jale el pasador (Pull), apunte a la base del fuego (Aim), apriete la manija (Squeeze) y barra de lado a lado (Sweep). Combata solo un fuego pequeño y contenido, con su salida detrás de usted.",
      "Si el fuego crece, se extiende o llena el área de humo: salga, cierre las puertas tras de usted y llame al 911. Ninguna herramienta o material vale regresar por él.",
      "El trabajo en caliente (esmerilar, cortar, soldar, sopletes de techo) requiere un área despejada, combustibles alejados o cubiertos, y un vigía de incendios durante y después del trabajo.",
      "Guarde combustible, solventes y propano en posición vertical, tapados y lejos de fuentes de ignición y salidas del edificio.",
      "Los trapos con aceite o solvente van en latas metálicas cerradas — pueden encenderse solos en un montón o en la basura.",
      "Nunca bloquee salidas, escaleras o paneles eléctricos con material, y mantenga visible la dirección de la obra para los servicios de emergencia.",
      "Reporte todo extintor que use o encuentre descargado o vencido para recargarlo o reemplazarlo el mismo día.",
    ],
  },
  {
    slug: "first-aid-readiness",
    titleEn: "First aid readiness",
    titleEs: "Preparación en primeros auxilios",
    bulletsEn: [
      "Know where the first-aid kit, eyewash and AED are on your site — before you need them, not after.",
      "Know who on the crew is first-aid / CPR trained and how to reach them fast.",
      "For serious bleeding: apply firm direct pressure with a clean dressing and keep pressure on; call 911 for bleeding that won't stop.",
      "Post the site address and the nearest hospital location where the whole crew can find them; send one person to guide responders in.",
      "Report every injury, however minor, the same shift — small cuts and strains documented early protect the worker and the crew.",
      "Restock what you use: an empty kit is a finding on the next inspection, and a problem in the next emergency.",
      "If you feel dizzy, ill or impaired in any way, tell your lead before starting work — readiness includes saying something.",
    ],
    bulletsEs: [
      "Sepa dónde están el botiquín, el lavaojos y el desfibrilador (AED) en su obra — antes de necesitarlos, no después.",
      "Sepa quién del equipo está capacitado en primeros auxilios y RCP y cómo localizarlo rápido.",
      "Para sangrado serio: aplique presión directa y firme con un vendaje limpio y manténgala; llame al 911 si el sangrado no se detiene.",
      "Coloque la dirección de la obra y el hospital más cercano donde todo el equipo pueda verlos; envíe a una persona a guiar a los servicios de emergencia.",
      "Reporte toda lesión, por menor que sea, en el mismo turno — los cortes y torceduras documentados temprano protegen al trabajador y al equipo.",
      "Reponga lo que utilice: un botiquín vacío es una observación en la próxima inspección y un problema en la próxima emergencia.",
      "Si se siente mareado, enfermo o afectado de cualquier forma, avise a su líder antes de empezar a trabajar — estar preparado incluye decirlo.",
    ],
  },
  {
    slug: "weather-lightning-cold",
    titleEn: "Weather — lightning & cold",
    titleEs: "Clima — rayos y frío",
    bulletsEn: [
      "Lightning rule: when thunder roars, go indoors. Stop outdoor work at the first thunder or visible lightning and wait 30 minutes after the last thunder before resuming.",
      "Safe shelter is a substantial building or a hard-topped vehicle — not a shed, tarp, tree or open equipment.",
      "Secure loose materials ahead of storms; unsecured plywood and metal become projectiles in high wind.",
      "Cold stress is real too, even in the South: wet clothing plus wind pulls heat fast. Layer up, keep a dry change of clothes, and take warm-up breaks.",
      "Know cold-illness signs: shivering that stops, numb pale skin, confusion and slurred speech all mean get the person warm and get help.",
      "Rain changes everything: slippery roofs and ladders, unstable soil, and electrical hazards all get worse when wet.",
      "Nobody argues with a weather stop — if your lead calls it, secure the work and come down.",
    ],
    bulletsEs: [
      "Regla de los rayos: cuando truene, entre a un lugar seguro. Detenga el trabajo al aire libre al primer trueno o rayo visible y espere 30 minutos después del último trueno antes de continuar.",
      "Un refugio seguro es un edificio sólido o un vehículo con techo rígido — no un cobertizo, una lona, un árbol o equipo abierto.",
      "Asegure los materiales sueltos antes de las tormentas; el contrachapado y el metal sin asegurar se vuelven proyectiles con viento fuerte.",
      "El estrés por frío también es real, incluso en el sur: la ropa mojada más el viento quitan calor rápido. Vístase en capas, tenga un cambio de ropa seca y tome descansos para calentarse.",
      "Conozca las señales de enfermedad por frío: temblores que se detienen, piel pálida y entumecida, confusión y dificultad para hablar significan calentar a la persona y buscar ayuda.",
      "La lluvia lo cambia todo: techos y escaleras resbalosos, suelo inestable y riesgos eléctricos empeoran con la humedad.",
      "Nadie discute una parada por clima — si su líder la ordena, asegure el trabajo y baje.",
    ],
  },
  {
    slug: "utility-locates-811",
    titleEn: "Utility locates (811)",
    titleEs: "Localización de servicios (811)",
    bulletsEn: [
      "Call 811 (or submit online) at least two full business days before any digging — including posts, footings, trenches and grading.",
      "Mark your dig area in white paint or flags first, so locators know exactly where you plan to excavate.",
      "Wait for every utility to respond and confirm marks before the shovel or machine touches the ground.",
      "Respect the marks: the tolerance zone is about 24 inches on either side of a marked line — hand-dig or vacuum-excavate inside it.",
      "If you expose a utility, stop and verify it matches the marks; if you damage one, move to safety, call 911 if anyone is at risk, then notify the utility and your supervisor.",
      "Marks fade and get disturbed: if locates expire, are unclear or the scope changes, request a re-mark before digging.",
      "Private lines (irrigation, site lighting, homeowner runs past the meter) are NOT located by 811 — plan separately for those.",
    ],
    bulletsEs: [
      "Llame al 811 (o haga la solicitud en línea) al menos dos días laborables completos antes de cualquier excavación — incluyendo postes, zapatas, zanjas y nivelación.",
      "Marque primero su área de excavación con pintura blanca o banderas, para que los localizadores sepan exactamente dónde planea excavar.",
      "Espere a que cada compañía de servicios responda y confirme las marcas antes de que la pala o la máquina toquen el suelo.",
      "Respete las marcas: la zona de tolerancia es de unas 24 pulgadas a cada lado de la línea marcada — excave a mano o con aspiradora dentro de ella.",
      "Si expone un servicio, deténgase y verifique que coincida con las marcas; si daña uno, aléjese a un lugar seguro, llame al 911 si alguien está en riesgo y luego avise a la compañía y a su supervisor.",
      "Las marcas se borran y se alteran: si las localizaciones vencen, no son claras o el trabajo cambia, solicite una nueva marcación antes de excavar.",
      "Las líneas privadas (riego, alumbrado del sitio, líneas del propietario después del medidor) NO las localiza el 811 — planifique aparte para ellas.",
    ],
  },
  {
    slug: "demolition-awareness",
    titleEn: "Demolition awareness",
    titleEs: "Demolición — concientización",
    bulletsEn: [
      "Survey before demo: confirm power, water, gas and HVAC are shut off and verified dead in the work area — never trust a switch position alone.",
      "Check for hazards in older buildings before disturbing them: asbestos-containing materials and lead paint require licensed handling — stop and ask if you suspect either.",
      "Demo works top-down and in a planned sequence; never remove structural members outside the plan, and shore anything questionable.",
      "Control the dust: wet methods and ventilation protect you, the crew and the homeowner's home.",
      "Keep the drop zone barricaded and a spotter posted; nobody works below active tear-out.",
      "Watch for hidden hazards in walls and ceilings: live wires, pressurized lines, pests, mold and stored chemicals all show up in demo.",
      "Load debris out steadily — piles of demo waste block exits, hide hazards and overload floors.",
    ],
    bulletsEs: [
      "Inspeccione antes de demoler: confirme que electricidad, agua, gas y climatización estén cortados y verificados sin energía en el área — nunca confíe solo en la posición de un interruptor.",
      "Busque riesgos en edificios antiguos antes de alterarlos: los materiales con asbesto y la pintura con plomo requieren manejo con licencia — deténgase y pregunte si sospecha de cualquiera de ellos.",
      "La demolición trabaja de arriba hacia abajo y en una secuencia planeada; nunca retire elementos estructurales fuera del plan y apuntale todo lo dudoso.",
      "Controle el polvo: los métodos húmedos y la ventilación lo protegen a usted, al equipo y a la casa del cliente.",
      "Mantenga la zona de caída con barricadas y un vigía asignado; nadie trabaja debajo de una demolición activa.",
      "Vigile los riesgos ocultos en paredes y techos: cables activos, tuberías con presión, plagas, moho y químicos almacenados aparecen en la demolición.",
      "Retire los escombros de forma continua — los montones de desechos bloquean salidas, esconden riesgos y sobrecargan los pisos.",
    ],
  },
  {
    slug: "working-around-public",
    titleEn: "Working around the public",
    titleEs: "Trabajar cerca del público",
    bulletsEn: [
      "Homeowners, kids, neighbors and pets don't know site hazards — barricade work zones, drop zones and open excavations every time, even 'just for an hour'.",
      "Keep a clean, marked path for residents to reach their door, and never leave tools, cords or materials in it.",
      "Watch backing and swinging equipment extra carefully where the public can approach; use a spotter near streets, sidewalks and driveways.",
      "Secure the site at the end of the day: ladders down or locked, materials stacked, hazards fenced — an unattended site attracts curious visitors.",
      "Be the professional face of the company: explain noise, dust and timing politely, and route complaints to the lead instead of debating them.",
      "If a member of the public enters the work zone, stop the risky work first, then escort them out courteously.",
      "Protect parked cars, landscaping and neighboring property with covers and distance — damage prevention is cheaper than repair.",
    ],
    bulletsEs: [
      "Los propietarios, niños, vecinos y mascotas no conocen los riesgos de la obra — ponga barricadas en las zonas de trabajo, de caída y en excavaciones abiertas siempre, aunque sea 'solo por una hora'.",
      "Mantenga un camino limpio y marcado para que los residentes lleguen a su puerta, y nunca deje herramientas, cables o materiales en él.",
      "Vigile con cuidado extra el equipo en reversa o en giro donde el público puede acercarse; use un vigía cerca de calles, aceras y entradas de vehículos.",
      "Asegure la obra al final del día: escaleras bajadas o aseguradas, materiales apilados, riesgos cercados — una obra sin supervisión atrae visitantes curiosos.",
      "Sea la cara profesional de la empresa: explique el ruido, el polvo y los horarios con cortesía, y pase las quejas al líder en vez de discutirlas.",
      "Si una persona del público entra a la zona de trabajo, detenga primero el trabajo riesgoso y luego acompáñela fuera con cortesía.",
      "Proteja los autos estacionados, la jardinería y la propiedad vecina con cubiertas y distancia — prevenir el daño es más barato que repararlo.",
    ],
  },
  {
    slug: "fatigue",
    titleEn: "Fatigue",
    titleEs: "Fatiga",
    bulletsEn: [
      "Fatigue slows reaction time like alcohol does — a tired worker on a roof, ladder or saw is a serious hazard.",
      "Watch for the signs in yourself and your crew: yawning, drifting attention, missed steps, irritability and 'zoning out'.",
      "Speak up before an incident, not after: telling your lead you're wiped is professionalism, not weakness.",
      "Sleep is the only real fix — caffeine and energy drinks mask fatigue for a short while and then make the crash worse.",
      "Rotate the heaviest and most repetitive tasks, and use scheduled breaks to actually rest, eat and hydrate.",
      "Long drives after long shifts are high-risk: if you're too tired to drive safely, say so and arrange another way home.",
      "If a teammate looks dangerously fatigued, flag it to the lead — looking out for each other is part of the job.",
    ],
    bulletsEs: [
      "La fatiga reduce el tiempo de reacción igual que el alcohol — un trabajador cansado en un techo, una escalera o una sierra es un riesgo serio.",
      "Vigile las señales en usted y en su equipo: bostezos, atención dispersa, pasos omitidos, irritabilidad y 'quedarse en blanco'.",
      "Hable antes de un incidente, no después: decirle a su líder que está agotado es profesionalismo, no debilidad.",
      "Dormir es la única solución real — la cafeína y las bebidas energéticas disimulan la fatiga por un rato y luego empeoran la caída.",
      "Rote las tareas más pesadas y repetitivas, y use los descansos programados para descansar, comer e hidratarse de verdad.",
      "Manejar trayectos largos después de turnos largos es de alto riesgo: si está demasiado cansado para manejar con seguridad, dígalo y busque otra forma de llegar a casa.",
      "Si un compañero se ve peligrosamente fatigado, avise al líder — cuidarse unos a otros es parte del trabajo.",
    ],
  },
  {
    slug: "incident-reporting",
    titleEn: "Incident reporting",
    titleEs: "Reporte de incidentes",
    bulletsEn: [
      "Report every injury, near miss, property damage and utility strike the same shift — to your lead, in person, not 'when you get a chance'.",
      "Near misses are free lessons: reporting them lets the crew fix the cause before the same situation hurts someone.",
      "Care first, paperwork second: get the injured person help, secure the scene, then document what happened.",
      "Write down facts while they're fresh: who, what, when, where, conditions and photos if it is safe to take them.",
      "Never hide or minimize an incident — reporting honestly is protected and expected; hiding one puts the whole crew and company at risk.",
      "Preserve evidence where it matters: damaged equipment and failed parts stay tagged and untouched until reviewed.",
      "Expect a follow-up conversation, not blame: the goal of every report is a fix — training, equipment, planning or process.",
    ],
    bulletsEs: [
      "Reporte toda lesión, casi-accidente, daño a la propiedad y golpe a un servicio público en el mismo turno — a su líder, en persona, no 'cuando tenga un chance'.",
      "Los casi-accidentes son lecciones gratuitas: reportarlos permite al equipo corregir la causa antes de que la misma situación lastime a alguien.",
      "Primero la atención, después el papeleo: consiga ayuda para la persona lesionada, asegure la escena y luego documente lo ocurrido.",
      "Anote los hechos mientras están frescos: quién, qué, cuándo, dónde, las condiciones y fotos si es seguro tomarlas.",
      "Nunca oculte ni minimice un incidente — reportar con honestidad está protegido y es lo esperado; ocultarlo pone en riesgo a todo el equipo y a la empresa.",
      "Conserve la evidencia donde importa: el equipo dañado y las piezas que fallaron quedan marcados y sin tocar hasta su revisión.",
      "Espere una conversación de seguimiento, no de culpa: la meta de cada reporte es una corrección — capacitación, equipo, planificación o proceso.",
    ],
  },
];

export function getSafetyTalk(slug: string): SafetyTalk | null {
  return SAFETY_TALKS.find((t) => t.slug === slug) ?? null;
}

// ---------------------------------------------------------------------------
// Credential expiry buckets (Safety dashboard). Boundaries are calendar-day
// based on YYYY-MM-DD strings so results never depend on server time-of-day:
// expired = before today; due30 = today through +30 days; due90 = +31..+90;
// ok = after +90; no_expiry = no expiry date on file (counts separately,
// never as OK).
// ---------------------------------------------------------------------------

export type CredentialBucket = "expired" | "due30" | "due90" | "ok" | "no_expiry";

export function daysUntilExpiry(expiresOn: string, today: string): number | null {
  if (!expiresOn) return null;
  const a = new Date(`${expiresOn}T12:00:00Z`).getTime();
  const b = new Date(`${today}T12:00:00Z`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86_400_000);
}

export function credentialBucket(expiresOn: string, today: string): CredentialBucket {
  const days = daysUntilExpiry(expiresOn, today);
  if (days === null) return "no_expiry";
  if (days < 0) return "expired";
  if (days <= 30) return "due30";
  if (days <= 90) return "due90";
  return "ok";
}

export const MEMBER_CREDENTIAL_TYPES = [
  "contractor_license",
  "osha_10",
  "osha_30",
  "cpr_first_aid",
  "epa_rrp",
  "drivers_license",
  "custom",
] as const;
export type MemberCredentialType = (typeof MEMBER_CREDENTIAL_TYPES)[number];

export const MEMBER_CREDENTIAL_TYPE_LABELS: Record<MemberCredentialType, string> = {
  contractor_license: "Contractor license",
  osha_10: "OSHA 10",
  osha_30: "OSHA 30",
  cpr_first_aid: "CPR / First Aid",
  epa_rrp: "EPA RRP",
  drivers_license: "Driver's license",
  custom: "Custom",
};

// ---------------------------------------------------------------------------
// Branded PDF proof of a toolbox-talk session. Self-contained jsPDF build
// following the letter-page patterns of client/src/financialPdf.ts (dark
// header band, company stack, accent section heads) as used server-side by
// server/src/docPdf.ts: talk title + talk points, date, job, presenter
// with the drawn signature image, and the attendee list.
// ---------------------------------------------------------------------------

export interface SafetySessionPdfData {
  companyName: string;
  companyPhone: string;
  companyEmail: string;
  companyAddress: string;
  licenseNumber: string;
  accentColor: string;
  title: string;
  date: string;
  jobLabel: string | null;
  presenterName: string;
  bullets: string[];
  customBody: string;
  attendees: string[];
  signatureDataUrl: string | null;
}

export function buildSafetySessionPdf(data: SafetySessionPdfData): { bytes: Uint8Array; filename: string } {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const w = 612;
  const h = 792;
  const margin = 54;
  const contentW = w - margin * 2;
  const ink: [number, number, number] = [24, 32, 30];
  const dim: [number, number, number] = [96, 106, 103];
  const hex = (data.accentColor || "#1f5a4a").replace("#", "");
  const accent: [number, number, number] = [
    Number.parseInt(hex.slice(0, 2), 16) || 31,
    Number.parseInt(hex.slice(2, 4), 16) || 90,
    Number.parseInt(hex.slice(4, 6), 16) || 74,
  ];
  let y = 0;
  const ensure = (need: number) => {
    if (y + need <= h - 64) return;
    doc.addPage();
    y = 54;
  };
  const paragraph = (text: string, size = 10.5, gap = 12, color: [number, number, number] = ink) => {
    if (!text.trim()) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, contentW) as string[];
    ensure(lines.length * (size + 3.5) + gap);
    doc.setTextColor(...color);
    doc.text(lines, margin, y);
    y += lines.length * (size + 3.5) + gap;
  };
  const sectionHead = (label: string) => {
    ensure(30);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...accent);
    doc.text(label, margin, y);
    y += 5;
    doc.setDrawColor(...accent);
    doc.setLineWidth(1);
    doc.line(margin, y, margin + 34, y);
    y += 16;
  };

  // Header band.
  const headerH = 66;
  doc.setFillColor(23, 26, 28);
  doc.rect(0, 0, w, headerH, "F");
  const stack: Array<{ text: string; name?: boolean }> = [];
  if (data.companyName) stack.push({ text: data.companyName, name: true });
  const bits = [data.companyPhone, data.licenseNumber].filter(Boolean);
  if (bits.length) stack.push({ text: bits.join("  ·  ") });
  if (data.companyAddress) stack.push({ text: data.companyAddress });
  if (data.companyEmail) stack.push({ text: data.companyEmail });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text("CREWKAT SAFETY", margin, headerH / 2 + 4);
  let stackY = headerH / 2 - ((stack.length - 1) * 11) / 2 + 3;
  for (const line of stack) {
    doc.setFont("helvetica", line.name ? "bold" : "normal");
    doc.setFontSize(line.name ? 11.5 : 7.5);
    doc.setTextColor(255, 255, 255);
    doc.text(line.text, w - margin, stackY, { align: "right" });
    stackY += 11;
  }
  y = headerH + 40;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...ink);
  doc.text("Toolbox Talk — Attendance Record", w / 2, y, { align: "center" });
  y += 26;

  const meta: Array<[string, string]> = [
    ["Topic", data.title],
    ["Date", data.date],
    ["Presenter", data.presenterName],
  ];
  if (data.jobLabel) meta.push(["Job", data.jobLabel]);
  meta.push(["Attendees", String(data.attendees.length)]);
  for (const [label, value] of meta) {
    ensure(16);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...dim);
    doc.text(`${label}:`, margin, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...ink);
    const lines = doc.splitTextToSize(value, contentW - 92) as string[];
    doc.text(lines, margin + 92, y);
    y += Math.max(1, lines.length) * 13 + 3;
  }
  y += 8;

  if (data.bullets.length > 0) {
    sectionHead("TALK POINTS");
    for (const bullet of data.bullets) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10.5);
      const lines = doc.splitTextToSize(bullet, contentW - 16) as string[];
      ensure(lines.length * 14 + 4);
      doc.setTextColor(...accent);
      doc.text("•", margin, y);
      doc.setTextColor(...ink);
      doc.text(lines, margin + 16, y);
      y += lines.length * 14 + 4;
    }
    y += 6;
  }
  if (data.customBody.trim()) {
    sectionHead("SESSION NOTES");
    paragraph(data.customBody, 10.5, 14);
  }

  sectionHead("ATTENDEES");
  if (data.attendees.length === 0) paragraph("No attendees recorded.", 10.5, 10, dim);
  data.attendees.forEach((name, i) => {
    ensure(15);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.setTextColor(...ink);
    doc.text(`${i + 1}.  ${name}`, margin, y);
    y += 15;
  });
  y += 10;

  sectionHead("PRESENTER SIGNATURE");
  if (data.signatureDataUrl) {
    ensure(70);
    try {
      doc.addImage(data.signatureDataUrl, data.signatureDataUrl.startsWith("data:image/png") ? "PNG" : "JPEG", margin, y - 8, 180, 54, undefined, "FAST");
    } catch { /* signature line below still certifies */ }
    y += 52;
  }
  ensure(30);
  doc.setDrawColor(...dim);
  doc.setLineWidth(0.7);
  doc.line(margin, y, margin + 240, y);
  doc.line(margin + 280, y, margin + 360, y);
  y += 13;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...dim);
  doc.text(data.presenterName || "Presenter", margin, y);
  doc.text(data.date, margin + 280, y);
  y += 22;
  paragraph("The presenter confirms this talk was delivered as recorded above and that the listed attendees were present.", 8.5, 8, dim);

  const out = doc.output("arraybuffer");
  const bytes = new Uint8Array(out);
  const safe = data.title.replace(/[^A-Za-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "session";
  return { bytes, filename: `toolbox-talk-${safe}-${data.date}.pdf` };
}
