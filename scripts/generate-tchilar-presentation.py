from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output" / "pdf" / "apresentacao-tchilar.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = 960, 540
RED = HexColor("#F4122A")
INK = HexColor("#111315")
MUTED = HexColor("#666A70")
PALE = HexColor("#F5F5F3")
FONT_DIR = Path("C:/Windows/Fonts")
pdfmetrics.registerFont(TTFont("Arial", str(FONT_DIR / "arial.ttf")))
pdfmetrics.registerFont(TTFont("Arial-Bold", str(FONT_DIR / "arialbd.ttf")))

def image_cover(path, x, y, w, h, radius=22):
    """Crop an image to a wide card with rounded corners, then paint it."""
    im = Image.open(path).convert("RGB")
    target = w / h
    ratio = im.width / im.height
    if ratio > target:
        nw = int(im.height * target)
        left = (im.width - nw) // 2
        im = im.crop((left, 0, left + nw, im.height))
    else:
        nh = int(im.width / target)
        top = (im.height - nh) // 2
        im = im.crop((0, top, im.width, top + nh))
    im = im.resize((int(w * 2), int(h * 2)), Image.Resampling.LANCZOS)
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, im.width, im.height), radius=radius * 2, fill=255)
    rgba = im.convert("RGBA")
    rgba.putalpha(mask)
    c.drawImage(ImageReader(rgba), x, y, w, h, mask="auto")

def text(c, x, y, value, size, color=INK, font="Arial", leading=None, maxw=None):
    c.setFillColor(color)
    c.setFont(font, size)
    if maxw is None:
        c.drawString(x, y, value)
        return y
    lines = []
    for paragraph in value.split("\n"):
        words = paragraph.split()
        line = ""
        for word in words:
            trial = (line + " " + word).strip()
            if pdfmetrics.stringWidth(trial, font, size) <= maxw or not line:
                line = trial
            else:
                lines.append(line)
                line = word
        if line:
            lines.append(line)
    step = leading or size * 1.35
    for line in lines:
        c.drawString(x, y, line)
        y -= step
    return y

def pill(c, x, y, label, bg=HexColor("#FFE7EA"), fg=RED):
    width = pdfmetrics.stringWidth(label, "Arial-Bold", 10) + 24
    c.setFillColor(bg)
    c.roundRect(x, y - 5, width, 24, 12, fill=1, stroke=0)
    text(c, x + 12, y + 3, label.upper(), 9, fg, "Arial-Bold")

def footer(c, page, dark=False):
    c.setStrokeColor(HexColor("#343638") if dark else HexColor("#E4E5E4"))
    c.line(56, 34, 904, 34)
    col = HexColor("#B8B9BB") if dark else MUTED
    text(c, 56, 17, "TCHILAR  ·  CONECTA · PARTILHA · VIVE", 8, col, "Arial-Bold")
    c.setFillColor(col)
    c.setFont("Arial", 8)
    c.drawRightString(904, 17, f"{page} / 5")

def title(c, eyebrow, heading, sub=None):
    pill(c, 56, 478, eyebrow)
    text(c, 56, 428, heading, 31, INK, "Arial-Bold", maxw=810)
    if sub:
        text(c, 56, 395, sub, 13, MUTED, maxw=820)

def bullet(c, x, y, head, body, width=390):
    c.setFillColor(RED)
    c.circle(x + 5, y + 5, 4, fill=1, stroke=0)
    text(c, x + 20, y, head, 14, INK, "Arial-Bold")
    y2 = text(c, x + 20, y - 21, body, 10.5, MUTED, leading=15, maxw=width - 20)
    return y2 - 20

c = canvas.Canvas(str(OUT), pagesize=(W, H))
c.setTitle("Tchilar | Apresentação")
c.setAuthor("Tchilar")

# 1 — Cover
c.setFillColor(INK); c.rect(0, 0, W, H, fill=1, stroke=0)
c.setFillColor(RED); c.rect(0, 0, 13, H, fill=1, stroke=0)
image_cover(ROOT / "public" / "tchilar-community-selfie.jpg", 548, 56, 356, 428, 28)
c.setFillColor(RED); c.circle(863, 462, 9, fill=1, stroke=0)
c.drawImage(str(ROOT / "public" / "tchilar-logo-full-dark.png"), 56, 418, width=310, height=75, preserveAspectRatio=True, anchor="sw", mask="auto")
pill(c, 58, 362, "Apresentação do produto", bg=HexColor("#302326"), fg=HexColor("#FF7483"))
text(c, 58, 300, "Uma rede para", 37, white, "Arial-Bold")
text(c, 58, 254, "criar, partilhar", 37, white, "Arial-Bold")
text(c, 58, 208, "e crescer junto.", 37, RED, "Arial-Bold")
text(c, 58, 148, "Comunidade, cultura e oportunidades para criadores.", 13, HexColor("#D3D4D5"), maxw=420)
text(c, 58, 79, "ANGOLA  ·  NOVEMBRO 2026", 9, HexColor("#A6A8AA"), "Arial-Bold")
text(c, 564, 39, "Imagem ilustrativa", 8, HexColor("#A6A8AA"))
c.showPage()

