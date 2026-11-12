// Dá (ou retira) acesso ao painel de moderação a uma conta existente.
// Uso: npm run admin:grant -- email@exemplo.com
//      npm run admin:grant -- email@exemplo.com --revoke
require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  if (!email || !email.includes("@")) {
    console.error("Indica o email da conta: npm run admin:grant -- email@exemplo.com [--revoke]");
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      "UPDATE users SET is_admin=$1 WHERE email=$2 RETURNING username",
      [!revoke, email]);
    if (!result.rowCount) {
      console.error("Nenhuma conta encontrada com esse email.");
      process.exitCode = 1;
      return;
    }
    console.log(`@${result.rows[0].username} ${revoke ? "deixou de ter" : "tem agora"} acesso à moderação.`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("Falhou:", error.message);
  process.exitCode = 1;
});
