# Imagens para as lojas de apps

Feitas a partir das capturas da app num iPhone (pasta `capturas/`), com `python design/lojas/gerar.py design/lojas/capturas`.
A barra de cima foi limpa (9:41 e bateria cheia, sem o «Leitor de código» do Expo Go).

## App Store (App Store Connect → a versão da app → Pré-visualizações e capturas de ecrã)

Pasta `app-store/`: 8 imagens de **1290 × 2796** (tamanho aceite para o ecrã de iPhone de 6,9"). Sobe-as por esta ordem:

1. `01-feed.png`: Partilha o que te faz viver
2. `02-eventos.png`: Descobre eventos perto de ti
3. `03-desafios.png`: Participa e ganha prémios
4. `04-painel-criador.png`: Acompanha o teu crescimento
5. `05-anuncios.png`: Chega a quem ainda não te conhece
6. `06-paginas.png`: Dá vida ao teu projeto
7. `07-academia.png`: Aprende, ensina e cresce
8. `08-menu.png`: Amigos, grupos, páginas e muito mais

As 3 primeiras são as que aparecem nos resultados de pesquisa: são as mais importantes.

## Google Play (Play Console → Presença na loja → Ficha principal da loja)

Pasta `google-play/`:
- **Capturas de ecrã do telemóvel**: as 8 imagens de **1080 × 1920** (9:16), pela mesma ordem.
- **Gráfico de funcionalidades**: `banner-1024x500.png` (obrigatório para aparecer em destaque).
- **Ícone da app** (512 × 512): usa o ícone da app (`mobile/tchilar-app/assets/icon.png`, redimensionado).

## Textos sugeridos

- **Nome**: Tchilar
- **Subtítulo (App Store, até 30 caracteres)**: Partilha o que te faz viver
- **Descrição curta (Google Play, até 80 caracteres)**: Partilha fotos e vídeos, descobre eventos e ganha com o que crias.

## Para trocar uma imagem

Tira uma nova captura na app, põe-na em `capturas/`, atualiza a lista `SLIDES` em `gerar.py` (ficheiro, título e frase)
e corre o script outra vez.
