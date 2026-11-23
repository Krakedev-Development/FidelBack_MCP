import { Injectable, Logger } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { PrismaService } from '../../../../context/database/prisma.service';
import {
  McpResourceDefinition,
  McpToolDefinition,
  McpToolExecutionResult,
} from '../../domain/interfaces/mcp-tool.port';
import {
  CLEARMINDS_MCP_RESOURCES,
  CLEARMINDS_MCP_TOOLS,
} from '../../infrastructure/resources/clearminds-catalog.resource';

@Injectable()
export class McpRegistryService {
  private readonly logger = new Logger(McpRegistryService.name);
  private readonly mcpServer: Server;

  private readonly executionLogs: McpToolExecutionResult[] = [];

  constructor(private readonly prisma: PrismaService) {
    this.mcpServer = new Server(
      {
        name: 'fidel-clearminds-mcp-server',
        version: '1.3.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      },
    );

    this.registerProtocolHandlers();
  }

  private registerProtocolHandlers(): void {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: CLEARMINDS_MCP_TOOLS,
    }));

    this.mcpServer.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: CLEARMINDS_MCP_RESOURCES.map((r: McpResourceDefinition) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType,
      })),
    }));

    this.mcpServer.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const resource = CLEARMINDS_MCP_RESOURCES.find(
        (r: McpResourceDefinition) => r.uri === request.params.uri,
      );
      if (!resource) {
        throw new Error(`Recurso MCP no encontrado: ${request.params.uri}`);
      }
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.content,
          },
        ],
      };
    });

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await this.executeTool(
        request.params.name,
        (request.params.arguments as Record<string, unknown>) ?? {},
      );
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    });
  }

  getMcpServerInstance(): Server {
    return this.mcpServer;
  }

  listTools(): McpToolDefinition[] {
    return CLEARMINDS_MCP_TOOLS;
  }

  listResources(): McpResourceDefinition[] {
    return CLEARMINDS_MCP_RESOURCES;
  }

  getRecentExecutions(): McpToolExecutionResult[] {
    return this.executionLogs.slice(0, 30);
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<McpToolExecutionResult> {
    const timestamp = new Date().toISOString();

    try {
      switch (toolName) {
        case 'cotizar_descuento_grupo': {
          const productKey = String(args.productKey || 'krakedev_academy');
          const count = Math.max(1, Number(args.participants || 1));
          const paymentMode = String(args.paymentMode || 'contado');

          if (productKey === 'krakedev_academy') {
            const enrollmentFee = 40;
            const firstModule = 280;
            const totalPerStudent = enrollmentFee + firstModule;
            const totalInvestment = totalPerStudent * count;

            const result: McpToolExecutionResult = {
              toolName,
              success: true,
              timestamp,
              data: {
                productKey,
                participants: count,
                paymentMode,
                enrollmentUsd: enrollmentFee,
                firstModuleUsd: firstModule,
                totalPerStudentUsd: totalPerStudent,
                totalInvestmentUsd: totalInvestment,
                modality: '100% Online, interactiva y con acompañamiento cercano',
              },
              message: `Cotización Krakedev (Oferta promocional): Matrícula $${enrollmentFee} USD + Primer módulo $${firstModule} USD (Total por estudiante: $${totalPerStudent} USD).`,
            };
            this.recordExecution(result);
            return result;
          } else if (productKey === 'aws_certifications') {
            const regularPriceUsd = 235;
            const blackFridayPriceUsd = 165;

            const result: McpToolExecutionResult = {
              toolName,
              success: true,
              timestamp,
              data: {
                productKey,
                programName: 'Preparación AWS Certified Solutions Architect – Associate',
                participants: count,
                paymentMode,
                regularPriceUsd,
                blackFridayPriceUsd,
                promoValidUntil: '30 de noviembre',
                duration: '8 semanas',
                modality: 'Clases 100 % en vivo',
                plannedStartDate: '11 de enero de 2027',
                schedules: {
                  morning: 'Lunes, miércoles y viernes | 07h00–08h20',
                  evening: 'Martes y jueves | 19h30–21h30',
                },
                includesVoucher: false,
                paymentMethods: ['Transferencia bancaria', 'Tarjeta de crédito', 'Link de pago'],
                syllabusUrl:
                  'https://drive.google.com/file/d/1godC01fw8ztyh0550ZgwwAyYgSKYnRp6/view?usp=sharing',
              },
              message: `Preparación AWS Certified Solutions Architect – Associate: Precio regular $${regularPriceUsd} USD; promoción Black Friday $${blackFridayPriceUsd} USD (ahorro de $70, vigente hasta el 30 de noviembre). Duración: 8 semanas, clases 100 % en vivo, inicio previsto 11 de enero de 2027. Voucher del examen oficial NO incluido.`,
            };
            this.recordExecution(result);
            return result;
          } else {
            const customResult: McpToolExecutionResult = {
              toolName,
              success: true,
              timestamp,
              data: {
                productKey,
                quotationType: 'NO_FIXED_PRICE',
                recommendation:
                  productKey === 'ai_assistants_b2b'
                    ? 'Indagar proceso a automatizar y proponer sesión técnica breve (accesos anticipados / piloto a medida).'
                    : 'No dar precios cerrados; levantar requerimientos específicos en reunión con especialista.',
              },
              message: `Sin precio cerrado para ${productKey}: requiere levantamiento técnico/comercial con especialista.`,
            };
            this.recordExecution(customResult);
            return customResult;
          }
        }

        case 'agendar_cita': {
          const leadName = String(args.leadName || 'Prospecto Clear Minds');
          const leadContact = String(args.leadContact || 'Por confirmar');
          const productKey = String(args.productKey || 'custom_software');
          const scheduledAtRaw = String(
            args.scheduledAt || new Date(Date.now() + 86400000).toISOString(),
          );

          const appointmentCode = `APT-${Date.now().toString().slice(-6)}`;
          try {
            await this.prisma.appointment.create({
              data: {
                appointmentCode,
                contactName: leadName,
                contactEmail: leadContact,
                productName: productKey,
                scheduledDate: scheduledAtRaw.slice(0, 10),
                scheduledTime: scheduledAtRaw.slice(11, 16) || '10:00',
              },
            });
          } catch (dbErr) {
            this.logger.debug(`Modo sin DB activa en agendar_cita: ${(dbErr as Error).message}`);
          }

          const result: McpToolExecutionResult = {
            toolName,
            success: true,
            timestamp,
            data: {
              appointmentCode,
              leadName,
              leadContact,
              productKey,
              scheduledAt: scheduledAtRaw,
              meetingLink: `https://meet.clearminds.ec/fidel-${appointmentCode.toLowerCase()}`,
            },
            message: `Cita agendada (${appointmentCode}) para ${leadName} (${productKey}) en fecha/hora: ${scheduledAtRaw}.`,
          };
          this.recordExecution(result);
          return result;
        }

        case 'registrar_lead_crm': {
          const sessionId = String(args.sessionId || '');
          const productKey = String(args.productKey || 'custom_software');
          const intentLevel = String(args.intentLevel || 'MEDIO');
          const extractedFields =
            (args.extractedFields as Record<string, unknown>) ?? {};

          try {
            if (sessionId) {
              await this.prisma.conversation.updateMany({
                where: { sessionId },
                data: {
                  productLineId: productKey,
                },
              });
            }
          } catch (dbErr) {
            this.logger.debug(`Modo sin DB activa en registrar_lead_crm: ${(dbErr as Error).message}`);
          }

          const result: McpToolExecutionResult = {
            toolName,
            success: true,
            timestamp,
            data: {
              sessionId: sessionId || 'session_local',
              productKey,
              intentLevel,
              extractedFields,
            },
            message: `Lead sincronizado en CRM para la línea ${productKey} con intención ${intentLevel}.`,
          };
          this.recordExecution(result);
          return result;
        }

        case 'transferir_a_humano': {
          const sessionId = String(args.sessionId || 'session_local');
          const reason = String(args.reason || 'Solicitud de atención personalizada');

          const result: McpToolExecutionResult = {
            toolName,
            success: true,
            timestamp,
            data: {
              sessionId,
              newStatus: 'PENDING_HANDOFF',
              reason,
            },
            message: `Escalamiento a asesor humano solicitado para sesión ${sessionId} (Fidel activo hasta respuesta del asesor). Motivo: ${reason}`,
          };
          this.recordExecution(result);
          return result;
        }

        default: {
          const unknownResult: McpToolExecutionResult = {
            toolName,
            success: false,
            timestamp,
            data: { args },
            message: `Herramienta MCP no reconocida: ${toolName}`,
          };
          this.recordExecution(unknownResult);
          return unknownResult;
        }
      }
    } catch (error) {
      const errorResult: McpToolExecutionResult = {
        toolName,
        success: false,
        timestamp,
        data: { error: (error as Error).message },
        message: `Error ejecutando tool MCP ${toolName}: ${(error as Error).message}`,
      };
      this.recordExecution(errorResult);
      return errorResult;
    }
  }

  private recordExecution(entry: McpToolExecutionResult): void {
    this.executionLogs.unshift(entry);
    if (this.executionLogs.length > 50) {
      this.executionLogs.pop();
    }
  }
}
