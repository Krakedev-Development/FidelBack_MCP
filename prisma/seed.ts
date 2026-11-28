import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomBytes, scryptSync } from 'crypto';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function hashPasswordSafe(plainText: string): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const bcrypt = require('bcrypt') as typeof import('bcrypt');
    return bcrypt.hashSync(plainText, 10);
  } catch {
    const salt = randomBytes(16).toString('hex');
    const derived = scryptSync(plainText, salt, 64).toString('hex');
    return `scrypt$${salt}$${derived}`;
  }
}

export const IMMUTABLE_GENERAL_POLICY = `1. IDENTIDAD Y OBJETIVO:
Eres Fidel, asistente virtual comercial y orientador académico de Clear Minds Consultores (KrakeDev y Formación AWS). Atiendes en español por WhatsApp, Facebook e Instagram según el canal habilitado. Orienta, resuelve dudas, identifica necesidades y facilita la inscripción sin presionar. Para KrakeDev, mantén además un tono ligeramente técnico cuando corresponda. Nunca te presentes como bot o IA salvo que te lo pregunten directamente.

2. ESTILO OBLIGATORIO DE CONVERSACIÓN:
- Habla de manera humana, cercana, amable, natural y profesional. Responde primero la pregunta concreta.
- Evita frases mecánicas, relleno, entusiasmo artificial, saludos repetidos y respuestas tipo catálogo. No envíes toda la información del programa de una vez.
- Procura 25 a 55 palabras y máximo tres oraciones breves por mensaje (sin contar líneas de precios u opciones), incluida una sola pregunta final pertinente de una sola opción (prohibido usar "o" para ofrecer dos opciones).
- Si se requieren varios datos, usa líneas cortas y entrega únicamente lo necesario. Separa ideas y pregunta final con una línea en blanco (dos saltos reales). Usa como máximo un emoji, exclusivamente al final.

3. CONTINUIDAD Y ATENCIÓN PERSONALIZADA:
- Saluda y preséntate solo al inicio. Pregunta el nombre si no lo conoces, sin condicionar la información.
- Usa el historial para interpretar respuestas como «sí», «la segunda», «la primera» o «me interesa». No repitas datos ni solicites información ya conocida.

4. PRECIOS, PROMOCIONES Y FORMATO WHATSAPP:
- Antes de cotizar, consulta en el RAG (file_search) el documento de promociones correspondiente y verifica producto, estado, fechas y condiciones para la fecha actual. Prioriza la campaña vigente aplicable.
- En WhatsApp usa asteriscos simples para negrita y virgulillas para tachado. Con promoción vigente muestra el precio regular tachado y en negrita, seguido del precio promocional en negrita en líneas separadas y el porcentaje autorizado si aplica:
  Precio regular: *~$[regular]~*
  Precio promocional: *$[promoción]*
  Descuento: *[porcentaje autorizado]*
- Sin promoción vigente, muestra solo el precio regular en negrita (*$[regular]*), sin tacharlo. PROHIBIDO usar «Te ahorras», «Ahorras» ni líneas de ahorro económico.

5. SELECCIÓN DE PROGRAMAS Y ATENCIÓN COMERCIAL:
- Si el prospecto llega por una campaña general de AWS y no ha elegido programa, presenta únicamente las tres opciones SIN precios (AWS AI Practitioner – Inteligencia Artificial; AWS Solutions Architect – Arquitecto; AWS Cloud) y pregunta cuál le interesa.
- En KrakeDev, ante consultas generales de precio, informa la campaña vigente aplicable desde la primera respuesta. Si pide alternativas, presenta las opciones de pronto pago verificadas.
- En consultas grupales, pregunta la cantidad si falta y comunica solo la tarifa y el beneficio correspondiente. PROHIBIDO ofrecer tarifas grupales si el cliente no preguntó por grupos.

6. ALCANCE ESTRICTO — SOLO ASESORÍA COMERCIAL (NO PROFESOR NI TUTOR):
- Atiende ÚNICAMENTE consultas comerciales o informativas sobre nuestros programas y soluciones respaldados por el RAG. PROHIBIDO explicar conceptos técnicos/académicos (algoritmos, árboles rojo y negro, código, estadística/ANOVA, tareas) o inventar datos sobre docentes/personas que no consten en el RAG.

7. EXACTITUD, SEGURIDAD Y DERIVACIÓN INMEDIATA:
- No inventes precios, descuentos, fechas, horarios, docentes, cupos, temarios, requisitos, beneficios, enlaces, cuentas ni medios de pago. No menciones manuales internos.
- Deriva de inmediato a un asesor/Admisiones si pide hablar con un humano, muestra molestia/fricción, quiere agendar una cita o expresa intención directa de inscribirse, matricularse o pagar (sin repetir precios ni volver a preguntar si desea que lo conectes), usando:
"¡Perfecto! Te comunico en este mismo momento con uno de nuestros asesores especializados para que coordinen los detalles. Dame un segundo por favor 🤝"`;

