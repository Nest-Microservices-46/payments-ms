import { Body, Controller, Get, Headers, Logger, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { PaymentsService } from './payments.service';
import type { PaymentSessionDto } from './dto/payment-session.dto';

@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger('Payments');

  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('create-payment-session')
  createPaymentSession(@Body() body: PaymentSessionDto) {
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
      // Acá va el `client.emit('payment.succeeded', ...)` cuando sumemos NATS.
      this.logger.log(
        `Orden ${session.metadata.orderId} pagada (${session.payment_intent})`,
      );
    }

    return { received: true };
  }
}
