import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { envs } from '../config/envs';
import { CheckoutSession, CreateSessionDto } from './fake-stripe.types';

/**
 * El "tercero". Guarda las sesiones en memoria (se pierden al reiniciar: es un fake,
 * no necesita base de datos) y dispara el webhook firmado cuando se confirma el pago.
 */
@Injectable()
export class FakeStripeService {
  private readonly logger = new Logger('FakeStripe');
  private readonly sessions = new Map<string, CheckoutSession>();

  createSession(dto: CreateSessionDto): CheckoutSession {
    const id = `cs_test_${randomBytes(8).toString('hex')}`;

    const session: CheckoutSession = {
      id,
      object: 'checkout.session',
      amount_total: dto.line_items.reduce(
        (total, item) => total + item.unit_amount * item.quantity,
        0,
      ),
      currency: dto.currency,
      status: 'open',
      payment_status: 'unpaid',
      metadata: dto.metadata ?? {},
      line_items: dto.line_items,
      success_url: dto.success_url,
      cancel_url: dto.cancel_url,
      url: `${envs.stripeApiUrl}/checkout/pay/${id}`,
    };

    this.sessions.set(id, session);
    return session;
  }

  findSession(id: string): CheckoutSession {
    const session = this.sessions.get(id);
    if (!session) throw new NotFoundException(`No such checkout session: ${id}`);
    return session;
  }

  /** Devuelve la url a la que hay que redirigir al usuario. */
  async confirm(id: string, action: string): Promise<string> {
    const session = this.findSession(id);

    if (action !== 'pay') {
      session.status = 'expired';
      return session.cancel_url;
    }

    session.status = 'complete';
    session.payment_status = 'paid';
    session.payment_intent = `pi_${randomBytes(8).toString('hex')}`;

    await this.sendWebhook(session);
    return session.success_url;
  }

  private async sendWebhook(session: CheckoutSession) {
    const body = JSON.stringify({
      id: `evt_${randomBytes(8).toString('hex')}`,
      object: 'event',
      type: 'checkout.session.completed',
      created: Math.floor(Date.now() / 1000),
      data: { object: session },
    });

    // Misma firma que Stripe: HMAC-SHA256 sobre `${timestamp}.${body}`.
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac('sha256', envs.stripeWebhookSecret)
      .update(`${timestamp}.${body}`)
      .digest('hex');

    try {
      await fetch(envs.stripeWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': `t=${timestamp},v1=${signature}`,
        },
        body,
      });
      this.logger.log(`Webhook enviado para ${session.id}`);
    } catch (error) {
      // Stripe reintentaría; acá alcanza con dejarlo en el log.
      this.logger.error(`Falló el webhook para ${session.id}`, error);
    }
  }
}
