import { McpResourceDefinition, McpToolDefinition } from '../../domain/interfaces/mcp-tool.port';

export const CLEARMINDS_MCP_RESOURCES: McpResourceDefinition[] = [
  {
    uri: 'brochure://software-medida',
    name: 'Línea A: Software a la Medida (B2B / Gerentes o Dueños de PyMEs)',
    description:
      'Desarrollo de software personalizado para empresas y PyMEs. Sin precios cerrados; requiere levantamiento de requerimientos con especialista.',
    mimeType: 'text/markdown',
    productKey: 'custom_software',
    requiredFields: [
      'Nombre del cliente',
      'Nombre de la empresa',
      'Giro de negocio',
      'Necesidad específica o problema a resolver',
    ],
    content: `# LÍNEA A: SOFTWARE A LA MEDIDA (B2B / PYMES)
- **Público objetivo**: Gerentes, directivos o dueños de PyMEs.
- **Datos a recopilar (en orden natural)**: Nombre del cliente, Nombre de la empresa, Giro de negocio y Necesidad específica o problema que buscan resolver con software.
- **Política de Precios**: PROHIBIDO dar precios cerrados. Explica de forma consultiva que cada desarrollo es a la medida y requiere levantar requerimientos específicos en una reunión con un especialista.
- **Lenguaje técnico**: Ligero y natural (evita tecnicismos innecesarios, demuestra dominio del tema).`,
  },
  {
    uri: 'brochure://krakedev-academy',
    name: 'Línea B: Academia de Programación (Krakedev)',
    description:
      'Formación práctica y especializada en programación orientada al empleo real. Matrícula $40 USD y primer módulo $280 USD.',
    mimeType: 'text/markdown',
    productKey: 'krakedev_academy',
    requiredFields: [
      'Nombre (interesado o estudiante)',
      'Edad del estudiante',
      'Conocimientos previos de programación',
    ],
    content: `# LÍNEA B: ACADEMIA DE PROGRAMACIÓN (KRAKEDEV)
- **Público objetivo**: Estudiantes, profesionales en transición o padres de familia.
- **Datos a recopilar**: Nombre (del interesado o del estudiante), Edad del estudiante, Conocimientos previos de programación (si tiene o empieza desde cero).
- **Política de Precios (Oferta promocional por tiempo limitado)**:
  - **Matrícula**: $40 USD.
  - **Primer módulo**: $280 USD.
- **Manejo de Objeciones Frecuentes**:
  - *¿Dan título?*: Aclara de forma transparente que es una formación práctica y especializada en programación orientada al empleo real (enfocada en habilidades duras del mercado tecnológico), no un título universitario tradicional.
  - *¿Son clases presenciales?*: Explica que la metodología es 100% online, interactiva y con acompañamiento cercano, lo que les permite estudiar sin descuidar sus horarios actuales.`,
  },
  {
    uri: 'brochure://aws-certifications',
    name: 'Línea C: Cursos y Certificaciones AWS',
    description:
      'Preparación oficial AWS Certified Solutions Architect – Associate (8 semanas, clases 100% en vivo, $235 regular / $165 Black Friday hasta 30 nov; voucher de examen NO incluido).',
    mimeType: 'text/markdown',
    productKey: 'aws_certifications',
    requiredFields: [
      'Nombre del interesado',
      'Certificación AWS de interés (AWS Solutions Architect – Associate)',
      'Horario preferido (matutino o nocturno)',
    ],
    content: `# LÍNEA C: PREPARACIÓN AWS CERTIFIED SOLUTIONS ARCHITECT – ASSOCIATE
- **Nombre oficial**: Preparación AWS Certified Solutions Architect – Associate.
- **Duración y modalidad**: 8 semanas · Clases 100 % en vivo.
- **Inicio previsto**: 11 de enero de 2027 (fecha prevista sujeta a confirmación interna; NO inventar otras fechas de inicio).
- **Horarios confirmados**:
  - **Matutino**: Lunes, miércoles y viernes | 07h00–08h20.
  - **Nocturno**: Martes y jueves | 19h30–21h30.
- **Precios confirmados**:
  - **Precio regular**: $235 USD.
  - **Precio promocional Black Friday**: $165 USD (ahorro de $70, aprox. 30 % de descuento), **vigente únicamente hasta el 30 de noviembre**.
- **Qué incluye**: Clases en vivo, acceso a grabaciones, simuladores, soporte y seguimiento durante el programa.
- **Voucher de examen oficial**: **NO incluido** (se adquiere por separado). El programa prepara para el examen oficial de AWS; aprobar el examen con AWS otorga la certificación, no comprar el curso.
- **Formas de pago**: Transferencia bancaria, tarjeta de crédito y link de pago (NO inventar números de cuenta ni enlaces de pago; si desea inscribirse o pide datos de pago, conectar con un asesor humano).
- **Temario oficial**: Si preguntan por temario, contenidos, temas, módulos, plan de estudios o syllabus, comparte inmediatamente este enlace íntegro sin inventar módulos ni contenidos:
  https://drive.google.com/file/d/1godC01fw8ztyh0550ZgwwAyYgSKYnRp6/view?usp=sharing
- **Restricciones obligatorias (AWS)**:
  - Respuestas breves (preferentemente 2 a 4 oraciones por mensaje), claras y una pregunta a la vez.
  - PROHIBIDO inventar precios, vigencias, cupos, fechas de inicio, horarios, instructores, temario, testimonios, beneficios, cuentas bancarias o enlaces de pago.
  - PROHIBIDO afirmar que el voucher está incluido o garantizar aprobación del examen o empleo.
  - Derivar a asesor humano ante solicitudes de inscripción, datos de transferencia/pago no disponibles, facturación, reclamos, descuentos excepcionales o información no validada.`,
  },
  {
    uri: 'brochure://ai-assistants-b2b',
    name: 'Línea D: Asistentes de IA para Negocios (B2B / PyMEs)',
    description:
      'Automatización inteligente y asistentes de IA para procesos de negocio. Accesos anticipados y soluciones piloto a medida.',
    mimeType: 'text/markdown',
    productKey: 'ai_assistants_b2b',
    requiredFields: [
      'Nombre',
      'Qué necesita automatizar o resolver',
      'Giro de negocio',
    ],
    content: `# LÍNEA D: ASISTENTES DE IA PARA NEGOCIOS (B2B / PYMES)
- **Datos a recopilar**: Nombre, Qué necesita automatizar o resolver, Giro de negocio.
- **Política de Precios y Disponibilidad**: Como aún no están liberados al público general de forma masiva o se requiere estructurar la solución, indaga en su necesidad y anticípale que se requiere una sesión técnica breve.
- **Respuesta si preguntan disponibilidad**: "Estamos liberando accesos anticipados y estructurando soluciones piloto a la medida. Cuéntame qué proceso de tu negocio te gustaría automatizar para evaluarlo".`,
  },
];

