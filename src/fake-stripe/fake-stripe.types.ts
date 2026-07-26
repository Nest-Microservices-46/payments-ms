// Nombres en snake_case a propósito: son los mismos que devuelve la API real de Stripe.

export interface LineItem {
  name: string;
  unit_amount: number; // en centavos
  quantity: number;
}

export interface CreateSessionDto {
  currency: string;
  line_items: LineItem[];
  metadata?: Record<string, string>;
  success_url: string;
  cancel_url: string;
}

export interface CheckoutSession {
  id: string;
  object: 'checkout.session';
  amount_total: number;
  currency: string;
  status: 'open' | 'complete' | 'expired';
  payment_status: 'unpaid' | 'paid';
  payment_intent?: string;
  metadata: Record<string, string>;
  line_items: LineItem[];
  success_url: string;
  cancel_url: string;
  url: string;
}

export interface StripeEvent {
  id: string;
  object: 'event';
  type: string;
  created: number;
  data: { object: CheckoutSession };
}
