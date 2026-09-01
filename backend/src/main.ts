import { NestFactory } from '@nestjs/core';
import { LogLevel, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AppConfigModule } from './config/config.module';
import { ConfigService } from '@nestjs/config';

// Expand a LOG_LEVEL threshold (error < warn < log < debug < verbose) to the
// level list expected by NestFactory. Unknown values fall back to 'log'.
function resolveLogLevels(level: string | undefined): LogLevel[] {
  switch ((level || 'log').toLowerCase()) {
    case 'error':
      return ['error', 'fatal'];
    case 'warn':
      return ['error', 'fatal', 'warn'];
    case 'debug':
      return ['error', 'fatal', 'warn', 'log', 'debug'];
    case 'verbose':
      return ['error', 'fatal', 'warn', 'log', 'debug', 'verbose'];
    case 'log':
    default:
      return ['error', 'fatal', 'warn', 'log'];
  }
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  // Applied after ConfigService init so LOG_LEVEL from .env is honored
  // (process.env alone would miss .env values at this point).
  app.useLogger(resolveLogLevels(config.get<string>('LOG_LEVEL')));
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // FRONTEND_URL can be a comma-separated list (multi-domain)
  const frontendUrls = (config.get<string>('FRONTEND_URL') || 'http://localhost:4200')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: frontendUrls.length >= 1 ? frontendUrls : ['http://localhost:4200'],
    credentials: true,
  });
  const port = config.get<number>('BACKEND_PORT') || 3000;
  await app.listen(port);
  console.log(`Backend listening on http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
