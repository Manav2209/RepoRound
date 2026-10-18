import { z } from "zod";

const envSchema = z.object({
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
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000"),
  INTERVIEW_DURATION_MINUTES: z.coerce
    .number()
    .int()
    .min(5)
    .max(60)
    .default(30),
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

/**
 * The evaluation worker only needs the database, model router, and queue
 * settings, so it must not be forced to supply LiveKit or CORS credentials.
 */
const workerEnvSchema = envSchema.pick({
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
