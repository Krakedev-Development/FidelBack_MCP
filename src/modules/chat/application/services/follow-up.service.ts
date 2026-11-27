import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../context/database/prisma.service';
import { LlmGatewayAdapter } from '../../infrastructure/adapters/llm-gateway.adapter';

export interface DispatchedFollowUp {
  sessionId: string;
  stage: number;
  messageText: string;
}

export const FOLLOW_UP_DELAYS_MS = {
  STAGE_1: 15 * 60_000, // 15 minutos
  STAGE_2: 3 * 60 * 60_000, // 3 horas
  STAGE_3: 8 * 60 * 60_000, // 8 horas (24/7 sin restricción de horario)
} as const;

@Injectable()
export class FollowUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmGateway: LlmGatewayAdapter,
  ) {}

  computeNextFollowUpAt(_completedStage: number, _now = new Date()): Date | null {
    return null;
  }

  async evaluateDueFollowUps(
    _tenantSlug: string,
    _limit = 10,
  ): Promise<DispatchedFollowUp[]> {
    // Seguimientos automáticos por inactividad (15m / 3h / 8h) deshabilitados.
    return [];
  }
}
