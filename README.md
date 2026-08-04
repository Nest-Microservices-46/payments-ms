# 💳 Payments Microservice

<p align="center">
  <img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" />
</p>

<p align="center">
  Microservicio de Pagos, construido con <a href="http://nestjs.com/" target="blank">NestJS</a>. Crea las sesiones de pago y procesa los webhooks de confirmación.
</p>

---

**Es el único servicio híbrido**: escucha HTTP *y* NATS al mismo tiempo.

```ts
const app = await NestFactory.create(AppModule, { rawBody: true });
app.connectMicroservice({ transport: Transport.NATS, ... });
await app.startAllMicroservices();
```

Necesita HTTP porque el webhook y la página de checkout son HTTP, y NATS porque `orders-ms` le habla por ahí. No tiene base de datos.

## 📬 Message Patterns y rutas

| | Patrón / Ruta | Hace |
|---|---|---|
| NATS | `create.payment.session` | Recibe `{ orderId, currency, items[] }` y devuelve `{ url, successUrl, cancelUrl }` |
| HTTP | `POST /payments/webhook` | Confirmación de pago. Verifica la firma y emite el evento |
| HTTP | `GET /payments/success` | Landing después de pagar |
| HTTP | `GET /payments/cancel` | Landing si se cancela |

Usa **strings con puntos** como patrón, igual que `auth-ms` y distinto de `products-ms` (objetos) y `orders-ms` (strings planos).

## 🎭 Fake Stripe

El servicio hospeda además un **reemplazo de la API de Stripe** (`src/fake-stripe/`), montado en `/v1/checkout`. No hace falta cuenta de Stripe ni claves reales para probar el flujo completo.

| Ruta | Hace |
|---|---|
| `POST /v1/checkout/sessions` | Crea la sesión, como haría Stripe |
| `GET /v1/checkout/pay/:id` | Página de pago |
| `POST /v1/checkout/pay/:id/confirm` | Confirma y dispara el webhook |

Ver [`FAKE-STRIPE.md`](./FAKE-STRIPE.md) para el detalle.

## 🔄 El flujo completo

1. `orders-ms` manda `create.payment.session` con los ítems. **Los precios viajan en unidades**; acá se multiplican por 100 para pasarlos a centavos.
2. Este servicio le pide la sesión al fake Stripe por HTTP y devuelve `{ url, successUrl, cancelUrl }`.
3. El usuario paga en esa `url`. El fake Stripe hace `POST` al webhook.
4. La firma del webhook se verifica contra **`req.rawBody`** — de ahí el `rawBody: true` del bootstrap. Usar `JSON.stringify(req.body)` reespacia el JSON y rompe el HMAC.
5. El webhook **emite** `payment.succeeded` con `emit()`, no con `send()`.

> El punto 5 es una decisión, no un detalle: a Stripe solo le importa recibir su 200. Si esperáramos la respuesta de `orders-ms`, un `orders-ms` caído provocaría reintentos del webhook.

## 📋 Requisitos Previos

- **Node.js 22**
- **npm** (este servicio usa npm, no pnpm)
- **Docker** (para NATS, o para levantar todo el stack)

## 🛠️ Instalación

```bash
cd payments-ms
npm install
```

## ⚙️ Variables de Entorno

```bash
cp .env.template .env
```

```env
PORT=3003
NATS_SERVERS="nats://localhost:4222"

STRIPE_API_URL=http://localhost:3003/v1
STRIPE_WEBHOOK_URL=http://localhost:3003/payments/webhook
STRIPE_WEBHOOK_SECRET=whsec_fake_local_secret
STRIPE_SUCCESS_URL=http://localhost:3003/payments/success
STRIPE_CANCEL_URL=http://localhost:3003/payments/cancel
```

> **Las cinco `STRIPE_*` son `required()`.** Si falta una, el contenedor compila, arranca y sale de inmediato. Bajo Docker llegan desde el `.env` de la raíz por interpolación `${...}`.

A diferencia de los demás microservicios, acá `PORT` **sí se usa**: es el puerto HTTP real.

## ▶️ Ejecución

Lo normal es levantar todo el stack desde la raíz del proyecto:

```bash
docker compose up -d --build
```

Solo, con NATS corriendo:

```bash
npm run start:dev
```

## 🧪 Testing

```bash
npm test
npm run test:e2e
npm run test:cov
```

## ⚠️ Cosas a tener en cuenta

**No tiene Prisma.** Su dockerfile empezó como una copia del de `orders-ms` y arrastraba un `RUN npx prisma generate` y la instalación de `openssl`; los dos se sacaron, porque un `prisma generate` sin directorio `prisma/` rompe el build.

**Las devDependencies tienen que quedar consistentes entre sí.** Venían con `jest@^25` al lado de `ts-jest@^29` (cuyo peer es `jest@^29`), `@nestjs/cli@^6.8.1` sobre una app de Nest 11, y `eslint@^10`. El lockfile se había generado con `--legacy-peer-deps`, así que solo fallaba dentro de Docker, en el `npm install`, con `npm error code ERESOLVE`. Ya están alineadas con `orders-ms`; si esa vuelta atrás reaparece, es lo primero para revisar.

**Es el que más sufre las fugas de hot reload.** Como sí bindea un puerto, un proceso huérfano de un recompilado anterior hace que el nuevo entre en crash-loop con `EADDRINUSE: address already in use :::3003`, y ahí deja de responder NATS por completo: `create.payment.session` empieza a fallar con `EmptyResponseException`. Está mitigado con `--no-shell` en el `start:dev`, pero si aparece, la salida es `docker compose restart payments-ms`.
