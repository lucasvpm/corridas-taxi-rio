import { join } from 'node:path';

// Os e2e rodam contra a infra real do docker compose (ou dos `services:` do CI).
process.env.OTEL_SDK_DISABLED = 'true';
process.env.LOG_LEVEL ??= 'silent';
process.env.JWT_PUBLIC_KEY_PATH ??= join(
  __dirname,
  '..',
  '..',
  'scripts',
  'test-keys',
  'public.pem',
);