# 2 — What it is
c.setFillColor(PALE); c.rect(0, 0, W, H, fill=1, stroke=0)
title(c, "A plataforma", "Um espaço digital feito para estar em comunidade", "O Tchilar aproxima pessoas, criadores e comunidades num só lugar.")
image_cover(ROOT / "public" / "tchilar-community-friends.jpg", 565, 83, 339, 268, 22)
text(c, 579, 67, "Imagem ilustrativa", 8, MUTED)
y = 342
y = bullet(c, 58, y, "Partilha diária", "Publicações com texto, fotografia e vídeo; stories de 24 horas e reels curtos.", 440)
y = bullet(c, 58, y, "Pessoas e interesses", "Perfis, amizades, pesquisa e descoberta de novas vozes.", 440)
y = bullet(c, 58, y, "Comunidades vivas", "Grupos, páginas, eventos, diretos e mensagens privadas.", 440)
footer(c, 2); c.showPage()

# 3 — Social experience
c.setFillColor(white); c.rect(0, 0, W, H, fill=1, stroke=0)
title(c, "Experiência social", "Do feed às conversas, tudo começa pela partilha", "Ferramentas para publicar, descobrir e manter a conversa a acontecer.")
cards = [
    (56, 222, "01", "Publica", "Texto, fotos, vídeos, stories e reels para partilhar momentos e ideias."),
    (350, 222, "02", "Encontra a tua comunidade", "Segue pessoas, participa em grupos, acompanha páginas e descobre eventos."),
    (644, 222, "03", "Fica em contacto", "Conversa por mensagens, reage aos diretos e acompanha notificações."),
]
for x, y, number, head, body in cards:
    c.setFillColor(PALE); c.roundRect(x, y, 260, 154, 18, fill=1, stroke=0)
    text(c, x+20, y+119, number, 12, RED, "Arial-Bold")
    text(c, x+20, y+88, head, 16, INK, "Arial-Bold", maxw=220)
    text(c, x+20, y+58, body, 10.5, MUTED, leading=15, maxw=220)
image_cover(ROOT / "public" / "tchilar-community-join.jpg", 56, 66, 848, 119, 18)
c.setFillColor(HexColor("#121417")); c.roundRect(72, 82, 285, 87, 15, fill=1, stroke=0)
text(c, 92, 139, "Pessoas reais. Interesses partilhados.", 13, white, "Arial-Bold", maxw=240)
text(c, 92, 112, "Um lugar para descobrir e participar.", 10, HexColor("#D7D8D9"), maxw=245)
text(c, 73, 53, "Imagem ilustrativa", 8, MUTED)
footer(c, 3); c.showPage()

# 4 — Creator tools
c.setFillColor(PALE); c.rect(0, 0, W, H, fill=1, stroke=0)
title(c, "Para criadores", "Transforma a tua presença em novas possibilidades", "Recursos para desenvolver uma audiência, oferecer valor e acompanhar resultados.")
items = [
    ("Subscrições", "Conteúdo exclusivo e apoio mensal da comunidade."),
    ("Estrelas", "Recebe apoio em publicações e diretos."),
    ("Campanhas com marcas", "Colaborações pagas entre marcas e criadores."),
    ("Promoções", "Dá mais visibilidade a publicações, sujeitas a revisão."),
    ("Academia Tchilar", "Guias e cursos para aprender e evoluir."),
    ("Painel do criador", "Consulta estatísticas, ganhos e levantamentos.")
]
for i, (head, body) in enumerate(items):
    col, row = i % 2, i // 2
    x = 58 + col * 430
    y = 326 - row * 91
    c.setFillColor(white); c.roundRect(x, y-56, 392, 72, 15, fill=1, stroke=0)
    c.setFillColor(RED); c.roundRect(x+15, y-36, 8, 32, 4, fill=1, stroke=0)
    text(c, x+37, y-14, head, 13, INK, "Arial-Bold")
    text(c, x+37, y-36, body, 9.5, MUTED, maxw=335)
c.setFillColor(HexColor("#211619")); c.roundRect(58, 49, 844, 42, 14, fill=1, stroke=0)
text(c, 78, 75, "Criatividade com ferramentas para crescer.", 10, white, "Arial-Bold")
text(c, 78, 59, "Recursos financeiros dependem da configuração dos serviços integrados.", 8, HexColor("#D9C9CC"), maxw=780)
footer(c, 4); c.showPage()

# 5 — Closing
c.setFillColor(INK); c.rect(0, 0, W, H, fill=1, stroke=0)
c.setFillColor(RED); c.rect(0, 0, W, 9, fill=1, stroke=0)
image_cover(ROOT / "public" / "tchilar-community-selfie.jpg", 573, 65, 331, 409, 24)
c.drawImage(str(ROOT / "public" / "tchilar-logo-full-dark.png"), 56, 427, width=250, height=61, preserveAspectRatio=True, anchor="sw", mask="auto")
text(c, 57, 342, "A tua voz", 35, white, "Arial-Bold")
text(c, 57, 299, "também faz", 35, white, "Arial-Bold")
text(c, 57, 256, "parte.", 35, RED, "Arial-Bold")
text(c, 58, 190, "Conecta · Partilha · Vive", 17, white, "Arial-Bold")
text(c, 58, 150, "Uma rede social angolana em evolução,", 12, HexColor("#CFD0D1"))
text(c, 58, 130, "pensada para pessoas, comunidades e criadores.", 12, HexColor("#CFD0D1"))
pill(c, 58, 83, "Tchilar", bg=HexColor("#302326"), fg=HexColor("#FF7483"))
text(c, 588, 47, "Imagem ilustrativa", 8, HexColor("#A6A8AA"))
footer(c, 5, dark=True)
c.save()
print(OUT)
