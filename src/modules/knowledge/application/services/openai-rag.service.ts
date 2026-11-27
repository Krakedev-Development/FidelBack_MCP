import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { extname } from 'path';
import { EnvironmentVariables } from '../../../../context/config/app.config';
import { PrismaService } from '../../../../context/database/prisma.service';

export interface UploadedRagFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.txt', '.md', '.docx', '.json']);
const VALID_CATEGORIES = new Set(['MANUAL', 'PRODUCT', 'CAMPAIGN', 'PROMOTION', 'GENERAL']);
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

@Injectable()
export class OpenAiRagService {
  private readonly logger = new Logger(OpenAiRagService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  private getOpenAiKey(): string {
    const key = this.configService.get('OPENAI_API_KEY', { infer: true })?.trim();
    if (!key) {
      throw new BadRequestException(
        'No se configuró OPENAI_API_KEY en el servidor para gestionar el RAG.',
      );
    }
    return key;
  }

  private normalizeCategory(raw?: string): string {
    const upper = (raw || 'GENERAL').trim().toUpperCase();
    return VALID_CATEGORIES.has(upper) ? upper : 'GENERAL';
  }

  private async fetchOpenAiJson<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<{ ok: boolean; status: number; data: T; rawText: string }> {
    const apiKey = this.getOpenAiKey();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${apiKey}`);

    const res = await fetch(`https://api.openai.com/v1${path}`, {
      ...init,
      headers,
      signal: init.signal ?? AbortSignal.timeout(30_000),
    });
    const rawText = await res.text();
    let data = {} as T;
    try {
      data = rawText ? (JSON.parse(rawText) as T) : ({} as T);
    } catch {
      data = {} as T;
    }
    return { ok: res.ok, status: res.status, data, rawText };
  }

  async ensureTenantVectorStore(
    tenantSlug: string,
  ): Promise<{ tenantId: string; vectorStoreId: string }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, slug: true, name: true, openaiVectorStoreId: true },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant no encontrado: ${tenantSlug}`);
    }

    if (tenant.openaiVectorStoreId?.trim()) {
      return { tenantId: tenant.id, vectorStoreId: tenant.openaiVectorStoreId.trim() };
    }

    const envStoreId = this.configService.get('OPENAI_VECTOR_STORE_ID', { infer: true })?.trim();
    if (envStoreId && tenant.slug === 'clearminds') {
      await this.prisma.tenant.update({
        where: { id: tenant.id },
        data: { openaiVectorStoreId: envStoreId },
      });
      return { tenantId: tenant.id, vectorStoreId: envStoreId };
    }

    const created = await this.fetchOpenAiJson<{ id?: string }>('/vector_stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `fidel-${tenant.slug}`,
      }),
    });

    if (!created.ok || !created.data?.id) {
      throw new BadRequestException(
        `No se pudo crear Vector Store en OpenAI (${created.status}): ${created.rawText.slice(0, 200)}`,
      );
    }

    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { openaiVectorStoreId: created.data.id },
    });

    this.logger.log(`Vector Store OpenAI creado para ${tenant.slug}: ${created.data.id}`);
    return { tenantId: tenant.id, vectorStoreId: created.data.id };
  }

  private async syncOpenAiFileStatus(
    vectorStoreId: string,
    openaiFileId: string,
  ): Promise<'PROCESSING' | 'READY' | 'FAILED'> {
    const res = await this.fetchOpenAiJson<{ status?: string }>(
      `/vector_stores/${encodeURIComponent(vectorStoreId)}/files/${encodeURIComponent(openaiFileId)}`,
      { method: 'GET', signal: AbortSignal.timeout(5_000) },
    );

    if (!res.ok) return 'PROCESSING';
    if (res.data?.status === 'completed') return 'READY';
    if (res.data?.status === 'failed' || res.data?.status === 'cancelled') return 'FAILED';
    return 'PROCESSING';
  }

  async getActiveVectorStoreInfo(
    tenantSlug: string,
  ): Promise<{ vectorStoreId: string | null; readyDocumentsCount: number }> {
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { slug: tenantSlug },
        select: { id: true, slug: true, openaiVectorStoreId: true },
      });
      if (!tenant) {
        return { vectorStoreId: null, readyDocumentsCount: 0 };
      }

      const envStoreId = this.configService.get('OPENAI_VECTOR_STORE_ID', { infer: true })?.trim();
      const vectorStoreId =
        tenant.openaiVectorStoreId?.trim() || (tenant.slug === 'clearminds' ? envStoreId : null) || null;

      if (!vectorStoreId) {
        return { vectorStoreId: null, readyDocumentsCount: 0 };
      }

      let readyCount = await this.prisma.knowledgeDocument.count({
        where: { tenantId: tenant.id, isActive: true, status: 'READY' },
      });

      if (readyCount === 0) {
        const processingDocs = await this.prisma.knowledgeDocument.findMany({
          where: { tenantId: tenant.id, isActive: true, status: 'PROCESSING' },
          take: 3,
        });
        for (const doc of processingDocs) {
          const nextStatus = await this.syncOpenAiFileStatus(doc.vectorStoreId, doc.openaiFileId);
          if (nextStatus !== doc.status) {
            await this.prisma.knowledgeDocument.update({
              where: { id: doc.id },
              data: { status: nextStatus },
            });
            if (nextStatus === 'READY') readyCount += 1;
          }
        }
      }

      // If OPENAI_VECTOR_STORE_ID was manually provided via env without local DB records, allow using it
      if (readyCount === 0 && envStoreId && vectorStoreId === envStoreId) {
        const totalInDb = await this.prisma.knowledgeDocument.count({
          where: { tenantId: tenant.id, isActive: true },
        });
        if (totalInDb === 0) {
          return { vectorStoreId, readyDocumentsCount: 1 };
        }
      }

      return { vectorStoreId, readyDocumentsCount: readyCount };
    } catch {
      return { vectorStoreId: null, readyDocumentsCount: 0 };
    }
  }

  async uploadDocument(params: {
    tenantSlug: string;
    file: UploadedRagFile;
    category?: string;
    productLineId?: string;
    notes?: string;
    uploadedBy?: string;
  }) {
    const file = params.file;
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Debes adjuntar un archivo válido en el campo "file".');
    }

    if (file.buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new BadRequestException('El archivo excede el límite permitido de 20 MB.');
    }

    const ext = extname(file.originalname || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException(
        `Formato no soportado (${ext || 'desconocido'}). Usa PDF, TXT, MD, DOCX o JSON.`,
      );
    }

    const { tenantId, vectorStoreId } = await this.ensureTenantVectorStore(params.tenantSlug);

    // 1. Subir archivo a OpenAI Files API
    const formData = new FormData();
    formData.append('purpose', 'assistants');
    const blob = new Blob([new Uint8Array(file.buffer)], {
      type: file.mimetype || 'application/octet-stream',
    });
    formData.append('file', blob, file.originalname || `document${ext}`);

    const uploadedFileRes = await this.fetchOpenAiJson<{ id?: string }>('/files', {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(60_000),
    });

    if (!uploadedFileRes.ok || !uploadedFileRes.data?.id) {
      throw new BadRequestException(
        `Error subiendo archivo a OpenAI (${uploadedFileRes.status}): ${uploadedFileRes.rawText.slice(0, 220)}`,
      );
    }

    const openaiFileId = uploadedFileRes.data.id;

    // 2. Vincular archivo al Vector Store del tenant
    const attachRes = await this.fetchOpenAiJson<{ id?: string; status?: string }>(
      `/vector_stores/${encodeURIComponent(vectorStoreId)}/files`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: openaiFileId }),
      },
    );

    if (!attachRes.ok) {
      await this.fetchOpenAiJson(`/files/${encodeURIComponent(openaiFileId)}`, {
        method: 'DELETE',
      }).catch(() => undefined);
      throw new BadRequestException(
        `Error indexando archivo en Vector Store (${attachRes.status}): ${attachRes.rawText.slice(0, 220)}`,
      );
    }

    // 3. Esperar brevemente hasta que OpenAI termine de indexar el archivo
    let finalStatus: 'PROCESSING' | 'READY' | 'FAILED' =
      attachRes.data?.status === 'completed'
        ? 'READY'
        : attachRes.data?.status === 'failed'
          ? 'FAILED'
          : 'PROCESSING';

    for (let attempt = 0; attempt < 6 && finalStatus === 'PROCESSING'; attempt++) {
      await new Promise((r) => setTimeout(r, 1500));
      finalStatus = await this.syncOpenAiFileStatus(vectorStoreId, openaiFileId);
    }

    const record = await this.prisma.knowledgeDocument.create({
      data: {
        tenantId,
        openaiFileId,
        vectorStoreId,
        filename: file.originalname,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size || file.buffer.length,
        category: this.normalizeCategory(params.category),
        productLineId: params.productLineId?.trim() || null,
        notes: params.notes?.trim() || null,
        status: finalStatus,
        uploadedBy: params.uploadedBy?.trim() || 'Admin',
      },
    });

    this.logger.log(
      `📄 Documento subido al RAG [${params.tenantSlug}] (${record.filename}) -> status=${record.status}`,
    );

    return {
      ok: true,
      vectorStoreId,
      document: record,
    };
  }

  async listDocuments(tenantSlug: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true, openaiVectorStoreId: true },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant no encontrado: ${tenantSlug}`);
    }

    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    const syncedDocs = await Promise.all(
      docs.map(async (doc) => {
        if (doc.status !== 'PROCESSING') return doc;
        const nextStatus = await this.syncOpenAiFileStatus(doc.vectorStoreId, doc.openaiFileId);
        if (nextStatus === doc.status) return doc;
        return this.prisma.knowledgeDocument.update({
          where: { id: doc.id },
          data: { status: nextStatus },
        });
      }),
    );

    return {
      ok: true,
      vectorStoreId: tenant.openaiVectorStoreId || null,
      readyDocumentsCount: syncedDocs.filter((d) => d.status === 'READY').length,
      documents: syncedDocs,
    };
  }

  async deleteDocument(tenantSlug: string, documentId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug: tenantSlug },
      select: { id: true },
    });
    if (!tenant) {
      throw new NotFoundException(`Tenant no encontrado: ${tenantSlug}`);
    }

    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id: documentId, tenantId: tenant.id },
    });
    if (!doc) {
      throw new NotFoundException(`Documento no encontrado: ${documentId}`);
    }

    await this.fetchOpenAiJson(
      `/vector_stores/${encodeURIComponent(doc.vectorStoreId)}/files/${encodeURIComponent(doc.openaiFileId)}`,
      { method: 'DELETE' },
    ).catch(() => undefined);

    await this.fetchOpenAiJson(`/files/${encodeURIComponent(doc.openaiFileId)}`, {
      method: 'DELETE',
    }).catch(() => undefined);

    await this.prisma.knowledgeDocument.delete({ where: { id: doc.id } });

    this.logger.log(`🗑️ Documento eliminado del RAG [${tenantSlug}]: ${doc.filename}`);

    return {
      ok: true,
      deletedId: doc.id,
      openaiFileId: doc.openaiFileId,
      filename: doc.filename,
    };
  }

  async searchTest(tenantSlug: string, query: string, maxResults = 5) {
    const cleanQuery = query?.trim();
    if (!cleanQuery) {
      throw new BadRequestException('El campo "query" es obligatorio.');
    }

    const { vectorStoreId, readyDocumentsCount } = await this.getActiveVectorStoreInfo(tenantSlug);
    if (!vectorStoreId) {
      throw new BadRequestException(
        'La empresa aún no tiene un Vector Store configurado. Sube al menos un documento primero.',
      );
    }

    const safeLimit = Math.min(10, Math.max(1, Number(maxResults) || 5));
    const res = await this.fetchOpenAiJson<{
      data?: Array<{
        file_id?: string;
        filename?: string;
        score?: number;
        content?: Array<{ type?: string; text?: string }>;
      }>;
    }>(`/vector_stores/${encodeURIComponent(vectorStoreId)}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: cleanQuery,
        max_num_results: safeLimit,
      }),
    });

    if (!res.ok) {
      throw new BadRequestException(
        `Error buscando en Vector Store (${res.status}): ${res.rawText.slice(0, 220)}`,
      );
    }

    const matches = (res.data?.data || []).map((item) => ({
      fileId: item.file_id || null,
      filename: item.filename || null,
      score: typeof item.score === 'number' ? item.score : null,
      excerpt: (item.content || [])
        .map((c) => c.text || '')
        .filter(Boolean)
        .join('\n'),
    }));

    return {
      ok: true,
      vectorStoreId,
      readyDocumentsCount,
      query: cleanQuery,
      matches,
    };
  }
}
