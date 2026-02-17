import { eq } from "drizzle-orm";
import { Elysia } from "elysia";

import { auth } from "../auth/auth";
import { db } from "../db/client";
import { board } from "../db/schema";

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
      .where(eq(board.ownerId, session.user.id))
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
  })
  .delete("/api/boards/:id", async ({ request, params, status }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return status(401, { error: "Unauthorized" });
    }

    const existing = await db
      .select({ id: board.id, ownerId: board.ownerId })
      .from(board)
      .where(eq(board.id, params.id))
      .limit(1);

    if (!existing.length) {
      return status(404, { error: "Not found" });
    }

    if (existing[0].ownerId !== session.user.id) {
      return status(403, { error: "Forbidden" });
    }

    await db.delete(board).where(eq(board.id, params.id));
    return { ok: true };
  })
  .patch("/api/boards/:id", async ({ request, params, status, body }) => {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) {
      return status(401, { error: "Unauthorized" });
    }

    const { name } = (body ?? {}) as { name?: string };
    const trimmed = (name ?? "").trim();
    if (!trimmed) {
      return status(400, { error: "Name is required" });
    }

    const existing = await db
      .select({ id: board.id, ownerId: board.ownerId })
      .from(board)
      .where(eq(board.id, params.id))
      .limit(1);

    if (!existing.length) {
      return status(404, { error: "Not found" });
    }

    if (existing[0].ownerId !== session.user.id) {
      return status(403, { error: "Forbidden" });
    }

    const now = new Date();
    await db
      .update(board)
      .set({ name: trimmed, updatedAt: now })
      .where(eq(board.id, params.id));

    return { id: params.id, name: trimmed };
  });
