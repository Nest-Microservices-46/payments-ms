# Sección Payments — Fake Stripe (sin SDK)

Guía de diseño de `payments-ms`. La idea es reproducir el flujo real de Stripe
(Checkout Session + webhook firmado) **sin instalar `stripe`** ni usar sus servidores:
escribimos nosotros el "proveedor de pagos" y hablamos con él por HTTP plano.

Los dos temas de la sección:

1. **RESTful API para crear sesiones de pago.**
2. **Webhook** que el proveedor usa para avisarnos que el pago se concretó.

Y el detalle de arquitectura que hace importante a la sección: `payments-ms` termina siendo
una **aplicación híbrida REST + NATS**. El webhook necesita una URL pública (mundo exterior,
HTTP), pero el aviso de "pago realizado" tiene que viajar por NATS a los interesados
(`orders-ms`). Un solo proceso con los dos transportes.

---

## 1. Qué estamos simulando

En el flujo real de Stripe pasan estas cosas:

| Paso | Real | Fake |
|---|---|---|
| Crear sesión | `stripe.checkout.sessions.create(...)` (SDK → API de Stripe) | `POST /v1/checkout/sessions` a nuestro fake |
| Pantalla de pago | Checkout hosteado por Stripe | Un HTML mínimo servido por el fake, con botón *Pagar* / *Cancelar* |
| Aviso de pago | Stripe hace `POST` al webhook con header `stripe-signature` | El fake hace el mismo `POST`, con la misma firma HMAC |
| Verificación | `stripe.webhooks.constructEvent(rawBody, sig, secret)` | Función propia `constructEvent()` (~20 líneas) |
| Redirects | `success_url` / `cancel_url` | Idénticos |

Todo lo demás (nombres de campos, formato de IDs, forma del evento) lo copiamos tal cual
para que migrar al Stripe real después sea cambiar una clase, no el flujo.

---

## 2. Decisión: ¿dónde vive el fake?

**Recomendado: un módulo aparte dentro de `payments-ms`** (`src/fake-stripe/`), no otro
servicio ni otro contenedor. Menos infraestructura para el curso, y el aislamiento se
consigue por código, no por proceso:

- `payments-ms` **nunca** importa clases de `fake-stripe` directamente.
- Habla con él por HTTP (`fetch` a `STRIPE_API_URL`), como si fuera externo.
- Del lado de `payments-ms` hay una interfaz `StripeGateway` con una sola implementación
  (`FakeStripeGateway`). El día que se quiera el Stripe real, se escribe
  `RealStripeGateway` y se cambia el provider en el módulo. Nada más.

Si en algún momento se quiere separar de verdad, el fake se muda a su propia carpeta/servicio
y solo cambia `STRIPE_API_URL`.

---

## 3. Flujo completo

```
client-gateway            payments-ms                 fake-stripe            orders-ms
     │                        │                            │                     │
     │ POST /api/payments/    │                            │                     │
     │      create-session    │                            │                     │
     ├───────────────────────>│                            │                     │
     │                        │ POST /v1/checkout/sessions │                     │
     │                        ├───────────────────────────>│                     │
     │                        │  { id, url, ... }          │                     │
     │  { url: .../pay/cs_..} │<───────────────────────────┤                     │
     │<───────────────────────┤                            │                     │
     │                                                     │                     │
  usuario abre la url, aprieta "Pagar" ───────────────────>│                     │
     │                                                     │                     │
     │                        │  POST /payments/webhook    │                     │
     │                        │  header stripe-signature   │                     │
     │                        │<───────────────────────────┤                     │
     │                        │                            │                     │
     │                        │  emit('payment.succeeded') ─── NATS ────────────>│
     │                        │                            │        marca la orden PAID
     │  302 a success_url  <──────────────────────────────┤                     │
```

Puntos a remarcar:

- El webhook es **server → server**. No depende de que el navegador del usuario vuelva al
  `success_url`; si el usuario cierra la pestaña, el pago igual se registra. Por eso la orden
  se marca pagada en el webhook y **no** en `GET /payments/success`.
- `payments-ms` responde `200` al webhook **rápido** y con `emit()` (fire-and-forget), no con
  `send()`. Si tarda o falla, el proveedor reintenta.

---

## 4. API del fake-stripe

Base: `http://localhost:3003/v1` (mismo proceso, prefijo distinto).

### `POST /v1/checkout/sessions`

Request (subconjunto de la API real, en **centavos**):

```json
{
  "currency": "usd",
  "line_items": [
    { "price_data": { "currency": "usd", "product_data": { "name": "Teclado" }, "unit_amount": 1500 }, "quantity": 2 }
  ],
  "mode": "payment",
  "metadata": { "orderId": "3f2a...-uuid" },
  "success_url": "http://localhost:3003/payments/success",
  "cancel_url": "http://localhost:3003/payments/cancel"
}
```

Response `201`:

```json
{
  "id": "cs_test_a1b2c3d4e5",
  "object": "checkout.session",
  "amount_total": 3000,
  "currency": "usd",
  "status": "open",
  "payment_status": "unpaid",
  "metadata": { "orderId": "3f2a...-uuid" },
  "url": "http://localhost:3003/v1/checkout/pay/cs_test_a1b2c3d4e5"
}
```

