import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../../common/decorators/public.decorator';
import { CrmService } from '../../../crm/application/services/crm.service';
import { OpenAiRagService, UploadedRagFile } from '../../application/services/openai-rag.service';

@ApiTags('Knowledge RAG (OpenAI Vector Store)')
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly openAiRag: OpenAiRagService,
    private readonly crmService: CrmService,
  ) {}

  private async requireTenantSlug(
    tenantApiKey?: string,
    tenantHeaderSlug?: string,
  ): Promise<string> {
    if (!tenantApiKey?.trim()) {
      throw new UnauthorizedException(
        'Se requiere el header x-tenant-key válido para gestionar documentos del RAG.',
      );
    }
    return this.crmService.resolveTenantSlug(tenantApiKey, tenantHeaderSlug);
  }

  @Public()
  @Get('documents')
  @ApiHeader({ name: 'x-tenant-key', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiOperation({ summary: 'Listar documentos subidos al RAG (OpenAI Vector Store) del tenant' })
  async listDocuments(
    @Headers('x-tenant-key') tenantApiKey?: string,
    @Headers('x-tenant-id') tenantHeaderSlug?: string,
  ) {
    const slug = await this.requireTenantSlug(tenantApiKey, tenantHeaderSlug);
    return this.openAiRag.listDocuments(slug);
  }

  @Public()
  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiHeader({ name: 'x-tenant-key', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary', description: 'Archivo PDF, TXT, MD, DOCX o JSON (máx 20 MB)' },
        category: {
          type: 'string',
          enum: ['MANUAL', 'PRODUCT', 'CAMPAIGN', 'PROMOTION', 'GENERAL'],
          default: 'GENERAL',
        },
        productLineId: { type: 'string', description: 'Opcional: ID de línea de producto asociada' },
        notes: { type: 'string', description: 'Opcional: nota descriptiva de vigencia o campaña' },
        uploadedBy: { type: 'string', description: 'Opcional: nombre de quien sube el documento' },
      },
    },
  })
  @ApiOperation({ summary: 'Subir un PDF o documento de texto al Vector Store de OpenAI del tenant' })
  async uploadDocument(
    @UploadedFile() file: UploadedRagFile | undefined,
    @Body() body: Record<string, unknown>,
    @Headers('x-tenant-key') tenantApiKey?: string,
    @Headers('x-tenant-id') tenantHeaderSlug?: string,
  ) {
    const slug = await this.requireTenantSlug(tenantApiKey, tenantHeaderSlug);
    if (!file) {
      throw new BadRequestException('Debes enviar un archivo en el campo "file".');
    }
    return this.openAiRag.uploadDocument({
      tenantSlug: slug,
      file,
      category: typeof body?.category === 'string' ? body.category : undefined,
      productLineId: typeof body?.productLineId === 'string' ? body.productLineId : undefined,
      notes: typeof body?.notes === 'string' ? body.notes : undefined,
      uploadedBy: typeof body?.uploadedBy === 'string' ? body.uploadedBy : undefined,
    });
  }

  @Public()
  @Delete('documents/:id')
  @ApiHeader({ name: 'x-tenant-key', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiOperation({ summary: 'Eliminar un documento del Vector Store de OpenAI y de Supabase' })
  async deleteDocument(
    @Param('id') id: string,
    @Headers('x-tenant-key') tenantApiKey?: string,
    @Headers('x-tenant-id') tenantHeaderSlug?: string,
  ) {
    const slug = await this.requireTenantSlug(tenantApiKey, tenantHeaderSlug);
    return this.openAiRag.deleteDocument(slug, id);
  }

  @Public()
  @Post('search-test')
  @ApiHeader({ name: 'x-tenant-key', required: true })
  @ApiHeader({ name: 'x-tenant-id', required: false })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', example: '¿Cuánto cuesta AWS Solutions Architect y qué promociones hay?' },
        maxResults: { type: 'number', default: 5 },
      },
    },
  })
  @ApiOperation({ summary: 'Probar búsqueda semántica directa en el Vector Store de OpenAI' })
  async searchTest(
    @Body() body: Record<string, unknown>,
    @Headers('x-tenant-key') tenantApiKey?: string,
    @Headers('x-tenant-id') tenantHeaderSlug?: string,
  ) {
    const slug = await this.requireTenantSlug(tenantApiKey, tenantHeaderSlug);
    const query = typeof body?.query === 'string' ? body.query : '';
    const maxResults = typeof body?.maxResults === 'number' ? body.maxResults : 5;
    return this.openAiRag.searchTest(slug, query, maxResults);
  }
}
