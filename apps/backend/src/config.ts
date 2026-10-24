import { z } from "zod";

const baseEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  DATABASE_URL: z.string().min(1),
  AI_ROUTER_BASE_URL: z.string().url(),
  AI_ROUTER_API_KEY: z.string().min(1),
  AI_ROUTER_MODEL: z.string().min(1),
  LLM_TEMPERATURE: z.coerce.number().default(0.4),
  LIVEKIT_URL: z.string().url(),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  INTERNAL_API_TOKEN: z.string().min(1),
  TRUSTED_PROXY_TOKEN: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  BETTER_AUTH_SECRET: z.string().min(32),
  AUTH_TRUSTED_ORIGINS: z.string().optional(),
  AUTH_COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  AUTH_SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  RESEND_API_KEY: z.string().min(1).optional(),
  AUTH_EMAIL_FROM: z.string().min(1).optional(),
  AUTH_EMAIL_REPLY_TO: z.string().email().optional(),
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  GITHUB_CLIENT_ID: z.string().min(1).optional(),
  GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
  SYSTEM_DESIGN_INTERVIEW_DURATION_MINUTES: z.coerce
    .number()
    .int()
    .min(10)
    .max(15)
    .default(15),
  GITHUB_INTERVIEW_DURATION_MINUTES: z.coerce
    .number()
    .int()
    .min(10)
    .max(15)
    .default(15),
  RECONNECT_WINDOW_SECONDS: z.coerce
    .number()
    .int()
    .min(30)
    .max(900)
    .default(300),
  LANGFUSE_BASE_URL: z.string().url().optional(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  FALKORDB_HOST: z.string().min(1).default("localhost"),
  FALKORDB_PORT: z.coerce.number().int().positive().default(6379),
  FALKORDB_GRAPH: z.string().min(1).default("ai_interviewer"),
  BULLMQ_REDIS_URL: z.string().url().default("redis://localhost:6380"),
  EVALUATION_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),
});

const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  for (const [idKey, secretKey] of [
    ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"],
  ] as const) {
    if (Boolean(env[idKey]) !== Boolean(env[secretKey])) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [secretKey],
        message: `${idKey} and ${secretKey} must be configured together`,
      });
    }
  }
  if (env.NODE_ENV === "production" && !env.RESEND_API_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["RESEND_API_KEY"],
      message: "Email delivery is required in production",
    });
  }
  if (env.NODE_ENV === "production" && !env.AUTH_EMAIL_FROM) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_EMAIL_FROM"],
      message: "AUTH_EMAIL_FROM is required in production",
    });
  }
  if (env.RESEND_API_KEY && !env.AUTH_EMAIL_FROM) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AUTH_EMAIL_FROM"],
      message: "AUTH_EMAIL_FROM is required when Resend is configured",
    });
  }
});

/**
 * The evaluation worker only needs the database, model router, and queue
 * settings, so it must not be forced to supply LiveKit or CORS credentials.
 */
const workerEnvSchema = baseEnvSchema.pick({
  DATABASE_URL: true,
  AI_ROUTER_BASE_URL: true,
  AI_ROUTER_API_KEY: true,
  AI_ROUTER_MODEL: true,
  LLM_TEMPERATURE: true,
  BULLMQ_REDIS_URL: true,
  EVALUATION_WORKER_CONCURRENCY: true,
});

export type BackendConfig = z.infer<typeof envSchema>;
export type WorkerConfig = z.infer<typeof workerEnvSchema>;

function parseEnv<S extends z.ZodTypeAny>(
  schema: S,
  env: NodeJS.ProcessEnv,
): z.infer<S> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(
      `Missing or invalid environment variables (${issues}). ` +
        `Copy the app's .env.example to .env and fill in the values.`,
    );
  }
  return parsed.data;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
): BackendConfig {
  return parseEnv(envSchema, env);
}

export function loadWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  return parseEnv(workerEnvSchema, env);
}
