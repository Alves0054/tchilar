// Catálogo de desafios mensais (40 modelos). A equipa escolhe quais lança em cada mês, e pode editar
// títulos, textos e prémios na Administração. Os prémios sobem com o nível: estrelas nos primeiros níveis,
// estrelas + dinheiro (Kz, entra no saldo do vencedor e levanta-se para o IBAN) nos níveis mais altos.
//
// Cada prémio é { place, stars, cashKz }: 1.º, 2.º e 3.º lugar (por gostos na publicação, desempate pela
// participação mais antiga).
const LEVELS = {
  1: { name: "Bronze", prizes: [{ place: 1, stars: 50, cashKz: 0 }, { place: 2, stars: 30, cashKz: 0 }, { place: 3, stars: 20, cashKz: 0 }] },
  2: { name: "Prata", prizes: [{ place: 1, stars: 100, cashKz: 0 }, { place: 2, stars: 60, cashKz: 0 }, { place: 3, stars: 40, cashKz: 0 }] },
  3: { name: "Ouro", prizes: [{ place: 1, stars: 250, cashKz: 0 }, { place: 2, stars: 150, cashKz: 0 }, { place: 3, stars: 100, cashKz: 0 }] },
  4: { name: "Diamante", prizes: [{ place: 1, stars: 500, cashKz: 5000 }, { place: 2, stars: 300, cashKz: 2500 }, { place: 3, stars: 200, cashKz: 0 }] },
  5: { name: "Lenda", prizes: [{ place: 1, stars: 1000, cashKz: 25000 }, { place: 2, stars: 500, cashKz: 10000 }, { place: 3, stars: 300, cashKz: 5000 }] }
};

