import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { EnvironmentVariables } from './context/config/app.config';

async function bootstrap() {
  const logger = new Logger('FidelBootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService<EnvironmentVariables, true>);

  const port = configService.get('PORT', { infer: true });
  const frontendUrl = configService.get('FRONTEND_URL', { infer: true });

  app.setGlobalPrefix('api');
  app.use(cookieParser());

  // Permite conectar el Front Universal en /mcp y /auth/* sin prefijo /api manteniendo compatibilidad con /api/*
  app.use((req: { url: string }, _res: unknown, next: () => void) => {
    if (req.url === '/mcp' || req.url.startsWith('/mcp?') || req.url.startsWith('/auth/')) {
      req.url = `/api${req.url}`;
    }
    next();
  });

  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Mcp-Protocol-Version',
      'Mcp-Session-Id',
      'Last-Event-ID',
      'X-Tenant-Id',
      'x-tenant-key',
      'x-tenant-id',
    ],
    exposedHeaders: ['Mcp-Session-Id', 'Mcp-Protocol-Version'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('FIDEL v1.3 — Commercial AI Agent & MCP Server API')
    .setDescription(
      'Backend NestJS 11 + Prisma 7 + Model Context Protocol (MCP) para Clear Minds / KrakeDev.',
    )
    .setVersion('1.3.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 FidelBack_MCP corriendo en: http://localhost:${port}/api`);
  logger.log(`📚 Documentación OpenAPI / Swagger: http://localhost:${port}/api/docs`);
  logger.log(`🔌 Servidor MCP (Tools & Resources): http://localhost:${port}/api/mcp/status`);
}

void bootstrap();
