// Músicas dos Reels: biblioteca da Biva (gerida pela equipa) e músicas carregadas por cada pessoa.
// O vídeo nunca é alterado: a publicação guarda { trackId, offset, volume, fade } em video_edit.music
// e o leitor toca a música por cima, sincronizada com o vídeo.
const crypto = require("crypto");
const multer = require("multer");

const MUSIC_GENRES = ["afrobeat", "kizomba", "semba", "kuduro", "amapiano", "hiphop", "pop", "gospel", "calmo", "outro"];
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const MAX_TRACK_SECONDS = 900;
const MAX_PERSONAL_TRACKS = 50;
const AUDIO_EXTENSIONS = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/webm": ".weba"
};

// Dados da música que acompanham cada publicação (null se não tiver ou se a música foi escondida).
const POST_MUSIC_SQL = `(SELECT json_build_object('id',m.id,'title',m.title,'artist',m.artist,'audio_url',m.audio_url)
  FROM music_tracks m WHERE m.id=(p.video_edit->'music'->>'trackId')::int AND m.hidden_at IS NULL) AS music`;

const TRACK_FIELDS = `m.id,m.title,m.artist,m.genre,m.audio_url,m.duration_seconds::float AS duration,m.license,m.is_library,
  m.uploaded_by,m.hidden_at,m.created_at,
  (SELECT COUNT(*) FROM posts p WHERE (p.video_edit->'music'->>'trackId')::int=m.id AND p.video_edit ? 'music')::int AS uses`;

function parseTrackFields(body, { isAdmin }) {
  const title = typeof body.title === "string" ? body.title.replace(/\s+/g, " ").trim() : "";
  const artist = typeof body.artist === "string" ? body.artist.replace(/\s+/g, " ").trim() : "";
  const genre = typeof body.genre === "string" && MUSIC_GENRES.includes(body.genre) ? body.genre : "outro";
  const license = typeof body.license === "string" ? body.license.trim() : "";
  const duration = Number(body.duration);
  if (!title || title.length > 100) return { error: "Dá um nome à música (até 100 caracteres)." };
  if (artist.length > 100) return { error: "O nome do artista pode ter até 100 caracteres." };
  if (license.length > 300) return { error: "A licença pode ter até 300 caracteres." };
  if (!Number.isFinite(duration) || duration <= 0 || duration > MAX_TRACK_SECONDS) return { error: "A música tem de ter até 15 minutos." };
  const library = isAdmin && (body.library === true || body.library === "true");
  if (library && !license) return { error: "Indica a licença da música (ex.: Pixabay Content License, ou autorização do artista)." };
  return { title, artist, genre, license, duration: Math.round(duration * 100) / 100, library };
}