// [código, nível, categoria, título, descrição]
const TEMPLATES = [
  // Nível 1 — Bronze: para começar, qualquer pessoa consegue.
  ["bom-dia-angola", 1, "foto", "Bom dia, Angola", "Publica a vista da tua janela ou da tua rua de manhã. Mostra como acorda o teu bairro."],
  ["o-meu-prato", 1, "comida", "O meu prato preferido", "Fotografa o teu prato angolano favorito (funge, muamba, calulu...) e conta onde se come melhor."],
  ["selfie-com-sorriso", 1, "foto", "Selfie com sorriso", "Uma selfie a sorrir e uma frase sobre o que te deixou feliz esta semana."],
  ["pet-do-mes", 1, "foto", "O meu animal de estimação", "Mostra o teu cão, gato ou outro companheiro. Diz-nos o nome e a mania mais engraçada."],
  ["por-do-sol", 1, "foto", "Pôr do sol", "O pôr do sol mais bonito que conseguires apanhar este mês, em qualquer ponto do país."],
  ["frase-do-mes", 1, "comunidade", "Frase que me inspira", "Partilha uma frase (tua, de um mais-velho ou de um livro) que te dá força. Explica porquê."],
  ["o-meu-cantinho", 1, "foto", "O meu cantinho", "O sítio da casa ou do bairro onde gostas mais de estar. Uma foto e duas linhas."],
  ["throwback", 1, "foto", "Foto antiga", "Uma foto tua de há mais de 5 anos. Conta o que mudou desde então."],
  // Nível 2 — Prata: pede um pouco mais de criatividade.
  ["kizomba-15s", 2, "dança", "Kizomba em 15 segundos", "Um Reel de 15 segundos a dançar kizomba, semba ou kuduro. Sozinho, a par ou em grupo."],
  ["receita-rapida", 2, "comida", "Receita em 1 minuto", "Ensina uma receita simples num vídeo de até 1 minuto: ingredientes, passos e o prato final."],
  ["look-do-dia", 2, "moda", "Look do dia", "Mostra o teu look com um tecido africano ou uma peça feita em Angola. Diz onde compraste."],
  ["piada-curta", 2, "comédia", "Piada de 30 segundos", "Um vídeo curto com uma piada ou uma situação do dia a dia angolano. Respeito acima de tudo."],
  ["mercado-cores", 2, "foto", "Cores do mercado", "Fotografa as cores de um mercado (Roque, São Paulo, Kikolo ou o da tua terra), com autorização de quem aparece."],
  ["desporto-de-rua", 2, "desporto", "Desporto de rua", "Futebol de rua, basquete, capoeira ou corrida: mostra a tua modalidade num vídeo ou foto em ação."],
  ["antes-depois", 2, "criatividade", "Antes e depois", "Mostra a transformação de algo: um quarto arrumado, um penteado, um móvel restaurado."],
  ["lingua-nacional", 2, "cultura", "Uma palavra em língua nacional", "Ensina uma palavra ou expressão em umbundu, kimbundu, kikongo, chokwe ou outra língua nacional."],
  // Nível 3 — Ouro: criadores dedicados.
  ["mini-documentario", 3, "vídeo", "Mini-documentário do bairro", "Um vídeo de até 3 minutos sobre uma pessoa, um ofício ou uma história do teu bairro."],
  ["cover-musical", 3, "música", "Cover acústico", "Canta ou toca uma música angolana em versão acústica. Indica o artista original."],
  ["tutorial-util", 3, "educação", "Tutorial útil", "Ensina algo prático em vídeo: poupar dinheiro, usar o Multicaixa Express, cuidar das plantas..."],
  ["fotografia-preto-branco", 3, "foto", "Angola a preto e branco", "Uma série de 3 fotos a preto e branco com um tema à tua escolha. Usa o efeito P&B do Tchilar."],
  ["desafio-coreografia", 3, "dança", "Coreografia original", "Cria uma coreografia original para uma música angolana e publica o Reel. Outros podem copiar!"],
  ["empreendedor", 3, "empreender", "O meu negócio", "Apresenta o teu negócio ou projeto em 1 minuto: o que fazes, para quem e como te encontrar."],
  ["poesia-falada", 3, "cultura", "Poesia falada", "Recita um poema teu (ou de um poeta angolano, com crédito) em vídeo."],
  ["natureza-viva", 3, "natureza", "Natureza viva", "Fotografa ou filma a natureza angolana: Kalandula, Tundavala, praias, florestas, animais."],
  // Nível 4 — Diamante: estrelas e dinheiro.
  ["curta-metragem", 4, "vídeo", "Curta-metragem de 3 minutos", "Uma história completa (início, meio e fim) em até 3 minutos. Ficção ou realidade."],
  ["musica-original", 4, "música", "Música original", "Publica uma música tua, original, com letra. Pode ser em português ou numa língua nacional."],
  ["serie-fotografica", 4, "foto", "Série fotográfica", "5 fotos que contam uma história. Escreve a legenda de cada uma no texto da publicação."],
  ["impacto-comunidade", 4, "comunidade", "Ação na comunidade", "Mostra uma ação solidária que fizeste ou organizaste: limpeza, doação, aulas grátis..."],
  ["moda-sustentavel", 4, "moda", "Moda sustentável", "Cria um look com roupa reaproveitada ou feita por ti. Mostra o processo."],
  ["chef-angolano", 4, "comida", "Chef angolano", "Recria um prato tradicional com um toque moderno. Vídeo do processo e prato final."],
  ["professor-por-um-dia", 4, "educação", "Professor por um dia", "Uma aula de até 5 minutos sobre um tema que dominas. Clara, útil e com exemplos."],
  ["viagem-angola", 4, "viagem", "Viagem por Angola", "Mostra uma viagem por uma província: o que ver, onde comer e quanto custa."],
  // Nível 5 — Lenda: os grandes prémios do mês.
  ["criador-do-mes", 5, "criador", "Criador do mês", "A tua melhor publicação do mês, em qualquer formato. A comunidade decide com os gostos."],
  ["videoclipe", 5, "música", "Videoclipe", "Grava um videoclipe para uma música tua ou de um artista angolano (com autorização)."],
  ["documentario-cultural", 5, "cultura", "Documentário cultural", "Até 5 minutos sobre uma tradição angolana: festas, artesanato, gastronomia, música."],
  ["startup-angola", 5, "empreender", "Ideia que muda Angola", "Apresenta uma ideia ou projeto que resolve um problema real do país. Explica como funciona."],
  ["campeao-danca", 5, "dança", "Campeonato de dança", "A tua melhor atuação de dança do ano, em vídeo. Solo ou grupo."],
  ["humor-do-ano", 5, "comédia", "Humor do ano", "O teu melhor sketch de humor, até 3 minutos, com respeito e criatividade."],
  ["fotografo-do-ano", 5, "foto", "Fotógrafo do mês", "A tua melhor fotografia, tirada este mês. Conta a história por trás dela."],
  ["influencia-positiva", 5, "comunidade", "Influência positiva", "Mostra como usas as redes para ajudar outras pessoas. Pode ser uma série de publicações resumida num vídeo."]
];

const templateRows = () => TEMPLATES.map(([code, level, category, title, description], index) => ({
  code, level, category, title, description, sort: index + 1, prizes: LEVELS[level].prizes
}));

// Valida os prémios vindos da Administração: até 10 lugares, estrelas e Kz não negativos.
function parsePrizes(raw) {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) return { error: "Indica entre 1 e 10 prémios." };
  const prizes = [];
  for (const [index, item] of raw.entries()) {
    const stars = Number(item?.stars ?? 0);
    const cashKz = Number(item?.cashKz ?? 0);
    if (!Number.isInteger(stars) || stars < 0 || stars > 1_000_000) return { error: `Estrelas inválidas no ${index + 1}.º lugar.` };
    if (!Number.isFinite(cashKz) || cashKz < 0 || cashKz > 10_000_000 || Math.round(cashKz * 100) !== cashKz * 100) {
      return { error: `Valor em Kz inválido no ${index + 1}.º lugar.` };
    }
    prizes.push({ place: index + 1, stars, cashKz });
  }
  if (!prizes.some(prize => prize.stars > 0 || prize.cashKz > 0)) return { error: "Pelo menos um lugar tem de ter prémio." };
  return { prizes };
}
const hasCash = prizes => prizes.some(prize => Number(prize.cashKz) > 0);

module.exports = { LEVELS, TEMPLATES, hasCash, parsePrizes, templateRows };
