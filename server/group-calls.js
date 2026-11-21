// Chamadas de voz e vídeo: nos grupos e a partir das mensagens (diretas, com convidados).
//
// Sem servidor de vídeo: cada participante liga-se diretamente a cada um dos outros (malha WebRTC), por isso
// o limite é de 8 pessoas. A API só faz a "sinalização": guarda quem está na chamada e passa as ofertas e
// respostas SDP de um para o outro. Com TURN configurado (LIVE_TURN_*), o áudio e o vídeo passam pela
// retransmissão e ninguém vê o IP de outra pessoa (o mesmo que nos diretos).
//
// Quem liga a quem: entre duas pessoas, quem tem o número de utilizador MAIS BAIXO envia a oferta.
//
// Rotas:
//   Grupos:   GET/POST /api/groups/:groupId/call, .../call/heartbeat, .../call/signal, .../call/leave
//   Diretas:  POST /api/calls (ligar a alguém), GET /api/calls/incoming (está a tocar?),
//             POST /api/calls/:callId/join | heartbeat | signal | leave | decline | invite
const MAX_PARTICIPANTS = 8;
const ALIVE_SECONDS = 25;        // sem sinal de vida há mais de 25 s → saiu da chamada
const RING_SECONDS = 45;         // uma chamada direta toca durante 45 s
const MAX_SIGNAL = 20000;

