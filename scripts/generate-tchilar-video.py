from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import subprocess, json, wave, shutil

ROOT = Path(__file__).resolve().parents[1]
TMP = ROOT / "tmp" / "video"
OUT = ROOT / "output" / "video" / "demonstracao-tchilar.mp4"
TMP.mkdir(parents=True, exist_ok=True)
OUT.parent.mkdir(parents=True, exist_ok=True)
W, H = 1280, 720
RED = (244, 18, 42)
INK = (16, 18, 20)
WHITE = (255, 255, 255)
PALE = (246, 246, 244)
GRAY = (105, 110, 116)
FONT = Path("C:/Windows/Fonts/arial.ttf")
BOLD = Path("C:/Windows/Fonts/arialbd.ttf")
ffmpeg = shutil.which("ffmpeg")
if not ffmpeg:
    raise SystemExit("ffmpeg não foi encontrado.")

def fnt(size, bold=False):
    return ImageFont.truetype(str(BOLD if bold else FONT), size)

def round_rect(d, xy, radius, fill, outline=None, width=1):
    d.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=width)

def text(d, x, y, s, size, fill=INK, bold=False):
    d.text((x,y), s, font=fnt(size,bold), fill=fill)

def wrapped(d, x, y, s, maxw, size, fill=GRAY, leading=None, bold=False):
    font=fnt(size,bold); leading=leading or int(size*1.35)
    for para in s.split("\n"):
        line=""
        for word in para.split():
            candidate=(line+" "+word).strip()
            if d.textlength(candidate,font=font) <= maxw or not line:
                line=candidate
            else:
                d.text((x,y),line,font=font,fill=fill); y+=leading; line=word
        if line:
            d.text((x,y),line,font=font,fill=fill); y+=leading
    return y

def cover_crop(path, size):
    im=Image.open(path).convert("RGB")
    tw,th=size; scale=max(tw/im.width,th/im.height)
    im=im.resize((int(im.width*scale),int(im.height*scale)),Image.Resampling.LANCZOS)
    x=(im.width-tw)//2; y=(im.height-th)//2
    return im.crop((x,y,x+tw,y+th)).convert("RGBA")

logo=Image.open(ROOT/"public"/"tchilar-logo-full-dark.png").convert("RGBA")
logo.thumbnail((250,70),Image.Resampling.LANCZOS)
logo_light=Image.open(ROOT/"public"/"tchilar-logo-full.png").convert("RGBA")
logo_light.thumbnail((250,70),Image.Resampling.LANCZOS)
photos=[ROOT/"public"/"tchilar-community-selfie.jpg", ROOT/"public"/"tchilar-community-friends.jpg", ROOT/"public"/"tchilar-community-join.jpg"]

def base(dark=True, section="TCHILAR"):
    im=Image.new("RGBA",(W,H),INK+(255,) if dark else PALE+(255,))
    d=ImageDraw.Draw(im)
    d.rectangle((0,0,10,H),fill=RED)
    im.alpha_composite(logo if dark else logo_light,(54,30))
    col=(183,187,191) if dark else GRAY
    text(d,54,115,section.upper(),14,RED,True)
    return im,d,col

def heading(d, title, subtitle, dark=True):
    text(d,54,151,title,38,WHITE if dark else INK,True)
    wrapped(d,56,204,subtitle,570,18,(212,214,216) if dark else GRAY,25)

def photo_card(im, path, xy, radius=22):
    x,y,w,h=xy
    ph=cover_crop(path,(w,h))
    mask=Image.new("L",(w,h),0); ImageDraw.Draw(mask).rounded_rectangle((0,0,w,h),radius=radius,fill=255)
    im.alpha_composite(Image.composite(ph,Image.new("RGBA",(w,h),(0,0,0,0)),mask),(x,y))

