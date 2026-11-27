import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { KnowledgeController } from './api/controllers/knowledge.controller';
import { OpenAiRagService } from './application/services/openai-rag.service';

@Module({
  imports: [CrmModule],
  controllers: [KnowledgeController],
  providers: [OpenAiRagService],
  exports: [OpenAiRagService],
})
export class KnowledgeModule {}
