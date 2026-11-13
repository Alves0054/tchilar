// Regras dos anúncios (sem Express), para poderem ser testadas sozinhas. Valores em kwanzas.

// Custo por mil impressões únicas (uma por pessoa e por dia).
const AD_CPM_KZ = 500;
const MIN_AD_BUDGET = 1000;
const MAX_AD_BUDGET = 10_000_000;
const MAX_AD_DAYS = 30;

// Quanto custa uma impressão única, arredondado ao cêntimo.
function impressionCost() {
  return Math.round((AD_CPM_KZ / 1000) * 100) / 100;
}

// Valida e normaliza os dados de um anúncio novo. Devolve { ad } ou { error }.
function parseAdInput(input, ownerUsername) {
  const text = value => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");
  const title = text(input.title);
  const body = text(input.body);
  if (!title || title.length > 80) return { error: "O título do anúncio deve ter entre 1 e 80 caracteres." };
  if (body.length > 200) return { error: "O texto do anúncio pode ter até 200 caracteres." };

  const budget = Number(input.budget);
  if (!Number.isFinite(budget) || budget < MIN_AD_BUDGET || budget > MAX_AD_BUDGET) {
    return { error: `O orçamento deve estar entre ${formatKz(MIN_AD_BUDGET)} e ${formatKz(MAX_AD_BUDGET)}.` };
  }
  const days = Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > MAX_AD_DAYS) {
    return { error: `A duração deve ser entre 1 e ${MAX_AD_DAYS} dias.` };
  }

  // Destino: o perfil de quem anuncia, ou um site externo (só https).
  let linkUrl = `/u/${ownerUsername}`;
  if (input.destination === "link") {
    let url;
    try {
      url = new URL(text(input.linkUrl));
    } catch {
      return { error: "Indica um endereço válido, começado por https://." };
    }
    if (url.protocol !== "https:") return { error: "Por segurança, o endereço tem de começar por https://." };
    linkUrl = url.toString();
  } else if (input.destination !== undefined && input.destination !== "profile") {
    return { error: "Destino do anúncio inválido." };
  }

  return { ad: { title, body, linkUrl, budget: Math.round(budget * 100) / 100, days } };
}

function formatKz(value) {
  return `${Number(value).toLocaleString("pt-PT")} Kz`;
}

// Quem anuncia vê o público por província, mas um grupo pequeno podia identificar alguém.
// As províncias com menos de AUDIENCE_MIN_GROUP pessoas (e quem não indicou) juntam-se em «Outras».
const AUDIENCE_MIN_GROUP = 5;
function groupAudience(rows, min = AUDIENCE_MIN_GROUP) {
  const shown = [];
  let other = 0;
  for (const { province, people } of rows) {
    if (province && people >= min) shown.push({ province, people });
    else other += people;
  }
  shown.sort((a, b) => b.people - a.people || a.province.localeCompare(b.province));
  if (other > 0) shown.push({ province: null, people: other });
  return shown;
}

module.exports = { AUDIENCE_MIN_GROUP, groupAudience, AD_CPM_KZ, MAX_AD_BUDGET, MAX_AD_DAYS, MIN_AD_BUDGET, formatKz, impressionCost, parseAdInput };
