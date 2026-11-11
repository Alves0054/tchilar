const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

async function runMigrations(pool, directory = path.join(__dirname, "migrations")) {
  const files = fs.readdirSync(directory)
    .filter(file => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort();
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await client.query("SELECT pg_advisory_lock($1)", [714035281]);
    try {
      for (const file of files) {
        const sql = fs.readFileSync(path.join(directory, file), "utf8");
        const checksum = crypto.createHash("sha256").update(sql).digest("hex");
        const applied = await client.query(
          "SELECT checksum FROM schema_migrations WHERE version=$1",
          [file]);
        if (applied.rowCount) {
          if (applied.rows[0].checksum !== checksum) {
            throw new Error(`Applied migration ${file} has been modified.`);
          }
          continue;
        }

        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
            [file, checksum]);
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [714035281]);
    }
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
