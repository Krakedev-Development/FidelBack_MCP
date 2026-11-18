import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../context/database/prisma.service';

export interface UniversalMcpToolSchema {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: false;
  };
  outputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
  };
}

export interface UniversalMcpCallContext {
  tenantSlug: string;
  userId: string;
  userEmail: string;
  userName: string;
  userRole: string;
}

export interface UniversalMcpToolOutput {
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

@Injectable()
export class UniversalMcpToolsService {
  private readonly logger = new Logger(UniversalMcpToolsService.name);
  private readonly operationCache = new Map<
    string,
    { expiresAt: number; result: UniversalMcpToolOutput }
  >();

  constructor(private readonly prisma: PrismaService) {}

  listTools(): UniversalMcpToolSchema[] {
    return [
      {
        name: 'verificar_conexion',
        description:
          'Comprueba que el servidor MCP de Fidel responde y muestra el tenant y usuario autenticado. Úsala para pruebas de conectividad; no consulta datos del negocio.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            server: { type: 'string' },
            version: { type: 'string' },
            tenantSlug: { type: 'string' },
            timestamp: { type: 'string' },
          },
          required: ['ok', 'server', 'version', 'tenantSlug', 'timestamp'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: 'consultar_empresa',
        description:
          'Devuelve la identidad de la empresa (tenant) conectada actualmente: id, nombre y slug. Úsala al iniciar sesión o para nombrar al asistente; no devuelve políticas internas ni API keys.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            nombre: { type: 'string' },
            slug: { type: 'string' },
            activa: { type: 'boolean' },
          },
          required: ['id', 'nombre', 'slug', 'activa'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: 'listar_lineas_producto',
        description:
          'Lista el catálogo de líneas de producto o servicios configurados para la empresa actual. Úsala cuando el asesor necesite conocer los códigos válidos de productLineId antes de filtrar o actualizar una oportunidad.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            page: { type: 'number' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  tagline: { type: 'string' },
                  badge: { type: 'string' },
                },
              },
            },
          },
          required: ['total', 'page', 'items'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: 'buscar_oportunidades',
        description:
          'Busca oportunidades/leads comerciales de la empresa actual con paginación (máximo 50 por página). Úsala cuando pidan listar o filtrar clientes interesados; no la uses para buscar citas (usa listar_citas). Si no hay coincidencias devuelve total: 0 e items: [].',
        inputSchema: {
          type: 'object',
          properties: {
            texto: {
              type: 'string',
              description: 'Texto libre a buscar en sessionId, objeción, acción o datos extraídos (ej. "AWS" o "Juan").',
            },
            intencion: {
              type: 'string',
              enum: ['alta', 'media', 'baja', 'sin_datos'],
              description: 'Filtro exacto por nivel de intención de compra.',
            },
            productLineId: {
              type: 'string',
              description: 'ID de la línea de producto (ej. "aws_certifications", "custom_software").',
            },
            page: {
              type: 'number',
              description: 'Número de página (empieza en 1).',
            },
            limite: {
              type: 'number',
              description: 'Cantidad de resultados por página (entre 1 y 50, por defecto 20).',
            },
          },
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  sessionId: { type: 'string' },
                  productLineId: { type: ['string', 'null'] },
                  productName: { type: ['string', 'null'] },
                  purchaseIntent: { type: 'string' },
                  objection: { type: 'string' },
                  suggestedAction: { type: 'string' },
                  controlState: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
            },
          },
          required: ['total', 'page', 'limit', 'items'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: 'consultar_oportunidad',
        description:
          'Obtiene el detalle completo de una oportunidad por oportunidadId o sessionId, incluyendo atributos extraídos, citas vinculadas y notas registradas. Úsala antes de modificar una oportunidad o para responder por un cliente puntual.',
        inputSchema: {
          type: 'object',
          properties: {
            oportunidadId: {
              type: 'string',
              description: 'UUID de la oportunidad (Lead.id).',
            },
            sessionId: {
              type: 'string',
              description: 'Identificador de sesión de conversación.',
            },
          },
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            sessionId: { type: 'string' },
            productLineId: { type: ['string', 'null'] },
            productName: { type: ['string', 'null'] },
            purchaseIntent: { type: 'string' },
            objection: { type: 'string' },
            suggestedAction: { type: 'string' },
            controlState: { type: 'string' },
            extractedFields: { type: 'array' },
            notes: { type: 'array' },
            appointments: { type: 'array' },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
          },
          required: ['id', 'sessionId', 'purchaseIntent', 'extractedFields', 'notes', 'appointments'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: 'listar_citas',
        description:
          'Lista citas comerciales agendadas para la empresa actual (máximo 50 por página). Úsala para consultar agenda por estado o fecha YYYY-MM-DD.',
        inputSchema: {
          type: 'object',
          properties: {
            estado: {
              type: 'string',
              description: 'Estado de la cita (ej. "CONFIRMED", "CANCELLED").',
            },
            fecha: {
              type: 'string',
              description: 'Fecha exacta en formato YYYY-MM-DD (ej. "2026-11-20").',
            },
            page: {
              type: 'number',
              description: 'Número de página (empieza en 1).',
            },
            limite: {
              type: 'number',
              description: 'Cantidad por página (1 a 50, por defecto 20).',
            },
          },
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            page: { type: 'number' },
            limit: { type: 'number' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  appointmentCode: { type: 'string' },
                  contactName: { type: 'string' },
                  contactEmail: { type: ['string', 'null'] },
                  productName: { type: 'string' },
                  scheduledDate: { type: 'string' },
                  scheduledTime: { type: 'string' },
                  status: { type: 'string' },
                  createdAt: { type: 'string' },
                },
              },
            },
          },
          required: ['total', 'page', 'limit', 'items'],
        },
        annotations: { readOnlyHint: true, destructiveHint: false },
      },
      {
        name: 'actualizar_oportunidad',
        description:
          'Modifica la intención, línea de producto, objeción o siguiente acción de una oportunidad existente. Requiere confirmación del usuario antes de ejecutarse y devuelve el registro actualizado.',
        inputSchema: {
          type: 'object',
          properties: {
            oportunidadId: {
              type: 'string',
              description: 'UUID de la oportunidad a actualizar (requerido).',
            },
            intencion: {
              type: 'string',
              enum: ['alta', 'media', 'baja'],
              description: 'Nuevo nivel de intención comercial.',
            },
            productLineId: {
              type: 'string',
              description: 'Nuevo ID de línea de producto.',
            },
            objecion: {
              type: 'string',
              description: 'Objeción principal reportada por el cliente.',
            },
            siguienteAccion: {
              type: 'string',
              description: 'Siguiente acción comercial recomendada.',
            },
            operationId: {
              type: 'string',
              description: 'Identificador único de operación para idempotencia.',
            },
          },
          required: ['oportunidadId'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            productLineId: { type: ['string', 'null'] },
            purchaseIntent: { type: 'string' },
            objection: { type: 'string' },
            suggestedAction: { type: 'string' },
            updatedAt: { type: 'string' },
          },
          required: ['id', 'purchaseIntent', 'objection', 'suggestedAction', 'updatedAt'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      {
        name: 'programar_cita',
        description:
          'Agenda una nueva cita comercial en formato fecha YYYY-MM-DD y hora HH:mm. Requiere confirmación del usuario y devuelve el registro de la cita creada.',
        inputSchema: {
          type: 'object',
          properties: {
            nombreCliente: {
              type: 'string',
              description: 'Nombre completo del cliente (ej. "María López").',
            },
            contactoCliente: {
              type: 'string',
              description: 'Correo o teléfono del cliente.',
            },
            producto: {
              type: 'string',
              description: 'Programa o servicio de interés (ej. "aws_certifications").',
            },
            fecha: {
              type: 'string',
              description: 'Fecha en formato YYYY-MM-DD (ej. "2026-11-25").',
            },
            hora: {
              type: 'string',
              description: 'Hora en formato 24h HH:mm (ej. "15:00").',
            },
            sessionId: {
              type: 'string',
              description: 'Opcional: ID de sesión de conversación para vincular la cita.',
            },
            operationId: {
              type: 'string',
              description: 'Identificador único de operación para evitar duplicados.',
            },
          },
          required: ['nombreCliente', 'producto', 'fecha', 'hora'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            appointmentCode: { type: 'string' },
            contactName: { type: 'string' },
            contactEmail: { type: ['string', 'null'] },
            productName: { type: 'string' },
            scheduledDate: { type: 'string' },
            scheduledTime: { type: 'string' },
            status: { type: 'string' },
            createdAt: { type: 'string' },
          },
          required: ['id', 'appointmentCode', 'contactName', 'productName', 'scheduledDate', 'scheduledTime', 'status'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
      {
        name: 'registrar_nota_oportunidad',
        description:
          'Guarda una nota comercial o seguimiento sobre una oportunidad existente. Requiere confirmación del usuario y devuelve la nota creada.',
        inputSchema: {
          type: 'object',
          properties: {
            oportunidadId: {
              type: 'string',
              description: 'UUID de la oportunidad (Lead.id).',
            },
            contenido: {
              type: 'string',
              description: 'Contenido de la nota o resumen del contacto.',
            },
            fechaSeguimiento: {
              type: 'string',
              description: 'Opcional: fecha de próximo seguimiento en formato YYYY-MM-DD.',
            },
            operationId: {
              type: 'string',
              description: 'Identificador único de operación para idempotencia.',
            },
          },
          required: ['oportunidadId', 'contenido'],
          additionalProperties: false,
        },
        outputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            leadId: { type: 'string' },
            authorEmail: { type: 'string' },
            authorName: { type: 'string' },
            content: { type: 'string' },
            followUpAt: { type: ['string', 'null'] },
            createdAt: { type: 'string' },
          },
          required: ['id', 'leadId', 'authorEmail', 'authorName', 'content', 'createdAt'],
        },
        annotations: { readOnlyHint: false, destructiveHint: false },
      },
    ];
  }

  private errorOut(errorCode: string, message: string): UniversalMcpToolOutput {
    return {
      isError: true,
      structuredContent: {
        errorCode,
        message,
      },
    };
  }

  private validateArgs(
    toolDef: UniversalMcpToolSchema,
    args: Record<string, unknown>,
  ): string | null {
    const allowedKeys = new Set(Object.keys(toolDef.inputSchema.properties));
    for (const key of Object.keys(args)) {
      if (!allowedKeys.has(key)) {
        return `Argumento no definido para ${toolDef.name}: "${key}"`;
      }
    }
    for (const req of toolDef.inputSchema.required ?? []) {
      const val = args[req];
      if (val === undefined || val === null || String(val).trim() === '') {
        return `Falta el argumento requerido "${req}" en ${toolDef.name}.`;
      }
    }
    return null;
  }

  private getIdempotentCache(cacheKey: string): UniversalMcpToolOutput | null {
    const now = Date.now();
    const cached = this.operationCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.result;
    }
    return null;
  }

  private setIdempotentCache(cacheKey: string, result: UniversalMcpToolOutput): void {
    this.operationCache.set(cacheKey, {
      expiresAt: Date.now() + 10 * 60_000,
      result,
    });
    if (this.operationCache.size > 500) {
      const firstKey = this.operationCache.keys().next().value;
      if (firstKey) this.operationCache.delete(firstKey);
    }
  }

  async callTool(
    toolName: string,
    rawArgs: Record<string, unknown> | undefined,
    context: UniversalMcpCallContext,
  ): Promise<UniversalMcpToolOutput> {
    const toolDef = this.listTools().find((t) => t.name === toolName);
    if (!toolDef) {
      return this.errorOut('NOT_FOUND', `Herramienta MCP no encontrada: ${toolName}`);
    }

    const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
    const validationErr = this.validateArgs(toolDef, args);
    if (validationErr) {
      return this.errorOut('VALIDATION_ERROR', validationErr);
    }

    const opId = typeof args.operationId === 'string' && args.operationId.trim()
      ? `${context.tenantSlug}:${toolName}:${args.operationId.trim()}`
      : null;

    if (opId && !toolDef.annotations.readOnlyHint) {
      const cached = this.getIdempotentCache(opId);
      if (cached) return cached;
    }

    try {
      let output: UniversalMcpToolOutput;

      switch (toolName) {
        case 'verificar_conexion': {
          output = {
            structuredContent: {
              ok: true,
              server: 'fidel-crm-mcp',
              version: '1.3.0',
              tenantSlug: context.tenantSlug,
              timestamp: new Date().toISOString(),
            },
          };
          break;
        }

        case 'consultar_empresa': {
          const tenant = await this.prisma.tenant.findUnique({
            where: { slug: context.tenantSlug },
            select: { id: true, name: true, slug: true, isActive: true },
          });
          if (!tenant) {
            return this.errorOut('NOT_FOUND', `Empresa no encontrada: ${context.tenantSlug}`);
          }
          output = {
            structuredContent: {
              id: tenant.id,
              nombre: tenant.name,
              slug: tenant.slug,
              activa: tenant.isActive,
            },
          };
          break;
        }

        case 'listar_lineas_producto': {
          const tenant = await this.prisma.tenant.findUnique({
            where: { slug: context.tenantSlug },
            select: { id: true },
          });
          if (!tenant) {
            return this.errorOut('NOT_FOUND', `Empresa no encontrada: ${context.tenantSlug}`);
          }
          const lines = await this.prisma.productLine.findMany({
            where: { tenantId: tenant.id },
            orderBy: { name: 'asc' },
            select: { id: true, name: true, tagline: true, badge: true },
          });
          output = {
            structuredContent: {
              total: lines.length,
              page: 1,
              items: lines,
            },
          };
          break;
        }

        case 'buscar_oportunidades': {
          const page = Math.max(1, Number(args.page || 1));
          const limit = Math.min(Math.max(1, Number(args.limite || 20)), 50);
          const skip = (page - 1) * limit;

          const texto = typeof args.texto === 'string' ? args.texto.trim() : '';
          const intencion = typeof args.intencion === 'string' ? args.intencion.trim() : '';
          const productLineId =
            typeof args.productLineId === 'string' ? args.productLineId.trim() : '';

          const where: Record<string, unknown> = {
            conversation: {
              tenant: { slug: context.tenantSlug },
            },
          };

          if (intencion) where.purchaseIntent = intencion;
          if (productLineId) where.productLineId = productLineId;
          if (texto) {
            where.OR = [
              { objection: { contains: texto, mode: 'insensitive' } },
              { suggestedAction: { contains: texto, mode: 'insensitive' } },
              { extractedDataJson: { contains: texto, mode: 'insensitive' } },
              { conversation: { sessionId: { contains: texto, mode: 'insensitive' } } },
            ];
          }

          const [total, rows] = await Promise.all([
            this.prisma.lead.count({ where: where as never }),
            this.prisma.lead.findMany({
              where: where as never,
              skip,
              take: limit,
              orderBy: { updatedAt: 'desc' },
              include: {
                productLine: { select: { name: true } },
                conversation: { select: { sessionId: true, controlState: true } },
              },
            }),
          ]);

          output = {
            structuredContent: {
              total,
              page,
              limit,
              items: rows.map((r) => ({
                id: r.id,
                sessionId: r.conversation.sessionId,
                productLineId: r.productLineId,
                productName: r.productLine?.name ?? null,
                purchaseIntent: r.purchaseIntent,
                objection: r.objection,
                suggestedAction: r.suggestedAction,
                controlState: r.conversation.controlState,
                updatedAt: r.updatedAt.toISOString(),
              })),
            },
          };
          break;
        }

        case 'consultar_oportunidad': {
          const oportunidadId =
            typeof args.oportunidadId === 'string' ? args.oportunidadId.trim() : '';
          const sessionId = typeof args.sessionId === 'string' ? args.sessionId.trim() : '';

          if (!oportunidadId && !sessionId) {
            return this.errorOut(
              'VALIDATION_ERROR',
              'Debes enviar "oportunidadId" o "sessionId".',
            );
          }

          const lead = await this.prisma.lead.findFirst({
            where: {
              ...(oportunidadId ? { id: oportunidadId } : {}),
              conversation: {
                tenant: { slug: context.tenantSlug },
                ...(sessionId ? { sessionId } : {}),
              },
            },
            include: {
              productLine: { select: { name: true } },
              conversation: {
                select: {
                  sessionId: true,
                  controlState: true,
                  appointments: {
                    orderBy: { createdAt: 'desc' },
                    take: 10,
                    select: {
                      id: true,
                      appointmentCode: true,
                      scheduledDate: true,
                      scheduledTime: true,
                      status: true,
                    },
                  },
                },
              },
              notes: {
                orderBy: { createdAt: 'desc' },
                take: 20,
                select: {
                  id: true,
                  authorEmail: true,
                  authorName: true,
                  content: true,
                  followUpAt: true,
                  createdAt: true,
                },
              },
            },
          });

          if (!lead) {
            return this.errorOut(
              'NOT_FOUND',
              'Oportunidad no encontrada en la empresa actual.',
            );
          }

          let extractedFields: unknown[] = [];
          try {
            const parsed = JSON.parse(lead.extractedDataJson);
            extractedFields = Array.isArray(parsed) ? parsed : [];
          } catch {
            extractedFields = [];
          }

          output = {
            structuredContent: {
              id: lead.id,
              sessionId: lead.conversation.sessionId,
              productLineId: lead.productLineId,
              productName: lead.productLine?.name ?? null,
              purchaseIntent: lead.purchaseIntent,
              objection: lead.objection,
              suggestedAction: lead.suggestedAction,
              controlState: lead.conversation.controlState,
              extractedFields,
              notes: lead.notes.map((n) => ({
                ...n,
                createdAt: n.createdAt.toISOString(),
              })),
              appointments: lead.conversation.appointments,
              createdAt: lead.createdAt.toISOString(),
              updatedAt: lead.updatedAt.toISOString(),
            },
          };
          break;
        }

        case 'listar_citas': {
          const page = Math.max(1, Number(args.page || 1));
          const limit = Math.min(Math.max(1, Number(args.limite || 20)), 50);
          const skip = (page - 1) * limit;

          const estado = typeof args.estado === 'string' ? args.estado.trim() : '';
          const fecha = typeof args.fecha === 'string' ? args.fecha.trim() : '';

          const tenantScope =
            context.tenantSlug === 'clearminds'
              ? {
                  OR: [
                    { conversation: { tenant: { slug: context.tenantSlug } } },
                    { conversationId: null },
                  ],
                }
              : {
                  conversation: { tenant: { slug: context.tenantSlug } },
                };

          const where: Record<string, unknown> = {
            ...tenantScope,
          };
          if (estado) where.status = estado;
          if (fecha) where.scheduledDate = fecha;

          const [total, items] = await Promise.all([
            this.prisma.appointment.count({ where: where as never }),
            this.prisma.appointment.findMany({
              where: where as never,
              skip,
              take: limit,
              orderBy: { createdAt: 'desc' },
            }),
          ]);

          output = {
            structuredContent: {
              total,
              page,
              limit,
              items: items.map((a) => ({
                id: a.id,
                appointmentCode: a.appointmentCode,
                contactName: a.contactName,
                contactEmail: a.contactEmail,
                productName: a.productName,
                scheduledDate: a.scheduledDate,
                scheduledTime: a.scheduledTime,
                status: a.status,
                createdAt: a.createdAt.toISOString(),
              })),
            },
          };
          break;
        }

        case 'actualizar_oportunidad': {
          const oportunidadId = String(args.oportunidadId).trim();
          const existing = await this.prisma.lead.findFirst({
            where: {
              id: oportunidadId,
              conversation: { tenant: { slug: context.tenantSlug } },
            },
          });

          if (!existing) {
            return this.errorOut(
              'NOT_FOUND',
              'Oportunidad no encontrada o sin acceso para la empresa actual.',
            );
          }

          const dataToUpdate: Record<string, unknown> = {};
          if (typeof args.intencion === 'string') {
            dataToUpdate.purchaseIntent = args.intencion;
          }
          if (typeof args.productLineId === 'string') {
            const validLine = await this.prisma.productLine.findFirst({
              where: {
                id: args.productLineId.trim(),
                tenant: { slug: context.tenantSlug },
              },
            });
            if (!validLine) {
              return this.errorOut(
                'VALIDATION_ERROR',
                `La línea de producto "${args.productLineId}" no existe en la empresa.`,
              );
            }
            dataToUpdate.productLineId = validLine.id;
          }
          if (typeof args.objecion === 'string') {
            dataToUpdate.objection = args.objecion.trim();
          }
          if (typeof args.siguienteAccion === 'string') {
            dataToUpdate.suggestedAction = args.siguienteAccion.trim();
          }

          const updated = await this.prisma.lead.update({
            where: { id: existing.id },
            data: dataToUpdate as never,
          });

          output = {
            structuredContent: {
              id: updated.id,
              productLineId: updated.productLineId,
              purchaseIntent: updated.purchaseIntent,
              objection: updated.objection,
              suggestedAction: updated.suggestedAction,
              updatedAt: updated.updatedAt.toISOString(),
            },
          };
          break;
        }

        case 'programar_cita': {
          const nombreCliente = String(args.nombreCliente).trim();
          const contactoCliente =
            typeof args.contactoCliente === 'string' ? args.contactoCliente.trim() : null;
          const producto = String(args.producto).trim();
          const fecha = String(args.fecha).trim();
          const hora = String(args.hora).trim();
          const sessionId =
            typeof args.sessionId === 'string' ? args.sessionId.trim() : '';

          let conversationId: string | null = null;
          if (sessionId) {
            const conv = await this.prisma.conversation.findFirst({
              where: { sessionId, tenant: { slug: context.tenantSlug } },
              select: { id: true },
            });
            if (!conv) {
              return this.errorOut(
                'NOT_FOUND',
                `Sesión "${sessionId}" no encontrada en la empresa actual.`,
              );
            }
            conversationId = conv.id;
          } else {
            const tenant = await this.prisma.tenant.findUnique({
              where: { slug: context.tenantSlug },
              select: { id: true },
            });
            if (tenant) {
              const conv = await this.prisma.conversation.create({
                data: {
                  tenantId: tenant.id,
                  sessionId: `universal_apt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  channelType: 'UNIVERSAL_MCP',
                  controlState: 'HUMAN_ACTIVE',
                },
                select: { id: true },
              });
              conversationId = conv.id;
            }
          }

          const appointmentCode = `APT-${Date.now().toString().slice(-6)}`;
          const created = await this.prisma.appointment.create({
            data: {
              conversationId,
              appointmentCode,
              contactName: nombreCliente,
              contactEmail: contactoCliente,
              productName: producto,
              scheduledDate: fecha,
              scheduledTime: hora,
              status: 'CONFIRMED',
            },
          });

          output = {
            structuredContent: {
              id: created.id,
              appointmentCode: created.appointmentCode,
              contactName: created.contactName,
              contactEmail: created.contactEmail,
              productName: created.productName,
              scheduledDate: created.scheduledDate,
              scheduledTime: created.scheduledTime,
              status: created.status,
              createdAt: created.createdAt.toISOString(),
            },
          };
          break;
        }

        case 'registrar_nota_oportunidad': {
          const oportunidadId = String(args.oportunidadId).trim();
          const contenido = String(args.contenido).trim();
          const fechaSeguimiento =
            typeof args.fechaSeguimiento === 'string' ? args.fechaSeguimiento.trim() : null;
          const rawOpId =
            typeof args.operationId === 'string' && args.operationId.trim()
              ? `${context.tenantSlug}:${args.operationId.trim()}`
              : null;

          const lead = await this.prisma.lead.findFirst({
            where: {
              id: oportunidadId,
              conversation: { tenant: { slug: context.tenantSlug } },
            },
            select: { id: true },
          });

          if (!lead) {
            return this.errorOut(
              'NOT_FOUND',
              'Oportunidad no encontrada o sin acceso para la empresa actual.',
            );
          }

          if (rawOpId) {
            const existingNote = await this.prisma.leadNote.findUnique({
              where: { operationId: rawOpId },
            });
            if (existingNote) {
              output = {
                structuredContent: {
                  id: existingNote.id,
                  leadId: existingNote.leadId,
                  authorEmail: existingNote.authorEmail,
                  authorName: existingNote.authorName,
                  content: existingNote.content,
                  followUpAt: existingNote.followUpAt,
                  createdAt: existingNote.createdAt.toISOString(),
                },
              };
              break;
            }
          }

          const note = await this.prisma.leadNote.create({
            data: {
              leadId: lead.id,
              authorEmail: context.userEmail,
              authorName: context.userName,
              content: contenido,
              followUpAt: fechaSeguimiento,
              operationId: rawOpId,
            },
          });

          output = {
            structuredContent: {
              id: note.id,
              leadId: note.leadId,
              authorEmail: note.authorEmail,
              authorName: note.authorName,
              content: note.content,
              followUpAt: note.followUpAt,
              createdAt: note.createdAt.toISOString(),
            },
          };
          break;
        }

        default:
          return this.errorOut('NOT_FOUND', `Herramienta desconocida: ${toolName}`);
      }

      if (opId && !toolDef.annotations.readOnlyHint && !output.isError) {
        this.setIdempotentCache(opId, output);
      }
      return output;
    } catch (err) {
      this.logger.error(`Error ejecutando tool universal "${toolName}": ${(err as Error).message}`);
      return this.errorOut(
        'UPSTREAM_ERROR',
        'No se pudo completar la operación en el servidor CRM.',
      );
    }
  }
}
