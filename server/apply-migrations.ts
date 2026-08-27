import { createDatabase } from "./db";

const db = createDatabase();
const applied = db.prepare("SELECT version, applied_at AS appliedAt FROM schema_migrations ORDER BY version").all();
console.log(JSON.stringify({ appliedMigrations: applied }, null, 2));
db.close();
