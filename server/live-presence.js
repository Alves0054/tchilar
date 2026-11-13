// Quem está a ver cada direto, em memória.
// Com 100 mil espectadores, gravar cada sinal de vida na base de dados seriam milhares de escritas
// por segundo. Aqui um sinal é uma operação O(1) num Map; a contagem é recalculada a cada poucos
// segundos (prune) e só o pico e o total de pessoas diferentes vão para a base de dados.
// Nota: a contagem é por processo. Com várias instâncias da API, usar Redis (ver deploy/README.md).
class LivePresence {
  constructor({ windowMs = 75_000 } = {}) {
    this.windowMs = windowMs;
    this.lives = new Map(); // liveId → { seen: Map<userId, ts>, unique: Set<userId>, count, peak }
  }

  entry(liveId) {
    let live = this.lives.get(liveId);
    if (!live) { live = { seen: new Map(), unique: new Set(), count: 0, peak: 0 }; this.lives.set(liveId, live); }
    return live;
  }

  touch(liveId, userId, now = Date.now()) {
    const live = this.entry(liveId);
    if (!live.seen.has(userId)) live.count += 1;
    live.seen.set(userId, now);
    live.unique.add(userId);
    live.peak = Math.max(live.peak, live.count);
  }

  leave(liveId, userId) {
    const live = this.lives.get(liveId);
    if (live?.seen.delete(userId)) live.count -= 1;
  }

  count(liveId) { return this.lives.get(liveId)?.count || 0; }

  stats(liveId) {
    const live = this.lives.get(liveId);
    return live ? { viewers: live.count, peak: live.peak, unique: live.unique.size } : { viewers: 0, peak: 0, unique: 0 };
  }

  // Remove quem deixou de dar sinal. Devolve as estatísticas de cada direto para gravar.
  prune(now = Date.now()) {
    const limit = now - this.windowMs;
    const snapshot = [];
    for (const [liveId, live] of this.lives) {
      for (const [userId, seenAt] of live.seen) if (seenAt < limit) live.seen.delete(userId);
      live.count = live.seen.size;
      snapshot.push({ liveId, viewers: live.count, peak: live.peak, unique: live.unique.size });
    }
    return snapshot;
  }

  forget(liveId) { this.lives.delete(liveId); }
}

// Com mais gente, os browsers perguntam menos vezes (o chat continua fluido e o servidor aguenta).
function pollInterval(viewers) {
  if (viewers < 500) return 2500;
  if (viewers < 5000) return 4000;
  if (viewers < 50000) return 6000;
  return 8000;
}

module.exports = { LivePresence, pollInterval };
