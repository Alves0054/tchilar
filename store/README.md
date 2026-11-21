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

## Publicar (depois das capturas)

A configuração já está pronta: `mobile/tchilar-app/eas.json` (builds de teste e de produção a apontar para
`https://api.tchilar.ao`), `app.json` (permissões explicadas em português, declaração de encriptação,
manifesto de privacidade da Apple, links que abrem a app). O `expo-doctor` passa nas 20 verificações.

Antes do primeiro build:

1. **O servidor tem de estar no ar** em `https://api.tchilar.ao` (ver `NOTA-DEPLOY.md`): a app instalada fala com ele.
2. Na pasta da app, entra na tua conta Expo e liga o projeto (cria o `projectId`, sem ele não há notificações push):
   `npx eas-cli@latest login` e depois `npx eas-cli@latest init`.
3. Build de teste para experimentar no telemóvel (push, chamadas, diretos, Face ID):
   `npx eas-cli@latest build --profile preview --platform android` (APK) e
   `npx eas-cli@latest build --profile production --platform ios` → TestFlight.
4. Quando estiver bom: `npx eas-cli@latest build --profile production --platform all` e
   `npx eas-cli@latest submit --platform all`.

Nas lojas vais precisar também de:
- **Política de privacidade**: `https://tchilar.ao/privacy`.
- **Apagar a conta**: Definições → Conta → Apagar conta (a Apple e o Google pedem que exista dentro da app).
- **Conteúdo gerado por utilizadores**: denunciar publicações, comentários, perfis, grupos e cursos, bloquear
  pessoas, e os Termos aceites no registo (pedido pela Apple, regra 1.2).
- **Conta de demonstração** para a equipa de revisão das lojas (cria uma no servidor de produção e dá o email e a
  palavra-passe só no formulário da loja).
- **Classificação etária**: 17+ na Apple / "Adolescentes" ou superior no Google (há chamadas, mensagens e grupos +18).

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
