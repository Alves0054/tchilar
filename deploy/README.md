# Pôr a Tchilar online

Guia para um **VPS Linux** (AngoWeb ou outro) com Ubuntu 24.04 e acesso root por SSH.
Alojamento partilhado (cPanel) **não serve**: a Tchilar precisa de um processo Node sempre ligado e de PostgreSQL.

Requisitos mínimos do VPS: 2 vCPU, 4 GB de RAM, 60 GB de disco (as fotos e vídeos crescem depressa).

## 1. Preparar o servidor

```bash
apt update && apt upgrade -y
apt install -y docker.io docker-compose-v2 certbot python3-certbot-nginx ufw fail2ban curl gnupg2 ca-certificates lsb-release ubuntu-keyring

# nginx do repositório oficial (nginx.org), ramo estável: o do Ubuntu atrasa as correções de segurança.
curl -fsSL https://nginx.org/keys/nginx_signing.key | gpg --dearmor -o /usr/share/keyrings/nginx-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/nginx-archive-keyring.gpg] http://nginx.org/packages/ubuntu $(lsb_release -cs) nginx" \
  > /etc/apt/sources.list.d/nginx.list
printf 'Package: *\nPin: origin nginx.org\nPin: release o=nginx\nPin-Priority: 900\n' > /etc/apt/preferences.d/99nginx
apt update && apt install -y nginx
nginx -v          # tem de ser 1.30.7 ou mais recente (correções de 18/11/2026)
systemctl enable --now nginx

ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable
```

- **nginx sempre atualizado:** a 18/11/2026 saiu a 1.30.7 com 10 correções de segurança (a mais grave, CVE-2026-123007,
  no HTTP/2, permite a um atacante sem conta correr código no servidor). Com o repositório oficial, `apt update && apt upgrade`
  traz as correções no mesmo dia. Confirma a versão com `nginx -v` e acompanha https://nginx.org/en/security_advisories.html.
  Se um dia não puderes atualizar logo, desliga o HTTP/2 (tira `http2` das linhas `listen 443`) até atualizares.

- **ufw** fecha todas as portas menos SSH, HTTP e HTTPS. A base de dados só escuta em 127.0.0.1.
- **fail2ban** bloqueia quem tenta adivinhar a palavra-passe do SSH.
- Entra por SSH com chave, não com palavra-passe (`PasswordAuthentication no` em `/etc/ssh/sshd_config`).

## 2. Copiar a aplicação e configurar

```bash
git clone <o-teu-repositorio> /opt/tchilar && cd /opt/tchilar
cp .env.example .env && nano .env
```

No `.env`, para produção:

| Variável | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `PAYOUT_ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — **guarda uma cópia fora do servidor**: sem ela, os IBAN e a verificação em dois passos ficam ilegíveis |
| `POSTGRES_PASSWORD` | uma palavra-passe longa e aleatória |
| `PUBLIC_CLIENT_URL` / `PUBLIC_APP_URL` | `https://tchilar.ao` |
| `SMTP_*` | a conta do **Resend** (ver «Email pelo Resend» abaixo; obrigatório para confirmar contas) |
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
cp deploy/nginx-tchilar.conf /etc/nginx/conf.d/tchilar.conf   # troca tchilar.ao pelo teu domínio
rm -f /etc/nginx/conf.d/default.conf                           # a página de boas-vindas do nginx
nginx -t && systemctl reload nginx
certbot --nginx -d tchilar.ao -d www.tchilar.ao
```

O certbot renova o certificado sozinho. Depois de o HTTPS funcionar, a Tchilar envia HSTS: os browsers passam a recusar abrir o site sem HTTPS.

## 4. Cópias de segurança e alertas

```bash
chmod +x deploy/*.sh
echo "TCHILAR_DOCKER=1" >> .env
crontab -e
```

```
30 3 * * *  /opt/tchilar/deploy/backup.sh >> /var/log/tchilar-backup.log 2>&1
*/5 * * * * /opt/tchilar/deploy/healthcheck.sh
```

- **Cópias:** todos os dias às 03:30, base de dados e fotos, guardadas 14 dias em `/var/backups/tchilar`.
  Para ter cópias fora do servidor (recomendado), instala o `rclone`, configura um destino
  (`rclone config`, ex.: Google Drive) e põe `RCLONE_REMOTE=drive:tchilar-backups` no `.env`.
- **Alertas:** instala a app **ntfy** no telemóvel, subscreve um tópico com nome difícil de adivinhar
  e põe `ALERT_WEBHOOK_URL=https://ntfy.sh/<esse-tópico>` no `.env`. Recebes uma notificação quando
  a Tchilar cai e quando volta, e quando uma cópia falha.
- Para um segundo alerta vindo de fora (se o servidor inteiro desligar, o script não corre),
  cria um monitor grátis no UptimeRobot a apontar para `https://tchilar.ao/api/health/ready`.

