// Reações rápidas durante um direto (coração, gosto, faísca).
// Com 100 mil pessoas a tocar no ecrã, cada reação não pode ser uma escrita na base de dados:
// contam-se em memória e o feed (já partilhado e em cache) leva os totais. Cada browser compara
// com os totais anteriores e anima a diferença.
const REACTION_KINDS = ["heart", "like", "spark"];
const REACTION_GAP_MS = 400; // no máximo ~2,5 reações por segundo por pessoa

class LiveReactions {
  constructor() {
    this.totals = new Map(); // liveId → { heart, like, spark }
    this.last = new Map();   // "liveId:userId" → instante da última reação
  }

  // Devolve false se a reação for inválida ou demasiado rápida.
  add(liveId, userId, kind, now = Date.now()) {
    if (!REACTION_KINDS.includes(kind)) return false;
    const key = `${liveId}:${userId}`;
    if (this.last.has(key) && now - this.last.get(key) < REACTION_GAP_MS) return false;
    this.last.set(key, now);
    if (this.last.size > 300_000) this.last.clear();
    const totals = this.totals.get(liveId) || Object.fromEntries(REACTION_KINDS.map(item => [item, 0]));
    totals[kind] += 1;
    this.totals.set(liveId, totals);
    return true;
  }

  of(liveId) {
    return { ...(this.totals.get(liveId) || Object.fromEntries(REACTION_KINDS.map(item => [item, 0]))) };
  }

  forget(liveId) { this.totals.delete(liveId); }
}

module.exports = { LiveReactions, REACTION_GAP_MS, REACTION_KINDS };
