// Dá (ou retira) acesso ao painel de moderação a uma conta existente.
// Uso: npm run admin:grant -- email@exemplo.com                  (administração total)
//      npm run admin:grant -- email@exemplo.com --role=finance     (finance | moderation | super)
//      npm run admin:grant -- email@exemplo.com --revoke
require("dotenv").config();
const { Pool } = require("pg");

async function main() {
  const email = (process.argv[2] || "").trim().toLowerCase();
  const revoke = process.argv.includes("--revoke");
  const roleArg = process.argv.find(arg => arg.startsWith("--role="));
  const role = roleArg ? roleArg.slice("--role=".length) : "super";
  if (!["super", "finance", "moderation"].includes(role)) {
    console.error("Função inválida: usa --role=super, --role=finance ou --role=moderation.");
    process.exitCode = 1;
    return;
  }
  if (!email || !email.includes("@")) {
    console.error("Indica o email da conta: npm run admin:grant -- email@exemplo.com [--revoke]");
    process.exitCode = 1;
    return;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await pool.query(
      "UPDATE users SET is_admin=$1, admin_role=$3, auth_version=auth_version + CASE WHEN $1 THEN 0 ELSE 1 END WHERE email=$2 RETURNING username",
      [!revoke, email, revoke ? null : role]);
    if (!result.rowCount) {
      console.error("Nenhuma conta encontrada com esse email.");
      process.exitCode = 1;
      return;
    }
    console.log(revoke ? `@${result.rows[0].username} deixou de estar na equipa.` : `@${result.rows[0].username} está agora na equipa (${role}).`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("Falhou:", error.message);
  process.exitCode = 1;
});
