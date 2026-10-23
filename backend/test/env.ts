// Environment for every test worker (validated by AppConfigModule in API tests).
import * as path from 'path';

export const TEST_DB_PATH = path.join(__dirname, '.tmp', 'test.db');

Object.assign(process.env, {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  DATABASE_URL: `file:${TEST_DB_PATH}`,
  JWT_SECRET: 'test-secret',
  FRONTEND_URL: 'http://localhost:4200',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '2525',
  SMTP_USER: 'test',
  SMTP_PASS: 'test',
  MAIL_FROM: 'Test <test@example.test>',
  OIDC_PROVIDERS: '',
  TELEGRAM_BOT_TOKEN: '123456:TEST-TOKEN',
  TELEGRAM_BOT_USERNAME: 'notifier_test_bot',
  TELEGRAM_ENABLED: 'true',
});