**Testa a restauração** pelo menos uma vez — uma cópia que nunca foi restaurada não é uma cópia:

```bash
docker compose exec -T database pg_restore -U biva -d biva --clean --if-exists < /var/backups/tchilar/db_<data>.dump
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
realm=tchilar.ao
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

No `.env` da Tchilar: `LIVE_TURN_URL=turn:tchilar.ao:3478` e `LIVE_TURN_SECRET=<o mesmo segredo>`.
Cada pessoa recebe credenciais que expiram em 12 horas, e o vídeo passa sempre pelo TURN:
ninguém fica a conhecer o IP de ninguém. As linhas `denied-peer-ip` impedem que o TURN seja usado
para chegar à rede interna do servidor.

## 6. Diretos para milhares de pessoas (MediaMTX + CDN) e OBS

Sem esta secção, o vídeo de um direto vai do browser de quem emite para cada espectador e chega
a **8 pessoas** no máximo. Com ela:

- quem emite envia o vídeo **uma vez** para o MediaMTX: pelo estúdio do browser (câmara, placa de
  captura, ecrã) ou por um programa como **OBS, vMix ou Streamlabs** (RTMP ou WHIP, com chave);
- o MediaMTX converte para **HLS** e uma **CDN** entrega-o a toda a gente. É a CDN que permite
  100 mil espectadores: 100 000 × 2,5 Mbps ≈ 250 Gbps, que nenhum VPS consegue servir sozinho;
  com a CDN, o VPS envia cada pedaço de vídeo poucas vezes e a CDN replica-o.

### 6.1 Ligar o MediaMTX

No `.env`:

```
MEDIA_HOOK_SECRET=<openssl rand -hex 32>
MEDIA_API_URL=http://mediamtx:9997
MEDIA_RTMP_URL=rtmp://live.tchilar.ao
MEDIA_WHIP_URL=https://live.tchilar.ao
MEDIA_HLS_URL=https://cdn-live.tchilar.ao
MEDIA_PUBLIC_HOST=<IP público do VPS>
```

```bash
docker compose --profile live up -d
ufw allow 1935/tcp && ufw allow 8189
```

A porta 1935 recebe o OBS (RTMP). A 8189 é o WebRTC do WHIP. As portas 8888 (HLS) e 8889 (WHIP)
ficam só em 127.0.0.1 e passam pelo nginx com HTTPS (bloco `live.tchilar.ao` em `nginx-tchilar.conf`):

```bash
certbot --nginx -d live.tchilar.ao
```

### 6.2 CDN à frente do HLS

Cria na tua CDN (Cloudflare, Bunny, CloudFront, Akamai...) uma «pull zone» com:

- **origem**: `https://live.tchilar.ao`
- **domínio**: `cdn-live.tchilar.ao` (o mesmo de `MEDIA_HLS_URL`)
- **cache**: respeitar os cabeçalhos da origem (o nginx já marca os segmentos `.mp4`/`.m4s` para
  ficarem 60 s e as listas `.m3u8` 1 s)
- **CORS**: deixar passar `Access-Control-Allow-Origin`.

Opcional: se a CDN puder enviar `Authorization: Bearer <segredo>`, põe o mesmo segredo em
`hlsCDNSecret` no `deploy/mediamtx.yml`.

**Diretos pagos:** o endereço do vídeo leva `?v=<token>` (só quem pagou a entrada o recebe; vale 3 h).
A CDN tem de **passar a query à origem** nos pedidos das listas `.m3u8` (na Cloudflare: *Cache Key* com a
query incluída, ou regra para não guardar `.m3u8` em cache). Os segmentos `.mp4`/`.m4s` podem continuar em cache.

O chat também aguenta a escala: o endereço `/api/lives/<id>/feed` é igual para toda a gente e
pode ficar 2 s na CDN (cabeçalho `s-maxage=2`). Se puseres a Tchilar inteira atrás da mesma CDN, 100 mil
pessoas a ler o chat custam à base de dados cerca de um pedido por segundo por direto.

### 6.3 Limites conhecidos

- **Uma só qualidade**: quem vê recebe a mesma qualidade que quem emite envia. Para Angola,
  recomenda-se 720p a 2500 kbps. Várias qualidades automáticas (480p/720p/1080p) exigem
  transcodificação (ffmpeg num servidor com bastante CPU ou um serviço como Mux/Cloudflare Stream).
- **Contagem de espectadores em memória**: certa com uma instância da API. Com várias instâncias
  (balanceador), é preciso partilhar a presença por Redis.
