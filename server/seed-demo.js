require("dotenv").config();

const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { runMigrations } = require("./migrate");

const demoAccount = {
  username: "biva_demo",
  email: "demo@biva.test",
  password: "Biva+Demo2026",
  displayName: "Rita Martins",
  bio: "A descobrir pessoas, ideias e momentos na comunidade Biva."
};

const demoPosts = [
  "Olá, comunidade Biva! Estou aqui para partilhar ideias, descobrir novos projetos e conhecer pessoas.",
  "Pequenos momentos também contam. Hoje reservei um tempo para criar algo novo e gostei do resultado.",
  "Que projeto ou ideia vos tem inspirado esta semana? Adorava descobrir o que andam a criar."
];

const demoStories = [
  "Um novo dia, novas ideias para partilhar.",
  "Hoje escolho fazer espaço para a criatividade.",
  "Que bom encontrar-vos por aqui. ✨"
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("A conta de demonstração só pode ser criada fora de produção.");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL não está definido. Configura a base de dados local primeiro.");
  }
  let databaseHost;
  try {
    databaseHost = new URL(process.env.DATABASE_URL).hostname;
  } catch {
    throw new Error("DATABASE_URL inválido.");
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(databaseHost)) {
    throw new Error("A conta de demonstração só pode ser criada numa base de dados local.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await runMigrations(pool);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const passwordHash = await bcrypt.hash(demoAccount.password, 12);
      const result = await client.query(`
        INSERT INTO users(username,email,password_hash,display_name,bio,is_creator,subscription_price,email_verified)
        VALUES($1,$2,$3,$4,$5,FALSE,0,TRUE)
        ON CONFLICT(username) DO UPDATE SET
          email=EXCLUDED.email,
          password_hash=EXCLUDED.password_hash,
          display_name=EXCLUDED.display_name,
          bio=EXCLUDED.bio,
          email_verified=TRUE,
          auth_version=users.auth_version+1
        RETURNING id
      `, [
        demoAccount.username,
        demoAccount.email,
        passwordHash,
        demoAccount.displayName,
        demoAccount.bio
      ]);
      const userId = result.rows[0].id;

      for (const body of demoPosts) {
        await client.query(`
          INSERT INTO posts(user_id,body)
          SELECT $1,$2
          WHERE NOT EXISTS (SELECT 1 FROM posts WHERE user_id=$1 AND body=$2)
        `, [userId, body]);
      }

      for (const body of demoStories) {
        await client.query(`
          INSERT INTO stories(user_id,body)
          SELECT $1,$2::varchar(500)
          WHERE NOT EXISTS (
            SELECT 1 FROM stories
            WHERE user_id=$1 AND body=$2::varchar(500) AND expires_at>NOW()
          )
        `, [userId, body]);
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    console.log("Perfil de demonstração Biva pronto.");
    console.log(`Email: ${demoAccount.email}`);
    console.log(`Palavra-passe: ${demoAccount.password}`);
    console.log(`Perfil: http://localhost:5173/u/${demoAccount.username}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error("Não foi possível criar o perfil de demonstração:", error.message);
  process.exitCode = 1;
});
