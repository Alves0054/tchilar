from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "descricao-tecnica-tchilar.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = 960, 540
RED = HexColor("#F4122A")
INK = HexColor("#111315")
MUTED = HexColor("#656A70")
PALE = HexColor("#F5F5F3")
LINE = HexColor("#E4E5E4")
FONT_DIR = Path("C:/Windows/Fonts")
pdfmetrics.registerFont(TTFont("Arial", str(FONT_DIR / "arial.ttf")))
pdfmetrics.registerFont(TTFont("Arial-Bold", str(FONT_DIR / "arialbd.ttf")))
c = canvas.Canvas(str(OUT), pagesize=(W, H))
c.setTitle("Descrição técnica do projeto Tchilar")
c.setAuthor("Tchilar")
c.setSubject("Arquitetura, tecnologias, estado do projeto e próximos passos")

def txt(x, y, s, size=11, color=INK, font="Arial"):
    c.setFillColor(color); c.setFont(font, size); c.drawString(x, y, s)

def wrap(x, y, s, width, size=10, color=MUTED, leading=14, font="Arial"):
    c.setFillColor(color); c.setFont(font, size)
    for paragraph in s.split("\n"):
        line = ""
        for word in paragraph.split():
            trial = (line + " " + word).strip()
            if pdfmetrics.stringWidth(trial, font, size) <= width or not line:
                line = trial
            else:
                c.drawString(x, y, line); y -= leading; line = word
        if line:
            c.drawString(x, y, line); y -= leading
    return y

def rounded(x, y, w, h, fill=white, stroke=None, r=14):
    c.setFillColor(fill)
    if stroke:
        c.setStrokeColor(stroke); c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, r, fill=1, stroke=1 if stroke else 0)

def pill(x, y, label, bg=HexColor("#FFE7EA"), fg=RED):
    width = pdfmetrics.stringWidth(label, "Arial-Bold", 9) + 22
    c.setFillColor(bg); c.roundRect(x, y-4, width, 21, 10, fill=1, stroke=0)
    txt(x+11, y+3, label.upper(), 8, fg, "Arial-Bold")

def header(section, heading, sub=None):
    pill(56, 481, section)
    txt(56, 438, heading, 27, INK, "Arial-Bold")
    if sub:
        txt(56, 410, sub, 11, MUTED)

def footer(page):
    c.setStrokeColor(LINE); c.line(56, 34, 904, 34)
    txt(56, 17, "TCHILAR  ·  DESCRIÇÃO TÉCNICA  ·  ESTADO DOCUMENTADO EM 15/11/2026", 7.5, MUTED, "Arial-Bold")
    c.setFillColor(MUTED); c.setFont("Arial", 8); c.drawRightString(904, 17, f"{page} / 7")

def bullet(x, y, heading, body, width=390):
    c.setFillColor(RED); c.circle(x+4, y+4, 3.5, fill=1, stroke=0)
    txt(x+17, y, heading, 12, INK, "Arial-Bold")
    end = wrap(x+17, y-19, body, width-18, 9.3, MUTED, 13)
    return end - 13

def box(x, y, w, h, heading, body, fill=white, accent=RED):
    rounded(x, y, w, h, fill, LINE, 12)
    c.setFillColor(accent); c.roundRect(x+13, y+h-28, 5, 16, 2, fill=1, stroke=0)
    txt(x+28, y+h-23, heading, 11, INK, "Arial-Bold")
    wrap(x+14, y+h-47, body, w-28, 8.7, MUTED, 12)

def arrow(x1, y1, x2, y2, label=None):
    c.setStrokeColor(HexColor("#8C9197")); c.setLineWidth(1.2)
    c.line(x1, y1, x2, y2)
    import math
    a = math.atan2(y2-y1, x2-x1); d=6
    p1=(x2-d*math.cos(a-0.45), y2-d*math.sin(a-0.45))
    p2=(x2-d*math.cos(a+0.45), y2-d*math.sin(a+0.45))
    path=c.beginPath(); path.moveTo(x2,y2); path.lineTo(*p1); path.lineTo(*p2); path.close()
    c.setFillColor(HexColor("#8C9197")); c.drawPath(path, fill=1, stroke=0)
    if label: txt((x1+x2)/2-28, (y1+y2)/2+7, label, 7.5, MUTED)

