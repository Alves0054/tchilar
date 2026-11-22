// Lembretes de eventos: 1 dia antes e 1 hora antes, a quem vai («Vou») e a quem tem bilhete pago.
// Corre de 10 em 10 minutos; event_reminders_sent garante que cada lembrete sai uma vez por evento
// (se a data mudar, a tabela é limpa e os lembretes voltam a sair para a nova data).
// As notificações viram push no telemóvel e no browser (server/push.js), e abrem o evento.

const LUANDA = "Africa/Luanda";
const timeOf = date => new Date(date).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit", timeZone: LUANDA });
const dayOf = date => new Date(date).toLocaleDateString("en-CA", { timeZone: LUANDA });

// Janelas: "day" quando faltam entre 2 h e 24 h; "hour" quando falta 1 h 15 min ou menos (e ainda não começou).
const WINDOWS = {
  day: "e.starts_at > NOW() + INTERVAL '2 hours' AND e.starts_at <= NOW() + INTERVAL '24 hours'",
  hour: "e.starts_at > NOW() AND e.starts_at <= NOW() + INTERVAL '75 minutes'"
};

function reminderText(kind, event, now = Date.now()) {
  if (kind === "hour") {
    const minutes = Math.max(1, Math.round((new Date(event.starts_at).getTime() - now) / 60000));
    return `«${event.name}» começa daqui a ${minutes >= 55 ? "1 hora" : `${minutes} min`}${event.location ? ` em ${event.location}` : ""}. Leva o teu bilhete.`;
  }
  const when = dayOf(event.starts_at) === dayOf(now) ? "hoje" : "amanhã";
  return `Lembrete: «${event.name}» é ${when} às ${timeOf(event.starts_at)}${event.location ? ` em ${event.location}` : ""}.`;
}

async function sendEventReminders({ pool, transaction }) {
  let sent = 0;
  for (const kind of ["day", "hour"]) {
    const due = (await pool.query(`
      SELECT e.id,e.name,e.location,e.starts_at,e.creator_id FROM events e
      WHERE ${WINDOWS[kind]} AND e.group_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM event_reminders_sent r WHERE r.event_id=e.id AND r.kind=$1)
      ORDER BY e.starts_at LIMIT 200`, [kind])).rows;
    for (const event of due) {
      sent += await transaction(async client => {
        const marked = await client.query("INSERT INTO event_reminders_sent(event_id,kind) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING event_id", [event.id, kind]);
        if (!marked.rowCount) return 0; // outra cópia da API já enviou
        const result = await client.query(`
          INSERT INTO notifications(user_id,type,text,event_id)
          SELECT DISTINCT people.user_id,'event_reminder',$2::text,$1::int FROM (
            SELECT user_id FROM event_attendees WHERE event_id=$1
            UNION SELECT user_id FROM event_tickets WHERE event_id=$1 AND status='paid' AND refund_status IS NULL
          ) people JOIN users u ON u.id=people.user_id
          WHERE people.user_id<>$3::int AND u.suspended_at IS NULL`, [event.id, reminderText(kind, event), event.creator_id]);
        return result.rowCount;
      });
    }
  }
  return sent;
}

module.exports = { reminderText, sendEventReminders };