def site_scene(index, title_text, subtitle, screenshot_name):
    im,d,_=base(True,"DEMONSTRAÇÃO NO SITE LOCAL")
    text(d,54,139,"CAPTURA REAL DO SITE",12,RED,True)
    wrapped(d,54,204,title_text,305,32,WHITE,40,True)
    wrapped(d,56,311,subtitle,300,17,(211,214,217),24)
    text(d,56,651,"INTERFACE CAPTADA NO AMBIENTE LOCAL",10,(173,176,180),True)
    source=TMP/screenshot_name
    if not source.exists():
        raise SystemExit(f"Falta a captura real do site: {source}")
    page=Image.open(source).convert("RGB").resize((842,631),Image.Resampling.LANCZOS).convert("RGBA")
    mask=Image.new("L",page.size,0); ImageDraw.Draw(mask).rounded_rectangle((0,0,page.width,page.height),radius=15,fill=255)
    im.alpha_composite(Image.composite(page,Image.new("RGBA",page.size,(0,0,0,0)),mask),(404,44))
    ImageDraw.Draw(im).rounded_rectangle((404,44,404+842,44+631),radius=15,outline=(76,80,85),width=2)
    return im

def tag(d, x,y, label, dark=True):
    bg=(43,35,38) if dark else (255,231,234)
    fg=(255,116,131) if dark else RED
    font=fnt(12,True); w=int(d.textlength(label,font=font))+24
    round_rect(d,(x,y,x+w,y+30),15,bg)
    text(d,x+12,y+7,label,12,fg,True)

