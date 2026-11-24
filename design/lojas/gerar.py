# Imagens para a App Store e o Google Play a partir das capturas da app.
# Uso: python design/lojas/gerar.py <pasta-com-as-capturas>
# Saída: design/lojas/app-store (1290x2796, iPhone 6.9"), design/lojas/google-play (1080x1920) e o banner 1024x500.
import os
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
SRC = sys.argv[1] if len(sys.argv) > 1 else HERE
FONT_BOLD = "C:/Windows/Fonts/segoeuib.ttf"
FONT_REG = "C:/Windows/Fonts/segoeui.ttf"

INK = (11, 11, 12)
RED = (227, 6, 19)
MUTED = (96, 96, 104)
BG = (242, 242, 244)

# (ficheiro, nome, etiqueta, título, subtítulo) pela ordem das lojas.
SLIDES = [
    ("1b313fe4-image.png", "01-feed", "FEED", "Partilha o que te faz viver", "Fotos, vídeos, stories e reels com quem gostas."),
    ("b6faabf6-image.png", "02-eventos", "EVENTOS", "Descobre eventos perto de ti", "Concertos, feiras e aulas. Compra o bilhete na app."),
    ("1f4fd6b1-image.png", "03-desafios", "DESAFIOS", "Participa e ganha prémios", "Desafios todos os meses, com prémios em kwanzas e estrelas."),
    ("9c0da92e-image.png", "04-painel-criador", "PAINEL DO CRIADOR", "Acompanha o teu crescimento", "Visualizações, seguidores e ganhos num só ecrã."),
    ("14bc716e-image.png", "05-anuncios", "ANÚNCIOS", "Chega a quem ainda não te conhece", "Impulsiona as tuas publicações a partir de 1000 Kz."),
    ("2e575bff-image.png", "06-paginas", "PÁGINAS", "Dá vida ao teu projeto", "Cria a página da tua marca, banda ou negócio."),
    ("d1bd94bf-image.png", "07-academia", "ACADEMIA TCHILAR", "Aprende, ensina e cresce", "Cursos de criadores, com amostras grátis."),
    ("17019455-image.png", "08-menu", "TUDO NUM SÓ LUGAR", "Amigos, grupos, páginas e muito mais", "Eventos, estrelas, desafios e academia na mesma app."),
]

STATUS_CROP = 140  # altura da barra de estado nas capturas (1170x2532)


def font(path, size):
    return ImageFont.truetype(path, size)


def wrap(draw, text, fnt, width):
    lines, line = [], ""
    for word in text.split():
        trial = f"{line} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def clean_screen(shot):
    """Tira a barra de estado verdadeira (hora, «Leitor de código», bateria) e desenha uma limpa: 9:41, bateria cheia."""
    w, h = shot.size
    bg = shot.getpixel((20, STATUS_CROP + 4))
    screen = Image.new("RGB", (w, h), bg)
    screen.paste(shot.crop((0, STATUS_CROP, w, h)), (0, STATUS_CROP))
    d = ImageDraw.Draw(screen)
    fg = (0, 0, 0) if sum(bg) > 380 else (255, 255, 255)
    d.text((120, 70), "9:41", font=font(FONT_BOLD, 50), fill=fg, anchor="lm")
    # Bateria cheia e sinal, simples.
    bx, by = w - 150, 52
    d.rounded_rectangle((bx, by, bx + 78, by + 36), radius=10, outline=fg, width=4)
    d.rounded_rectangle((bx + 7, by + 7, bx + 71, by + 29), radius=5, fill=fg)
    d.rounded_rectangle((bx + 82, by + 12, bx + 88, by + 24), radius=3, fill=fg)
    for k in range(4):
        hh = 12 + k * 8
        d.rounded_rectangle((bx - 120 + k * 18, by + 36 - hh, bx - 108 + k * 18, by + 36), radius=3, fill=fg)
    return screen


