import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { envs } from '../config/envs';
import { PaymentSessionDto } from './dto/payment-session.dto';
import { StripeEvent } from '../fake-stripe/fake-stripe.types';
import { NATS_SERVICE } from 'src/config/services';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class PaymentsService {

  constructor(
    @Inject(NATS_SERVICE) private readonly client: ClientProxy
  ) {

  }
  /** Le pide la sesión al proveedor por HTTP. El día de mañana, a Stripe de verdad. */
  async createPaymentSession(dto: PaymentSessionDto) {
    const response = await fetch(`${envs.stripeApiUrl}/checkout/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currency: dto.currency,
        line_items: dto.items.map((item) => ({
          name: item.name,
          unit_amount: Math.round(item.price * 100), // Stripe trabaja en centavos
          quantity: item.quantity,
        })),
        metadata: { orderId: dto.orderId },
        success_url: envs.stripeSuccessUrl,
        cancel_url: envs.stripeCancelUrl,
      }),
    });

    const session = await response.json();

    return {
      cancelUrl: envs.stripeCancelUrl,
      successUrl: envs.stripeSuccessUrl,
      url: session.url,
    };
  }

  /**
   * Equivalente a `stripe.webhooks.constructEvent`: verifica la firma sobre el
   * body crudo. `JSON.stringify(req.body)` no sirve — puede reordenar o
   * reespaciar el JSON y la firma deja de coincidir.
   */
  constructEvent(rawBody: Buffer | undefined, header: string | undefined): StripeEvent {
    if (!rawBody || !header) throw new BadRequestException('Missing raw body or signature');

    const parts = Object.fromEntries(
      header.split(',').map((part) => part.split('=') as [string, string]),
    );
    const { t, v1 } = parts;
    if (!t || !v1) throw new BadRequestException('Invalid signature header');

    // Tolerancia de 5 minutos: evita que reenvíen un evento viejo.
    if (Math.abs(Date.now() / 1000 - Number(t)) > 300) {
      throw new BadRequestException('Signature timestamp too old');
    }

    const expected = createHmac('sha256', envs.stripeWebhookSecret)
      .update(`${t}.${rawBody.toString()}`)
      .digest('hex');

    const a = Buffer.from(expected);
    const b = Buffer.from(v1);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('Invalid signature');
    }

    return JSON.parse(rawBody.toString());
  }
}