# 1. Cover
c.setFillColor(INK); c.rect(0,0,W,H,fill=1,stroke=0)
c.setFillColor(RED); c.rect(0,0,13,H,fill=1,stroke=0)
c.drawImage(str(ROOT/"public"/"tchilar-logo-full-dark.png"), 58, 418, width=285, height=70, preserveAspectRatio=True, anchor="sw", mask="auto")
pill(60, 355, "Descrição técnica", bg=HexColor("#302326"), fg=HexColor("#FF7483"))
txt(58, 290, "Tchilar", 43, white, "Arial-Bold")
txt(58, 244, "Arquitetura, funcionamento", 24, white, "Arial-Bold")
txt(58, 211, "e plano de conclusão", 24, RED, "Arial-Bold")
wrap(60, 162, "Rede social angolana para criadores e comunidades. Este documento resume as tecnologias, a arquitetura, o que já está implementado e o trabalho necessário para preparar o lançamento público.", 570, 12, HexColor("#D4D5D7"), 18)
rounded(696, 108, 208, 259, HexColor("#1B1D20"), HexColor("#303337"), 18)
txt(720, 325, "ESTADO DO PROJETO", 9, HexColor("#B8BBC0"), "Arial-Bold")
txt(720, 281, "Produto funcional", 17, white, "Arial-Bold")
txt(720, 257, "em ambiente local", 13, RED, "Arial-Bold")
c.setStrokeColor(HexColor("#3A3C40")); c.line(720, 234, 880, 234)
txt(720, 207, "Web + API + app Expo", 10, white)
txt(720, 185, "Base técnica implementada", 9, HexColor("#C2C4C6"))
txt(720, 164, "Publicação e integrações", 9, HexColor("#C2C4C6"))
txt(720, 146, "a concluir", 9, HexColor("#C2C4C6"))
txt(60, 54, "Documento preparado em 19 de novembro de 2026", 9, HexColor("#A6A8AA"), "Arial-Bold")
txt(60, 37, "Baseado na documentação técnica do projeto, atualizada a 15/11/2026.", 8, HexColor("#888B90"))
c.showPage()

# 2. Product and architecture
c.setFillColor(PALE); c.rect(0,0,W,H,fill=1,stroke=0)
header("Visão geral", "Uma aplicação, três componentes ligados", "O site e a app móvel usam a mesma API e a mesma base de dados.")
box(58, 250, 236, 108, "Site web", "React 19 + Vite. Interface servida como ficheiros estáticos; rotas da aplicação comunicam com a API REST.")
box(362, 250, 236, 108, "API e serviços", "Node.js 20+ + Express 5. Autenticação, regras de negócio, moderação, pagamentos, notificações e gestão de ficheiros.", HexColor("#FFF5F5"))
box(666, 250, 236, 108, "App iOS e Android", "React Native + Expo SDK 58 + Expo Router. Interface nativa ligada à mesma API.")
arrow(294, 304, 362, 304, "HTTPS / JSON")
arrow(666, 304, 598, 304, "HTTPS / JSON")
box(238, 92, 220, 94, "PostgreSQL", "Contas, publicações, relações sociais, pagamentos e dados da aplicação. Migrações versionadas.")
box(502, 92, 220, 94, "Ficheiros", "Fotografias, vídeos e áudio. Em produção, armazenamento persistente montado para uploads.")
arrow(430, 250, 350, 186, "SQL")
arrow(530, 250, 610, 186, "uploads")
rounded(58, 202, 844, 27, HexColor("#ECEDEC"), None, 10)
txt(73, 211, "Integrações externas: email SMTP · pagamentos · Expo/Web Push · TURN e servidor de vídeo (MediaMTX)", 8.5, MUTED, "Arial-Bold")
footer(2); c.showPage()

