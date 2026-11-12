# Pôr a Biva online

Guia para um **VPS Linux** (AngoWeb ou outro) com Ubuntu 24.04 e acesso root por SSH.
Alojamento partilhado (cPanel) **não serve**: a Biva precisa de um processo Node sempre ligado e de PostgreSQL.

Requisitos mínimos do VPS: 2 vCPU, 4 GB de RAM, 60 GB de disco (as fotos e vídeos crescem depressa).

## 1. Preparar o servidor

```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 nginx certbot python3-certbot-nginx ufw fail2ban
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

- **ufw** fecha todas as portas menos SSH, HTTP e HTTPS. A base de dados só escuta em 127.0.0.1.
- **fail2ban** bloqueia quem tenta adivinhar a palavra-passe do SSH.
- Entra por SSH com chave, não com palavra-passe (`PasswordAuthentication no` em `/etc/ssh/sshd_config`).

## 2. Copiar a aplicação e configurar

```bash
git clone <o-teu-repositorio> /opt/biva && cd /opt/biva
cp .env.example .env && nano .env
```

No `.env`, para produção:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PAYOUT_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — **guarda uma cópia fora do servidor**: sem ela, os IBAN e a verificação em dois passos ficam ilegíveis |
| `POSTGRES_PASSWORD` | uma palavra-passe longa e aleatória |
| `PUBLIC_CLIENT_URL` / `PUBLIC_APP_URL` | `https://biva.ao` |
| `SMTP_*` | os dados do email (obrigatório para confirmar contas) |
| `TRUST_PROXY` | `1` (há um nginx à frente) |
| `PAYMENTS_DEMO` | `false` (ou apaga a linha) |

```bash
chmod 600 .env
docker compose up -d --build
docker compose exec app npm run db:migrate
docker compose exec app npm run admin:grant -- <o-teu-username>
```

O administrador tem de ativar a **verificação em dois passos** (Definições → A tua conta) antes de abrir o painel.

## 3. Domínio e HTTPS

```bash
cp deploy/nginx-biva.conf /etc/nginx/sites-available/biva   # troca biva.ao pelo teu domínio
ln -s /etc/nginx/sites-available/biva /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d biva.ao -d www.biva.ao
```

O certbot renova o certificado sozinho. Depois de o HTTPS funcionar, a Biva envia HSTS: os browsers passam a recusar abrir o site sem HTTPS.

## 4. Cópias de segurança e alertas

```bash
chmod +x deploy/*.sh
echo "BIVA_DOCKER=1" >> .env
crontab -e
```

```
30 3 * * *  /opt/biva/deploy/backup.sh >> /var/log/biva-backup.log 2>&1
*/5 * * * * /opt/biva/deploy/healthcheck.sh
```

- **Cópias:** todos os dias às 03:30, base de dados e fotos, guardadas 14 dias em `/var/backups/biva`.
  Para ter cópias fora do servidor (recomendado), instala o `rclone`, configura um destino
  (`rclone config`, ex.: Google Drive) e põe `RCLONE_REMOTE=drive:biva-backups` no `.env`.
- **Alertas:** instala a app **ntfy** no telemóvel, subscreve um tópico com nome difícil de adivinhar
  e põe `ALERT_WEBHOOK_URL=https://ntfy.sh/<esse-tópico>` no `.env`. Recebes uma notificação quando
  a Biva cai e quando volta, e quando uma cópia falha.
- Para um segundo alerta vindo de fora (se o servidor inteiro desligar, o script não corre),
  cria um monitor grátis no UptimeRobot a apontar para `https://biva.ao/api/health/ready`.

**Testa a restauração** pelo menos uma vez — uma cópia que nunca foi restaurada não é uma cópia:

```bash
docker compose exec -T database pg_restore -U biva -d biva --clean --if-exists < /var/backups/biva/db_<data>.dump
```

## 5. Diretos com TURN (esconde os IPs e funciona em redes móveis)

```bash
apt install -y coturn
```

Em `/etc/turnserver.conf`:

```
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=<um segredo longo e aleatório>
realm=biva.ao
no-cli
no-multicast-peers
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
```

```bash
systemctl enable --now coturn
ufw allow 3478 && ufw allow 49152:65535/udp
```

No `.env` da Biva: `LIVE_TURN_URL=turn:biva.ao:3478` e `LIVE_TURN_SECRET=<o mesmo segredo>`.
Cada pessoa recebe credenciais que expiram em 12 horas, e o vídeo passa sempre pelo TURN:
ninguém fica a conhecer o IP de ninguém. As linhas `denied-peer-ip` impedem que o TURN seja usado
para chegar à rede interna do servidor.

## Opção: base de dados na Supabase

Em vez do PostgreSQL do docker compose:

1. Cria o projeto na Supabase e copia a ligação do **pooler em modo sessão** (porta 5432 do `pooler.supabase.com`).
   A ligação direta só funciona com IPv6.
2. No `.env`: `DATABASE_URL=<essa ligação>?sslmode=require`.
3. `npm run db:migrate`.
4. No SQL Editor da Supabase, corre `deploy/supabase-lockdown.sql`. **Não saltes este passo:**
   a Supabase publica uma API pública para todas as tabelas, e sem isto qualquer pessoa com a chave
   pública poderia ler a tabela de utilizadores.
5. As cópias de segurança diárias ficam por conta da Supabase (no plano pago). O `backup.sh` continua
   a funcionar com `pg_dump` para teres também uma cópia tua.

As fotos e vídeos continuam no disco do VPS.
