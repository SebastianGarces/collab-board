import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { auth } from "./auth/auth";
import { betterAuthPlugin } from "./auth/plugin";
import { boardRoutes } from "./boards/routes";
import { collabWsPlugin } from "./collab/ws";
import { corsOrigins, env } from "./env";

const app = new Elysia()
  .use(
    cors({
      origin: corsOrigins,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization", "Cookie"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
    })
  )
  .use(betterAuthPlugin)
  .use(collabWsPlugin)
  .use(boardRoutes)
  .get("/api/health", () => ({
    status: "ok"
  }))
  .get("/api/me", async ({ request, status }) => {
    const session = await auth.api.getSession({
      headers: request.headers
    });

    if (!session) {
      return status(401, {
        error: "Unauthorized"
      });
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name
      }
    };
  })
  .listen({ port: env.PORT, hostname: "0.0.0.0" });

console.log(`Backend listening on http://localhost:${app.server?.port}`);