function registerGroupCalls(app, deps) {
  const { pool, auth, parseId, isRecord, transaction, turnServer, rateLimit, reachAllowed, blockedBetween } = deps;
  const env = deps.env || process.env;
  const ALIVE = `p.left_at IS NULL AND p.last_seen_at > NOW() - INTERVAL '${ALIVE_SECONDS} seconds'`;

  // ----- Motor comum (por número da chamada) -----
  const participants = callId => pool.query(`
    SELECT p.user_id,u.username,u.display_name,u.avatar_url,p.muted,p.camera,p.joined_at
    FROM group_call_participants p JOIN users u ON u.id=p.user_id
    WHERE p.call_id=$1 AND ${ALIVE} ORDER BY p.joined_at`, [callId]).then(result => result.rows);

  // Fecha a chamada se já não tem ninguém (com 10 s de margem para quem a começou, ou o tempo de toque nas diretas).
  async function stillOpen(db, call) {
    if (!call || call.ended_at) return false;
    const alive = await db.query(`SELECT COUNT(*)::int AS n FROM group_call_participants p WHERE p.call_id=$1 AND ${ALIVE}`, [call.id]);
    const grace = call.group_id ? 10000 : RING_SECONDS * 1000;
    if (alive.rows[0].n === 0 && Date.now() - new Date(call.started_at).getTime() > grace) {
      await db.query("UPDATE group_calls SET ended_at=NOW() WHERE id=$1 AND ended_at IS NULL", [call.id]);
      return false;
    }
    call.count = alive.rows[0].n;
    return true;
  }

  async function enter(client, call, userId) {
    const already = await client.query(`SELECT 1 FROM group_call_participants p WHERE p.call_id=$1 AND p.user_id=$2 AND ${ALIVE}`, [call.id, userId]);
    if (!already.rowCount && call.count >= MAX_PARTICIPANTS) return false;
    await client.query(`
      INSERT INTO group_call_participants(call_id,user_id,camera) VALUES($1,$2,$3)
      ON CONFLICT (call_id,user_id) DO UPDATE SET joined_at=NOW(), last_seen_at=NOW(), left_at=NULL, muted=FALSE, camera=$3`,
    [call.id, userId, call.kind === "video"]);
    // Sinais antigos para mim (de uma entrada anterior) já não servem.
    await client.query("DELETE FROM group_call_signals WHERE call_id=$1 AND to_user=$2", [call.id, userId]);
    return true;
  }

  const joinedResponse = async (res, call, userId) => {
    const { iceServers, iceTransportPolicy } = turnServer(userId, env);
    res.status(201).json({ call: { id: call.id, kind: call.kind, group_id: call.group_id, started_by: call.started_by, participants: await participants(call.id) }, iceServers, iceTransportPolicy, me: userId });
  };

  async function heartbeat(req, res, call) {
    if (!call || call.ended_at) return res.json({ call: null });
    const body = isRecord(req.body) ? req.body : {};
    const updated = await pool.query(`UPDATE group_call_participants SET last_seen_at=NOW(), muted=$3, camera=$4
      WHERE call_id=$1 AND user_id=$2 AND left_at IS NULL RETURNING user_id`, [call.id, req.user.id, body.muted === true, body.camera !== false]);
    if (!updated.rowCount) return res.json({ call: null });
    const signals = await pool.query("DELETE FROM group_call_signals WHERE call_id=$1 AND to_user=$2 RETURNING id,from_user,kind,payload", [call.id, req.user.id]);
    const invited = call.group_id ? [] : (await pool.query(`
      SELECT i.user_id,u.display_name,u.avatar_url,u.username,i.declined_at IS NOT NULL AS declined FROM call_invites i JOIN users u ON u.id=i.user_id
      WHERE i.call_id=$1 AND NOT EXISTS(SELECT 1 FROM group_call_participants p WHERE p.call_id=i.call_id AND p.user_id=i.user_id AND ${ALIVE})`, [call.id])).rows;
    res.json({ call: { id: call.id, kind: call.kind, group_id: call.group_id, participants: await participants(call.id), invited }, signals: signals.rows.sort((a, b) => a.id - b.id) });
  }

  async function signal(req, res, call) {
    const body = isRecord(req.body) ? req.body : {};
    const to = parseId(body.to);
    const payload = typeof body.payload === "string" ? body.payload : "";
    if (!to || to === req.user.id || !["offer", "answer", "bye"].includes(body.kind) || payload.length > MAX_SIGNAL) return res.status(400).json({ error: "Sinal inválido." });
    if (!call || call.ended_at) return res.status(404).json({ error: "A chamada já terminou." });
    const both = await pool.query("SELECT COUNT(*)::int AS n FROM group_call_participants WHERE call_id=$1 AND user_id = ANY($2::int[]) AND left_at IS NULL", [call.id, [req.user.id, to]]);
    if (both.rows[0].n !== 2) return res.status(404).json({ error: "Essa pessoa já não está na chamada." });
    await pool.query("INSERT INTO group_call_signals(call_id,from_user,to_user,kind,payload) VALUES($1,$2,$3,$4,$5)", [call.id, req.user.id, to, body.kind, payload]);
    res.status(201).json({ sent: true });
  }

  async function leave(req, res, call) {
    if (!call || call.ended_at) return res.json({ left: true });
    await pool.query("UPDATE group_call_participants SET left_at=NOW() WHERE call_id=$1 AND user_id=$2", [call.id, req.user.id]);
    await pool.query("DELETE FROM group_call_signals WHERE call_id=$1 AND (to_user=$2 OR from_user=$2)", [call.id, req.user.id]);
    const left = await pool.query("SELECT COUNT(*)::int AS n FROM group_call_participants WHERE call_id=$1 AND left_at IS NULL", [call.id]);
    if (left.rows[0].n === 0) await pool.query("UPDATE group_calls SET ended_at=NOW() WHERE id=$1", [call.id]);
    res.json({ left: true });
  }

  // ----- Chamadas de grupo -----
  async function memberGroup(req, res) {
    const groupId = parseId(req.params.groupId);
    if (!groupId) { res.status(400).json({ error: "Grupo inválido." }); return null; }
    const result = await pool.query(`
      SELECT g.id,g.name FROM social_groups g JOIN group_members m ON m.group_id=g.id AND m.user_id=$2
      WHERE g.id=$1 AND g.hidden_at IS NULL`, [groupId, req.user.id]);
    if (!result.rowCount) { res.status(404).json({ error: "Grupo não encontrado ou não és membro." }); return null; }
    return result.rows[0];
  }
  const groupCall = async (db, groupId) => {
    const call = (await db.query("SELECT id,group_id,kind,started_at,started_by,ended_at FROM group_calls WHERE group_id=$1 AND ended_at IS NULL", [groupId])).rows[0];
    return (await stillOpen(db, call)) ? call : null;
  };

  app.get("/api/groups/:groupId/call", auth, async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    const call = await groupCall(pool, group.id);
    res.json({ call: call ? { id: call.id, kind: call.kind, started_at: call.started_at, count: call.count, participants: await participants(call.id) } : null, maxParticipants: MAX_PARTICIPANTS });
  });
  // Começar uma chamada (voz ou vídeo) ou entrar na que já está aberta.
  app.post("/api/groups/:groupId/call", auth, rateLimit, async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    const kind = req.body?.kind === "voice" ? "voice" : "video";
    const result = await transaction(async client => {
      // Bloqueia o grupo enquanto decide, para dois "começar" ao mesmo tempo não abrirem duas chamadas.
      await client.query("SELECT id FROM social_groups WHERE id=$1 FOR UPDATE", [group.id]);
      let call = await groupCall(client, group.id);
      const started = !call;
      if (!call) {
        call = (await client.query("INSERT INTO group_calls(group_id,started_by,kind) VALUES($1,$2,$3) RETURNING id,group_id,kind,started_at,started_by",
          [group.id, req.user.id, kind])).rows[0];
        call.count = 0;
      }
      if (!(await enter(client, call, req.user.id))) return { full: true };
      if (started) {
        await client.query(`INSERT INTO notifications(user_id,actor_id,type,text,group_id)
          SELECT m.user_id,$2,'group_call',$3,$1 FROM group_members m WHERE m.group_id=$1 AND m.user_id<>$2`,
        [group.id, req.user.id, `Começou uma chamada de ${call.kind === "voice" ? "voz" : "vídeo"} no grupo «${group.name}». Entra!`]);
      }
      return { call };
    });
    if (result.full) return res.status(409).json({ error: `A chamada está cheia (máximo ${MAX_PARTICIPANTS} pessoas).` });
    await joinedResponse(res, result.call, req.user.id);
  });
  for (const [action, handler] of Object.entries({ heartbeat, signal, leave })) {
    app.post(`/api/groups/:groupId/call/${action}`, auth, async (req, res) => {
      const group = await memberGroup(req, res);
      if (!group) return;
      const call = (await pool.query("SELECT id,group_id,kind,ended_at FROM group_calls WHERE group_id=$1 AND ended_at IS NULL", [group.id])).rows[0];
      await handler(req, res, call);
    });
  }

  // ----- Chamadas a partir das mensagens -----
  // Quem pode ligar a quem: as mesmas regras das mensagens (bloqueios e "quem me pode enviar mensagens").
  async function canCall(fromId, toId) {
    const user = await pool.query(`SELECT 1 FROM users WHERE id=$1 AND suspended_at IS NULL AND NOT ${blockedBetween("$2", "id")}`, [toId, fromId]);
    return user.rowCount > 0 && await reachAllowed("messages", toId, fromId);
  }
  // A chamada direta, se a pessoa pode estar nela (quem ligou ou convidado).
  async function directCall(req, res) {
    const callId = parseId(req.params.callId);
    if (!callId) { res.status(400).json({ error: "Chamada inválida." }); return null; }
    const result = await pool.query(`
      SELECT c.id,c.group_id,c.kind,c.started_at,c.started_by,c.ended_at FROM group_calls c
      WHERE c.id=$1 AND c.group_id IS NULL AND (c.started_by=$2 OR EXISTS(SELECT 1 FROM call_invites i WHERE i.call_id=c.id AND i.user_id=$2))`, [callId, req.user.id]);
    if (!result.rowCount) { res.status(404).json({ error: "Chamada não encontrada." }); return null; }
    return result.rows[0];
  }
  async function invite(client, call, fromId, ids) {
    const current = await client.query(`SELECT COUNT(*)::int AS n FROM (
      SELECT user_id FROM call_invites WHERE call_id=$1 AND declined_at IS NULL UNION SELECT started_by FROM group_calls WHERE id=$1) x`, [call.id]);
    if (current.rows[0].n + ids.length > MAX_PARTICIPANTS) return { error: `Uma chamada tem no máximo ${MAX_PARTICIPANTS} pessoas.` };
    const kindLabel = call.kind === "voice" ? "voz" : "vídeo";
    for (const id of ids) {
      await client.query(`INSERT INTO call_invites(call_id,user_id,invited_by) VALUES($1,$2,$3)
        ON CONFLICT (call_id,user_id) DO UPDATE SET declined_at=NULL, created_at=NOW(), invited_by=$3`, [call.id, id, fromId]);
      await client.query("INSERT INTO notifications(user_id,actor_id,type,text,call_id) VALUES($1,$2,'call',$3,$4)",
        [id, fromId, `Está a ligar-te (chamada de ${kindLabel}).`, call.id]);
    }
    return {};
  }
  const parseTargets = (body, me) => [...new Set((Array.isArray(body.to) ? body.to : [body.to]).map(Number))].filter(id => Number.isSafeInteger(id) && id > 0 && id !== me);

  // Ligar a uma ou mais pessoas (até 7 convidados + quem liga).
  app.post("/api/calls", auth, rateLimit, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const ids = parseTargets(body, req.user.id);
    if (!ids.length || ids.length > MAX_PARTICIPANTS - 1) return res.status(400).json({ error: `Escolhe entre 1 e ${MAX_PARTICIPANTS - 1} pessoas.` });
    for (const id of ids) if (!(await canCall(req.user.id, id))) return res.status(403).json({ error: "Não podes ligar a uma destas pessoas." });
    const kind = body.kind === "voice" ? "voice" : "video";
    const result = await transaction(async client => {
      const call = (await client.query("INSERT INTO group_calls(group_id,started_by,kind) VALUES(NULL,$1,$2) RETURNING id,group_id,kind,started_at,started_by",
        [req.user.id, kind])).rows[0];
      call.count = 0;
      const invited = await invite(client, call, req.user.id, ids);
      if (invited.error) throw Object.assign(new Error(invited.error), { status: 400 });
      await enter(client, call, req.user.id);
      return call;
    }).catch(error => { if (error.status) return { error: error.message }; throw error; });
    if (result.error) return res.status(400).json({ error: result.error });
    await joinedResponse(res, result, req.user.id);
  });

  // Está alguém a ligar-me? (o site e a app perguntam de poucos em poucos segundos)
  app.get("/api/calls/incoming", auth, async (req, res) => {
    const result = await pool.query(`
      SELECT c.id,c.kind,c.started_at,u.id AS caller_id,u.username AS caller_username,u.display_name AS caller_name,u.avatar_url AS caller_avatar,
        (SELECT COUNT(*)::int FROM group_call_participants p WHERE p.call_id=c.id AND ${ALIVE}) AS count
      FROM call_invites i JOIN group_calls c ON c.id=i.call_id JOIN users u ON u.id=COALESCE(i.invited_by, c.started_by)
      WHERE i.user_id=$1 AND i.declined_at IS NULL AND c.ended_at IS NULL AND c.group_id IS NULL
        AND i.created_at > NOW() - INTERVAL '${RING_SECONDS} seconds'
        AND NOT EXISTS(SELECT 1 FROM group_call_participants p WHERE p.call_id=c.id AND p.user_id=$1 AND ${ALIVE})
      ORDER BY i.created_at DESC LIMIT 1`, [req.user.id]);
    const call = result.rows[0];
    res.json({ call: call && call.count > 0 ? call : null });
  });

  app.post("/api/calls/:callId/join", auth, async (req, res) => {
    const call = await directCall(req, res);
    if (!call) return;
    const result = await transaction(async client => {
      if (!(await stillOpen(client, call))) return { ended: true };
      if (!(await enter(client, call, req.user.id))) return { full: true };
      return {};
    });
    if (result.ended) return res.status(410).json({ error: "A chamada já terminou." });
    if (result.full) return res.status(409).json({ error: `A chamada está cheia (máximo ${MAX_PARTICIPANTS} pessoas).` });
    await joinedResponse(res, call, req.user.id);
  });
  app.post("/api/calls/:callId/decline", auth, async (req, res) => {
    const call = await directCall(req, res);
    if (!call) return;
    await pool.query("UPDATE call_invites SET declined_at=NOW() WHERE call_id=$1 AND user_id=$2", [call.id, req.user.id]);
    res.json({ declined: true });
  });
  // Adicionar mais pessoas a uma chamada em curso (quem está na chamada pode convidar).
  app.post("/api/calls/:callId/invite", auth, rateLimit, async (req, res) => {
    const call = await directCall(req, res);
    if (!call) return;
    if (!(await stillOpen(pool, call))) return res.status(410).json({ error: "A chamada já terminou." });
    const body = isRecord(req.body) ? req.body : {};
    let ids = parseTargets(body, req.user.id);
    if (typeof body.username === "string" && body.username.trim()) {
      const found = await pool.query("SELECT id FROM users WHERE lower(username)=lower($1)", [body.username.trim().replace(/^@/, "")]);
      if (!found.rowCount) return res.status(404).json({ error: "Não encontrámos essa pessoa." });
      ids = [...new Set([...ids, found.rows[0].id])].filter(id => id !== req.user.id);
    }
    if (!ids.length) return res.status(400).json({ error: "Escolhe quem queres adicionar." });
    for (const id of ids) if (!(await canCall(req.user.id, id))) return res.status(403).json({ error: "Não podes ligar a essa pessoa." });
    const result = await transaction(client => invite(client, call, req.user.id, ids));
    if (result.error) return res.status(400).json({ error: result.error });
    res.status(201).json({ invited: ids.length });
  });
  for (const [action, handler] of Object.entries({ heartbeat, signal, leave })) {
    app.post(`/api/calls/:callId/${action}`, auth, async (req, res) => {
      const call = await directCall(req, res);
      if (!call) return;
      await handler(req, res, call);
    });
  }
}

module.exports = { MAX_PARTICIPANTS, registerGroupCalls };
