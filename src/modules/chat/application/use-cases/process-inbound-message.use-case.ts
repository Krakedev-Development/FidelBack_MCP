import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../context/database/prisma.service';
import { CLEARMINDS_MCP_RESOURCES } from '../../../mcp/infrastructure/resources/clearminds-catalog.resource';
import { McpRegistryService } from '../../../mcp/application/services/mcp-registry.service';
import {
  McpResourceDefinition,
  McpToolExecutionResult,
} from '../../../mcp/domain/interfaces/mcp-tool.port';
import { CrmService } from '../../../crm/application/services/crm.service';
import { OpenAiRagService } from '../../../knowledge/application/services/openai-rag.service';
import { LlmGatewayAdapter } from '../../infrastructure/adapters/llm-gateway.adapter';
import {
  AdContextInput,
  ProductLineKey,
  StructuredExtractionItem,
} from '../../domain/interfaces/llm-gateway.port';

export interface InMemorySessionState {
  sessionId: string;
  tenantSlug: string;
  status: 'AI_ACTIVE' | 'HUMAN_ACTIVE' | 'CLOSED';
  activeProductKey: ProductLineKey | null;
  adSummary?: string;
  broadcastContext?: string;
  incrementalSummary: string;
  messagesCount: number;
  extractedFields: StructuredExtractionItem[];
  history: Array<{
    role: 'user' | 'assistant' | 'human_agent';
    content: string;
    createdAt: string;
  }>;
}

