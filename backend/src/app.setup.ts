import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

/** HTTP setup shared by main.ts and the API tests. */
export function configureApp(app: NestExpressApplication) {
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api');
  // project imports send every dependency of every module (Express default: 100kb);
  // same ceiling as nginx's default client_max_body_size
  app.useBodyParser('json', { limit: '1mb' });
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
}
