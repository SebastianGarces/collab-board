import { db, pool } from "../db/client";
import { board } from "../db/schema";

const PUBLIC_BOARD_ID = "public-demo";

async function main() {
  await db
    .insert(board)
    .values({
      id: PUBLIC_BOARD_ID,
      name: "Public Demo Board",
      ownerId: null,
      isPublic: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: board.id,
      set: { name: "Public Demo Board", isPublic: true, updatedAt: new Date() },
    });

  console.info(`[seed] Public board '${PUBLIC_BOARD_ID}' upserted.`);
}

main()
  .catch((e) => {
    console.error("[seed] failed:", e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
