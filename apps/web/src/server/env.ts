import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: z.string().default("local"),
  APP_BASE_URL: z.string().url(),
  AWS_REGION: z.string().default("us-east-1"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(5432),
  DB_NAME: z.string().min(1).default("theckards"),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DOCUMENTS_BUCKET: z.string().min(3),
  DATA_KEY_ARN: z.string().startsWith("arn:"),
  SEAL_KEY_ARN: z.string().startsWith("arn:"),
  AUTH_HMAC_SECRET: z.string().min(32),
  EMAIL_HASH_SECRET: z.string().min(32),
  USER_POOL_ID: z.string().min(1),
  USER_POOL_CLIENT_ID: z.string().min(1),
  USER_POOL_CLIENT_SECRET: z.string().min(1),
  COGNITO_DOMAIN: z.string().url(),
  APPCONFIG_APPLICATION_ID: z.string().min(1),
  APPCONFIG_ENVIRONMENT_ID: z.string().min(1),
  APPCONFIG_PROFILE_ID: z.string().min(1),
  APPCONFIG_DEPLOYMENT_STRATEGY_ID: z.string().min(1),
});

export type AppEnv = z.infer<typeof EnvSchema>;
let cached: AppEnv | undefined;

export function env(): AppEnv {
  cached ??= EnvSchema.parse(process.env);
  return cached;
}