# 3. Technologies and structure
c.setFillColor(white); c.rect(0,0,W,H,fill=1,stroke=0)
header("Tecnologias", "Stack técnica e organização do código", "Estrutura modular no mesmo repositório, com pastas distintas para servidor, site, app e publicação.")
data = [
    ("Servidor", "Node.js 20+ · Express 5 · PostgreSQL 17", "API REST, autenticação, serviços e migrações SQL."),
    ("Site", "React 19 · Vite 7 · JavaScript / JSX", "Interface web e áreas públicas e administrativas."),
    ("App móvel", "React Native 0.88 · Expo SDK 58 · Expo Router", "Ecrãs nativos; EAS previsto para builds de loja."),
    ("Infraestrutura", "Docker Compose · nginx · Redis opcional", "API e base de dados em contentores; nginx para HTTPS e proxy."),
    ("Tempo real e media", "WebRTC · TURN · MediaMTX (opcional)", "Chamadas e diretos; SFU/MediaMTX necessário para transmissão escalável."),
    ("Pagamentos e avisos", "Paybyrd · ProxyPay · Stripe · PayPal · RedotPay · PayPay", "Integrações configuráveis por credenciais e webhooks; email SMTP e push.")
]
for i,(area,stack,desc) in enumerate(data):
    col,row=i%2,i//2; x=58+col*430; y=333-row*91
    rounded(x,y-68,400,76,PALE,None,13)
    txt(x+16,y-16,area.upper(),8,RED,"Arial-Bold")
    txt(x+16,y-34,stack,10,INK,"Arial-Bold")
    txt(x+16,y-52,desc,8.5,MUTED)
rounded(58, 47, 844, 32, HexColor("#17191B"), None, 11)
txt(77, 66, "Pastas principais: server/ · src/ · public/ · mobile/tchilar-app/ · deploy/ · scripts/", 8.5, white, "Arial-Bold")
footer(3); c.showPage()

# 4. How it works and security
c.setFillColor(PALE); c.rect(0,0,W,H,fill=1,stroke=0)
header("Funcionamento", "Do ecrã ao dado guardado", "Fluxo típico de publicação e controlos centrais da plataforma.")
steps=[("1", "Pessoa", "Inicia sessão no site ou na app."),("2", "Cliente", "Envia pedido autenticado à API."),("3", "API", "Valida acesso, aplica regras e grava dados."),("4", "Resposta", "Devolve resultado e atualiza o ecrã.")]
for i,(n,h,b) in enumerate(steps):
    x=58+i*218
    rounded(x,305,190,92,white,LINE,13)
    c.setFillColor(RED); c.circle(x+25,370,13,fill=1,stroke=0)
    c.setFillColor(white); c.setFont("Arial-Bold",9); c.drawCentredString(x+25,367,n)
    txt(x+47,367,h,12,INK,"Arial-Bold")
    wrap(x+16,341,b,158,8.5,MUTED,12)
    if i<3: arrow(x+190,350,x+213,350)
bullet(58,260,"Dados relacionais", "PostgreSQL persiste contas, publicações e registos. Migrações numeradas mantêm o esquema evolutivo.",400)
bullet(490,260,"Sessão e permissões", "Tokens, sessão por aparelho, papéis administrativos e verificação TOTP para a equipa.",400)
bullet(58,177,"Proteção de dados", "Bloqueio, denúncias, controlos de privacidade e pedidos de acesso, correção e apagamento.",400)
bullet(490,177,"Segredos e pagamentos", "Chaves ficam no ambiente do servidor. IBAN e segredo TOTP são cifrados com chave dedicada.",400)
rounded(58,57,844,39,HexColor("#FFF0F1"),None,11)
txt(75,72,"Em desenvolvimento local: API em :4000, site em :5173 e PostgreSQL em Docker na porta :5433.",9,HexColor("#74333A"),"Arial-Bold")
footer(4); c.showPage()

# 5. What is ready
c.setFillColor(white); c.rect(0,0,W,H,fill=1,stroke=0)
header("Implementado", "O que já está construído", "As funcionalidades abaixo constam no código e na documentação do produto.")
ready=[
    ("Social", "Feed, perfis, amizades, comentários, gostos, partilhas, stories, reels, pesquisa e mensagens."),
    ("Comunidades", "Grupos e páginas com regras e moderação; eventos, sondagens, ficheiros e calendário."),
    ("Criadores", "Painel, subscrições, Estrelas, campanhas, promoções, cursos, desafios e levantamentos."),
    ("Administração", "Papéis separados para finanças e moderação; gestão de contas, pagamentos, conteúdo e dados."),
    ("Segurança", "Confirmação de email, recuperação, TOTP, sessões por aparelho, bloqueios e denúncias."),
    ("Base de qualidade", "Testes automatizados, lint, verificação de tipos e builds definidos nos scripts do projeto.")
]
for i,(h,b) in enumerate(ready):
    col,row=i%2,i//2; x=58+col*430; y=338-row*93
    rounded(x,y-66,400,76,PALE,None,13)
    txt(x+16,y-17,h,12,INK,"Arial-Bold")
    wrap(x+16,y-38,b,368,8.7,MUTED,12)
