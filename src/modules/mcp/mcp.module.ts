import { Module } from '@nestjs/common';
import { McpController } from './api/controllers/mcp.controller';
import { McpRegistryService } from './application/services/mcp-registry.service';
import { UniversalMcpToolsService } from './application/services/universal-mcp-tools.service';

@Module({
  controllers: [McpController],
  providers: [McpRegistryService, UniversalMcpToolsService],
  exports: [McpRegistryService, UniversalMcpToolsService],
})
export class McpModule {}
