import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { envs } from './config/envs';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

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
  //compelte this 
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: {
      servers: envs.natsServers
    }
  }, {
    inheritAppConfig: true
  })

  await app.startAllMicroservices();

  await app.listen(envs.port);
  logger.log(`Payments Microservice is running on port ${envs.port}`);
}
bootstrap();