export const DEFAULT_PRODUCT_LINES = [
  {
    id: 'custom_software',
    name: 'Línea A: Software a la Medida (B2B / PyMEs)',
    tagline: 'Desarrollo de software personalizado para empresas y PyMEs',
    badge: 'Desarrollo B2B · A la Medida',
    ragStoreId: 'brochure://software-medida',
    systemInstructions:
      'LÍNEA A — SOFTWARE A LA MEDIDA: Consultar el RAG (file_search) para calificación y política de precios (no dar precios cerrados).',
    keyFields: [
      'Nombre del cliente',
      'Nombre de la empresa',
      'Giro de negocio',
      'Necesidad específica o problema a resolver',
    ],
    suggestedPrompts: [
      'Hola, tengo una distribuidora y necesito un sistema a la medida para controlar pedidos e inventario.',
    ],
  },
  {
    id: 'krakedev_academy',
    name: 'Línea B: Academia de Programación (Krakedev)',
    tagline: 'Escuela de Inteligencia Artificial · Formación Full Stack con IA',
    badge: 'KrakeDev · Consultar RAG vigente',
    ragStoreId: 'brochure://krakedev-academy',
    systemInstructions:
      'LÍNEA B — KRAKEDEV: Consultar siempre los manuales vigentes de KrakeDev y Promociones Vigentes KrakeDev en el RAG (file_search).',
    keyFields: [
      'Nombre del interesado',
      'Experiencia previa en programación',
      'Objetivo profesional',
    ],
    suggestedPrompts: [
      'Hola, quiero aprender programación desde cero en KrakeDev. ¿Cuánto cuesta?',
    ],
  },
  {
    id: 'aws_certifications',
    name: 'Línea C: Cursos y Certificaciones AWS',
    tagline: 'Preparación en certificaciones AWS (AI Practitioner, Solutions Architect y Cloud)',
    badge: 'AWS · Consultar RAG vigente',
    ragStoreId: 'brochure://aws-certifications',
    systemInstructions:
      'LÍNEA C — CURSOS Y CERTIFICACIONES AWS: Consultar siempre los manuales vigentes de cada certificación y el Manual de Promociones Vigentes – AWS en el RAG (file_search).',
    keyFields: [
      'Nombre del interesado',
      'Certificación AWS de interés',
      'Horario preferido',
    ],
    suggestedPrompts: [
      'Me interesa AWS Solutions Architect – Associate. ¿Cuál es el precio y horarios?',
    ],
  },
  {
    id: 'ai_assistants_b2b',
    name: 'Línea D: Asistentes de IA para Negocios (B2B / PyMEs)',
    tagline: 'Automatización inteligente y soluciones piloto a la medida con IA',
    badge: 'Pilotos IA · Consultar RAG',
    ragStoreId: 'brochure://ai-assistants-b2b',
    systemInstructions:
      'LÍNEA D — ASISTENTES DE IA PARA NEGOCIOS: Consultar el RAG (file_search) para flujo de calificación y disponibilidad.',
    keyFields: [
      'Nombre',
      'Qué necesita automatizar o resolver',
      'Giro de negocio',
    ],
    suggestedPrompts: [
      'Quiero un asistente de IA para automatizar la atención de mi negocio. ¿Ya lo tienen disponible?',
    ],
  },
];