def make_scene(i):
    path=TMP/f"scene-{i:02d}.png"
    if 2 <= i <= 5:
        screens={
            2:("Feed e descoberta","Publicações, stories e navegação num único espaço.","site-feed.png"),
            3:("Perfis da comunidade","Uma página pessoal para apresentar ideias e publicações.","site-profile.png"),
            4:("Painel do criador","Insights e ferramentas para gerir conteúdo e monetização.","site-creator.png"),
            5:("Grupos e interesses","Espaços para conversar e organizar comunidades.","site-groups.png")
        }
        im=site_scene(i,*screens[i])
    elif i==1:
        im=Image.new("RGBA",(W,H),INK+(255,)); d=ImageDraw.Draw(im)
        photo_card(im,photos[0],(735,0,545,H),0)
        overlay=Image.new("RGBA",(W,H),(0,0,0,0)); od=ImageDraw.Draw(overlay)
        for x in range(0,780): od.line((x,0,x,H),fill=(13,15,17,int(255*(1-x/780))))
        im=Image.alpha_composite(im,overlay); d=ImageDraw.Draw(im)
        d.rectangle((0,0,10,H),fill=RED); im.alpha_composite(logo,(56,35))
        tag(d,58,154,"APRESENTAÇÃO DO PROJETO")
        text(d,57,231,"Tchilar",62,WHITE,True)
        text(d,59,315,"Conecta. Partilha. Vive.",28,RED,True)
        wrapped(d,60,390,"Uma rede social angolana para pessoas, comunidades e criadores.",560,21,(232,233,234),30)
        text(d,60,655,"DEMONSTRAÇÃO VISUAL  ·  NOVEMBRO 2026",12,(188,190,193),True)
    elif i==2:
        im,d,_=base(True,"UMA PLATAFORMA LIGADA")
        heading(d,"Site, app e API partilham a mesma base","Uma experiência conectada em web e dispositivos móveis.")
        cards=[(58,390,285,160,"SITE WEB","React 19 + Vite\nFeed, perfis e comunidades."),(496,390,285,160,"API","Node.js + Express\nRegras, contas e serviços."),(934,390,285,160,"APP MÓVEL","React Native + Expo\niOS e Android.")]
        for x,y,w,h,a,b in cards:
            round_rect(d,(x,y,x+w,y+h),20,(35,38,41),outline=(62,66,71),width=2)
            text(d,x+20,y+22,a,15,RED,True); wrapped(d,x+20,y+58,b,w-40,21,WHITE,31,True)
        for x1,x2 in [(343,496),(781,934)]:
            d.line((x1,470,x2,470),fill=(142,147,153),width=3)
            d.polygon([(x2,470),(x2-12,462),(x2-12,478)],fill=(142,147,153))
        round_rect(d,(363,267,917,335),17,(29,32,35),outline=(62,66,71),width=1)
        text(d,421,290,"POSTGRESQL  ·  CONTAS, PUBLICAÇÕES E DADOS",15,WHITE,True)
        text(d,58,677,"ESQUEMA DE ARQUITETURA",11,(173,176,180),True)
    elif i==3:
        im,d,_=base(False,"PARTILHA E DESCOBERTA")
        heading(d,"Um feed para publicar e descobrir","Texto, fotografias, vídeos, stories e reels ajudam a comunidade a manter a conversa viva.",False)
        # Phone frame / illustrative UI.
        round_rect(d,(704,60,1100,662),38,(20,22,24))
        round_rect(d,(716,72,1088,650),29,WHITE)
        text(d,742,91,"Tchilar",22,INK,True); text(d,1003,98,"Agora",12,RED,True)
        text(d,743,134,"Stories",14,INK,True)
        for j,p in enumerate(photos):
            photo_card(im,p,(741+j*106,158,82,82),41)
        round_rect(d,(738,258,1066,617),18,(250,250,249),outline=(229,230,228),width=2)
        photo_card(im,photos[1],(754,273,296,170),14)
        text(d,756,457,"@comunidade",13,INK,True)
        text(d,756,483,"Um momento partilhado",14,INK,True)
        text(d,756,512,"Gostos     Comentários     Partilhar",11,GRAY)
        text(d,756,557,"Feed e publicações",12,RED,True)
        text(d,756,582,"Pré-visualização ilustrativa",10,GRAY)
        tag(d,730,626,"ECRÃ ILUSTRATIVO",False)
    elif i==4:
        im,d,_=base(True,"GRUPOS E COMUNIDADES")
        heading(d,"Encontra a tua comunidade","Grupos, páginas, mensagens e eventos aproximam pessoas em torno do que gostam.")
        photo_card(im,photos[2],(690,117,520,420),24)
        round_rect(d,(76,370,651,570),22,(35,38,41),outline=(62,66,71),width=2)
        text(d,105,397,"COMUNIDADES",13,RED,True)
        for j,(a,b) in enumerate([("Grupos","Participar e conversar"),("Páginas","Acompanhar criadores"),("Eventos","Descobrir e reunir")]):
            y=447+j*42
            d.ellipse((108,y,124,y+16),fill=RED)
            text(d,143,y-1,a,18,WHITE,True); text(d,315,y+2,b,14,(193,196,200))
        text(d,704,561,"Imagem ilustrativa",11,(176,179,183))
        tag(d,78,611,"PARTICIPAÇÃO E CONVERSA")
    elif i==5:
        im,d,_=base(False,"FERRAMENTAS PARA CRIADORES")
        heading(d,"Cria uma comunidade à tua volta","Painel do criador, subscrições, Estrelas, campanhas, cursos e promoções.",False)
        round_rect(d,(92,293,1188,620),24,WHITE,outline=(226,227,225),width=2)
        text(d,123,320,"Painel do Criador",21,INK,True)
        widgets=[("Audiência","Acompanha a comunidade"),("Subscrições","Conteúdo exclusivo"),("Estrelas","Apoio em posts e diretos"),("Campanhas","Parcerias com marcas")]
        for j,(a,b) in enumerate(widgets):
            x=123+j*260
            round_rect(d,(x,383,x+230,484),18,(247,247,245),outline=(232,233,231),width=1)
            text(d,x+16,403,a,16,RED,True); wrapped(d,x+16,435,b,196,14,GRAY,19)
        # Abstract activity bars, no fake metrics.
        text(d,123,514,"Atividade da comunidade",14,INK,True)
        for j,h in enumerate([38,54,42,67,49,81,58,72,45,61,85,52]):
            x=126+j*47; d.rounded_rectangle((x,604-h,x+20,604),radius=8,fill=RED if j in (5,10) else (216,219,219))
        tag(d,924,543,"ECRÃ ILUSTRATIVO · SEM DADOS REAIS",False)
    elif i==6:
        im,d,_=base(False,"ESTADO DO PROJETO")
        heading(d,"A base do produto está construída","O próximo passo é preparar a operação e disponibilizar as apps ao público.",False)
        round_rect(d,(66,299,607,594),20,(239,249,242),outline=(201,228,208),width=2)
        round_rect(d,(672,299,1213,594),20,(255,245,242),outline=(239,214,210),width=2)
        text(d,96,329,"IMPLEMENTADO",15,(31,122,67),True)
        text(d,702,329,"A PREPARAR",15,(185,69,53),True)
        done=["Site, API e app Expo", "Feed, perfis e comunidades", "Ferramentas para criadores", "Testes e builds registados nas notas"]
        todo=["Domínio, hospedagem e HTTPS", "Credenciais reais dos serviços", "Primeiro build e publicação nas lojas", "Revisões operacionais e legais"]
        for j,s in enumerate(done):
            yy=378+j*46; d.ellipse((98,yy+1,112,yy+15),fill=(31,150,76)); text(d,128,yy-2,s,16,INK)
        for j,s in enumerate(todo):
            yy=378+j*46; d.ellipse((704,yy+1,718,yy+15),fill=RED); text(d,734,yy-2,s,15,INK)
        text(d,68,624,"Estado baseado nas notas do projeto, atualizadas em 15/11/2026.",12,GRAY,True)
    else:
        im=Image.new("RGBA",(W,H),INK+(255,)); photo_card(im,photos[0],(748,0,532,H),0)
        overlay=Image.new("RGBA",(W,H),(0,0,0,0)); od=ImageDraw.Draw(overlay)
        for x in range(0,800): od.line((x,0,x,H),fill=(13,15,17,int(255*(1-x/800))))
        im=Image.alpha_composite(im,overlay); d=ImageDraw.Draw(im)
        d.rectangle((0,0,10,H),fill=RED); im.alpha_composite(logo,(56,42))
        text(d,59,225,"A tua voz",53,WHITE,True)
        text(d,59,291,"também faz parte.",42,RED,True)
        text(d,62,390,"Conecta · Partilha · Vive",23,WHITE,True)
        wrapped(d,62,443,"Tchilar. Uma rede para criar, partilhar e crescer junto.",570,18,(224,226,228),26)
        text(d,62,654,"IMAGENS ILUSTRATIVAS  ·  DEMONSTRAÇÃO VISUAL DO PROJETO",11,(185,188,191),True)
    im.convert("RGB").save(path,quality=94)
    return path

SCENES = [
    "O Tchilar é uma rede social angolana para pessoas, comunidades e criadores. Conecta, partilha, vive.",
    "No feed, publicam-se texto, fotografias, vídeos e stories. A comunidade descobre novidades no mesmo espaço.",
    "Cada pessoa tem um perfil próprio para apresentar ideias e acompanhar publicações da comunidade.",
    "O painel do criador reúne insights, conteúdos e ferramentas para subscrições, promoções e parcerias.",
    "Nos grupos, as pessoas conversam e organizam interesses em espaços partilhados.",
    "A versão local reúne site, API e app móvel. Para o lançamento público ainda faltam infraestrutura, credenciais de produção, build das lojas e validações operacionais.",
    "Tchilar. Conecta, partilha, vive."
]

manifest=[]
for idx, narration in enumerate(SCENES,1):
    make_scene(idx)
    manifest.append({"image":str(TMP/f"scene-{idx:02d}.png"),"text":narration,"audio":str(TMP/f"voice-{idx:02d}.wav")})
(TMP/"narration.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Preparadas {len(manifest)} cenas em {TMP}")
