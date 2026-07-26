import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { envs } from './config/envs';

async function bootstrap() {
  // rawBody: hace falta el body sin parsear para verificar la firma del webhook.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  const logger = new Logger('PaymentsMicroservice');

  await app.listen(envs.port);
  logger.log(`Payments Microservice is running on port ${envs.port}`);
}
bootstrap();