- **Atraso**: 6–10 s (HLS padrão, compatível com todas as CDNs).
- Só quem tem sessão iniciada conta como espectador e pode escrever no chat; ver o vídeo é aberto.
- **Capacidade medida da API** (uma instância, portátil de desenvolvimento): ~750 sinais de vida/s
  e ~1100 leituras do feed/s sem CDN. Com 100 mil pessoas, os sinais de vida passam a 120 s
  (~830/s) e o chat entra em modo lento (5 s entre mensagens da mesma pessoa). Num VPS de 4 vCPU
  em produção há folga; acima disso, várias instâncias + Redis para a presença.

### 6.4 OBS

No Tchilar: **Diretos → Começar um direto → OBS ou programa → Gerar chave**. No OBS:
**Definições → Transmissão → Personalizado**, cola o servidor e a chave; H.264, CBR 2500–4500 kbps,
keyframes a cada 2 s. Cria o direto no Tchilar e depois carrega em «Iniciar transmissão» no OBS.
A chave só é mostrada uma vez e é guardada apenas como hash; terminar o direto corta a emissão.

### 6.5 Segurança do MediaMTX

A API de controlo do MediaMTX (porta 9997) não tem porta pública e só aceita a app do Tchilar
(utilizador `tchilar-api` com o `MEDIA_HOOK_SECRET`). As métricas, o `pprof` e os protocolos que
não usamos (RTSP, SRT, MoQ) estão desligados em `deploy/mediamtx.yml`.

### 6.6 Imagem sem root

A API corre como o utilizador `node` dentro do contentor (não como root). Numa instalação nova não é
preciso fazer nada. Se já tinhas a Tchilar instalada antes desta versão, dá uma vez a pasta das fotos
ao novo utilizador:

```
docker compose run --rm --user root app chown -R node:node /app/uploads
```

## 7. Várias cópias da API (crescer)

Uma cópia aguenta bem o início. Quando o CPU do servidor passar muitas vezes dos 70 %:

1. No `.env`: `REDIS_URL=redis://redis:6379` (os limites de tentativas passam a ser partilhados;
   sem isto, cada cópia dava a cada pessoa as suas próprias tentativas de login).
2. Arranca as três cópias e o Redis: `docker compose --profile scale up -d --build`.
   A primeira fica na porta 4003 e as outras nas portas 4004 e 4005 do próprio servidor.
3. Em `/etc/nginx/conf.d/tchilar.conf`, acrescenta as cópias nas portas 4004 e 4005 aos
   **dois** blocos `upstream`:
   ```
   server 127.0.0.1:4004;
   server 127.0.0.1:4005;
   ```
   e `nginx -t && systemctl reload nginx`.

Os diretos continuam certos com várias cópias: o nginx manda sempre o mesmo direto para a mesma
cópia (contagem de espectadores, modo lento e reações), e a lista de diretos lê da base de dados os
números que as outras cópias gravam a cada 15 s.

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


## Email pelo Resend

Os emails do Tchilar (confirmar a conta, recuperar a palavra-passe, avisos) saem pelo **Resend** (https://resend.com),
por SMTP. Planos: **grátis** com 3 000 emails/mês e **100 por dia**; **Pro** a 20 USD/mês (cerca de 18 240 Kz) com
50 000 emails/mês e sem limite diário (cerca de 0,90 USD por cada 1 000 a mais). Paga-se com cartão internacional em USD.

1. Cria a conta no Resend e, em **Domains**, acrescenta `tchilar.ao`. Põe no DNS do domínio os registos que o Resend
   mostra (SPF e DKIM) e espera que fique **Verified**.
2. Acrescenta também um registo **DMARC** (`_dmarc.tchilar.ao`, `v=DMARC1; p=none; rua=mailto:...`).
3. Em **API Keys**, cria uma chave só com permissão de envio (*Sending access*), para o domínio `tchilar.ao`.
4. No `.env` do servidor:

   ```
   SMTP_HOST=smtp.resend.com
   SMTP_PORT=465
   SMTP_SECURE=true          # ou porta 587 com SMTP_SECURE=false
   SMTP_USER=resend
   SMTP_PASSWORD=re_...      # a chave da API; nunca no git
   SMTP_FROM="Tchilar <nao-responder@tchilar.ao>"
   ```
5. **Limite do plano grátis:** 100 emails por dia. Quando os registos passarem disso (ou antes de uma campanha),
   muda para o Pro no painel do Resend; o código não muda.

## Servidor na AngoWeb

O **alojamento de sites** da AngoWeb não corre Node.js nem Docker, por isso a API do Tchilar precisa de um **VPS**
(https://angoweb.ao/servidor-dedicado-vps.php): para começar, o **CX33** (4 vCPU, 8 GB de RAM, 80 GB SSD, 20 TB de
tráfego; 14 216 Kz/mês no pagamento anual), com Debian ou Ubuntu e acesso root. As cópias de segurança são uma opção
paga à parte (marca-a na encomenda). Com mais pessoas: CX43 (8 vCPU, 16 GB, 160 GB) e um 2.º VPS para vídeos e diretos.
