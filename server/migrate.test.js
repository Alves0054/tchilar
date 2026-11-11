const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { runMigrations } = require("./migrate");

function createPool() {
  const applied = new Map();
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push(sql.trim());
      if (sql.includes("SELECT checksum FROM schema_migrations")) {
        const checksum = applied.get(values[0]);
        return checksum ? { rowCount: 1, rows: [{ checksum }] } : { rowCount: 0, rows: [] };
      }
      if (sql.includes("INSERT INTO schema_migrations")) {
        applied.set(values[0], values[1]);
      }
      if (sql.includes("FAIL MIGRATION")) throw new Error("migration failed");
      return { rowCount: 1, rows: [] };
    },
    release() {
      calls.push("RELEASE");
    }
  };
  return {
    applied,
    calls,
    pool: { connect: async () => client }
  };
}

async function withMigrations(files, operation) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "creator-social-migrations-"));
  try {
    for (const [filename, sql] of Object.entries(files)) {
      fs.writeFileSync(path.join(directory, filename), sql);
    }
    await operation(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test("migrations run in version order and are skipped after being recorded", async () => {
  await withMigrations({
    "002_second.sql": "SELECT 'second';",
    "001_first.sql": "SELECT 'first';"
  }, async directory => {
    const { pool, applied, calls } = createPool();
    await runMigrations(pool, directory);
    assert.deepEqual([...applied.keys()], ["001_first.sql", "002_second.sql"]);
    assert.ok(calls.indexOf("SELECT 'first';") < calls.indexOf("SELECT 'second';"));

    calls.length = 0;
    await runMigrations(pool, directory);
    assert.equal(calls.filter(sql => sql.startsWith("SELECT '")).length, 0);
    assert.ok(calls.some(sql => sql.includes("pg_advisory_unlock")));
  });
});

test("migration failure rolls back and does not record its version", async () => {
  await withMigrations({ "001_failure.sql": "FAIL MIGRATION;" }, async directory => {
    const { pool, applied, calls } = createPool();
    await assert.rejects(runMigrations(pool, directory), /migration failed/);
    assert.equal(applied.has("001_failure.sql"), false);
    assert.ok(calls.includes("ROLLBACK"));
    assert.ok(calls.some(sql => sql.includes("pg_advisory_unlock")));
    assert.ok(calls.includes("RELEASE"));
  });
});

test("applied migration checksum changes stop startup", async () => {
  await withMigrations({ "001_first.sql": "SELECT 'original';" }, async directory => {
    const { pool } = createPool();
    await runMigrations(pool, directory);
    fs.writeFileSync(path.join(directory, "001_first.sql"), "SELECT 'changed';");
    await assert.rejects(runMigrations(pool, directory), /has been modified/);
  });
});