rounded(58,47,844,32,HexColor("#17191B"),None,10)
txt(75,66,"Em 15/11/2026: 215 testes da API, 14 do site, lint e builds indicados como OK.",8.5,white,"Arial-Bold")
footer(5); c.showPage()

# 6. What remains
c.setFillColor(PALE); c.rect(0,0,W,H,fill=1,stroke=0)
header("A concluir", "Preparação para lançamento público", "O código está avançado; lançamento depende de infraestrutura, contas e validação operacional.")
todo=[
    ("Infraestrutura", "Registar/confirmar domínio, contratar VPS e alojamento web, configurar DNS, HTTPS e variáveis de produção."),
    ("Pagamentos", "Ativar contas e chaves reais dos prestadores, webhooks, moeda e fluxos de reembolso; confirmar condições comerciais."),
    ("Email e identidade", "Configurar SMTP no domínio e SPF/DKIM; ativar TOTP na conta administradora."),
    ("Legal e privacidade", "Rever Termos e Política de Privacidade com apoio jurídico e tratar o registo/comunicação aplicável à APD."),
    ("Aplicação móvel", "Fazer o primeiro build EAS e publicar nas lojas; completar capturas da loja e links universais/app links."),
    ("Operação", "Ligar cópias de segurança e alertas; configurar MediaMTX para diretos; TURN; Redis para múltiplas instâncias."),
    ("Verificação adicional", "SMS ainda não valida o número; falta método de subscrição no app. Recomenda-se monitorização, moderação prática e testes de carga.")
]
for i,(h,b) in enumerate(todo):
    col,row=i%2,i//2; x=58+col*430; y=354-row*78
    rounded(x,y-59,400,65,white,LINE,12)
    txt(x+14,y-17,h,10.5,INK,"Arial-Bold")
    wrap(x+14,y-34,b,370,8.1,MUTED,10.5)
txt(58,46,"Credenciais de produção devem ficar no servidor, nunca no repositório.",8,HexColor("#74333A"),"Arial-Bold")
footer(6); c.showPage()

# 7. Roadmap and handoff
c.setFillColor(INK); c.rect(0,0,W,H,fill=1,stroke=0)
pill(56,481,"Próximas etapas",bg=HexColor("#302326"),fg=HexColor("#FF7483"))
txt(56,438,"Sequência recomendada para concluir",26,white,"Arial-Bold")
road=[
    ("01", "Preparar ambiente", "Domínio, VPS, alojamento, HTTPS e configuração segura."),
    ("02", "Ativar serviços", "Email, pagamentos, push, media e credenciais de produção."),
    ("03", "Validar lançamento", "Build EAS, revisão jurídica, backups, alertas e testes de carga."),
    ("04", "Publicar e acompanhar", "Lojas, monitorização, apoio à comunidade e melhoria contínua.")
]
for i,(n,h,b) in enumerate(road):
    y=347-i*76
    c.setFillColor(RED); c.circle(79,y+3,17,fill=1,stroke=0)
    c.setFillColor(white); c.setFont("Arial-Bold",9); c.drawCentredString(79,y,n)
    txt(111,y+8,h,13,white,"Arial-Bold")
    txt(111,y-12,b,9,HexColor("#C8C9CB"))
    if i<3:
        c.setStrokeColor(HexColor("#43464A")); c.setLineWidth(1); c.line(79,y-15,79,y-42)
c.setStrokeColor(HexColor("#3A3D41")); c.line(56,61,904,61)
wrap(56,46,"Fontes internas: NOTA-TCHILAR.md, NOTA-O-QUE-FALTA.md, NOTA-DEPLOY.md, README.md, package.json e mobile/tchilar-app/package.json. Estado funcional e testes conforme notas do projeto de 15/11/2026; esta descrição não substitui uma auditoria técnica nem confirma serviços externos ativos.",820,7.2,HexColor("#A8AAAD"),10)
c.showPage()

c.save()
print(OUT)
