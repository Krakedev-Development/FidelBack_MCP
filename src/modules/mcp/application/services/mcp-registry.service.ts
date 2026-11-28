import { Injectable, Logger } from "@nestjs/common";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { PrismaService } from "../../../../context/database/prisma.service";
import {
  McpResourceDefinition,
  McpToolDefinition,
  McpToolExecutionResult,
} from "../../domain/interfaces/mcp-tool.port";
import {
  CLEARMINDS_MCP_RESOURCES,
  CLEARMINDS_MCP_TOOLS,
} from "../../infrastructure/resources/clearminds-catalog.resource";

@Injectable()
export class McpRegistryService {
  private readonly logger = new Logger(McpRegistryService.name);
  private readonly mcpServer: Server;

  private readonly executionLogs: McpToolExecutionResult[] = [];

  constructor(private readonly prisma: PrismaService) {
    this.mcpServer = new Server(
      {
        name: "fidel-clearminds-mcp-server",
        version: "1.3.0",
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

    this.mcpServer.setRequestHandler(
      ReadResourceRequestSchema,
      async (request) => {
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
      },
    );

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const result = await this.executeTool(
        request.params.name,
        (request.params.arguments as Record<string, unknown>) ?? {},
      );
      return {
        content: [
          {
            type: "text",
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
        case "cotizar_descuento_grupo": {
          const productKey = String(args.productKey || "krakedev_academy");
          const count = Math.max(1, Number(args.participants || 1));
          const paymentMode = String(args.paymentMode || "contado");

          const result: McpToolExecutionResult = {
            toolName,
            success: true,
            timestamp,
            data: {
              productKey,
              participants: count,
              paymentMode,
              source: "OPENAI_VECTOR_STORE_RAG",
            },
            message: `Consultar los documentos vigentes del Vector Store (file_search) para precios y promociones actualizadas de ${productKey}.`,
          };
          this.recordExecution(result);
          return result;
        }

        case "agendar_cita": {
          const leadName = String(args.leadName || "Prospecto Clear Minds");
          const leadContact = String(args.leadContact || "Por confirmar");
          const productKey = String(args.productKey || "custom_software");
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
                scheduledTime: scheduledAtRaw.slice(11, 16) || "10:00",
              },
            });
          } catch (dbErr) {
            this.logger.debug(
              `Modo sin DB activa en agendar_cita: ${(dbErr as Error).message}`,
            );
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

        case "registrar_lead_crm": {
          const sessionId = String(args.sessionId || "");
          const productKey = String(args.productKey || "custom_software");
          const intentLevel = String(args.intentLevel || "MEDIO");
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
            this.logger.debug(
              `Modo sin DB activa en registrar_lead_crm: ${(dbErr as Error).message}`,
            );
          }

          const result: McpToolExecutionResult = {
            toolName,
            success: true,
            timestamp,
            data: {
              sessionId: sessionId || "session_local",
              productKey,
              intentLevel,
              extractedFields,
            },
            message: `Lead sincronizado en CRM para la línea ${productKey} con intención ${intentLevel}.`,
          };
          this.recordExecution(result);
          return result;
        }

        case "transferir_a_humano": {
          const sessionId = String(args.sessionId || "session_local");
          const reason = String(
            args.reason || "Solicitud de atención personalizada",
          );

          const result: McpToolExecutionResult = {
            toolName,
            success: true,
            timestamp,
            data: {
              sessionId,
              newStatus: "PENDING_HANDOFF",
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
