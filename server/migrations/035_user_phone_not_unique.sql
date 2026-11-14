-- Sem confirmação por SMS, o número não pode ser único: alguém podia ocupar o número de outra pessoa
-- e a mensagem "já está noutra conta" revelava quem tem conta. A regra volta quando houver verificação.
DROP INDEX IF EXISTS users_phone_unique;
CREATE INDEX IF NOT EXISTS users_phone_idx ON users(phone) WHERE phone IS NOT NULL;
