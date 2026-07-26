import "dotenv/config";
import * as Joi from "joi";

// PRODUCTS_MICROSERVICES_HOST/PORT quedaron de la etapa TCP: ya no las lee nadie
// (la comunicación va por NATS), pero al seguir siendo `required()` rompían el arranque
// en Docker, donde no se definen.
interface EnvVars {
    PORT: number;
    NATS_SERVERS: string[];
    STRIPE_API_URL: string;
    STRIPE_WEBHOOK_URL: string;
    STRIPE_WEBHOOK_SECRET: string;
    STRIPE_SUCCESS_URL: string;
    STRIPE_CANCEL_URL: string;
}

const envsSchema = Joi.object({
    PORT: Joi.number().required(),
    NATS_SERVERS: Joi.array().items(Joi.string()).required(),
    STRIPE_API_URL: Joi.string().required(),
    STRIPE_WEBHOOK_URL: Joi.string().required(),
    STRIPE_WEBHOOK_SECRET: Joi.string().required(),
    STRIPE_SUCCESS_URL: Joi.string().required(),
    STRIPE_CANCEL_URL: Joi.string().required(),
}).unknown(true);

const { error, value } = envsSchema.validate({
    ...process.env,
    NATS_SERVERS: process.env.NATS_SERVERS?.split(','),
});

if (error) {
    throw new Error("Invalid environment variables");
}

const envVars: EnvVars = value;

export const envs = {
    port: envVars.PORT,
    natsServers: envVars.NATS_SERVERS,
    stripeApiUrl: envVars.STRIPE_API_URL,
    stripeWebhookUrl: envVars.STRIPE_WEBHOOK_URL,
    stripeWebhookSecret: envVars.STRIPE_WEBHOOK_SECRET,
    stripeSuccessUrl: envVars.STRIPE_SUCCESS_URL,
    stripeCancelUrl: envVars.STRIPE_CANCEL_URL,
}