Las sesiones viven en memoria (`Map<string, Session>`). Se reinician con el servicio: es un
fake, no hace falta base de datos.

### `GET /v1/checkout/pay/:sessionId`

Devuelve un HTML mínimo (el "Checkout hosteado"): detalle de los ítems, total, y dos botones
que postean a `/v1/checkout/pay/:sessionId/confirm` con `action=pay` o `action=cancel`.

### `POST /v1/checkout/pay/:sessionId/confirm`

1. Marca la sesión `complete` / `expired`.
2. Si fue pago: arma el evento `checkout.session.completed`, lo firma y lo `POST`ea a
   `STRIPE_WEBHOOK_URL`.
3. Redirige (`302`) al `success_url` o `cancel_url` de la sesión.

El webhook se dispara **antes** del redirect pero sin esperar su resultado. Vale simular el
retardo real con un `setTimeout` corto.

---

## 5. El evento y la firma

Evento (`POST` al webhook, `Content-Type: application/json`):

```json
{
  "id": "evt_1a2b3c",
  "object": "event",
  "type": "checkout.session.completed",
  "created": 1753400000,
  "data": {
    "object": {
      "id": "cs_test_a1b2c3d4e5",
      "object": "checkout.session",
      "amount_total": 3000,
      "currency": "usd",
      "payment_status": "paid",
      "payment_intent": "pi_9z8y7x",
      "metadata": { "orderId": "3f2a...-uuid" }
    }
  }
}
```

Header, mismo formato que Stripe:

```
stripe-signature: t=1753400000,v1=<hex hmac-sha256>
```

La firma se calcula sobre el **string exacto** que se envía como body:

```ts
const payload = `${timestamp}.${rawBody}`;
const v1 = createHmac('sha256', WEBHOOK_SECRET).update(payload).digest('hex');
```

Verificación en `payments-ms` (`constructEvent`):

1. Parsear el header en `t` y `v1`.
2. Recalcular el HMAC con el **raw body**, no con el objeto ya parseado.
   `JSON.stringify(req.body)` **no** sirve: puede reordenar o reespaciar y la firma no cierra.
3. Comparar con `timingSafeEqual` (no `===`).
4. Rechazar si `|now - t| > 300s` (tolerancia de 5 minutos, protege contra replay).
5. Cualquier fallo → `400`, sin tocar nada más.

Para tener el raw body en Nest:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true });
// en el controller: @Req() req: RawBodyRequest<Request>  →  req.rawBody
```

---

## 6. API REST de `payments-ms`

| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/payments/create-payment-session` | Crea la sesión contra el fake y devuelve `{ cancelUrl, successUrl, url }` |
| `GET` | `/payments/success` | Landing post-pago. **Solo informativa** |
| `GET` | `/payments/cancel` | Landing de cancelación |
| `POST` | `/payments/webhook` | Recibe el evento firmado. Verifica → emite por NATS → `200 { received: true }` |

Los tres primeros ya existen como stubs en `src/payments/payments.controller.ts`; el actual
`fake-webhook-stripe` pasa a ser `webhook`.

DTO de entrada (`PaymentSessionDto`), con `class-validator`:

```ts
orderId: string;              // @IsUUID()
currency: string;             // @IsString()
items: PaymentSessionItemDto[]; // @IsArray() @ValidateNested({ each: true }) @Type(...)
// item: name: string, price: number (@IsPositive), quantity: number (@IsPositive @IsInt)
```

Ojo: los precios llegan en unidades (`15.00`) y Stripe trabaja en centavos →
`Math.round(price * 100)` al armar `unit_amount`. Redondear **una sola vez**, por ítem.

---

## 7. Aplicación híbrida (REST + NATS)

`main.ts` queda así:

```ts
const app = await NestFactory.create(AppModule, { rawBody: true });

app.setGlobalPrefix('api');   // opcional; si se pone, actualizar las urls del fake
app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));

app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.NATS,
  options: { servers: envs.natsServers },
});

await app.startAllMicroservices();
await app.listen(envs.port);
```

Mensajes NATS:

- **Recibe** `@MessagePattern('create.payment.session')` → misma lógica que el `POST` REST.
  Así el gateway puede pedir la sesión por NATS y el webhook sigue entrando por HTTP.
- **Emite** `@Payload` en `client.emit('payment.succeeded', { stripePaymentId, orderId, receiptUrl })`.
  `orders-ms` se suscribe con `@EventPattern('payment.succeeded')` y marca la orden como pagada.

`emit` y no `send`: el webhook no necesita respuesta de `orders-ms`, y bloquearlo haría que el
proveedor reintente por timeout.

El cliente NATS se registra en `PaymentsModule` con el token `NATS_SERVICE`
(`src/config/services.ts` ya lo exporta), igual que en `orders-ms`.

---

## 8. Variables de entorno

Agregar a la interfaz **y** al schema Joi de `src/config/envs.ts` (si falta una, el servicio
no arranca — es un error duro, no un warning):

