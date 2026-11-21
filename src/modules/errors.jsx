// Erros no browser: uma área que falha não apaga o site inteiro, e o erro chega ao registo do servidor.
import { Component } from "react";
import { API } from "./core.jsx";

const seen = new Set();

// Envia o erro para o servidor (no máximo 10 por visita e sem repetir o mesmo). Nunca envia o token.
export function reportClientError(error, context = "") {
  const message = String(error?.message || error || "Erro desconhecido").slice(0, 500);
  const key = `${context}|${message}`;
  if (seen.has(key) || seen.size >= 10) return null;
  seen.add(key);
  const reference = Math.random().toString(16).slice(2, 10);
  const payload = JSON.stringify({
    reference, context, message,
    stack: String(error?.stack || "").slice(0, 4000),
    path: window.location.pathname
  });
  try {
    fetch(`${API}/client-errors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
  } catch { /* sem rede: fica só na consola */ }
  return reference;
}

// Depois de uma nova versão do Tchilar, os ficheiros antigos de cada área deixam de existir.
// Quem tinha a página aberta recebe este erro ao mudar de área: recarregar resolve (uma vez por visita).
export function isStaleChunkError(error) {
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically/i.test(String(error?.message || error));
}

function reloadOnceForNewVersion() {
  try {
    if (sessionStorage.getItem("tchilar-reloaded-for-version") || sessionStorage.getItem("biva-reloaded-for-version")) return false;
    sessionStorage.setItem("tchilar-reloaded-for-version", "1");
  } catch { return false; }
  window.location.reload();
  return true;
}

export function installGlobalErrorReporting() {
  window.addEventListener("error", event => {
    if (event.error) reportClientError(event.error, "window");
  });
  window.addEventListener("unhandledrejection", event => {
    if (isStaleChunkError(event.reason) && reloadOnceForNewVersion()) return;
    reportClientError(event.reason, "promise");
  });
}

// Fronteira de erro de cada página: mostra uma mensagem e "Tentar outra vez" em vez de um ecrã em branco.
export class PageErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, reference: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (isStaleChunkError(error) && reloadOnceForNewVersion()) return;
    this.setState({ reference: reportClientError({ message: error?.message, stack: `${error?.stack || ""}\n${info?.componentStack || ""}` }, "render") });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const stale = isStaleChunkError(this.state.error);
    return <section className="page narrow">
      <div className="empty card page-error" role="alert">
        <h1>{stale ? "Há uma versão nova do Tchilar" : "Esta página teve um problema"}</h1>
        <p>{stale
          ? "Recarrega para continuares com a versão mais recente."
          : "O resto do Tchilar continua a funcionar. Tenta outra vez; se voltar a acontecer, diz-nos a referência abaixo."}</p>
        {!stale && this.state.reference && <p className="page-error-ref">Referência: {this.state.reference}</p>}
        <div className="page-error-actions">
          <button className="btn" type="button" onClick={() => (stale ? window.location.reload() : this.setState({ error: null, reference: null }))}>
            {stale ? "Recarregar" : "Tentar outra vez"}
          </button>
          <a className="btn secondary" href="/">Ir para o início</a>
        </div>
      </div>
    </section>;
  }
}
