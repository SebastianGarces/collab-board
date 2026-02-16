import { eq } from "drizzle-orm";

import { db } from "../db/client";
import { board } from "../db/schema";
import type { PersistenceAdapter } from "./room-manager";

function uint8ToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

function base64ToUint8(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}

export const drizzlePersistence: PersistenceAdapter = {
  async loadState(roomId: string): Promise<Uint8Array | null> {
    const result = await db
      .select({ yjsStateB64: board.yjsStateB64 })
      .from(board)
      .where(eq(board.id, roomId))
      .limit(1);

    if (result.length === 0 || !result[0].yjsStateB64) {
      return null;
    }
    return base64ToUint8(result[0].yjsStateB64);
  },

  async saveState(roomId: string, state: Uint8Array): Promise<void> {
    const b64 = uint8ToBase64(state);
    const now = new Date();

    const existing = await db
      .select({ id: board.id })
      .from(board)
      .where(eq(board.id, roomId))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(board).values({
        id: roomId,
        name: roomId,
        yjsStateB64: b64,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await db
        .update(board)
        .set({ yjsStateB64: b64, updatedAt: now })
        .where(eq(board.id, roomId));
    }
  },
};
