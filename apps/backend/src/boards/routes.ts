import { Elysia } from "elysia";
import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { board } from "../db/schema";
import { auth } from "../auth/auth";

export const boardRoutes = new Elysia({ name: "board-routes" })
  .get("/api/boards", async ({ request, status }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return status(401, { error: "Unauthorized" });
    }

    const boards = await db
      .select({
        id: board.id,
        name: board.name,
        ownerId: board.ownerId,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
      })
      .from(board)
      .orderBy(board.updatedAt);

    return { boards };
  })
  .post("/api/boards", async ({ request, status, body }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return status(401, { error: "Unauthorized" });
    }

    const { name } = (body ?? {}) as { name?: string };
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    await db.insert(board).values({
      id,
      name: name ?? "Untitled",
      ownerId: session.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { id, name: name ?? "Untitled" };
  });