async function main() {
  console.log('🌱 Iniciando Seed de FidelBack_MCP en Supabase PostgreSQL...');

  const passwordHash = hashPasswordSafe('ClearMinds2026!');

  // 1. Usuarios Admin por defecto (soporta ambos correos comunes)
  for (const email of ['admin@clearminds.ec', 'admin@clearminds-it.com']) {
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, tenantSlug: 'clearminds', isActive: true },
      create: {
        email,
        passwordHash,
        fullName: 'Administrador Clear Minds',
        role: 'ADMIN',
        tenantSlug: 'clearminds',
      },
    });
  }

  // 2. Tenant principal: Clear Minds
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'clearminds' },
    update: {
      generalPolicy: IMMUTABLE_GENERAL_POLICY,
      apiKey: 'fidel_live_clearminds_2026',
    },
    create: {
      slug: 'clearminds',
      name: 'Clear Minds / KrakeDev',
      apiKey: 'fidel_live_clearminds_2026',
      generalPolicy: IMMUTABLE_GENERAL_POLICY,
      memoryThreshold: 5,
    },
  });

  // 3.Segundo Tenant de demostración Multi-Empresa (ej. Academia Demo)
  const demoTenant = await prisma.tenant.upsert({
    where: { slug: 'academia-futuro' },
    update: {
      apiKey: 'fidel_live_academia_2026',
    },
    create: {
      slug: 'academia-futuro',
      name: 'Academia Futuro Digital (Demo Multi-Empresa)',
      apiKey: 'fidel_live_academia_2026',
      generalPolicy:
        'Eres el asesor virtual de Academia Futuro Digital. Responde siempre con entusiasmo, ofrece becas del 20% y agenda llamadas de admisión.',
      memoryThreshold: 5,
    },
  });

  await prisma.user.upsert({
    where: { email: 'asesor@academiafuturo.com' },
    update: { passwordHash, tenantSlug: demoTenant.slug, isActive: true },
    create: {
      email: 'asesor@academiafuturo.com',
      passwordHash,
      fullName: 'Asesor Academia Futuro',
      role: 'ADVISOR',
      tenantSlug: demoTenant.slug,
    },
  });

  // 4. Limpiar líneas obsoletas de Clear Minds y registrar las 4 nuevas líneas
  const obsoleteIds = ['ia_docencia', 'aws_pack', 'krake_mentor'];
  await prisma.conversation.updateMany({
    where: { productLineId: { in: obsoleteIds } },
    data: { productLineId: null },
  });
  await prisma.lead.updateMany({
    where: { productLineId: { in: obsoleteIds } },
    data: { productLineId: null },
  });
  await prisma.productLine.deleteMany({
    where: { id: { in: obsoleteIds } },
  });

  for (const line of DEFAULT_PRODUCT_LINES) {
    await prisma.productLine.upsert({
      where: { id: line.id },
      update: {
        name: line.name,
        tagline: line.tagline,
        badge: line.badge,
        ragStoreId: line.ragStoreId,
        systemInstructions: line.systemInstructions,
        keyFieldsJson: JSON.stringify(line.keyFields),
        suggestedPrompts: JSON.stringify(line.suggestedPrompts),
      },
      create: {
        id: line.id,
        tenantId: tenant.id,
        name: line.name,
        tagline: line.tagline,
        badge: line.badge,
        ragStoreId: line.ragStoreId,
        systemInstructions: line.systemInstructions,
        keyFieldsJson: JSON.stringify(line.keyFields),
        suggestedPrompts: JSON.stringify(line.suggestedPrompts),
      },
    });
  }

  console.log('✅ Seed completado en Supabase:');
  console.log('   - Empresa 1: Clear Minds (slug: clearminds | apiKey: fidel_live_clearminds_2026)');
  console.log('   - Empresa 2: Academia Futuro Digital (slug: academia-futuro | apiKey: fidel_live_academia_2026)');
  console.log('   - Logins: admin@clearminds.ec / ClearMinds2026!  |  asesor@academiafuturo.com / ClearMinds2026!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
