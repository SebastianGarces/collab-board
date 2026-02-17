import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { db } from "../db/client";
import { schema } from "../db/schema";
import { corsOrigins, env } from "../env";

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
      enabled: true,
      domain: ".gsgarces.dev"
    },
    defaultCookieAttributes: {
      secure: true,
      sameSite: "lax"
    }
  }
});
