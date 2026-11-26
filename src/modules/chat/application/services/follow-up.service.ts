import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../../../context/database/prisma.service";
import { LlmGatewayAdapter } from "../../infrastructure/adapters/llm-gateway.adapter";

export interface DispatchedFollowUp {
  sessionId: string;
  stage: number;
  messageText: string;
}

const FOLLOW_UP_TEMPLATES: Record<1 | 2 | 3, string> = {
  1: "¡Hola! ☕ ¿Te quedó sonando alguna dudita o te pillé ocupado? Aquí sigo atento por si quieres que profundicemos en algo.",
  2: "¡Hola de nuevo! 😄 No te preocupes si el trabajo te consumió. Cuando tengas un respiro, avísame y retomamos justo donde lo dejamos.",
  3: "¡Hola! 👋 Sé que los días pasan volando. ¿Pudiste pensar en la opción que revisamos o prefieres que agendemos una llamada rápida esta semana para ayudarte a decidir?",
};

export const FOLLOW_UP_DELAYS_MS = {
  STAGE_1: 15 * 60_000, // 15 minutos
  STAGE_2: 3 * 60 * 60_000, // 3 horas
  STAGE_3: 8 * 60 * 60_000, // 8 horas (24/7 sin restricción de horario)
} as const;

const WHATSAPP_SAFE_WINDOW_MS = (23 * 60 + 45) * 60_000;

@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmGateway: LlmGatewayAdapter,
  ) {}

  computeNextFollowUpAt(completedStage: number, now = new Date()): Date | null {
    if (completedStage === 0) {
      return new Date(now.getTime() + FOLLOW_UP_DELAYS_MS.STAGE_1);
    }
    if (completedStage === 1) {
      return new Date(now.getTime() + FOLLOW_UP_DELAYS_MS.STAGE_2);
    }
    if (completedStage === 2) {
      return new Date(now.getTime() + FOLLOW_UP_DELAYS_MS.STAGE_3);
    }
    return null;
  }

  async evaluateDueFollowUps(
    tenantSlug: string,
    limit = 10,
  ): Promise<DispatchedFollowUp[]> {
    const now = new Date();
    const safeLimit = Math.min(25, Math.max(1, limit));
    const windowCutoff = new Date(now.getTime() - WHATSAPP_SAFE_WINDOW_MS);

    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!tenant) {
      return [];
    }

    const candidates = await this.prisma.conversation.findMany({
      where: {
        tenantId: tenant.id,
        controlState: "AI_ACTIVE",
        followUpStage: { lt: 3 },
        nextFollowUpAt: { not: null, lte: now },
        lastCustomerMessageAt: { gt: windowCutoff },
        appointments: { none: { status: "CONFIRMED" } },
      },
      include: {
        productLine: { select: { name: true } },
        lead: { select: { extractedDataJson: true, suggestedAction: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 6,
          select: { senderType: true, content: true },
        },
      },
      orderBy: { nextFollowUpAt: "asc" },
      take: safeLimit,
    });

    const dispatched: DispatchedFollowUp[] = [];

    for (const conv of candidates) {
      const latestMsg = conv.messages[0];
      if (!latestMsg || latestMsg.senderType !== "AI") {
        if (latestMsg?.senderType === "HUMAN") {
          await this.prisma.conversation.update({
            where: { id: conv.id },
            data: { nextFollowUpAt: null },
          });
        }
        continue;
      }

      const nextStage = (conv.followUpStage + 1) as 1 | 2 | 3;
      const nextFollowUpAt = this.computeNextFollowUpAt(nextStage, now);

      const claimed = await this.prisma.conversation.updateMany({
        where: {
          id: conv.id,
          controlState: "AI_ACTIVE",
          followUpStage: conv.followUpStage,
          nextFollowUpAt: { not: null, lte: now },
        },
        data: {
          followUpStage: nextStage,
          nextFollowUpAt,
          lastAiReplyAt: now,
        },
      });

      if (claimed.count === 0) {
        continue;
      }

      const baseTemplate = FOLLOW_UP_TEMPLATES[nextStage];
      const messageText = await this.llmGateway.generateContextualFollowUp({
        stage: nextStage,
        baseTemplate,
        productName: conv.productLine?.name ?? null,
        extractedDataJson: conv.lead?.extractedDataJson ?? null,
        suggestedAction: conv.lead?.suggestedAction ?? null,
        recentMessages: [...conv.messages].reverse(),
      });

      await this.prisma.message.create({
        data: {
          conversationId: conv.id,
          senderType: "AI",
          content: messageText,
        },
      });

      this.logger.log(
        `⏰ Seguimiento automático etapa ${nextStage}/3 preparado para sesión ${conv.sessionId}`,
      );

      dispatched.push({
        sessionId: conv.sessionId,
        stage: nextStage,
        messageText,
      });
    }

    return dispatched;
  }
}
