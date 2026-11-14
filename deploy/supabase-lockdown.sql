-- Só para quem usa a Supabase como base de dados.
-- A Supabase publica automaticamente uma API (PostgREST) para todas as tabelas do esquema "public".
-- A Tchilar não usa essa API — só o servidor Node fala com a base de dados —, por isso fechamos tudo:
-- RLS ligado sem políticas = os papéis "anon" e "authenticated" da API não leem nem escrevem nada.
-- O servidor da Tchilar liga-se como dono das tabelas (utilizador "postgres"), que não é afetado pelo RLS.
--
-- Corre no SQL Editor da Supabase DEPOIS das migrações (npm run db:migrate) e volta a correr
-- sempre que uma migração nova criar tabelas.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;

-- Tabelas criadas no futuro também ficam fechadas para a API.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;

-- Verificação: deve devolver 0 linhas.
SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity;
