import { Elysia } from "elysia";

import { auth } from "./auth";

export const betterAuthPlugin = new Elysia({ name: "better-auth" })
  .mount(auth.handler)
  .macro({
    auth: {
      async resolve({ request, status }) {
        const session = await auth.api.getSession({
          headers: request.headers
        });

        if (!session) {
          return status(401, { error: "Unauthorized" });
        }

        return {
          user: session.user,
          session: session.session
        };
      }
    }
  });
