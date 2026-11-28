import {
  McpResourceDefinition,
  McpToolDefinition,
} from "../../domain/interfaces/mcp-tool.port";

export const CLEARMINDS_MCP_RESOURCES: McpResourceDefinition[] = [
  {
    uri: "brochure://software-medida",
    name: "Línea A: Software a la Medida (B2B / Gerentes o Dueños de PyMEs)",
    description:
      "Desarrollo de software personalizado para empresas y PyMEs. Consultar documentos vigentes del RAG.",
    mimeType: "text/markdown",
    productKey: "custom_software",
    requiredFields: [
      "Nombre del cliente",
      "Nombre de la empresa",
      "Giro de negocio",
      "Necesidad específica o problema a resolver",
    ],
    content: `# LÍNEA A: SOFTWARE A LA MEDIDA (B2B / PYMES)
- Consultar siempre el RAG (file_search) para detalles vigentes, flujo de calificación y políticas de precios.`,
  },
  {
    uri: "brochure://krakedev-academy",
    name: "Línea B: Academia de Programación (Krakedev)",
    description:
      "Escuela de Inteligencia Artificial y Desarrollo Full Stack. Consultar manual general y promociones vigentes de KrakeDev en el RAG.",
    mimeType: "text/markdown",
    productKey: "krakedev_academy",
    requiredFields: [
      "Nombre del interesado",
      "Experiencia previa en programación",
      "Objetivo profesional",
    ],
    content: `# LÍNEA B: ACADEMIA DE PROGRAMACIÓN (KRAKEDEV)
- Consultar siempre los manuales vigentes de KrakeDev y Promociones Vigentes KrakeDev en el RAG (file_search) para precios, campañas, modalidad, horarios e inicio.`,
  },
  {
    uri: "brochure://aws-certifications",
    name: "Línea C: Cursos y Certificaciones AWS",
    description:
      "Programas de preparación para certificaciones AWS (AI Practitioner, Solutions Architect – Associate y Cloud Practitioner). Consultar RAG.",
    mimeType: "text/markdown",
    productKey: "aws_certifications",
    requiredFields: [
      "Nombre del interesado",
      "Certificación AWS de interés",
      "Horario preferido",
    ],
    content: `# LÍNEA C: CURSOS Y CERTIFICACIONES AWS
- Consultar siempre los manuales generales vigentes de cada certificación AWS y el Manual de Promociones Vigentes – AWS en el RAG (file_search).`,
  },
  {
    uri: "brochure://ai-assistants-b2b",
    name: "Línea D: Asistentes de IA para Negocios (B2B / PyMEs)",
    description:
      "Automatización inteligente y soluciones piloto con IA para negocios. Consultar documentos vigentes del RAG.",
    mimeType: "text/markdown",
    productKey: "ai_assistants_b2b",
    requiredFields: [
      "Nombre",
      "Qué necesita automatizar o resolver",
      "Giro de negocio",
    ],
    content: `# LÍNEA D: ASISTENTES DE IA PARA NEGOCIOS (B2B / PYMES)
- Consultar siempre el RAG (file_search) para detalles vigentes, flujo de calificación y políticas de disponibilidad.`,
  },
];

export const CLEARMINDS_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "agendar_cita",
    description:
      "Registra solicitud de reunión o cita cuando corresponda (si el cliente pide explícitamente agendar cita o hablar con un asesor, priorizar transferir_a_humano).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "ID de la sesión de conversación.",
        },
        leadName: {
          type: "string",
          description: "Nombre completo del cliente.",
        },
        leadContact: {
          type: "string",
          description: "Teléfono WhatsApp o correo electrónico.",
        },
        productKey: {
          type: "string",
          enum: [
            "custom_software",
            "krakedev_academy",
            "aws_certifications",
            "ai_assistants_b2b",
          ],
        },
        scheduledAt: {
          type: "string",
          description:
            "Fecha y hora solicitada (ISO 8601 o texto descriptivo).",
        },
        notes: {
          type: "string",
          description: "Notas del requerimiento o contexto comercial.",
        },
      },
      required: ["leadName", "productKey", "scheduledAt"],
    },
  },
  {
    name: "registrar_lead_crm",
    description:
      "Guarda o actualiza en tiempo real los atributos comerciales extraídos del prospecto y su nivel de intención en el CRM.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string" },
        productKey: {
          type: "string",
          enum: [
            "custom_software",
            "krakedev_academy",
            "aws_certifications",
            "ai_assistants_b2b",
          ],
        },
        intentLevel: {
          type: "string",
          enum: ["ALTO", "MEDIO", "BAJO"],
        },
        extractedFields: {
          type: "object",
          description:
            "Mapa clave-valor de campos extraídos según la línea de negocio.",
        },
      },
      required: ["productKey", "extractedFields"],
    },
  },
  {
    name: "transferir_a_humano",
    description:
      "Cambia el estado de la conversación a HUMAN_ACTIVE (Modo Espejo / Escalamiento) cuando el cliente pide hablar con un asesor, muestra molestia/fricción o manifiesta intención directa de inscribirse, pagar o agendar una cita.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "ID de la sesión a transferir.",
        },
        reason: {
          type: "string",
          description: "Motivo de la transferencia al asesor humano.",
        },
      },
      required: ["sessionId", "reason"],
    },
  },
];
