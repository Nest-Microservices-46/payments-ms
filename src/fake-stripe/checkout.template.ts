import { CheckoutSession } from './fake-stripe.types';

const money = (cents: number, currency: string) =>
  `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;

/** El "Checkout hosteado": lo único que ve el usuario del proveedor de pagos. */
export const checkoutPage = (session: CheckoutSession) => `
<html>
  <head><title>Fake Stripe Checkout</title></head>
  <body style="font-family: sans-serif; max-width: 420px; margin: 60px auto;">
    <h2>Fake Stripe</h2>
    <p style="color:#666">Sesión ${session.id}</p>
    <ul>
      ${session.line_items
        .map(
          (item) =>
            `<li>${item.name} x${item.quantity} — ${money(item.unit_amount * item.quantity, session.currency)}</li>`,
        )
        .join('')}
    </ul>
    <h3>Total: ${money(session.amount_total, session.currency)}</h3>

    <form method="POST" action="${session.url}/confirm">
      <button name="action" value="pay">Pagar</button>
      <button name="action" value="cancel">Cancelar</button>
    </form>
  </body>
</html>
`;
