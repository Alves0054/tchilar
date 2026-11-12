# Biva

<img src="public/biva-logo-full.png" alt="Biva" width="220">

_Conecta · Partilha · Vive_

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

O script cria `.env` apenas se ainda não existir, gera segredos locais, cria/verifica `biva` e testa a ligação. Se já tiveres `.env`, preserva-o e configura a base de dados manualmente.

Inicia frontend e backend:

```powershell
npm run dev
```

Abre <http://localhost:5173>. No desenvolvimento, o Vite encaminha pedidos `/api` e `/uploads` para a API local. Assim, a aplicação também funciona quando aberta a partir de outro dispositivo pela rede local, sem tentar contactar o `localhost` desse dispositivo. O backend aplica as migrações pendentes no arranque. Para as aplicar sem iniciar o servidor:

```powershell
npm run db:migrate
```

O endpoint `/api/health/ready` verifica a ligação PostgreSQL.

Para preparar uma demonstração local sem palavra-passe de administrador PostgreSQL, usa no VS Code a tarefa **Preparar Biva (base de dados + perfil demo)**. Ela cria uma instância PostgreSQL isolada em `%LOCALAPPDATA%\Biva\PostgreSQL17`, numa porta própria, e preserva qualquer instância/base de dados PostgreSQL existente. Depois executa **Iniciar Biva (frontend + API)**.

### Perfil de demonstração

Depois de configurar a base de dados local, cria um perfil de demonstração com publicações de exemplo:

```powershell
npm run db:seed-demo
```

Inicia sessão em <http://localhost:5173/login> com:

- Email: `demo@biva.test`
- Palavra-passe: `Biva+Demo2026`

O perfil `@biva_demo` e as publicações também ficam disponíveis em <http://localhost:5173/u/biva_demo>. O comando recusa ambientes de produção e bases de dados que não sejam locais; voltar a executá-lo repõe a palavra-passe de demonstração e não duplica as publicações de exemplo.

## Docker

Com Docker Desktop ativo, cria `.env` a partir do `.env.example` e define `POSTGRES_PASSWORD` e `JWT_SECRET` com valores aleatórios. Depois:

```powershell
docker compose up --build
```

A aplicação fica em <http://localhost:4000> e a base de dados fica acessível localmente na porta `5433`, evitando conflito com uma instalação PostgreSQL local na porta `5432`. Os dados PostgreSQL e uploads persistem em volumes Docker.

Para publicar atrás de um domínio, define `PUBLIC_APP_URL` e `PUBLIC_CLIENT_URL` no `.env`, configura `NODE_ENV=production`, SMTP e os domínios permitidos antes de iniciar. Usa HTTPS e um proxy reverso; não exponhas diretamente a porta PostgreSQL. Em produção, o arranque exige configuração SMTP válida para envio de confirmação e recuperação.

**Guia completo para um VPS (AngoWeb ou outro), com HTTPS, cópias de segurança, alertas, TURN e a opção Supabase: [deploy/README.md](deploy/README.md).**

## Segurança

- **Cabeçalhos:** `helmet` envia CSP (só scripts do próprio site, a página não pode ser aberta dentro de outra), HSTS fora de desenvolvimento, `nosniff` e `Permissions-Policy` (câmara e microfone só para o próprio site).
- **Palavras-passe:** bcrypt, mínimo de 8 caracteres, recusa as mais óbvias. Com sessão iniciada, muda-se em Definições → A tua conta.
- **Sessões:** "Terminar outras sessões" e mudar a palavra-passe invalidam todos os tokens antigos (`auth_version`).
- **Verificação em dois passos (TOTP):** opcional para toda a gente, **obrigatória para administradores** (sem ela, o painel de administração responde 403). O segredo fica cifrado com `PAYOUT_ENCRYPTION_KEY` e cada código só serve uma vez.
- **Pagamentos de demonstração:** só com `NODE_ENV=development` **e** `PAYMENTS_DEMO=true`.
- **Diretos:** com `LIVE_TURN_URL` + `LIVE_TURN_SECRET`, o vídeo passa sempre pelo TURN (ninguém vê o IP de ninguém) e as credenciais expiram em 12 h.
- **Atrás de nginx:** define `TRUST_PROXY=1`, senão os limites de tentativas contam toda a gente como uma pessoa.