@Injectable()
export class ProcessInboundMessageUseCase {
  private readonly logger = new Logger(ProcessInboundMessageUseCase.name);
  private readonly sessions = new Map<string, InMemorySessionState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crmService: CrmService,
    private readonly mcpRegistry: McpRegistryService,
    private readonly llmGateway: LlmGatewayAdapter,
    private readonly openAiRag: OpenAiRagService,
  ) {}

  getOrCreateMemorySession(
    sessionId: string,
    initialProductKey: ProductLineKey | null = null,
    tenantSlug = 'clearminds',
  ): InMemorySessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.tenantSlug = tenantSlug || existing.tenantSlug;
      return existing;
    }

    const resource = initialProductKey
      ? CLEARMINDS_MCP_RESOURCES.find(
          (r: McpResourceDefinition) => r.productKey === initialProductKey,
        ) ?? null
      : null;

    const created: InMemorySessionState = {
      sessionId,
      tenantSlug,
      status: 'AI_ACTIVE',
      activeProductKey: initialProductKey,
      incrementalSummary: '',
      messagesCount: 0,
      extractedFields: resource
        ? resource.requiredFields.map((key: string) => ({
            key,
            value: 'Pendiente',
            status: 'missing',
          }))
        : [],
      history: [],
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  getSessionState(sessionId: string): InMemorySessionState {
    return this.getOrCreateMemorySession(sessionId);
  }

  private isWithinAdvisorHours(): boolean {
    const hourStr = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Guayaquil',
      hour: 'numeric',
      hourCycle: 'h23',
    }).format(new Date());
    const hour = Number(hourStr) % 24;
    return hour >= 8 && hour < 17;
  }

  private async buildAdSummary(
    adContext: AdContextInput,
    apiKey?: string,
    provider?: 'gemini' | 'openai',
  ): Promise<string> {
    const parts: string[] = [];

    if (adContext.campaignName?.trim()) {
      parts.push(`Campaña: "${adContext.campaignName.trim()}"`);
    }
    if (
      adContext.headline?.trim() &&
      !/^(https?:\/\/)?(api\.whatsapp\.com|wa\.me|facebook\.com)/i.test(adContext.headline.trim())
    ) {
      parts.push(`Título del anuncio: "${adContext.headline.trim()}"`);
    }
    if (adContext.body?.trim()) {
      parts.push(`Texto del anuncio: "${adContext.body.trim()}"`);
    }
    if (
      adContext.welcomeText?.trim() &&
      !adContext.welcomeText.includes('Completa el siguiente formulario para registrarte')
    ) {
      parts.push(`Saludo del anuncio: "${adContext.welcomeText.trim()}"`);
    }
    if (adContext.imageUrl?.trim()) {
      const visualText = await this.llmGateway.analyzeAdImage(
        adContext.imageUrl.trim(),
        adContext.sourceId,
        apiKey,
        provider,
      );
      if (visualText) {
        parts.push(`Contenido visual de la imagen del anuncio: "${visualText}"`);
      }
    }

    return parts.join(' | ');
  }

  async setSessionStatus(
    sessionId: string,
    status: 'AI_ACTIVE' | 'HUMAN_ACTIVE' | 'CLOSED',
  ) {
    const session = this.getOrCreateMemorySession(sessionId);
    session.status = status;

    try {
      await this.prisma.conversation.updateMany({
        where: { sessionId },
        data: {
          controlState: status,
          ...(status === 'HUMAN_ACTIVE' ? { nextFollowUpAt: null } : {}),
        },
      });
    } catch {
      // Fallback in-memory
    }

    return {
      sessionId,
      status: session.status,
      message:
        status === 'HUMAN_ACTIVE'
          ? 'Modo Espejo activado (HUMAN_ACTIVE). Fidel escuchará en silencio sin responder al cliente.'
          : 'Modo IA activado (AI_ACTIVE). Fidel retoma la atención automática.',
    };
  }

  async execute(params: {
    sessionId: string;
    message: string;
    provider: 'gemini' | 'openai';
    model: string;
    apiKey?: string;
    tenantApiKey?: string;
    tenantSlug?: string;
    activeProductKey?: ProductLineKey;
    senderRole?: 'user' | 'human_agent';
    customSystemPrompt?: string;
    trainingMode?: boolean;
    trainerName?: string;
    adContext?: AdContextInput;
    broadcastContext?: string;
  }) {
    // 0. Resolver empresa (Tenant) por x-tenant-key o tenantSlug
    const resolvedTenantSlug = await this.crmService.resolveTenantSlug(
      params.tenantApiKey,
      params.tenantSlug,
    );

    const session = this.getOrCreateMemorySession(
      params.sessionId,
      params.activeProductKey ?? null,
      resolvedTenantSlug,
    );

    if (params.activeProductKey && params.activeProductKey !== session.activeProductKey) {
      session.activeProductKey = params.activeProductKey;
    }

    if (params.adContext && !session.adSummary) {
      const summary = await this.buildAdSummary(params.adContext, params.apiKey, params.provider);
      if (summary) {
        session.adSummary = summary;
      }
    }

    if (params.broadcastContext?.trim()) {
      session.broadcastContext = params.broadcastContext.trim();
    }

    const incomingRole = params.senderRole || 'user';
    session.history.push({
      role: incomingRole,
      content: params.message,
      createdAt: new Date().toISOString(),
    });
    session.messagesCount += 1;

    if (session.status === 'HUMAN_ACTIVE' || incomingRole === 'human_agent') {
      session.status = 'HUMAN_ACTIVE';
      return {
        sessionId: session.sessionId,
        tenantSlug: resolvedTenantSlug,
        status: session.status,
        ignoredByAi: true,
        replyText: null,
        detectedProductKey: session.activeProductKey,
        productSwitched: false,
        incrementalSummary: session.incrementalSummary,
        extractedFields: session.extractedFields,
        mcpExecutions: [],
        notice:
          'Mensaje registrado en Modo Espejo (HUMAN_ACTIVE). Fidel actualizó el contexto silenciosamente sin interrumpir al asesor humano.',
      };
    }

    const tenantConfig = await this.crmService.getTenantConfig(resolvedTenantSlug);
    const isClearMinds = resolvedTenantSlug === 'clearminds';

    const allBrochuresContext = isClearMinds
      ? CLEARMINDS_MCP_RESOURCES.map(
          (r: McpResourceDefinition) =>
            `### [${r.productKey}] ${r.name}\nCampos requeridos: ${r.requiredFields.join(', ')}\n${r.content}`,
        ).join('\n\n')
      : tenantConfig.productLines && tenantConfig.productLines.length > 0
        ? tenantConfig.productLines
            .map((p: Record<string, unknown>) =>
              'id' in p
                ? `### [${String(p.id)}] ${String(p.name)}\n${String(p.systemInstructions)}`
                : `### [${String(p.key)}] ${String(p.title)}\n${String(p.brochureContext)}`,
            )
            .join('\n\n')
        : 'Usa estrictamente la información y datos contextuales proporcionados en la conversación.';

    const activeResource = session.activeProductKey
      ? CLEARMINDS_MCP_RESOURCES.find(
          (r: McpResourceDefinition) => r.productKey === session.activeProductKey,
        ) ?? null
      : null;

    const activeRulesBlock = await this.crmService.getActiveTrainingRulesBlock(resolvedTenantSlug);
    const todayEcuador = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guayaquil',
    }).format(new Date());

    const ragInfo = await this.openAiRag.getActiveVectorStoreInfo(resolvedTenantSlug);
    const useRagFirst =
      params.provider === 'openai' &&
      Boolean(ragInfo.vectorStoreId) &&
      ragInfo.readyDocumentsCount > 0;

    const ragCatalogSummary = isClearMinds
      ? CLEARMINDS_MCP_RESOURCES.map(
          (r: McpResourceDefinition) =>
            `- [${r.productKey}] ${r.name} (Campos CRM: ${r.requiredFields.join(', ')})`,
        ).join('\n')
      : (tenantConfig.productLines || [])
          .map((p: Record<string, unknown>) => `- [${String(p.id || p.key)}] ${String(p.name || p.title)}`)
          .join('\n');

    const knowledgeSection = useRagFirst
      ? `LÍNEAS DE NEGOCIO PARA CLASIFICACIÓN CRM:\n${ragCatalogSummary || '- General'}\n\nFUENTE PRINCIPAL DE CONOCIMIENTO (RAG VECTOR STORE ACTIVO - ${ragInfo.readyDocumentsCount} documento(s)):\n- Usa OBLIGATORIAMENTE la herramienta file_search para consultar manuales de comportamiento de Fidel, productos, campañas, precios, fechas de inicio, horarios, temarios y promociones vigentes.\n- JERARQUÍA OBLIGATORIA: Ante cualquier diferencia de precios, fechas, horarios o promociones entre POLÍTICA Y REGLAS y los documentos recuperados por file_search (RAG), PREVALECEN SIEMPRE los documentos del RAG y las REGLAS APRENDIDAS activas.\n- No respondas usando suposiciones ni promociones viejas que no aparezcan activas en los documentos del RAG para la fecha actual (${todayEcuador}).\n- Si una promoción o dato consultado no aparece vigente en los documentos del RAG, dilo con honestidad y escala a un asesor humano.`
      : `CATÁLOGO / CONOCIMIENTO:\n${allBrochuresContext}`;

    const systemPrompt =
      params.customSystemPrompt?.trim() ||
      `Eres ${tenantConfig.tenant.agentName}, ${tenantConfig.tenant.agentRole} de la empresa "${tenantConfig.tenant.name}" (tenant: ${resolvedTenantSlug}).\nFECHA ACTUAL (Ecuador): ${todayEcuador} — úsala para validar si una promoción o fecha de inicio está vigente.\nTONO: ${tenantConfig.tenant.tone}\nPOLÍTICA Y REGLAS DE LA EMPRESA:\n${tenantConfig.tenant.globalRules}\n\nREGLA OBLIGATORIA DE FIDELIDAD DE DATOS:\n- Obedece estrictamente los datos confirmados en los documentos del RAG (file_search), CATÁLOGO / CONOCIMIENTO y REGLAS APRENDIDAS.\n- NUNCA inventes fechas de inicio, duraciones, horarios, precios, promociones, descuentos, cuentas bancarias, links de pago ni inclusión de vouchers.\n\n${knowledgeSection}${activeRulesBlock}`;

    const recentHistory = session.history
      .slice(-8, -1)
      .map((h) => ({
        role: (h.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: h.content,
      }));

    if (params.trainingMode) {
      const trainingOut = await this.llmGateway.generateTrainingTurn({
        provider: params.provider,
        model: params.model,
        apiKey: params.apiKey,
        systemPrompt,
        vectorStoreId: useRagFirst ? ragInfo.vectorStoreId : null,
        recentHistory,
        userMessage: params.message,
      });

      let savedRule: Record<string, unknown> | null = null;
      if (trainingOut.mode === 'CORRECTION' && trainingOut.learnedRule) {
        try {
          const created = await this.crmService.createTrainingRule(resolvedTenantSlug, {
            instruction: trainingOut.learnedRule.instruction,
            category: trainingOut.learnedRule.category,
            sourceFeedback: params.message,
            createdByName: params.trainerName || 'Entrenador',
          });
          savedRule = created.rule as unknown as Record<string, unknown>;
        } catch (err) {
          this.logger.warn(`No se pudo guardar regla aprendida: ${(err as Error).message}`);
        }
      }

      session.history.push({
        role: 'assistant',
        content: trainingOut.reply,
        createdAt: new Date().toISOString(),
      });

      await this.persistTurnInSupabase({
        sessionId: session.sessionId,
        tenantId: tenantConfig.tenant.id,
        productKey: session.activeProductKey,
        controlState: session.status,
        userMessage: params.message,
        aiReply: trainingOut.reply,
        intentLevel: 'MEDIO',
        nextAction: 'Continuar roleplay / entrenamiento',
        extractedFields: session.extractedFields,
        mcpExecutions: [],
      });

      return {
        sessionId: session.sessionId,
        tenantSlug: resolvedTenantSlug,
        tenantName: tenantConfig.tenant.name,
        status: session.status,
        trainingMode: trainingOut.mode,
        replyText: trainingOut.reply,
        learnedRule: savedRule,
        detectedProductKey: session.activeProductKey,
        productSwitched: false,
        intentLevel: 'MEDIO',
        intentJustification: `Sesión en Modo Entrenamiento (${trainingOut.mode})`,
        extractedFields: session.extractedFields,
        nextAction: 'Continuar roleplay / entrenamiento',
        incrementalSummary: session.incrementalSummary,
        mcpExecutions: [],
      };
    }

    const llmOutput = await this.llmGateway.generateCommercialTurn({
      provider: params.provider,
      model: params.model,
      apiKey: params.apiKey,
      systemPrompt,
      activeProductKey: session.activeProductKey,
      requiredFields: activeResource ? activeResource.requiredFields : [],
      incrementalSummary: session.incrementalSummary,
      adSummary: session.adSummary,
      broadcastContext: params.broadcastContext?.trim() || session.broadcastContext,
      vectorStoreId: useRagFirst ? ragInfo.vectorStoreId : null,
      useRagFirst,
      recentHistory,
      userMessage: params.message,
    });

    const previousProductKey = session.activeProductKey;
    const productSwitched =
      previousProductKey !== null && llmOutput.detectedProductKey !== previousProductKey;
    session.activeProductKey = llmOutput.detectedProductKey;
    if (llmOutput.extractedFields.length > 0) {
      session.extractedFields = llmOutput.extractedFields;
    } else if (llmOutput.detectedProductKey) {
      const detectedResource = CLEARMINDS_MCP_RESOURCES.find(
        (r: McpResourceDefinition) => r.productKey === llmOutput.detectedProductKey,
      );
      session.extractedFields = detectedResource
        ? detectedResource.requiredFields.map((key: string) => ({
            key,
            value: 'Pendiente',
            status: 'missing' as const,
          }))
        : [];
    }

    const mcpExecutions: McpToolExecutionResult[] = [];
    let handoffRequested = false;

    for (const toolCall of llmOutput.mcpToolCalls) {
      const execResult = await this.mcpRegistry.executeTool(toolCall.toolName, {
        ...toolCall.arguments,
        sessionId: session.sessionId,
        productKey: toolCall.arguments.productKey ?? session.activeProductKey,
      });
      mcpExecutions.push(execResult);

      if (toolCall.toolName === 'transferir_a_humano') {
        handoffRequested = true;
      }
    }

    const withinBusinessHours = this.isWithinAdvisorHours();
    if (handoffRequested && !withinBusinessHours) {
      const alreadyHasScheduleNotice =
        llmOutput.replyText.includes('8:00') || llmOutput.replyText.includes('5:00');
      if (!alreadyHasScheduleNotice) {
        llmOutput.replyText = `${llmOutput.replyText}\n\n📌 Ten en cuenta que nuestros asesores atienden de 8:00 a.m. a 5:00 p.m., por lo que tu solicitud ya quedó asignada y un asesor se comunicará contigo dentro del horario establecido.`;
      }
    }

    const capturedMap: Record<string, string> = {};
    for (const item of llmOutput.extractedFields) {
      if (item.status !== 'missing' && item.value && item.value !== 'Pendiente') {
        capturedMap[item.key] = item.value;
      }
    }

    if (Object.keys(capturedMap).length > 0) {
      const crmSync = await this.mcpRegistry.executeTool('registrar_lead_crm', {
        sessionId: session.sessionId,
        productKey: session.activeProductKey,
        intentLevel: llmOutput.intentLevel,
        extractedFields: capturedMap,
      });
      mcpExecutions.push(crmSync);
    }

    session.history.push({
      role: 'assistant',
      content: llmOutput.replyText,
      createdAt: new Date().toISOString(),
    });
    session.messagesCount += 1;

    // Persistir conversación y mensajes en Supabase garantizando programación de seguimiento
    await this.persistTurnInSupabase({
      sessionId: session.sessionId,
      tenantId: tenantConfig.tenant.id,
      productKey: session.activeProductKey,
      controlState: session.status,
      userMessage: params.message,
      aiReply: llmOutput.replyText,
      intentLevel: llmOutput.intentLevel,
      nextAction: llmOutput.nextAction,
      extractedFields: session.extractedFields,
      mcpExecutions,
    });

    const summaryInterval = tenantConfig.tenant.summaryInterval || 5;
    let summaryUpdated = false;
    if (session.messagesCount >= summaryInterval && session.messagesCount % summaryInterval <= 1) {
      session.incrementalSummary = await this.llmGateway.generateSummary(
        params.provider,
        params.model,
        params.apiKey,
        session.incrementalSummary,
        session.history.slice(-6),
      );
      summaryUpdated = true;
    }

    return {
      sessionId: session.sessionId,
      tenantSlug: resolvedTenantSlug,
      tenantName: tenantConfig.tenant.name,
      status: session.status,
      replyText: llmOutput.replyText,
      detectedProductKey: session.activeProductKey,
      previousProductKey,
      productSwitched,
      intentLevel: llmOutput.intentLevel,
      intentJustification: llmOutput.intentJustification,
      extractedFields: session.extractedFields,
      nextAction: llmOutput.nextAction,
      handoffRequested,
      handoffCategory: llmOutput.handoffCategory || (handoffRequested ? 'SALES_REQUEST' : null),
      withinBusinessHours,
      incrementalSummary: session.incrementalSummary,
      summaryUpdated,
      mcpExecutions,
      metrics: {
        provider: params.provider,
        model: params.model,
        inputTokens: llmOutput.inputTokens,
        outputTokens: llmOutput.outputTokens,
        latencyMs: llmOutput.latencyMs,
      },
    };
  }

  private async persistTurnInSupabase(data: {
    sessionId: string;
    tenantId: string;
    productKey: string | null;
    controlState: string;
    userMessage: string;
    aiReply: string;
    intentLevel: string;
    nextAction: string;
    extractedFields: StructuredExtractionItem[];
    mcpExecutions: McpToolExecutionResult[];
  }): Promise<void> {
    try {
      const validProductLine = data.productKey
        ? await this.prisma.productLine.findUnique({
            where: { id: data.productKey },
          })
        : null;

      const now = new Date();
      const firstFollowUpAt =
        data.controlState === 'AI_ACTIVE' ? new Date(now.getTime() + 15 * 60_000) : null;

      const conversation = await this.prisma.conversation.upsert({
        where: { sessionId: data.sessionId },
        update: {
          productLineId: validProductLine ? data.productKey : null,
          controlState: data.controlState,
          followUpStage: 0,
          lastCustomerMessageAt: now,
          lastAiReplyAt: now,
          nextFollowUpAt: firstFollowUpAt,
        },
        create: {
          sessionId: data.sessionId,
          tenantId: data.tenantId,
          productLineId: validProductLine ? data.productKey : null,
          controlState: data.controlState,
          followUpStage: 0,
          lastCustomerMessageAt: now,
          lastAiReplyAt: now,
          nextFollowUpAt: firstFollowUpAt,
        },
      });

      await this.prisma.message.createMany({
        data: [
          {
            conversationId: conversation.id,
            senderType: 'CUSTOMER',
            content: data.userMessage,
          },
          {
            conversationId: conversation.id,
            senderType: 'AI',
            content: data.aiReply,
            extractionJson: JSON.stringify(data.extractedFields),
            toolCallJson:
              data.mcpExecutions.length > 0 ? JSON.stringify(data.mcpExecutions) : null,
          },
        ],
      });

      await this.prisma.lead.upsert({
        where: { conversationId: conversation.id },
        update: {
          productLineId: validProductLine ? data.productKey : null,
          purchaseIntent: data.intentLevel.toLowerCase(),
          suggestedAction: data.nextAction,
          extractedDataJson: JSON.stringify(data.extractedFields),
        },
        create: {
          conversationId: conversation.id,
          productLineId: validProductLine ? data.productKey : null,
          purchaseIntent: data.intentLevel.toLowerCase(),
          suggestedAction: data.nextAction,
          extractedDataJson: JSON.stringify(data.extractedFields),
        },
      });
    } catch (err) {
      this.logger.warn(`Error no bloqueante al persistir turno en Supabase: ${(err as Error).message}`);
    }
  }

  async runSandboxTrainingTurn(params: {
    tenantApiKey?: string;
    tenantSlug?: string;
    message: string;
    history?: Array<{ role: 'trainer' | 'fidel'; text: string }>;
    trainerName?: string;
  }) {
    const resolvedTenantSlug = await this.crmService.resolveTenantSlug(
      params.tenantApiKey,
      params.tenantSlug,
    );
    const tenantConfig = await this.crmService.getTenantConfig(resolvedTenantSlug);
    const isClearMinds = resolvedTenantSlug === 'clearminds';

    const allBrochuresContext = isClearMinds
      ? CLEARMINDS_MCP_RESOURCES.map(
          (r: McpResourceDefinition) =>
            `### [${r.productKey}] ${r.name}\nCampos requeridos: ${r.requiredFields.join(', ')}\n${r.content}`,
        ).join('\n\n')
      : tenantConfig.productLines && tenantConfig.productLines.length > 0
        ? tenantConfig.productLines
            .map((p: Record<string, unknown>) =>
              'id' in p
                ? `### [${String(p.id)}] ${String(p.name)}\n${String(p.systemInstructions)}`
                : `### [${String(p.key)}] ${String(p.title)}\n${String(p.brochureContext)}`,
            )
            .join('\n\n')
        : 'Usa estrictamente la información y datos contextuales proporcionados.';

    const activeRulesBlock = await this.crmService.getActiveTrainingRulesBlock(resolvedTenantSlug);
    const defaultProvider = this.llmGateway.getDefaultProvider();
    const defaultModel = this.llmGateway.getDefaultModel(defaultProvider);
    const ragInfo = await this.openAiRag.getActiveVectorStoreInfo(resolvedTenantSlug);
    const useRagFirst =
      defaultProvider === 'openai' &&
      Boolean(ragInfo.vectorStoreId) &&
      ragInfo.readyDocumentsCount > 0;
    const todayEcuador = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Guayaquil',
    }).format(new Date());

    const systemPrompt = `Eres ${tenantConfig.tenant.agentName}, ${tenantConfig.tenant.agentRole} de la empresa "${tenantConfig.tenant.name}" (tenant: ${resolvedTenantSlug}).\nFECHA ACTUAL (Ecuador): ${todayEcuador}\nTONO: ${tenantConfig.tenant.tone}\nPOLÍTICA Y REGLAS DE LA EMPRESA:\n${tenantConfig.tenant.globalRules}\n\n${useRagFirst ? 'Usa file_search (RAG Vector Store) como fuente principal de conocimiento.' : `CATÁLOGO / CONOCIMIENTO:\n${allBrochuresContext}`}${activeRulesBlock}`;

    const recentHistory = (params.history || []).slice(-12).map((h) => ({
      role: (h.role === 'fidel' ? 'assistant' : 'user') as 'user' | 'assistant',
      content: h.text,
    }));

    const out = await this.llmGateway.generateTrainingTurn({
      provider: defaultProvider,
      model: defaultModel,
      systemPrompt,
      vectorStoreId: useRagFirst ? ragInfo.vectorStoreId : null,
      recentHistory,
      userMessage: params.message,
    });

    let savedRule: Record<string, unknown> | null = null;
    if (out.mode === 'CORRECTION' && out.learnedRule) {
      try {
        const created = await this.crmService.createTrainingRule(resolvedTenantSlug, {
          instruction: out.learnedRule.instruction,
          category: out.learnedRule.category,
          sourceFeedback: params.message,
          createdByName: params.trainerName || 'Entrenador',
        });
        savedRule = created.rule as unknown as Record<string, unknown>;
      } catch (err) {
        this.logger.warn(`No se pudo guardar regla sandbox: ${(err as Error).message}`);
      }
    }

    return {
      ok: true,
      text: out.reply,
      mode: out.mode,
      learnedRule: savedRule,
    };
  }
}
