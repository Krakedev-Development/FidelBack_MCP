import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../../../context/config/app.config';
import {
  LlmTurnInput,
  LlmTurnOutput,
  ProductLineKey,
} from '../../domain/interfaces/llm-gateway.port';

@Injectable()
export class LlmGatewayAdapter {
  private readonly logger = new Logger(LlmGatewayAdapter.name);
  private readonly adVisionCache = new Map<string, string>();

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables, true>,
  ) {}

  hasProviderKey(provider: 'gemini' | 'openai'): boolean {
    const key =
      provider === 'openai'
        ? this.configService.get('OPENAI_API_KEY', { infer: true })
        : this.configService.get('GEMINI_API_KEY', { infer: true });
    return Boolean(key && key.trim());
  }

  getDefaultProvider(): 'gemini' | 'openai' {
    const raw = this.configService.get('LLM_DEFAULT_PROVIDER', { infer: true });
    const configured: 'gemini' | 'openai' = raw === 'gemini' ? 'gemini' : 'openai';
    if (this.hasProviderKey(configured)) {
      return configured;
    }
    const backup: 'gemini' | 'openai' = configured === 'openai' ? 'gemini' : 'openai';
    if (this.hasProviderKey(backup)) {
      this.logger.warn(
        `Falta key para "${configured}" en servidor; usando "${backup}" automáticamente como respaldo.`,
      );
      return backup;
    }
    return configured;
  }

  getDefaultModel(provider: 'gemini' | 'openai'): string {
    if (provider === 'openai') {
      return (
        this.configService.get('OPENAI_DEFAULT_MODEL', { infer: true })?.trim() || 'gpt-4.1-mini'
      );
    }
    return (
      this.configService.get('GEMINI_DEFAULT_MODEL', { infer: true })?.trim() ||
      'gemini-flash-lite-latest'
    );
  }

  normalizeModelForProvider(provider: 'gemini' | 'openai', requestedModel?: string): string {
    const clean = requestedModel?.trim();
    if (!clean) {
      return this.getDefaultModel(provider);
    }
    if (provider === 'openai' && clean.toLowerCase().startsWith('gemini')) {
      return this.getDefaultModel('openai');
    }
    if (provider === 'gemini' && /^(gpt-|o1|o3|o4)/i.test(clean)) {
      return this.getDefaultModel('gemini');
    }
    return clean;
  }

  private stripCitationMarkers(text: string): string {
    return text.replace(/【[^】]*】/g, '').replace(/[ \t]{2,}/g, ' ').trim();
  }

  private buildUpstreamError(label: string, status: number, errText: string): Error {
    const snippet = errText.slice(0, 250);
    if (status === 429 || status >= 500) {
      return new ServiceUnavailableException(`${label} (${status}): ${snippet}`);
    }
    return new BadRequestException(`${label} (${status}): ${snippet}`);
  }

  private extractResponsesApiText(data: Record<string, unknown>): string {
    if (typeof data.output_text === 'string' && data.output_text.trim()) {
      return data.output_text.trim();
    }
    if (Array.isArray(data.output)) {
      const parts: string[] = [];
      for (const item of data.output) {
        if (
          item &&
          typeof item === 'object' &&
          (item as Record<string, unknown>).type === 'message' &&
          Array.isArray((item as Record<string, unknown>).content)
        ) {
          for (const block of (item as Record<string, unknown>).content as Array<
            Record<string, unknown>
          >) {
            if (typeof block?.text === 'string') {
              parts.push(block.text);
            }
          }
        }
      }
      if (parts.length > 0) {
        return parts.join('\n').trim();
      }
    }
    return '';
  }

  async analyzeAdImage(
    imageUrl: string,
    cacheKey?: string,
    overrideKey?: string,
    provider?: 'gemini' | 'openai',
  ): Promise<string | null> {
    const cleanUrl = imageUrl?.trim();
    if (!cleanUrl) return null;

    const targetProvider = provider || this.getDefaultProvider();
    const key = `${targetProvider}:${(cacheKey || cleanUrl).trim()}`;
    if (this.adVisionCache.has(key)) {
      return this.adVisionCache.get(key)!;
    }

    try {
      const apiKey = this.resolveApiKey(targetProvider, overrideKey);
      const imgRes = await fetch(cleanUrl, {
        signal: AbortSignal.timeout(7000),
      });
      if (!imgRes.ok) {
        this.logger.warn(`No se pudo descargar imagen de anuncio (${imgRes.status}): ${cleanUrl}`);
        return null;
      }

      const arrayBuffer = await imgRes.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
      const visionPrompt =
        'Analiza esta imagen de un anuncio publicitario y describe en 1 o 2 oraciones claras qué curso, certificación o servicio específico promociona (transcribe los textos clave visibles en la imagen, como AWS, certificaciones AI/Cloud/Solutions Architect, Krakedev, Software a la Medida, precios o promociones vigentes). Sé directo.';

      if (targetProvider === 'openai') {
        const cleanModel = this.getDefaultModel('openai');
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: cleanModel,
            max_tokens: 180,
            temperature: 0.1,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: visionPrompt },
                  {
                    type: 'image_url',
                    image_url: { url: `data:${mimeType};base64,${base64}` },
                  },
                ],
              },
            ],
          }),
          signal: AbortSignal.timeout(12_000),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const summary = data.choices?.[0]?.message?.content?.trim() || null;
          if (summary) {
            this.adVisionCache.set(key, summary);
            this.logger.log(`🖼️ Anuncio visual OpenAI cacheado [${key}]: ${summary}`);
          }
          return summary;
        }

        const errBody = await res.text();
        this.logger.warn(`OpenAI Vision anuncio HTTP ${res.status}: ${errBody.slice(0, 150)}`);
        if (!overrideKey && this.hasProviderKey('gemini')) {
          return this.analyzeAdImageWithGemini(
            base64,
            mimeType,
            visionPrompt,
            this.resolveApiKey('gemini'),
            key,
          );
        }
        return null;
      }

      return this.analyzeAdImageWithGemini(base64, mimeType, visionPrompt, apiKey, key);
    } catch (err) {
      this.logger.warn(`Error analizando imagen del anuncio: ${(err as Error).message}`);
      return null;
    }
  }

  private async analyzeAdImageWithGemini(
    base64: string,
    mimeType: string,
    visionPrompt: string,
    apiKey: string,
    cacheKey: string,
  ): Promise<string | null> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.getDefaultModel('gemini').replace(/^models\//, '')}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: visionPrompt },
              { inlineData: { mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 150,
          temperature: 0.1,
        },
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.warn(`Gemini Vision anuncio HTTP ${res.status}: ${errBody.slice(0, 150)}`);
      return null;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const summary = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    if (summary) {
      this.adVisionCache.set(cacheKey, summary);
      this.logger.log(`🖼️ Anuncio visual Gemini cacheado [${cacheKey}]: ${summary}`);
    }
    return summary;
  }

  resolveApiKey(provider: 'gemini' | 'openai', overrideKey?: string): string {
    const trimmed = overrideKey?.trim();
    if (trimmed) return trimmed;

    if (provider === 'gemini') {
      const envKey = this.configService.get('GEMINI_API_KEY', { infer: true });
      if (envKey) return envKey.trim();
      throw new BadRequestException(
        'No se proporcionó GEMINI_API_KEY en la petición ni en el archivo .env del servidor.',
      );
    }

    const envKey = this.configService.get('OPENAI_API_KEY', { infer: true });
    if (envKey) return envKey.trim();
    throw new BadRequestException(
      'No se proporcionó OPENAI_API_KEY en la petición ni en el archivo .env del servidor.',
    );
  }

  async testConnection(
    provider: 'gemini' | 'openai',
    model: string,
    overrideKey?: string,
  ): Promise<{ ok: boolean; provider: string; model: string; latencyMs: number; message: string }> {
    const start = Date.now();
    const apiKey = this.resolveApiKey(provider, overrideKey);

    if (provider === 'gemini') {
      const cleanModel = (model || 'gemini-flash-lite-latest').replace(/^models\//, '');
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Responde solo OK' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new BadRequestException(`Gemini HTTP ${res.status}: ${errBody.slice(0, 200)}`);
      }

      return {
        ok: true,
        provider: 'gemini',
        model: cleanModel,
        latencyMs: Date.now() - start,
        message: `Conexión exitosa con Google Gemini (${cleanModel}) desde FidelBack_MCP.`,
      };
    }

    const cleanModel = model || 'gpt-4o-mini';
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: cleanModel,
        messages: [{ role: 'user', content: 'Responde solo OK' }],
        max_tokens: 10,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new BadRequestException(`OpenAI HTTP ${res.status}: ${errBody.slice(0, 200)}`);
    }

    return {
      ok: true,
      provider: 'openai',
      model: cleanModel,
      latencyMs: Date.now() - start,
      message: `Conexión exitosa con OpenAI (${cleanModel}) desde FidelBack_MCP.`,
    };
  }

  async generateCommercialTurn(input: LlmTurnInput): Promise<LlmTurnOutput> {
    const start = Date.now();

    const jsonInstruction = `
Devuelve SIEMPRE un objeto JSON válido con la siguiente estructura exacta:
{
  "respuesta_chat": "Tu respuesta comercial en español al cliente",
  "linea_detectada": "custom_software" | "krakedev_academy" | "aws_certifications" | "ai_assistants_b2b",
  "intencion": "ALTO" | "MEDIO" | "BAJO",
  "justificacion_intencion": "Breve explicación de la intención comercial",
  "extraccion": [
    { "key": "Nombre del campo requerido", "value": "Valor extraído o 'Pendiente'", "status": "captured" | "partial" | "missing" }
  ],
  "siguiente_accion": "Siguiente paso comercial recomendado",
  "motivo_escalamiento": "SUPPORT_OR_FRICTION" | "SALES_REQUEST" | null,
  "mcp_tool_calls": [
    {
      "toolName": "cotizar_descuento_grupo" | "agendar_cita" | "registrar_lead_crm" | "transferir_a_humano",
      "arguments": {}
    }
  ]
}
REGLAS MCP Y DE COMPORTAMIENTO:
- ESTILO WHATSAPP HUMANO Y BREVE (OBLIGATORIO):
  - Responde en máximo 2 a 3 oraciones cortas (idealmente 25 a 55 palabras en total; prohibido escribir párrafos largos o listas extensas).
  - Habla natural, cercano y directo como un asesor comercial real por WhatsApp; usa máximo 2 emojis por mensaje (ej. 👋, 🚀, 💻, 💡) y lenguaje técnico ligero.
  - CERO REPETICIÓN DE CONTEXTO: Si en el historial reciente ya están hablando de un curso o servicio (ej. AWS AI Practitioner o KrakeDev), NO repitas el nombre completo del programa ni datos ya entregados (precio regular, duración, etc.); responde directo a lo nuevo que preguntó el cliente.
  - UNA SOLA PREGUNTA SIMPLE AL FINAL: Termina con máximo una pregunta corta y concreta (prohibido hacer preguntas dobles como "¿Quieres X o prefieres Y?").
- Nunca te presentes como un bot o IA a menos que el cliente lo pregunte directamente.
- REGLA CRÍTICA DE VERACIDAD (CERO ALUCINACIONES): Usa ÚNICAMENTE fechas de inicio, duraciones, horarios, precios, promociones, enlaces y condiciones que aparezcan literalmente en los documentos recuperados por file_search (RAG), en tu catálogo autorizado o en reglas aprendidas. Está TERMINANTEMENTE PROHIBIDO inventar o suponer precios, promociones inexistentes, descuentos no vigentes, fechas de inicio alternativas, horas de duración, horarios, instructores, cupos, módulos de temario, cuentas bancarias, links de pago o inclusión de vouchers. Si el cliente pregunta por una promoción, descuento o dato que NO consta vigente en los documentos autorizados, aclara con honestidad que no tienes confirmada esa promoción o dato y ofrece conectarlo con un asesor humano.
- ${input.useRagFirst ? 'MODO RAG-FIRST Y PROMOCIONES (OBLIGATORIO): Consulta file_search recuperando TANTO el manual general del producto COMO el Manual de Promociones Vigentes de esa línea (ej. AWS o KrakeDev) antes de cotizar o afirmar que no hay descuento vigente. Nunca niegues una promoción mencionada en el anuncio o en el turno previo sin verificar primero el Manual de Promociones Vigentes para la fecha actual. No asumas precios de memoria; cita los de los documentos.' : 'Si el cliente pregunta precios de Academia Krakedev o Cursos/Certificaciones AWS, incluye "cotizar_descuento_grupo" en "mcp_tool_calls".'}
- Para Software a la Medida está PROHIBIDO dar precios cerrados; indaga en su necesidad para reunión con especialista.
- REGLA DE ORO DE TRASPASO A HUMANO:
  - Si el cliente muestra molestia/inconformidad, pregunta por el avance o proceso de su proyecto de desarrollo en curso, o busca soporte/aclarar dudas post-venta, incluye "transferir_a_humano" en "mcp_tool_calls" y pon "motivo_escalamiento": "SUPPORT_OR_FRICTION".
  - Si el cliente pide explícitamente hablar con un asesor comercial, agendar una cita/reunión, cerrar inscripción, datos de transferencia/pago no disponibles o descuentos excepcionales, incluye "transferir_a_humano" en "mcp_tool_calls", pon "motivo_escalamiento": "SALES_REQUEST", y pon en "respuesta_chat": "¡Perfecto! Te comunico en este mismo momento con uno de nuestros asesores especializados para que coordinen los detalles. Dame un segundo por favor 🤝".
- Si el cliente cambia de producto en la conversación, actualiza "linea_detectada" al nuevo producto y llena "extraccion" con los campos de ese nuevo producto.
`;

    const adBlock = input.adSummary
      ? `\nORIGEN PUBLICITARIO DEL LEAD (META ADS — TEXTO + IMAGEN DEL ANUNCIO):\n${input.adSummary}\nINSTRUCCIÓN CRÍTICA DE ANUNCIO:
- El cliente llegó por este anuncio. Identifica inmediatamente la línea anunciada (ej. si menciona AWS -> "aws_certifications", Krakedev -> "krakedev_academy", Software -> "custom_software", IA -> "ai_assistants_b2b").
- Si el anuncio (texto o imagen) YA especifica un programa o certificación concreta (por ejemplo: "AWS Solutions Architect – Associate", "AI Practitioner", "Cloud Practitioner"), regístrala automáticamente como "captured" en "extraccion" y PROHIBIDO volver a preguntarle al cliente cuál certificación quiere. Asume directamente ese programa, dale la bienvenida sobre él (reconociendo cualquier promoción del anuncio como Black Friday si aparece) y pídele únicamente los datos que aún falten (ej. su nombre completo).\n`
      : '';

    const broadcastBlock = input.broadcastContext?.trim()
      ? `\nMENSAJE MASIVO / CAMPAÑA ENVIADA PREVIAMENTE AL CLIENTE:\n${input.broadcastContext.trim()}\nINSTRUCCIÓN DE CONTEXTO MASIVO:\n- El cliente está respondiendo a este envío masivo o plantilla enviada por Clear Minds.\n- Responde directamente en contexto a la promoción, curso o invitación mencionada en el masivo (no preguntes "a qué te refieres"), y obedece estrictamente los documentos del RAG / catálogo autorizado sin inventar fechas, precios ni vouchers.\n`
      : '';

    const activeLineBlock = input.activeProductKey
      ? `LÍNEA ACTIVA ACTUAL: ${input.activeProductKey}\nCAMPOS DE EXTRACCIÓN DE LÍNEA ACTIVA: ${input.requiredFields.join(', ')}`
      : `LÍNEA ACTIVA ACTUAL: Ninguna preseleccionada (Detecta la línea según el anuncio o el mensaje del cliente; si el cliente solo saluda y NO hay anuncio ni mención de producto, pregúntale amablemente en cuál de nuestras soluciones está interesado en vez de asumir "custom_software").`;

    const now = new Date();
    const currentDateIso = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'America/Guayaquil',
    }).format(now);
    const currentDateHuman = new Intl.DateTimeFormat('es-EC', {
      timeZone: 'America/Guayaquil',
      dateStyle: 'full',
    }).format(now);
    const currentDateBlock = `FECHA ACTUAL (Ecuador, America/Guayaquil): ${currentDateHuman} (${currentDateIso}). Usa esta fecha exacta para validar si una promoción o fecha de inicio está vigente o vencida.`;

    const fullSystemPrompt = `${input.systemPrompt}\n\n${currentDateBlock}\n\nMEMORIA INCREMENTAL PREVIA:\n${input.incrementalSummary || 'Sin resumen previo.'}\n${adBlock}${broadcastBlock}\n${activeLineBlock}\n${jsonInstruction}`;

    const canFailoverToGemini = !input.apiKey && this.hasProviderKey('gemini');
    const canFailoverToOpenAi = !input.apiKey && this.hasProviderKey('openai');

    if (input.provider === 'gemini') {
      try {
        const geminiKey = this.resolveApiKey('gemini', input.apiKey);
        return await this.executeGeminiCommercialTurn(input, fullSystemPrompt, geminiKey, start);
      } catch (err) {
        if (canFailoverToOpenAi) {
          this.logger.warn(
            `Failover automático Gemini -> OpenAI en turno comercial: ${(err as Error).message}`,
          );
          const openAiKey = this.resolveApiKey('openai');
          return this.executeOpenAiCompletionsCommercialTurn(
            input,
            fullSystemPrompt,
            openAiKey,
            start,
            this.getDefaultModel('openai'),
          );
        }
        throw err;
      }
    }

    // Proveedor principal OpenAI (con cascada RAG Responses -> Chat Completions -> Gemini failover)
    if (!input.apiKey && !this.hasProviderKey('openai') && canFailoverToGemini) {
      this.logger.warn('OPENAI_API_KEY ausente; ejecutando turno comercial directamente con Gemini.');
      return this.executeGeminiCommercialTurn(
        input,
        fullSystemPrompt,
        this.resolveApiKey('gemini'),
        start,
        this.getDefaultModel('gemini'),
      );
    }

    const openAiKey = this.resolveApiKey('openai', input.apiKey);
    const openAiModel = this.normalizeModelForProvider('openai', input.model);

    if (input.vectorStoreId) {
      try {
        return await this.executeOpenAiResponsesCommercialTurn(
          input,
          fullSystemPrompt,
          openAiKey,
          start,
          openAiModel,
        );
      } catch (ragErr) {
        this.logger.warn(
          `Responses RAG falló; intentando OpenAI Chat Completions sin vectorStore: ${(ragErr as Error).message}`,
        );
      }
    }

    try {
      return await this.executeOpenAiCompletionsCommercialTurn(
        input,
        fullSystemPrompt,
        openAiKey,
        start,
        openAiModel,
      );
    } catch (openAiErr) {
      if (canFailoverToGemini) {
        this.logger.warn(
          `Failover automático OpenAI -> Gemini en turno comercial: ${(openAiErr as Error).message}`,
        );
        return this.executeGeminiCommercialTurn(
          input,
          fullSystemPrompt,
          this.resolveApiKey('gemini'),
          start,
          this.getDefaultModel('gemini'),
        );
      }
      throw openAiErr;
    }
  }

  private async executeGeminiCommercialTurn(
    input: LlmTurnInput,
    fullSystemPrompt: string,
    apiKey: string,
    start: number,
    overrideModel?: string,
  ): Promise<LlmTurnOutput> {
    const cleanModel = this.normalizeModelForProvider(
      'gemini',
      overrideModel ?? input.model,
    ).replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const contents = [
      ...input.recentHistory.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      {
        role: 'user',
        parts: [{ text: input.userMessage }],
      },
    ];

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: fullSystemPrompt }],
          },
          contents,
          generationConfig: {
            temperature: 0.15,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ServiceUnavailableException(`Error de red/timeout con Gemini: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`Error Gemini: ${errText}`);
      throw this.buildUpstreamError('Error en Gemini', res.status, errText);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const parsed = this.safeParseJson(
      rawText,
      input.activeProductKey || 'custom_software',
      input.requiredFields,
    );

    return {
      ...parsed,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 420,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 180,
      latencyMs: Date.now() - start,
    };
  }

  private async executeOpenAiResponsesCommercialTurn(
    input: LlmTurnInput,
    fullSystemPrompt: string,
    apiKey: string,
    start: number,
    cleanModel: string,
  ): Promise<LlmTurnOutput> {
    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: cleanModel,
          input: [
            {
              role: 'developer',
              content: `${fullSystemPrompt}\n\nIMPORTANTE: Tu salida completa debe ser estrictamente un objeto JSON válido conforme al formato solicitado.`,
            },
            ...input.recentHistory.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            { role: 'user', content: input.userMessage },
          ],
          tools: [
            {
              type: 'file_search',
              vector_store_ids: [input.vectorStoreId],
              max_num_results: 12,
            },
          ],
          text: {
            format: { type: 'json_object' },
          },
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(25_000),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Error de red/timeout en OpenAI Responses: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`Error OpenAI Responses API: ${errText}`);
      throw this.buildUpstreamError('Error en OpenAI Responses', res.status, errText);
    }

    const data = (await res.json()) as Record<string, unknown> & {
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const rawText = this.extractResponsesApiText(data) || '{}';
    const parsed = this.safeParseJson(
      rawText,
      input.activeProductKey || 'custom_software',
      input.requiredFields,
    );
    parsed.replyText = this.stripCitationMarkers(parsed.replyText);

    return {
      ...parsed,
      inputTokens: data.usage?.input_tokens ?? 550,
      outputTokens: data.usage?.output_tokens ?? 210,
      latencyMs: Date.now() - start,
    };
  }

  private async executeOpenAiCompletionsCommercialTurn(
    input: LlmTurnInput,
    fullSystemPrompt: string,
    apiKey: string,
    start: number,
    cleanModel: string,
  ): Promise<LlmTurnOutput> {
    let res: Response;
    try {
      res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: cleanModel,
          response_format: { type: 'json_object' },
          temperature: 0.4,
          messages: [
            { role: 'system', content: fullSystemPrompt },
            ...input.recentHistory.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            { role: 'user', content: input.userMessage },
          ],
        }),
        signal: AbortSignal.timeout(22_000),
      });
    } catch (err) {
      throw new ServiceUnavailableException(
        `Error de red/timeout en OpenAI: ${(err as Error).message}`,
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      this.logger.error(`Error OpenAI: ${errText}`);
      throw this.buildUpstreamError('Error en OpenAI', res.status, errText);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const rawText = data.choices?.[0]?.message?.content || '{}';
    const parsed = this.safeParseJson(
      rawText,
      input.activeProductKey || 'custom_software',
      input.requiredFields,
    );

    return {
      ...parsed,
      inputTokens: data.usage?.prompt_tokens ?? 450,
      outputTokens: data.usage?.completion_tokens ?? 190,
      latencyMs: Date.now() - start,
    };
  }

  async generateSummary(
    provider: 'gemini' | 'openai',
    model: string,
    apiKey: string | undefined,
    previousSummary: string,
    messagesToSummarize: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const resolvedKey = this.resolveApiKey(provider, apiKey);
    const prompt = `Actualiza el siguiente resumen ejecutivo comercial en máximo 4 viñetas concisas conservando nombre del cliente, empresa/institución, línea de interés, presupuesto/grupo y objeciones.\n\nRESUMEN ANTERIOR:\n${previousSummary || 'Ninguno'}\n\nNUEVOS MENSAJES:\n${messagesToSummarize.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}`;

    try {
      if (provider === 'gemini') {
        const cleanModel = (model || 'gemini-flash-lite-latest').replace(/^models\//, '');
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(resolvedKey)}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 250, temperature: 0.2 },
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || previousSummary;
        }
      } else {
        const cleanModel = model || this.getDefaultModel('openai');
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolvedKey}`,
          },
          body: JSON.stringify({
            model: cleanModel,
            max_tokens: 250,
            temperature: 0.2,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          return data.choices?.[0]?.message?.content?.trim() || previousSummary;
        }
      }
    } catch (err) {
      this.logger.warn(`No se pudo comprimir resumen incremental: ${(err as Error).message}`);
    }
    return previousSummary;
  }

  private safeParseJson(
    rawText: string,
    fallbackProduct: ProductLineKey,
    requiredFields: string[],
  ): Omit<LlmTurnOutput, 'inputTokens' | 'outputTokens' | 'latencyMs'> {
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;

      const validProducts: ProductLineKey[] = [
        'custom_software',
        'krakedev_academy',
        'aws_certifications',
        'ai_assistants_b2b',
      ];
      const detected = validProducts.includes(parsed.linea_detectada as ProductLineKey)
        ? (parsed.linea_detectada as ProductLineKey)
        : fallbackProduct;

      const rawExtraction = Array.isArray(parsed.extraccion) ? parsed.extraccion : [];
      const extractedFields =
        rawExtraction.length > 0
          ? rawExtraction.map((item: Record<string, unknown>) => ({
              key: String(item.key || 'Dato'),
              value: String(item.value || 'Pendiente'),
              status: (['captured', 'partial', 'missing'].includes(String(item.status))
                ? String(item.status)
                : 'missing') as 'captured' | 'partial' | 'missing',
            }))
          : requiredFields.map((key) => ({
              key,
              value: 'Pendiente',
              status: 'missing' as const,
            }));

      const rawTools = Array.isArray(parsed.mcp_tool_calls) ? parsed.mcp_tool_calls : [];
      const rawHandoffCat = String(parsed.motivo_escalamiento || '').trim();
      const handoffCategory: 'SUPPORT_OR_FRICTION' | 'SALES_REQUEST' | null =
        rawHandoffCat === 'SUPPORT_OR_FRICTION' || rawHandoffCat === 'SALES_REQUEST'
          ? rawHandoffCat
          : null;

      return {
        replyText: String(
          parsed.respuesta_chat ||
            'Hola, soy Fidel de Clear Minds. ¿En qué programa o solución tecnológica te puedo asesorar hoy?',
        ),
        detectedProductKey: detected,
        intentLevel: (['ALTO', 'MEDIO', 'BAJO'].includes(String(parsed.intencion))
          ? String(parsed.intencion)
          : 'MEDIO') as 'ALTO' | 'MEDIO' | 'BAJO',
        intentJustification: String(
          parsed.justificacion_intencion || 'Evaluación comercial en curso.',
        ),
        extractedFields,
        nextAction: String(
          parsed.siguiente_accion || 'Continuar calificación consultiva del prospecto.',
        ),
        handoffCategory,
        mcpToolCalls: rawTools
          .filter((t: Record<string, unknown>) => typeof t?.toolName === 'string')
          .map((t: Record<string, unknown>) => ({
            toolName: t.toolName as
              | 'cotizar_descuento_grupo'
              | 'agendar_cita'
              | 'registrar_lead_crm'
              | 'transferir_a_humano',
            arguments: (t.arguments as Record<string, unknown>) ?? {},
          })),
      };
    } catch {
      return {
        replyText: rawText || 'Recibido. ¿Me comentas más detalles para asesorarte mejor?',
        detectedProductKey: fallbackProduct,
        intentLevel: 'MEDIO',
        intentJustification: 'Respuesta en texto libre.',
        extractedFields: requiredFields.map((key) => ({
          key,
          value: 'Pendiente',
          status: 'missing' as const,
        })),
        nextAction: 'Indagar requerimiento principal.',
        handoffCategory: null,
        mcpToolCalls: [],
      };
    }
  }

  async generateTrainingTurn(input: {
    provider: 'gemini' | 'openai';
    model: string;
    apiKey?: string;
    systemPrompt: string;
    vectorStoreId?: string | null;
    recentHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
    userMessage: string;
  }): Promise<{
    reply: string;
    mode: 'SETUP' | 'ROLEPLAY' | 'CORRECTION';
    learnedRule: { instruction: string; category: string } | null;
  }> {
    const resolvedKey = this.resolveApiKey(input.provider, input.apiKey);

    const trainingInstructions = `
# MODO ENTRENAMIENTO INTERACTIVO — FIDEL (COACH COMERCIAL)
Estás operando en **MODO ENTRENAMIENTO ACTIVO** conversando con un Entrenador (jefe de ventas o asesor) que practica contigo mediante roleplay y te da correcciones para mejorar.

Clasifica el ÚLTIMO MENSAJE del Entrenador en uno de 3 escenarios:
1. "SETUP": El usuario te avisa que va a empezar a entrenarte o pregunta si estás listo.
   - mode: "SETUP", learnedRule: null, reply: Confirma brevemente que estás en Modo Entrenamiento y listo para practicar.
2. "CORRECTION": El usuario sale del papel de cliente o usa frases como "Entrenador:", "Mejor di...", "Corrige...", "Menos emojis", "Ten en cuenta...", "Guarda en memoria..." para corregir tu respuesta, tono o enseñarte un dato nuevo.
   - mode: "CORRECTION"
   - learnedRule: { "instruction": "Directriz clara en imperativo para futuros clientes", "category": "ESTILO" | "COMERCIAL" | "OBJECIONES" | "GENERAL" }
   - reply: En dos partes breves separadas por un salto de línea:
     1) "✅ Anotado en memoria: [resumen breve]."
     2) "Respuesta corregida: \"[nueva respuesta mejorada aplicando la regla]\""
3. "ROLEPLAY": El usuario escribe actuando como un cliente real.
   - mode: "ROLEPLAY", learnedRule: null, reply: Responde 100% en tu papel de Fidel aplicando tu conocimiento base${input.vectorStoreId ? ', los documentos del RAG (file_search)' : ''} y TODAS las reglas aprendidas previamente.

Devuelve ÚNICAMENTE un JSON válido:
{
  "mode": "SETUP" | "ROLEPLAY" | "CORRECTION",
  "learnedRule": { "instruction": "string", "category": "ESTILO" | "COMERCIAL" | "OBJECIONES" | "GENERAL" } | null,
  "reply": "string con la respuesta exacta para el chat"
}`;

    const fullSystem = `${input.systemPrompt}\n\n${trainingInstructions}`;
    const canFailoverToGemini = !input.apiKey && this.hasProviderKey('gemini');

    if (input.provider === 'gemini') {
      return this.executeGeminiTrainingTurn(input, fullSystem, resolvedKey);
    }

    const cleanModel = this.normalizeModelForProvider('openai', input.model);
    if (input.vectorStoreId) {
      try {
        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resolvedKey}`,
          },
          body: JSON.stringify({
            model: cleanModel,
            input: [
              {
                role: 'developer',
                content: `${fullSystem}\n\nResponde estrictamente con un objeto JSON válido.`,
              },
              ...input.recentHistory.map((m) => ({ role: m.role, content: m.content })),
              { role: 'user', content: input.userMessage },
            ],
            tools: [
              {
                type: 'file_search',
                vector_store_ids: [input.vectorStoreId],
                max_num_results: 12,
              },
            ],
            text: { format: { type: 'json_object' } },
            temperature: 0.35,
          }),
          signal: AbortSignal.timeout(25_000),
        });

        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          const raw = this.extractResponsesApiText(data) || '{}';
          const parsed = this.parseTrainingJson(raw);
          parsed.reply = this.stripCitationMarkers(parsed.reply);
          return parsed;
        }
        const errText = await res.text();
        this.logger.warn(`OpenAI Training RAG HTTP ${res.status}: ${errText.slice(0, 180)}`);
      } catch (ragErr) {
        this.logger.warn(
          `OpenAI Training RAG falló; intentando Chat Completions: ${(ragErr as Error).message}`,
        );
      }
    }

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolvedKey}`,
        },
        body: JSON.stringify({
          model: cleanModel,
          response_format: { type: 'json_object' },
          temperature: 0.15,
          messages: [
            { role: 'system', content: fullSystem },
            ...input.recentHistory.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: input.userMessage },
          ],
        }),
        signal: AbortSignal.timeout(22_000),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw this.buildUpstreamError('Error en OpenAI Training', res.status, errText);
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const raw = data.choices?.[0]?.message?.content || '{}';
      return this.parseTrainingJson(raw);
    } catch (err) {
      if (canFailoverToGemini) {
        this.logger.warn(
          `Failover automático OpenAI -> Gemini en Training: ${(err as Error).message}`,
        );
        return this.executeGeminiTrainingTurn(input, fullSystem, this.resolveApiKey('gemini'));
      }
      if (err instanceof BadRequestException || err instanceof ServiceUnavailableException) {
        throw err;
      }
      throw new ServiceUnavailableException(
        `Error de red/timeout en OpenAI Training: ${(err as Error).message}`,
      );
    }
  }

  private async executeGeminiTrainingTurn(
    input: {
      model: string;
      recentHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
      userMessage: string;
    },
    fullSystem: string,
    apiKey: string,
  ): Promise<{
    reply: string;
    mode: 'SETUP' | 'ROLEPLAY' | 'CORRECTION';
    learnedRule: { instruction: string; category: string } | null;
  }> {
    const cleanModel = this.normalizeModelForProvider('gemini', input.model).replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const contents = [
      ...input.recentHistory.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: input.userMessage }] },
    ];

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: fullSystem }] },
          contents,
          generationConfig: { temperature: 0.35, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      throw new ServiceUnavailableException(`Error de red/timeout en Gemini Training: ${(err as Error).message}`);
    }

    if (!res.ok) {
      const errText = await res.text();
      throw this.buildUpstreamError('Error en Gemini Training', res.status, errText);
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    return this.parseTrainingJson(raw);
  }

  private parseTrainingJson(rawText: string): {
    reply: string;
    mode: 'SETUP' | 'ROLEPLAY' | 'CORRECTION';
    learnedRule: { instruction: string; category: string } | null;
  } {
    try {
      const cleaned = rawText
        .replace(/^```json\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const parsed = JSON.parse(cleaned) as Record<string, unknown>;
      const mode = (['SETUP', 'ROLEPLAY', 'CORRECTION'].includes(String(parsed.mode))
        ? String(parsed.mode)
        : 'ROLEPLAY') as 'SETUP' | 'ROLEPLAY' | 'CORRECTION';

      let learnedRule: { instruction: string; category: string } | null = null;
      if (
        mode === 'CORRECTION' &&
        parsed.learnedRule &&
        typeof parsed.learnedRule === 'object' &&
        (parsed.learnedRule as Record<string, unknown>).instruction
      ) {
        const lr = parsed.learnedRule as Record<string, unknown>;
        learnedRule = {
          instruction: String(lr.instruction),
          category: String(lr.category || 'GENERAL').toUpperCase(),
        };
      }

      return {
        reply: String(parsed.reply || 'Modo Entrenamiento activo. Continúa por favor.'),
        mode,
        learnedRule,
      };
    } catch {
      return {
        reply: rawText || 'Modo Entrenamiento activo. ¿Cómo deseas continuar?',
        mode: 'ROLEPLAY',
        learnedRule: null,
      };
    }
  }

  async generateContextualFollowUp(input: {
    stage: 1 | 2 | 3;
    baseTemplate: string;
    productName?: string | null;
    extractedDataJson?: string | null;
    suggestedAction?: string | null;
    recentMessages: Array<{ senderType: string; content: string }>;
    provider?: 'gemini' | 'openai';
  }): Promise<string> {
    try {
      const targetProvider = input.provider || this.getDefaultProvider();
      const apiKey = this.resolveApiKey(targetProvider);
      const historyText = input.recentMessages
        .slice(-6)
        .map((m) => `${m.senderType === 'CUSTOMER' ? 'Cliente' : 'Fidel'}: ${m.content}`)
        .join('\n');

      const prompt = [
        'Eres Fidel, asesor comercial cercano, gentil y amable de Clear Minds / KrakeDev en WhatsApp.',
        `Debes redactar un mensaje de seguimiento por inactividad (Etapa ${input.stage} de 3).`,
        `Plantilla base obligatoria de referencia (conserva su tono gentil/divertido, propósito y estilo):\n"${input.baseTemplate}"`,
        input.productName ? `Producto/programa conversado: ${input.productName}` : '',
        input.extractedDataJson && input.extractedDataJson !== '{}' && input.extractedDataJson !== '[]'
          ? `Datos capturados del cliente: ${input.extractedDataJson}`
          : '',
        input.suggestedAction ? `Siguiente acción sugerida: ${input.suggestedAction}` : '',
        historyText ? `Últimos mensajes de la conversación:\n${historyText}` : '',
        'REGLAS ESTRICTAS:',
        '1. Adapta suavemente la plantilla base al tema que estaban conversando (por ejemplo mencionando brevemente el programa o duda pendiente), SIN salirte del contexto.',
        '2. NO inventes precios, fechas, descuentos ni cambies de producto.',
        '3. Mantén 1 o 2 frases cortas, naturales para WhatsApp, sin sonar insistente ni robótico.',
        '4. Devuelve ÚNICAMENTE el texto final del mensaje listo para enviar.',
      ]
        .filter(Boolean)
        .join('\n\n');

      if (targetProvider === 'openai') {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: this.getDefaultModel('openai'),
            max_tokens: 160,
            temperature: 0.35,
            messages: [{ role: 'user', content: prompt }],
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (res.ok) {
          const data = (await res.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          const generated = data.choices?.[0]?.message?.content
            ?.replace(/^["']|["']$/g, '')
            .trim();

          if (generated && generated.length >= 15 && generated.length <= 450) {
            return generated;
          }
        }
        if (this.hasProviderKey('gemini')) {
          return this.generateFollowUpWithGemini(prompt, input.baseTemplate);
        }
        return input.baseTemplate;
      }

      return this.generateFollowUpWithGemini(prompt, input.baseTemplate);
    } catch (err) {
      this.logger.warn(
        `Fallback a plantilla literal de seguimiento (etapa ${input.stage}): ${(err as Error).message}`,
      );
      return input.baseTemplate;
    }
  }

  private async generateFollowUpWithGemini(prompt: string, fallback: string): Promise<string> {
    const geminiKey = this.resolveApiKey('gemini');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.getDefaultModel('gemini').replace(/^models\//, '')}:generateContent?key=${encodeURIComponent(geminiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 160,
          temperature: 0.4,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return fallback;
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const generated = data.candidates?.[0]?.content?.parts?.[0]?.text
      ?.replace(/^["']|["']$/g, '')
      .trim();

    if (!generated || generated.length < 15 || generated.length > 450) {
      return fallback;
    }
    return generated;
  }
}
