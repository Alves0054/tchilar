// Ecrã inicial: responde a três perguntas de quem abre a app.
//   O que está a acontecer?        → `now`: eventos de hoje, grupos teus com conversa nova, amigos online.
//   O que há para descobrir?       → `discover.groups` e `discover.pages`, puxados pelos temas e tipos que já segues.
//   Com quem posso interagir?      → `discover.people`: amigos de amigos e gente da tua província.
// Tudo num pedido, para o ecrã inicial não esperar por várias respostas.
const { onlineSql } = require("./preferences");

const HOME_TIMEZONE = "Africa/Luanda";

function registerHomeRoutes(app, { pool, auth, blockedBetween }) {
  // Os ids dos amigos de $1, reutilizados por várias consultas.
  const friendIds = `SELECT CASE WHEN f.user_a_id=$1 THEN f.user_b_id ELSE f.user_a_id END AS id
    FROM friendships f WHERE f.user_a_id=$1 OR f.user_b_id=$1`;

  app.get("/api/home", auth, async (req, res) => {
    const me = req.user.id;
    const [events, activeGroups, online, groups, pages, people] = await Promise.all([
      // Eventos que começam hoje (hora de Angola) e ainda não acabaram há mais de 3 horas.
      pool.query(`
        SELECT e.id,e.name,e.location,e.starts_at,
          (SELECT COUNT(*) FROM event_attendees a WHERE a.event_id=e.id)::int AS attendee_count,
          EXISTS(SELECT 1 FROM event_attendees a WHERE a.event_id=e.id AND a.user_id=$1) AS attending
        FROM events e
        WHERE (e.starts_at AT TIME ZONE '${HOME_TIMEZONE}')::date = (NOW() AT TIME ZONE '${HOME_TIMEZONE}')::date
          AND e.starts_at > NOW() - INTERVAL '3 hours'
          AND NOT ${blockedBetween("$1", "e.creator_id")}
        ORDER BY e.starts_at LIMIT 3`, [me]),
      // Grupos onde participas com publicações de outras pessoas nas últimas 24 horas.
      pool.query(`
        SELECT g.id,g.name,g.group_type,g.category,g.subcategory,COUNT(p.id)::int AS new_posts,MAX(p.created_at) AS last_post_at
        FROM group_members m
        JOIN social_groups g ON g.id=m.group_id
        JOIN posts p ON p.group_id=g.id AND p.user_id<>$1 AND p.hidden_at IS NULL AND p.created_at > NOW() - INTERVAL '24 hours'
        WHERE m.user_id=$1 AND NOT ${blockedBetween("$1", "p.user_id")}
        GROUP BY g.id ORDER BY last_post_at DESC LIMIT 4`, [me]),
      pool.query(`
        SELECT u.id,u.username,u.display_name,u.avatar_url
        FROM users u WHERE u.id IN (${friendIds}) AND ${onlineSql("u")}
        ORDER BY u.last_seen_at DESC LIMIT 12`, [me]),
      // Grupos sugeridos: não secretos, onde ainda não estás nem pediste para entrar. Primeiro os de
      // temas onde já participas, depois os mais movimentados (membros + publicações da última semana).
      pool.query(`
        WITH my_topics AS (
          SELECT DISTINCT g.category FROM group_members m JOIN social_groups g ON g.id=m.group_id WHERE m.user_id=$1)
        SELECT g.id,g.name,g.description,g.group_type,g.category,g.subcategory,g.requires_approval,g.invite_only,
          (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id)::int AS member_count,
          (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id AND m.user_id IN (${friendIds}))::int AS friend_count,
          g.category IN (SELECT category FROM my_topics) AS same_topic
        FROM social_groups g
        WHERE NOT g.is_secret AND g.hidden_at IS NULL AND g.owner_id<>$1
          AND NOT EXISTS(SELECT 1 FROM group_members m WHERE m.group_id=g.id AND m.user_id=$1)
          AND NOT EXISTS(SELECT 1 FROM group_join_requests r WHERE r.group_id=g.id AND r.user_id=$1)
          AND NOT ${blockedBetween("$1", "g.owner_id")}
        ORDER BY friend_count DESC, same_topic DESC,
          (SELECT COUNT(*) FROM group_members m WHERE m.group_id=g.id)
            + 3 * (SELECT COUNT(*) FROM posts p WHERE p.group_id=g.id AND p.created_at > NOW() - INTERVAL '7 days') DESC,
          g.created_at DESC
        LIMIT 4`, [me]),
      // Páginas sugeridas: que não segues; primeiro as que os teus amigos seguem e as do mesmo tipo das que já segues.
      pool.query(`
        WITH my_types AS (
          SELECT DISTINCT p.page_type FROM page_followers f JOIN pages p ON p.id=f.page_id WHERE f.user_id=$1)
        SELECT p.id,p.name,p.page_type,p.category,p.subcategory,
          (SELECT COUNT(*) FROM page_followers f WHERE f.page_id=p.id)::int AS follower_count,
          (SELECT COUNT(*) FROM page_followers f WHERE f.page_id=p.id AND f.user_id IN (${friendIds}))::int AS friend_count
        FROM pages p
        WHERE p.hidden_at IS NULL AND p.owner_id<>$1
          AND NOT EXISTS(SELECT 1 FROM page_followers f WHERE f.page_id=p.id AND f.user_id=$1)
          AND NOT ${blockedBetween("$1", "p.owner_id")}
        ORDER BY friend_count DESC, p.page_type IN (SELECT page_type FROM my_types) DESC, follower_count DESC, p.created_at DESC
        LIMIT 4`, [me]),
      // Pessoas que talvez conheças: amigos de amigos primeiro, depois quem é da tua província, depois quem chegou há pouco.
      // A província só serve para ordenar: não vai na resposta (ninguém escolheu mostrá-la).
      pool.query(`
        SELECT u.id,u.username,u.display_name,u.avatar_url,
          (SELECT COUNT(*) FROM friendships f
            WHERE (f.user_a_id=u.id AND f.user_b_id IN (${friendIds})) OR (f.user_b_id=u.id AND f.user_a_id IN (${friendIds})))::int AS mutual_count
        FROM users u
        WHERE u.id<>$1 AND u.suspended_at IS NULL AND u.email_verified
          AND u.id NOT IN (${friendIds})
          AND NOT EXISTS(SELECT 1 FROM friend_requests r WHERE r.status='pending'
            AND ((r.requester_id=$1 AND r.addressee_id=u.id) OR (r.requester_id=u.id AND r.addressee_id=$1)))
          AND NOT ${blockedBetween("$1", "u.id")}
        ORDER BY mutual_count DESC, (u.province IS NOT NULL AND u.province=(SELECT province FROM users WHERE id=$1)) DESC, u.created_at DESC
        LIMIT 6`, [me])
    ]);
    res.json({
      now: { events: events.rows, groups: activeGroups.rows, online: online.rows },
      discover: { groups: groups.rows, pages: pages.rows, people: people.rows }
    });
  });
}

module.exports = { registerHomeRoutes };
