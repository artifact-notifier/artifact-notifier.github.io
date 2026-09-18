import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as Joi from 'joi';

export const validationSchema = Joi.object({
  BACKEND_PORT: Joi.number().default(3000),
  FRONTEND_URL: Joi.string().default('http://localhost:4200'),
  // Public API URL (used for OIDC redirect_uris).
  // In same-origin (frontend proxy) it equals the frontend URL; in cross-origin
  // it equals the API domain, e.g. https://api.example.com
  BACKEND_PUBLIC_URL: Joi.string().default(''),
  // Log verbosity threshold: error < warn < log (default) < debug < verbose
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'log', 'debug', 'verbose').default('log'),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().required(),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),
  MAIL_FROM: Joi.string().required(),
  // Minimum digest interval (minutes) enforced when the channel includes email.
  // Daily (1440) by default; lower it in dev for faster testing (e.g. 1).
  MAIL_MIN_DIGEST_INTERVAL_MINUTES: Joi.number().integer().min(1).default(1440),
  OIDC_PROVIDERS: Joi.string().default(''),
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema,
      envFilePath: ['.env', '.env.local'],
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