```
PORT=3003
NATS_SERVERS=nats://localhost:4222
STRIPE_API_URL=http://localhost:3003/v1          # el fake; en docker: http://payments-ms:3003/v1
STRIPE_WEBHOOK_URL=http://localhost:3003/payments/webhook
STRIPE_WEBHOOK_SECRET=whsec_fake_local_secret
STRIPE_SUCCESS_URL=http://localhost:3003/payments/success
STRIPE_CANCEL_URL=http://localhost:3003/payments/cancel
```

En `docker-compose.yml` las URLs usan el nombre del servicio (`payments-ms`), no `localhost`:
dentro del contenedor `localhost` es el contenedor mismo — acá funciona porque el fake vive en
el mismo proceso, pero conviene escribirlo bien desde el principio.

---

## 9. Estructura de archivos

```
src/
├── main.ts                       # rawBody: true (+ NATS cuando sea híbrido)
├── app.module.ts
├── config/
│   ├── envs.ts                   # + STRIPE_*
│   └── services.ts               # NATS_SERVICE
├── payments/
│   ├── payments.controller.ts    # create-payment-session, success, cancel, webhook
│   ├── payments.service.ts       # fetch al fake + constructEvent() (firma)
│   ├── payments.module.ts
│   └── dto/payment-session.dto.ts
└── fake-stripe/                  # "el tercero". No lo importa nadie de payments/
    ├── fake-stripe.controller.ts # /v1/checkout/...
    ├── fake-stripe.service.ts    # Map de sesiones, firma y disparo del webhook
    ├── fake-stripe.module.ts
    ├── fake-stripe.types.ts      # CheckoutSession, StripeEvent (nombres de Stripe)
    └── checkout.template.ts      # HTML del checkout
```

La interfaz `StripeGateway` de la sección 2 quedó implícita: `payments.service.ts` habla por
`fetch` contra `envs.stripeApiUrl` y no importa nada del módulo `fake-stripe` salvo los tipos.
Cuando aparezca el Stripe real, ahí sí conviene extraer la interfaz.

Nota de TypeScript: con `isolatedModules` + `emitDecoratorMetadata`, los tipos usados en
parámetros decorados (`@Body() body: PaymentSessionDto`, `@Res() res: Response`) tienen que
importarse con `import type`, o `nest build` falla con `TS1272`.

---

## 10. Orden de implementación

1. ✅ `envs.ts` con las `STRIPE_*` + `main.ts` con `rawBody: true`.
2. ✅ Módulo `fake-stripe`: crear sesión + `GET` del HTML.
3. ✅ Firma HMAC y disparo del webhook desde el fake.
4. ✅ `constructEvent()` + `POST /payments/webhook` que loguea el evento verificado.
5. ✅ `PaymentsService.createPaymentSession()` por HTTP contra el fake.
6. Convertir a híbrido: `connectMicroservice` + `@MessagePattern('create.payment.session')`.
7. `emit('payment.succeeded')` en el webhook y `@EventPattern` del lado de `orders-ms`.
8. Endpoint en `client-gateway` que reenvía por NATS.
9. `dockerfile` + servicio en `docker-compose.yml` (`depends_on: nats-server`).

## 11. Pruebas rápidas con curl

```bash
# 1. crear sesión
curl -s -X POST http://localhost:3003/payments/create-payment-session \
  -H 'Content-Type: application/json' \
  -d '{"orderId":"11111111-1111-1111-1111-111111111111","currency":"usd",
       "items":[{"name":"Teclado","price":15,"quantity":2}]}'

# 2. abrir la url devuelta en el navegador y apretar "Pagar"

# 3. webhook con firma inválida → 400
curl -i -X POST http://localhost:3003/payments/webhook \
  -H 'Content-Type: application/json' -H 'stripe-signature: t=123,v1=deadbeef' \
  -d '{"type":"checkout.session.completed"}'
```

Para firmar a mano un payload de prueba:

```bash
node -e 'const c=require("crypto");const b=process.argv[1];const t=Math.floor(Date.now()/1000);
console.log(`t=${t},v1=`+c.createHmac("sha256","whsec_fake_local_secret").update(`${t}.${b}`).digest("hex"))' \
  '{"type":"checkout.session.completed"}'
```

---

## 12. Cosas que suelen fallar

- **Firma inválida siempre** → se está firmando/verificando sobre el objeto parseado en vez del
  raw body, o falta `rawBody: true` en `NestFactory.create`.
- **`ValidationPipe` rechaza el evento del webhook.** El pipe global corre con
  `forbidNonWhitelisted: true`; el body del webhook no debe pasar por un DTO — tomarlo del raw
  body y tipar el evento a mano.
- **La orden nunca se marca pagada** aunque el pago "funcionó" → se está actualizando en
  `success_url` en vez del webhook, o se usó `send()` en lugar de `emit()` y quedó esperando.
- **`EmptyResponseException: no subscribers listening`** → el pattern NATS de un lado no coincide
  exacto con el del otro. Son strings, no hay chequeo en compilación.
- **Centavos vs unidades**: `amount_total` en centavos, precios de `products-ms` en unidades.
  Convertir en un solo lugar (al armar el `line_item`).
