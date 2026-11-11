# Creator Social

Rede social de criadores com feed, perfis, amizades, grupos, páginas, eventos e mensagens.

## Funcionalidades

- Registo, login, confirmação de email e recuperação de palavra-passe
- Perfis, feed, publicações de texto, imagem e vídeo, gostos e comentários
- Amizades, sugestões, grupos, páginas, eventos e notificações
- Mensagens privadas e subscrições
- Upload de ficheiros; publicações exclusivas e de grupos verificam autorização
- API REST em Express e PostgreSQL, com migrações versionadas

## Requisitos

- Node.js 20+
- PostgreSQL 15+ (ou Docker Desktop)

## Desenvolvimento no Windows

Instala as dependências:

```powershell
npm install
```

Para criar uma base de dados e um utilizador locais, executa o script. Introduz a palavra-passe de administrador PostgreSQL diretamente no prompt seguro; não a partilhes nem a coloques no chat.

```powershell
npm run db:setup
```

O script cria `.env` apenas se ainda não existir, gera segredos locais, cria/verifica `creator_social` e testa a ligação. Se já tiveres `.env`, preserva-o e configura a base de dados manualmente.

Inicia frontend e backend:

```powershell
npm run dev
```

Abre <http://localhost:5173>. No desenvolvimento, o Vite encaminha pedidos `/api` e `/uploads` para a API local. Assim, a aplicação também funciona quando aberta a partir de outro dispositivo pela rede local, sem tentar contactar o `localhost` desse dispositivo. O backend aplica as migrações pendentes no arranque. Para as aplicar sem iniciar o servidor:

```powershell
npm run db:migrate
```

O endpoint `/api/health/ready` verifica a ligação PostgreSQL.

Para preparar uma demonstração local sem palavra-passe de administrador PostgreSQL, usa no VS Code a tarefa **Preparar NOVA+ (base de dados + perfil demo)**. Ela cria uma instância PostgreSQL isolada em `%LOCALAPPDATA%\NOVAPlus\PostgreSQL17`, numa porta própria, e preserva qualquer instância/base de dados PostgreSQL existente. Depois executa **Iniciar NOVA+ (frontend + API)**.

### Perfil de demonstração

Depois de configurar a base de dados local, cria um perfil de demonstração com publicações de exemplo:

```powershell
npm run db:seed-demo
```

Inicia sessão em <http://localhost:5173/login> com:

- Email: `demo@nova-plus.test`
- Palavra-passe: `NOVA+Demo2026`

O perfil `@nova_demo` e as publicações também ficam disponíveis em <http://localhost:5173/u/nova_demo>. O comando recusa ambientes de produção e bases de dados que não sejam locais; voltar a executá-lo repõe a palavra-passe de demonstração e não duplica as publicações de exemplo.

## Docker

Com Docker Desktop ativo, cria `.env` a partir do `.env.example` e define `POSTGRES_PASSWORD` e `JWT_SECRET` com valores aleatórios. Depois:

```powershell
docker compose up --build
```

A aplicação fica em <http://localhost:4000> e a base de dados fica acessível localmente na porta `5433`, evitando conflito com uma instalação PostgreSQL local na porta `5432`. Os dados PostgreSQL e uploads persistem em volumes Docker.

Para publicar atrás de um domínio, define `PUBLIC_APP_URL` e `PUBLIC_CLIENT_URL` no `.env`, configura `NODE_ENV=production`, SMTP e os domínios permitidos antes de iniciar. Usa HTTPS e um proxy reverso; não exponhas diretamente a porta PostgreSQL. Em produção, o arranque exige configuração SMTP válida para envio de confirmação e recuperação.

## Email e autenticação

Configura estas variáveis no `.env` para enviar emails:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=utilizador-smtp
SMTP_PASSWORD=palavra-passe-smtp
SMTP_FROM="Creator Social <no-reply@example.com>"
APP_URL=https://social.example.com
CLIENT_URL=https://social.example.com
```

Em desenvolvimento, sem SMTP, os endpoints de registo/recuperação devolvem um link de teste. Em produção, SMTP, `SMTP_FROM`, `APP_URL` e `CLIENT_URL` são obrigatórios. Tokens de email e recuperação expiram após uma hora; redefinir a palavra-passe invalida sessões existentes. Tokens de sessão expiram após 12 horas.

As migrações ficam em `server/migrations`. Uma migração já aplicada é protegida por checksum: não edites ficheiros aplicados; cria uma nova migração numerada.

## Subscrições pagas (Stripe)

Os criadores definem o preço mensal (1 € a 1000 €) em **Definições → Editar perfil** e podem marcar publicações como **Só para subscritores**. O acesso ao conteúdo exclusivo depende de uma subscrição com `status='active'` e um período pago ainda válido (`current_period_end`).

- **Sem `STRIPE_SECRET_KEY`, em desenvolvimento:** subscrever cria uma subscrição de demonstração de 30 dias, sem pagamento.
- **Sem `STRIPE_SECRET_KEY`, em produção:** subscrever devolve 503. Ninguém obtém acesso sem pagar.
- **Com Stripe:** `POST /api/subscriptions/:creatorId` devolve `checkoutUrl` (Stripe Checkout). A subscrição só fica ativa quando o webhook confirma o pagamento.

Para testar localmente com chaves de teste da Stripe:

```powershell
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Copia o `whsec_...` mostrado para `STRIPE_WEBHOOK_SECRET`. Em produção, cria o endpoint `https://<domínio>/api/webhooks/stripe` no painel da Stripe com os eventos `checkout.session.completed` e `customer.subscription.created/updated/deleted`.

`DELETE /api/subscriptions/:creatorId` cancela a renovação; o acesso mantém-se até ao fim do período pago. Voltar a subscrever antes desse fim retoma a renovação.

**Limitação atual:** os pagamentos entram na conta Stripe da plataforma. Para pagar automaticamente aos criadores é preciso Stripe Connect.

## Verificação

```powershell
npm test
npm run build
```

## API

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `POST /api/auth/verify-email`, `POST /api/auth/verify-email/resend`
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`
- `GET /api/health`, `GET /api/health/ready`
- Posts, comentários, amizades, grupos, páginas, eventos, subscrições, notificações e mensagens em `/api`

Antes de lançar um serviço público, configura Stripe (ver acima), moderação, política de retenção e privacidade, armazenamento de uploads apropriado e rate limiting partilhado entre instâncias (o limitador atual é em memória).
