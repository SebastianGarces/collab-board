import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "../db/client";
import { schema } from "../db/schema";
import { corsOrigins, env } from "../env";

const isProduction = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: corsOrigins,
  emailAndPassword: {
    enabled: true
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema
  }),
  advanced: {
    crossSubDomainCookies: {
      enabled: isProduction,
      domain: ".gsgarces.dev"
    },
    defaultCookieAttributes: {
      secure: isProduction,
      sameSite: "lax"
    }
  }
});
