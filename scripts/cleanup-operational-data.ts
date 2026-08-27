import { createDatabase } from "../server/db";
import { createLocalPrivateStorage } from "../server/storage";
import { cleanupExpiredObjects } from "../server/operations";

const db = createDatabase();
try {
  const result = await cleanupExpiredObjects(db, createLocalPrivateStorage());
  console.log(JSON.stringify({ ok: true, ...result }));
} finally {
  db.close();
}
