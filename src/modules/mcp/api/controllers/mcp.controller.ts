import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import {
  AuthPayload,
  CurrentUser,
} from '../../../../common/decorators/current-user.decorator';
import { Public } from '../../../../common/decorators/public.decorator';
import { PrismaService } from '../../../../context/database/prisma.service';
import { McpRegistryService } from '../../application/services/mcp-registry.service';
import { UniversalMcpToolsService } from '../../application/services/universal-mcp-tools.service';
import { ExecuteMcpToolDto } from '../dtos/execute-mcp-tool.dto';

const MCP_PROTOCOL_VERSION = '2025-03-26';
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 120;

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

@ApiTags('MCP Server (Model Context Protocol)')
@Controller('mcp')
export class McpController {
  private readonly rateLimits = new Map<string, RateLimitBucket>();

  constructor(
    private readonly mcpRegistry: McpRegistryService,
    private readonly universalMcpTools: UniversalMcpToolsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Endpoint oficial MCP Streamable HTTP (JSON-RPC 2.0) protegido con JWT para Front Universal',
  })
  async handleUniversalMcp(
    @Req() req: Request,
    @Res() res: Response,
    @CurrentUser() authUser: AuthPayload,
  ) {
    const now = Date.now();
    const rateKey = authUser?.sub || req.ip || 'anonymous';
    if (!this.consumeRateLimit(rateKey, now)) {
      return res.status(HttpStatus.TOO_MANY_REQUESTS).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32029,
          message: 'Rate limit exceeded (max 120 requests per minute).',
        },
      });
    }

    const incomingSessionHeader = req.headers['mcp-session-id'];
    const sessionId =
      (Array.isArray(incomingSessionHeader)
        ? incomingSessionHeader[0]
        : incomingSessionHeader
      )?.trim() || randomUUID();

    res.setHeader('Mcp-Protocol-Version', MCP_PROTOCOL_VERSION);
    res.setHeader('Mcp-Session-Id', sessionId);

    const user = await this.prisma.user.findUnique({
      where: { id: authUser.sub },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        tenantSlug: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Usuario inactivo o no encontrado');
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const id = (body.id as string | number | null | undefined) ?? null;
    const jsonrpc = body.jsonrpc;
    const method = body.method;
    const params =
      body.params && typeof body.params === 'object' && !Array.isArray(body.params)
        ? (body.params as Record<string, unknown>)
        : {};

    if (jsonrpc !== '2.0' || typeof method !== 'string' || !method.trim()) {
      return res.status(HttpStatus.BAD_REQUEST).json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32600,
          message: 'Invalid JSON-RPC 2.0 request.',
        },
      });
    }

    if (method === 'notifications/initialized' || method.startsWith('notifications/')) {
      if (body.id === undefined || body.id === null) {
        return res.status(HttpStatus.ACCEPTED).send();
      }
      return res.status(HttpStatus.OK).json({
        jsonrpc: '2.0',
        id,
        result: {},
      });
    }

    if (method === 'initialize') {
      return res.status(HttpStatus.OK).json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: { listChanged: false },
          },
          serverInfo: {
            name: 'fidel-clearminds-mcp',
            version: '1.3.0',
          },
        },
      });
    }

    if (method === 'ping') {
      return res.status(HttpStatus.OK).json({
        jsonrpc: '2.0',
        id,
        result: {},
      });
    }

    if (method === 'tools/list') {
      return res.status(HttpStatus.OK).json({
        jsonrpc: '2.0',
        id,
        result: {
          tools: this.universalMcpTools.listTools(),
        },
      });
    }

    if (method === 'tools/call') {
      const toolName = typeof params.name === 'string' ? params.name.trim() : '';
      if (!toolName) {
        return res.status(HttpStatus.OK).json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Missing required parameter: name',
          },
        });
      }

      const rawTenantHeader = req.headers['x-tenant-id'];
      const requestedTenant = (
        Array.isArray(rawTenantHeader) ? rawTenantHeader[0] : rawTenantHeader
      )?.trim();

      if (
        requestedTenant &&
        requestedTenant !== user.tenantSlug &&
        user.role !== 'ADMIN'
      ) {
        const denied = {
          ok: false,
          errorCode: 'NO_PERMISSION',
          message: `No tienes permiso para acceder al tenant "${requestedTenant}".`,
        };
        return res.status(HttpStatus.OK).json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(denied) }],
            structuredContent: denied,
            isError: true,
          },
        });
      }

      const effectiveTenant = requestedTenant || user.tenantSlug;
      const toolArgs =
        params.arguments &&
        typeof params.arguments === 'object' &&
        !Array.isArray(params.arguments)
          ? (params.arguments as Record<string, unknown>)
          : {};

      const out = await this.universalMcpTools.callTool(toolName, toolArgs, {
        tenantSlug: effectiveTenant,
        userId: user.id,
        userEmail: user.email,
        userName: user.fullName,
        userRole: user.role,
      });

      return res.status(HttpStatus.OK).json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(out.structuredContent) }],
          structuredContent: out.structuredContent,
          isError: Boolean(out.isError),
        },
      });
    }

    return res.status(HttpStatus.OK).json({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    });
  }

  private consumeRateLimit(key: string, now: number): boolean {
    if (this.rateLimits.size > 1000) {
      for (const [entryKey, bucket] of this.rateLimits.entries()) {
        if (bucket.resetAt <= now) {
          this.rateLimits.delete(entryKey);
        }
      }
    }

    const existing = this.rateLimits.get(key);
    if (!existing || existing.resetAt <= now) {
      this.rateLimits.set(key, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS,
      });
      return true;
    }

    if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }

    existing.count += 1;
    return true;
  }

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Estado del servidor MCP de Fidel y resumen de capacidades' })
  getStatus() {
    return {
      server: 'fidel-clearminds-mcp-server',
      version: '1.3.0',
      protocol: 'Model Context Protocol (MCP)',
      toolsCount: this.mcpRegistry.listTools().length,
      resourcesCount: this.mcpRegistry.listResources().length,
      recentExecutions: this.mcpRegistry.getRecentExecutions(),
    };
  }

  @Public()
  @Get('tools')
  @ApiOperation({ summary: 'Listar todas las Tools MCP disponibles para el agente comercial' })
  listTools() {
    return {
      tools: this.mcpRegistry.listTools(),
    };
  }

  @Public()
  @Get('resources')
  @ApiOperation({ summary: 'Listar los Resources MCP (brochures oficiales de Clear Minds)' })
  listResources() {
    return {
      resources: this.mcpRegistry.listResources(),
    };
  }

  @Public()
  @Get('resources/:productKey')
  @ApiOperation({ summary: 'Leer el contenido de un brochure MCP por productKey' })
  getResourceByKey(@Param('productKey') productKey: string) {
    const resource = this.mcpRegistry
      .listResources()
      .find((r) => r.productKey === productKey);
    return {
      resource: resource ?? null,
    };
  }

  @Public()
  @Post('execute')
  @ApiOperation({ summary: 'Ejecutar directamente una Tool MCP (cotización, agenda, CRM, handoff)' })
  async executeTool(@Body() dto: ExecuteMcpToolDto) {
    return this.mcpRegistry.executeTool(dto.toolName, dto.arguments ?? {});
  }

  @Public()
  @Get('sse')
  @ApiOperation({ summary: 'Endpoint SSE de descubrimiento e inspección en vivo del servidor MCP' })
  streamSse(@Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const initialPayload = {
      event: 'mcp_ready',
      server: 'fidel-clearminds-mcp-server',
      version: '1.3.0',
      tools: this.mcpRegistry.listTools().map((t) => t.name),
      resources: this.mcpRegistry.listResources().map((r) => r.uri),
    };

    res.write(`data: ${JSON.stringify(initialPayload)}\n\n`);
  }
}
