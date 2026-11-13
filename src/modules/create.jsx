import { useContext, useState } from "react";
import { useNavigate } from "react-router-dom";
import { downscaleImage } from "../PhotoEditors.jsx";
import { Avatar, UserContext, api, token } from "./core.jsx";
import { ExclusiveToggle } from "./feed.jsx";

export function Create() {
  const { user } = useContext(UserContext);
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [exclusive, setExclusive] = useState(false);

  const submit = async event => {
    event.preventDefault();
    if (!token()) return navigate("/login");
    const formData = new FormData();
    formData.append("body", body);
    if (file) formData.append("media", await downscaleImage(file, 2048, 2048));
    if (exclusive) formData.append("isExclusive", "true");
    setBusy(true);
    try {
      await api("/posts", { method: "POST", body: formData });
      navigate("/");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  };

  return <div className="page narrow"><form className="panel card" onSubmit={submit}><div className="composer-top"><Avatar user={user} /><textarea required={!file} placeholder="Em que estás a pensar?" value={body} onChange={event => setBody(event.target.value)} /></div><label className="file-label">Fotografia/vídeo<input type="file" accept="image/*,video/*" onChange={event => setFile(event.target.files?.[0] || null)} /></label><ExclusiveToggle user={user} checked={exclusive} onChange={setExclusive} />{error && <p className="error">{error}</p>}<button className="btn" disabled={busy}>{busy ? "A publicar..." : "Publicar"}</button></form></div>;
}
