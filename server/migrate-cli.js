require("dotenv").config();

const { Pool } = require("pg");
const { runMigrations } = require("./migrate");

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não está definido. Configura o ficheiro .env.");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await runMigrations(pool);
    console.log("Migrações da base de dados aplicadas.");
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("Database migration failed:", error.message);
  process.exitCode = 1;
});
