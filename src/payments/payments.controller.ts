import { Controller, Get, Headers, Inject, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import type { PaymentSessionDto } from './dto/payment-session.dto';
import { ClientProxy, MessagePattern, Payload } from '@nestjs/microservices';
import { NATS_SERVICE } from 'src/config/services';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly paymentsService: PaymentsService,
    @Inject(NATS_SERVICE) private readonly client: ClientProxy,
  ) { }

  @MessagePattern('create.payment.session')
  createPaymentSession(@Payload() body: PaymentSessionDto) {
    return this.paymentsService.createPaymentSession(body);
  }

  // Sólo informativas: el usuario puede cerrar la pestaña y el pago igual se registra,
  // porque quien confirma es el webhook.
  @Get('success')
  success() {
    return { ok: true, message: 'Payment successful' };
  }

  @Get('cancel')
  cancel() {
    return { ok: false, message: 'Payment cancelled' };
  }

  @Post('webhook')
  handleStripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    const event = this.paymentsService.constructEvent(req.rawBody, signature);

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      // emit y no send: al webhook no le importa la respuesta de orders-ms, y si
      // esperara una, un orders-ms caído dejaría a Stripe sin su 200 y reintentando.
      this.client.emit('payment.succeeded', {
        orderId: session.metadata.orderId,
        stripePaymentId: session.payment_intent,
        receiptUrl: session.url,
      });
      this.logger.log(
        `Orden ${session.metadata.orderId} pagada (${session.payment_intent})`,
      );
    }

    return { received: true };
  }
}