## Email e autenticação

Configura estas variáveis no `.env` para enviar emails:

```dotenv
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=utilizador-smtp
SMTP_PASSWORD=palavra-passe-smtp
SMTP_FROM="Biva <no-reply@example.com>"
APP_URL=https://social.example.com
CLIENT_URL=https://social.example.com
```

Com `NODE_ENV=development` e sem SMTP, os links de confirmação e recuperação aparecem no terminal do servidor. Para os receber também na resposta da API (e no botão do ecrã), define `DEV_EXPOSE_AUTH_LINKS=true` — só numa máquina local, porque permite a qualquer pessoa com acesso à API redefinir a palavra-passe de qualquer conta. Com qualquer outro `NODE_ENV` (incluindo nenhum), SMTP, `SMTP_FROM`, `APP_URL` e `CLIENT_URL` são obrigatórios. O `docker-compose.yml` usa `production` por omissão. Tokens de email e recuperação expiram após uma hora; redefinir a palavra-passe invalida sessões existentes. Tokens de sessão expiram após 12 horas.

As migrações ficam em `server/migrations`. Uma migração já aplicada é protegida por checksum: não edites ficheiros aplicados; cria uma nova migração numerada.

## Subscrições pagas (Stripe)

Os criadores definem o preço mensal em kwanzas (500 Kz a 500 000 Kz) em **Definições → Editar perfil** e podem marcar publicações como **Só para subscritores**. O acesso ao conteúdo exclusivo depende de uma subscrição com `status='active'` e um período pago ainda válido (`current_period_end`).

- **Sem `STRIPE_SECRET_KEY`, em desenvolvimento:** subscrever cria uma subscrição de demonstração de 30 dias, sem pagamento.
- **Sem `STRIPE_SECRET_KEY`, fora de `NODE_ENV=development`** (produção, staging ou variável esquecida): subscrever, promover, comprar estrelas e pagar campanhas devolve 503. Ninguém obtém nada sem pagar. O modo de demonstração (sem cobrança) só existe com `NODE_ENV=development`, e nesse modo os levantamentos estão bloqueados.
- **Com Stripe:** `POST /api/subscriptions/:creatorId` devolve `checkoutUrl` (Stripe Checkout). A subscrição só fica ativa quando o webhook confirma o pagamento.

Para testar localmente com chaves de teste da Stripe:

```powershell
stripe listen --forward-to localhost:4000/api/webhooks/stripe
```

Copia o `whsec_...` mostrado para `STRIPE_WEBHOOK_SECRET`.

`DELETE /api/subscriptions/:creatorId` cancela a renovação; o acesso mantém-se até ao fim do período pago. Voltar a subscrever antes desse fim retoma a renovação.

### Stripe em produção — lista de verificação

1. **Conta:** a Stripe não abre contas para empresas sediadas em Angola. É preciso uma empresa num país suportado (por exemplo Portugal) ou usar um agregador local (ver abaixo).
2. **Moeda:** `SUBSCRIPTION_CURRENCY=aoa` é usada em todos os pagamentos. Confirma no painel da Stripe que o kwanza (AOA) está disponível para a tua conta. Se não estiver, usa a moeda da conta (por exemplo `eur`) e ajusta os preços. A Stripe exige um valor mínimo por pagamento equivalente a cerca de 0,50 € na moeda de liquidação.
3. **Webhook:** cria o endpoint `https://<domínio>/api/webhooks/stripe` com os eventos:
   - `checkout.session.completed` e `checkout.session.async_payment_succeeded` (promoções, estrelas, campanhas e subscrições);
   - `customer.subscription.created`, `customer.subscription.updated` e `customer.subscription.deleted`.
