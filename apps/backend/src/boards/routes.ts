import { eq } from "drizzle-orm";
import { Elysia } from "elysia";

import { auth } from "../auth/auth";
import { db } from "../db/client";
import { board } from "../db/schema";
import { CreateBoardBody, UpdateBoardBody, stripHtmlTags } from "@collab/shared/validation";

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

    // Sanitize and use the name if provided, otherwise "Untitled"
    const sanitizedName = body.name ? stripHtmlTags(body.name).trim() : "Untitled";
    const finalName = sanitizedName || "Untitled";
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    await db.insert(board).values({
      id,
      name: finalName,
      ownerId: session.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    return { id, name: finalName };
  }, {
    body: CreateBoardBody
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

    // Sanitize and trim the name
    const sanitizedName = stripHtmlTags(body.name).trim();

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
      .set({ name: sanitizedName, updatedAt: now })
      .where(eq(board.id, params.id));

    return { id: params.id, name: sanitizedName };
  }, {
    body: UpdateBoardBody
  });