export const CLEARMINDS_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'cotizar_descuento_grupo',
    description:
      'Devuelve precios y condiciones oficiales para AWS Solutions Architect – Associate ($235 USD regular / $165 USD Black Friday vigente hasta el 30 de noviembre; voucher oficial NO incluido) o Academia Krakedev (matrícula $40 + primer módulo $280). Para Software a la Medida o Asistentes de IA indica sesión de levantamiento sin precios cerrados.',
    inputSchema: {
      type: 'object',
      properties: {
        productKey: {
          type: 'string',
          enum: ['custom_software', 'krakedev_academy', 'aws_certifications', 'ai_assistants_b2b'],
          description: 'Clave de la línea de negocio consultada.',
        },
        participants: {
          type: 'number',
          description: 'Cantidad de certificaciones (en AWS: 1, 2 o 3) o participantes.',
        },
        paymentMode: {
          type: 'string',
          enum: ['contado', 'cuotas'],
          description: 'Modalidad de pago consultada.',
        },
      },
      required: ['productKey', 'participants'],
    },
  },
  {
    name: 'agendar_cita',
    description:
      'Registra solicitud de reunión o cita cuando corresponda (Nota: si el cliente pide explícitamente agendar cita o hablar con un asesor, priorizar transferir_a_humano).',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID de la sesión de conversación.' },
        leadName: { type: 'string', description: 'Nombre completo del cliente.' },
        leadContact: { type: 'string', description: 'Teléfono WhatsApp o correo electrónico.' },
        productKey: {
          type: 'string',
          enum: ['custom_software', 'krakedev_academy', 'aws_certifications', 'ai_assistants_b2b'],
        },
        scheduledAt: {
          type: 'string',
          description: 'Fecha y hora solicitada (ISO 8601 o texto descriptivo).',
        },
        notes: { type: 'string', description: 'Notas del requerimiento o contexto comercial.' },
      },
      required: ['leadName', 'productKey', 'scheduledAt'],
    },
  },
  {
    name: 'registrar_lead_crm',
    description:
      'Guarda o actualiza en tiempo real los atributos comerciales extraídos del prospecto y su nivel de intención en el CRM.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string' },
        productKey: {
          type: 'string',
          enum: ['custom_software', 'krakedev_academy', 'aws_certifications', 'ai_assistants_b2b'],
        },
        intentLevel: {
          type: 'string',
          enum: ['ALTO', 'MEDIO', 'BAJO'],
        },
        extractedFields: {
          type: 'object',
          description: 'Mapa clave-valor de campos extraídos según la línea de negocio.',
        },
      },
      required: ['productKey', 'extractedFields'],
    },
  },
  {
    name: 'transferir_a_humano',
    description:
      'Cambia el estado de la conversación a HUMAN_ACTIVE (Modo Espejo / Escalamiento) cuando el cliente pide hablar con un asesor, muestra molestia/fricción o manifiesta intención explícita de agendar una cita o reunión.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: { type: 'string', description: 'ID de la sesión a transferir.' },
        reason: { type: 'string', description: 'Motivo de la transferencia al asesor humano.' },
      },
      required: ['sessionId', 'reason'],
    },
  },
];
