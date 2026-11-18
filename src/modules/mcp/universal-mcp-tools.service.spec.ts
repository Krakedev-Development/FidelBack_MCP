import { PrismaService } from '../../context/database/prisma.service';
import {
  UniversalMcpCallContext,
  UniversalMcpToolsService,
} from './application/services/universal-mcp-tools.service';

describe('UniversalMcpToolsService', () => {
  const defaultContext: UniversalMcpCallContext = {
    tenantSlug: 'clearminds',
    userId: 'user-1',
    userEmail: 'admin@clearminds.ec',
    userName: 'Administrador Clear Minds',
    userRole: 'ADMIN',
  };

  function createService(prismaMock: Record<string, unknown> = {}) {
    return new UniversalMcpToolsService(prismaMock as unknown as PrismaService);
  }

  it('lists all 9 universal MCP tools with outputSchema and annotations', () => {
    const service = createService();
    const tools = service.listTools();

    expect(tools).toHaveLength(9);
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      'verificar_conexion',
      'consultar_empresa',
      'listar_lineas_producto',
      'buscar_oportunidades',
      'consultar_oportunidad',
      'listar_citas',
      'actualizar_oportunidad',
      'programar_cita',
      'registrar_nota_oportunidad',
    ]);

    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(typeof tool.annotations.readOnlyHint).toBe('boolean');
      expect(typeof tool.annotations.destructiveHint).toBe('boolean');
    }
  });

  it('returns server and tenant identity on verificar_conexion', async () => {
    const service = createService();
    const result = await service.callTool('verificar_conexion', {}, defaultContext);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      server: 'fidel-crm-mcp',
      version: '1.3.0',
      tenantSlug: 'clearminds',
    });
    expect(typeof result.structuredContent.timestamp).toBe('string');
  });

  it('rejects undefined arguments with VALIDATION_ERROR', async () => {
    const service = createService();
    const result = await service.callTool(
      'buscar_oportunidades',
      { campoInexistente: 'valor' },
      defaultContext,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      errorCode: 'VALIDATION_ERROR',
    });
  });

  it('deduplicates write calls with the same operationId', async () => {
    const createdAt = new Date('2026-11-18T12:00:00.000Z');
    const createMock = jest.fn().mockResolvedValue({
      id: 'note-1',
      leadId: 'lead-1',
      authorEmail: defaultContext.userEmail,
      authorName: defaultContext.userName,
      content: 'Seguimiento inicial',
      followUpAt: '2026-11-25',
      createdAt,
    });

    const prismaMock = {
      lead: {
        findFirst: jest.fn().mockResolvedValue({ id: 'lead-1' }),
      },
      leadNote: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: createMock,
      },
    };

    const service = createService(prismaMock);
    const args = {
      oportunidadId: 'lead-1',
      contenido: 'Seguimiento inicial',
      fechaSeguimiento: '2026-11-25',
      operationId: 'op-note-123',
    };

    const first = await service.callTool('registrar_nota_oportunidad', args, defaultContext);
    const second = await service.callTool('registrar_nota_oportunidad', args, defaultContext);

    expect(first.isError).toBeUndefined();
    expect(second).toEqual(first);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
