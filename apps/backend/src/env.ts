import { z } from "zod";

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  OPENAI_API_KEY: z.string().min(1),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.string().optional(),
});

export const env = envSchema.parse(process.env);

export const corsOrigins = env.CORS_ORIGIN.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
      return `https://${origin}`;
    }
    return origin.replace(/\/$/, "");
  });