4. **Reembolsos:** quando um administrador recusa uma promoção paga, o Biva pede o reembolso à Stripe automaticamente. Se falhar (ou se o pagamento não tiver identificador), aparece em **Administração → Finanças → Reembolsos a fazer à mão**.
5. **Faturação:** a Stripe não emite faturas certificadas pela AGT. Para cumprir a lei angolana é preciso um programa de faturação certificado (integração por API) — isto ainda não está feito.

### Multicaixa Express e Pagamento por Referência

Promoções, estrelas e campanhas podem ser pagas por **Multicaixa Express** ou **Referência** (e por cartão, se a Stripe estiver configurada). O cliente escolhe o método num só ecrã de pagamento.

| Método | Prestador | Variáveis | Webhook |
|---|---|---|---|
| Pagamento por Referência (Entidade + Referência + Valor) | [ProxyPay API v2](https://developer.proxypay.co.ao/v2/) | `PROXYPAY_API_KEY`, `PROXYPAY_ENTITY_ID`, `PROXYPAY_ENV` | `https://<domínio>/api/webhooks/proxypay` |
| Multicaixa Express (pedido na app do telemóvel ou QR code) | [Paybyrd](https://docs.paybyrd.com) | `PAYBYRD_API_KEY` | `https://<domínio>/api/webhooks/paybyrd` |

- **Referências:** válidas 3 dias. A notificação só é aceite com a assinatura `X-Signature` (HMAC-SHA-256 com a chave da API) e o valor pago tem de cobrir o valor pedido. Sem webhook, o servidor lê a fila `GET /payments` da ProxyPay a cada minuto. No sandbox, o ecrã de pagamento mostra **Simular pagamento**.
- **Multicaixa Express:** o pedido chega à app pelo número de telemóvel (ou QR code). O ecrã vai perguntando o estado; a notificação da Paybyrd nunca é usada como prova — o servidor confirma sempre com `GET /transactions/{id}`.
- **A confirmar com a Paybyrd antes de ir para produção:** o formato do número (`244#9XXXXXXXX`, como nos exemplos da documentação), se o kwanza (AOA) está ativo na conta e os nomes exatos dos estados finais.
- **Reembolsos:** Express e Referência não têm devolução automática; aparecem em **Administração → Finanças → Reembolsos a fazer à mão**.
- Para outro prestador, implementa o cliente em `server/angola-payments.js` e liga-o em `server/payments.js`.

## Ganhos e levantamentos dos criadores

Os criadores veem em **Painel do criador → Ganhos** o que ganharam com o Programa de Parceiros (meses fechados), as estrelas recebidas (70%) e as campanhas concluídas (85%). Podem pedir levantamentos a partir de 5 000 Kz para um IBAN angolano (validado pelo módulo 97).

- O IBAN é guardado **cifrado (AES-256-GCM)** com a chave `PAYOUT_ENCRYPTION_KEY`. Em produção o servidor não arranca sem ela. Gera uma com:

  ```powershell
  node -e "console.log(require(crypto).randomBytes(32).toString(hex))"
  ```

  Guarda esta chave num cofre: sem ela não é possível ler os IBAN guardados.
- Os pedidos aparecem em **Administração → Levantamentos** com o IBAN completo. A equipa faz a transferência no banco e marca o pedido como pago, com a referência. Recusar devolve o valor ao saldo do criador.
- Os pedidos ficam guardados mesmo que a conta seja apagada (registo contabilístico).

## Revisão das promoções

Depois de pagas, as promoções ficam **em revisão** e só vão para o ar quando um administrador as aprova em **Administração → Promoções**. O prazo começa a contar na aprovação. Recusar pede o reembolso automaticamente. As regras públicas estão em `/publicidade`.

## Moderação

Qualquer pessoa pode bloquear contas e denunciar publicações, comentários e perfis. Para dar acesso ao painel de moderação (`/moderation`) a uma conta existente:

```powershell
npm run admin:grant -- email@exemplo.com
```

Para retirar o acesso, acrescenta `--revoke`. A moderação pode esconder publicações, apagar comentários e suspender contas (a suspensão termina as sessões abertas). A regra de ocultação automática por número de denúncias está em `server/moderation.js` (`shouldAutoHide`); por omissão nunca esconde sozinha.

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