function registerMusicRoutes(app, deps) {
  const { pool, auth, optionalAuth, requireAdmin, parseId, isRecord, uploadDir, removeUpload, rateLimit } = deps;

  const audioUpload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, callback) => callback(null, `${crypto.randomBytes(16).toString("hex")}${AUDIO_EXTENSIONS[file.mimetype] || ""}`)
    }),
    limits: { fileSize: MAX_AUDIO_BYTES },
    fileFilter: (_req, file, callback) => {
      if (!Object.hasOwn(AUDIO_EXTENSIONS, file.mimetype)) return callback(new Error("Formato de ficheiro não suportado."));
      callback(null, true);
    }
  });
  const uploadLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Carregaste muitas músicas seguidas. Tenta daqui a uma hora." }
  });

  // Biblioteca (todas as pessoas) + as músicas que a própria pessoa carregou.
  app.get("/api/music", optionalAuth, async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
    const genre = MUSIC_GENRES.includes(req.query.genre) ? req.query.genre : null;
    const like = q ? `%${q.replace(/[\\%_]/g, character => `\\${character}`)}%` : null;
    const filters = `AND ($1::text IS NULL OR m.title ILIKE $1 OR m.artist ILIKE $1) AND ($2::text IS NULL OR m.genre=$2)`;
    const library = await pool.query(`
      SELECT ${TRACK_FIELDS} FROM music_tracks m
      WHERE m.is_library AND m.hidden_at IS NULL ${filters}
      ORDER BY uses DESC, m.created_at DESC LIMIT 60`, [like, genre]);
    const mine = req.user ? await pool.query(`
      SELECT ${TRACK_FIELDS} FROM music_tracks m
      WHERE m.uploaded_by=$3 AND NOT m.is_library AND m.hidden_at IS NULL ${filters}
      ORDER BY m.created_at DESC LIMIT 50`, [like, genre, req.user.id]) : { rows: [] };
    res.json({ library: library.rows, mine: mine.rows, genres: MUSIC_GENRES });
  });

  // Carregar uma música. Quem carrega confirma que tem direitos para a usar.
  // Só a equipa (admin) pode pô-la na biblioteca pública, e tem de registar a licença.
  app.post("/api/music", uploadLimit, auth, audioUpload.single("audio"), async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const fileUrl = req.file ? `/uploads/${req.file.filename}` : null;
    const fail = async (status, error) => { if (fileUrl) await removeUpload(fileUrl); return res.status(status).json({ error }); };
    if (!req.file) return fail(400, "Escolhe um ficheiro de áudio (MP3, M4A, AAC, WAV ou OGG).");
    if (body.rightsConfirmed !== "true" && body.rightsConfirmed !== true) {
      return fail(400, "Confirma que tens direitos para usar esta música.");
    }
    const account = await pool.query("SELECT is_admin FROM users WHERE id=$1", [req.user.id]);
    const isAdmin = account.rows[0]?.is_admin === true;
    const fields = parseTrackFields(body, { isAdmin });
    if (fields.error) return fail(400, fields.error);
    if (!fields.library) {
      const count = await pool.query("SELECT COUNT(*)::int AS total FROM music_tracks WHERE uploaded_by=$1 AND NOT is_library", [req.user.id]);
      if (count.rows[0].total >= MAX_PERSONAL_TRACKS) return fail(409, `Já tens ${MAX_PERSONAL_TRACKS} músicas. Apaga alguma antes de carregar outra.`);
    }
    const created = await pool.query(`
      INSERT INTO music_tracks(title,artist,genre,audio_url,duration_seconds,license,is_library,uploaded_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [fields.title, fields.artist, fields.genre, fileUrl, fields.duration, fields.license, fields.library, req.user.id]);
    const track = await pool.query(`SELECT ${TRACK_FIELDS} FROM music_tracks m WHERE m.id=$1`, [created.rows[0].id]);
    res.status(201).json({ track: track.rows[0] });
  });

  // Apagar uma música própria (só se nenhum vídeo a estiver a usar; senão esses vídeos ficavam sem som).
  app.delete("/api/music/:id", auth, async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: "Música inválida." });
    const found = await pool.query(`SELECT ${TRACK_FIELDS} FROM music_tracks m WHERE m.id=$1 AND m.uploaded_by=$2 AND NOT m.is_library`, [id, req.user.id]);
    if (!found.rowCount) return res.status(404).json({ error: "Música não encontrada." });
    if (found.rows[0].uses > 0) return res.status(409).json({ error: "Esta música está em vídeos publicados. Apaga primeiro esses vídeos." });
    await pool.query("DELETE FROM music_tracks WHERE id=$1", [id]);
    await removeUpload(found.rows[0].audio_url);
    res.json({ deleted: true });
  });

  // ----- Equipa: gerir a biblioteca -----
  app.get("/api/admin/music", auth, requireAdmin, async (_req, res) => {
    const result = await pool.query(`
      SELECT ${TRACK_FIELDS}, u.username AS uploader FROM music_tracks m LEFT JOIN users u ON u.id=m.uploaded_by
      ORDER BY m.is_library DESC, m.created_at DESC LIMIT 200`);
    res.json({ tracks: result.rows, genres: MUSIC_GENRES });
  });

  // Pôr/tirar da biblioteca, esconder (direitos de autor, denúncia) ou corrigir os dados.
  app.patch("/api/admin/music/:id", auth, requireAdmin, async (req, res) => {
    const id = parseId(req.params.id);
    const body = isRecord(req.body) ? req.body : {};
    if (!id) return res.status(400).json({ error: "Música inválida." });
    const current = await pool.query("SELECT license FROM music_tracks WHERE id=$1", [id]);
    if (!current.rowCount) return res.status(404).json({ error: "Música não encontrada." });
    const license = typeof body.license === "string" ? body.license.trim().slice(0, 300) : current.rows[0].license;
    if (body.library === true && !license) return res.status(400).json({ error: "Regista a licença antes de pôr a música na biblioteca." });
    const genre = MUSIC_GENRES.includes(body.genre) ? body.genre : null;
    await pool.query(`
      UPDATE music_tracks SET
        is_library=COALESCE($2,is_library),
        hidden_at=CASE WHEN $3::boolean IS NULL THEN hidden_at WHEN $3 THEN COALESCE(hidden_at,NOW()) ELSE NULL END,
        license=$4,
        genre=COALESCE($5,genre)
      WHERE id=$1`,
      [id, typeof body.library === "boolean" ? body.library : null, typeof body.hidden === "boolean" ? body.hidden : null, license, genre]);
    const track = await pool.query(`SELECT ${TRACK_FIELDS} FROM music_tracks m WHERE m.id=$1`, [id]);
    res.json({ track: track.rows[0] });
  });

  // Uma publicação só pode usar músicas da biblioteca ou carregadas pela própria pessoa.
  async function canUseTrack(trackId, userId) {
    const result = await pool.query(
      "SELECT 1 FROM music_tracks WHERE id=$1 AND hidden_at IS NULL AND (is_library OR uploaded_by=$2)", [trackId, userId]);
    return result.rowCount > 0;
  }

  return { canUseTrack };
}

module.exports = { AUDIO_EXTENSIONS, MUSIC_GENRES, POST_MUSIC_SQL, parseTrackFields, registerMusicRoutes };
