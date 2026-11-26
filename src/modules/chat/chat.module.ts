import { Module } from "@nestjs/common";
import { CrmModule } from "../crm/crm.module";
import { McpModule } from "../mcp/mcp.module";
import { ChatController } from "./api/controllers/chat.controller";
import { FollowUpService } from "./application/services/follow-up.service";
import { ProcessInboundMessageUseCase } from "./application/use-cases/process-inbound-message.use-case";
import { LlmGatewayAdapter } from "./infrastructure/adapters/llm-gateway.adapter";

@Module({
  imports: [CrmModule, McpModule],
  controllers: [ChatController],
  providers: [ProcessInboundMessageUseCase, LlmGatewayAdapter, FollowUpService],
  exports: [ProcessInboundMessageUseCase, LlmGatewayAdapter, FollowUpService],
})
export class ChatModule {}
