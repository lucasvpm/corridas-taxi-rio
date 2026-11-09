import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { correlationMiddleware } from './observability/correlation';
import { metricsMiddleware } from './observability/metrics';

/**
 * Configuração HTTP compartilhada entre o main.ts e os testes e2e,
 * para que os testes exercitem exatamente o mesmo pipeline da produção.
 */
export function configureApp(app: INestApplication): void {
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.use(correlationMiddleware);
  app.use(metricsMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
