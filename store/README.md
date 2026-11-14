# Imagens e textos para as lojas

Gerado por `npm run app:assets` (a partir de `mobile/tchilar-app/assets/tchilar-icon.png`).

| Ficheiro | Para quê |
|---|---|
| `app-store-icon-1024.png` | App Store (ícone 1024×1024, sem transparência) |
| `play-icon-512.png` | Google Play (ícone 512×512) |
| `play-feature-graphic.png` | Google Play, imagem de destaque (1024×500) |
| `screenshots/app-store-6.9/` | Capturas para iPhone 6,9" (1320×2868) |
| `screenshots/google-play/` | Capturas para Android (1080×1920) |

## Capturas de ecrã

1. No telemóvel, com a app instalada e contas de demonstração, tira capturas de: Início, Reels,
   editor de vídeo, Diretos, Painel do criador, Mensagens.
2. Copia-as para `store/raw/` com nomes por ordem: `1-inicio.png`, `2-reels.png`...
3. Escreve os títulos em `store/captions.json`, por exemplo:
   ```json
   { "1-inicio.png": "Tudo o que se passa em Angola", "2-reels.png": "Vídeos com música e efeitos" }
   ```
4. Corre `npm run app:assets`: as capturas saem com o título e o fundo da marca, nos tamanhos das duas lojas.

## Texto da loja (português)

**Nome:** Tchilar

**Subtítulo / descrição curta (até 80 caracteres):** A rede social de Angola: conecta, partilha, vive.

**Descrição:**

O Tchilar é a rede social feita em Angola, para quem cria e para quem gosta de estar junto.

- Publica fotos, vídeos e Reels com efeitos, texto e música.
- Stories que duram 24 horas.
- Diretos com comentários, reações e estrelas.
- Grupos, páginas e eventos da tua zona.
- Mensagens privadas com os teus amigos.
- Para criadores: subscrições, estrelas, campanhas com marcas e levantamentos para IBAN angolano.
- Pagamentos com Multicaixa Express e Referência.

Os teus dados são teus: descarrega-os ou apaga a conta quando quiseres (Lei n.º 22/11).

**Categoria:** Redes sociais · **Classificação etária:** 13+ (grupos secretos só para maiores de 18)

**Palavras-chave (App Store):** angola,rede social,luanda,kizomba,criadores,reels,diretos,amigos,grupos,kwanza
