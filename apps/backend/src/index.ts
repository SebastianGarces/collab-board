import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

import { betterAuthPlugin } from "./auth/plugin";
import { auth } from "./auth/auth";
import { collabWsPlugin } from "./collab/ws";
import { boardRoutes } from "./boards/routes";
import { corsOrigins, env } from "./env";

const app = new Elysia()
  .use(
    cors({
      origin: corsOrigins,
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
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