def phone(screen, width):
    """Captura dentro de um telemóvel: cantos redondos e moldura preta."""
    sw = width - 2 * round(width * 0.022)
    sh = round(screen.height * sw / screen.width)
    bezel = (width - sw) // 2
    scaled = screen.resize((sw, sh), Image.Resampling.LANCZOS)
    radius = round(sw * 0.11)
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw, sh), radius=radius, fill=255)
    body = Image.new("RGBA", (width, sh + 2 * bezel), (0, 0, 0, 0))
    ImageDraw.Draw(body).rounded_rectangle((0, 0, width - 1, sh + 2 * bezel - 1), radius=radius + bezel, fill=(18, 18, 20, 255))
    body.paste(scaled, (bezel, bezel), mask)
    return body


def slide(shot, size, kicker, title, subtitle):
    W, H = size
    s = W / 1290  # escala a partir do desenho da App Store
    canvas = Image.new("RGB", size, BG)
    d = ImageDraw.Draw(canvas)
    margin = round(80 * s)
    y = round(150 * s)
    d.text((W // 2, y), kicker, font=font(FONT_BOLD, round(40 * s)), fill=RED, anchor="mt")
    y += round(72 * s)
    tfont = font(FONT_BOLD, round(96 * s))
    for line in wrap(d, title, tfont, W - 2 * margin):
        d.text((W // 2, y), line, font=tfont, fill=INK, anchor="mt")
        y += round(112 * s)
    y += round(14 * s)
    sfont = font(FONT_REG, round(46 * s))
    for line in wrap(d, subtitle, sfont, W - 2 * margin - round(60 * s)):
        d.text((W // 2, y), line, font=sfont, fill=MUTED, anchor="mt")
        y += round(60 * s)
    # Telemóvel: começa por baixo do texto e sai pelo fundo (como nas lojas).
    pw = round(min(W * 0.78, (H - y - 60 * s) * 0.5))
    device = phone(clean_screen(shot), pw)
    top = y + round(60 * s)
    shadow = Image.new("RGBA", size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(((W - pw) // 2, top + round(30 * s), (W + pw) // 2, top + device.height),
                                             radius=round(pw * 0.13), fill=(0, 0, 0, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(round(40 * s)))
    canvas = Image.alpha_composite(canvas.convert("RGBA"), shadow)
    canvas.paste(device, ((W - pw) // 2, top), device)
    return canvas.convert("RGB")


def feature_graphic(shot, path):
    """Banner do Google Play (1024x500): logótipo, frase e o feed num telemóvel."""
    W, H = 1024, 500
    canvas = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(canvas)
    logo = Image.open(os.path.join(ROOT, "public", "tchilar-logo-full-dark.png")).convert("RGBA")
    lw = 330
    logo = logo.resize((lw, round(logo.height * lw / logo.width)), Image.Resampling.LANCZOS)
    canvas.paste(logo, (64, 120), logo)
    tfont = font(FONT_BOLD, 50)
    y = 120 + logo.height + 40
    for line in ["Partilha o que", "te faz viver."]:
        d.text((64, y), line, font=tfont, fill=(255, 255, 255))
        y += 60
    d.rectangle((64, y + 22, 64 + 90, y + 28), fill=RED)
    device = phone(clean_screen(shot), 300)
    canvas.paste(device, (W - 300 - 90, 70), device)
    canvas.save(path, optimize=True)


def main():
    out_ios = os.path.join(HERE, "app-store")
    out_play = os.path.join(HERE, "google-play")
    os.makedirs(out_ios, exist_ok=True)
    os.makedirs(out_play, exist_ok=True)
    for file, name, kicker, title, subtitle in SLIDES:
        shot = Image.open(os.path.join(SRC, file)).convert("RGB")
        slide(shot, (1290, 2796), kicker, title, subtitle).save(os.path.join(out_ios, f"{name}.png"), optimize=True)
        slide(shot, (1080, 1920), kicker, title, subtitle).save(os.path.join(out_play, f"{name}.png"), optimize=True)
        print("ok", name)
    feature_graphic(Image.open(os.path.join(SRC, SLIDES[0][0])).convert("RGB"), os.path.join(out_play, "banner-1024x500.png"))
    print("ok banner")


if __name__ == "__main__":
    main()
