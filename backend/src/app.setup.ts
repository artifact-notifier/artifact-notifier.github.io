import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';

/** HTTP setup shared by main.ts and the API tests. */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
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
}
