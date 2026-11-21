// Pagamentos e recibos: a lista da equipa (/admin/pagamentos), os pagamentos de cada pessoa
// (Definições → Pagamentos) e o recibo para imprimir ou guardar em PDF (/recibos/:kind/:id).
import { useContext, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { API, Icon, UserContext, api, formatPrice, token } from "./core.jsx";
import { Select } from "./select.jsx";
import { DatePicker } from "./date-picker.jsx";

const KIND_OPTIONS = [["", "Todos os tipos"], ["ad", "Promoções"], ["stars", "Estrelas"], ["campaign", "Campanhas"], ["group_access", "Entradas em grupos"], ["course", "Cursos"]];
const METHOD_OPTIONS = [["", "Todos os métodos"], ["express", "Multicaixa Express"], ["reference", "Referência"], ["card", "Cartão"], ["paypal", "PayPal"], ["redotpay", "RedotPay"], ["paypay", "PayPay Africa"], ["demo", "Demonstração"]];
const STATUS_OPTIONS = [["", "Todos os estados"], ["paid", "Pagos"], ["refunded", "Reembolsados"], ["refund_due", "Reembolso por fazer"]];

const dateTime = value => new Date(value).toLocaleString("pt-PT", { timeZone: "Africa/Luanda", dateStyle: "medium", timeStyle: "short" });
const receiptPath = (payment, team) => `/recibos/${payment.kind}/${payment.id}${team ? "?equipa=1" : ""}`;

export function PaymentStatus({ payment }) {
  return <span className={`payment-status is-${payment.status}`}>{payment.status_label}</span>;
}

// Como foi pago, numa linha: o método e, quando existe, a referência ou o telemóvel usado.
function methodDetail(payment) {
  if (payment.method === "reference" && payment.reference) return `${payment.method_label} · Entidade ${payment.entity} · Ref. ${payment.reference}`;
  if (payment.method === "express" && payment.phone) return `${payment.method_label} · ${payment.phone}`;
  return payment.method_label;
}

// ---------------------------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------------------------
const FILTER_KEYS = ["kind", "method", "status", "from", "to", "q", "page"];

export function AdminPayments() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState(params.get("q") || "");
  const [exporting, setExporting] = useState(false);
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState("");
  // Os filtros vivem no endereço: um link para "pagamentos por Referência de março" pode ser partilhado na equipa.
  const query = new URLSearchParams(FILTER_KEYS.flatMap(key => params.get(key) ? [[key, params.get(key)]] : [])).toString();

  useEffect(() => {
    let active = true;
    setError("");
    api(`/admin/payments${query ? `?${query}` : ""}`)
      .then(result => { if (active) setData(result); })
      .catch(loadError => { if (active) setError(loadError.message); });
    return () => { active = false; };
  }, [query, reload]);

  // Express e Referência não se devolvem sozinhos: a equipa transfere à mão e confirma aqui (fica no registo).
  // Reembolso: retira o que o pagamento deu e devolve o dinheiro (cartão automático; Express/Referência à mão).
  const refund = async payment => {
    const what = { stars: "As Estrelas saem do saldo da pessoa.", group_access: "A pessoa sai do grupo.", course: "A pessoa perde o acesso ao curso.", campaign: "A campanha é cancelada.", ad: "A promoção sai do ar." }[payment.kind];
    const note = window.prompt(`Reembolsar ${formatPrice(payment.amount)} a @${payment.customer?.username || "?"} (${payment.receipt})?
${what}
Motivo (fica no registo):`);
    if (!note) return;
    setError(""); setNotice("");
    try {
      const result = await api(`/admin/payments/${payment.kind}/${payment.id}/refund`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
      setNotice(result.status === "refunded"
        ? `${payment.receipt} reembolsado.`
        : `Acesso retirado. Falta devolver ${formatPrice(payment.amount)} à mão (${payment.method_label}); depois carrega em «Marcar devolvido».`);
      setReload(value => value + 1);
    } catch (refundError) {
      setError(refundError.message);
    }
  };
  const markRefunded = async payment => {
    const note = window.prompt(`Como devolveste ${formatPrice(payment.amount)} (${payment.receipt})? Ex.: referência da transferência`);
    if (!note) return;
    setError(""); setNotice("");
    try {
      await api(`/admin/payments/${payment.kind}/${payment.id}/refunded`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) });
      setNotice(`Reembolso de ${payment.receipt} confirmado. A pessoa foi avisada.`);
      setReload(value => value + 1);
    } catch (refundError) {
      setError(refundError.message);
    }
  };

  const setFilter = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  // O CSV precisa do token, por isso é pedido com fetch e guardado como ficheiro (um <a href> não levaria a sessão).
  const exportCsv = async () => {
    setExporting(true);
    try {
      const response = await fetch(`${API}/admin/payments.csv${query ? `?${query}` : ""}`, { headers: { Authorization: `Bearer ${token()}` } });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "Não foi possível exportar.");
      const url = URL.createObjectURL(await response.blob());
      const link = Object.assign(document.createElement("a"), { href: url, download: `tchilar-pagamentos-${new Date().toISOString().slice(0, 10)}.csv` });
      link.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError.message);
    } finally {
      setExporting(false);
    }
  };

  const page = data?.page || 1;
  return <section className="creator-card admin-payments">
    <div className="creator-card-head">
      <div><h2>Pagamentos</h2><p>Todos os pagamentos confirmados: promoções, Estrelas, campanhas e entradas em grupos.</p></div>
      <button className="btn secondary" type="button" onClick={exportCsv} disabled={exporting}>
        <Icon name="arrowDown" size={16} />{exporting ? "A exportar..." : "Exportar CSV"}
      </button>
    </div>

    <form className="payment-filters" onSubmit={event => { event.preventDefault(); setFilter("q", search.trim()); }}>
      <label className="payment-search"><Icon name="search" size={16} /><span className="visually-hidden">Pesquisar</span>
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nome, @utilizador, email ou nº do recibo" /></label>
      {[["kind", KIND_OPTIONS, "Tipo"], ["method", METHOD_OPTIONS, "Método"], ["status", STATUS_OPTIONS, "Estado"]].map(([key, options, label]) =>
        <label className="period-select" key={key}><span className="visually-hidden">{label}</span>
          <Select value={params.get(key) || ""} onChange={event => setFilter(key, event.target.value)}>
            {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </Select></label>)}
      <label className="payment-date">De<DatePicker mode="date" shortcuts={false} value={params.get("from") || ""} max={params.get("to") || ""} placeholder="Início"
        onChange={event => setFilter("from", event.target.value)} aria-label="Pagamentos desde" /></label>
      <label className="payment-date">Até<DatePicker mode="date" shortcuts={false} value={params.get("to") || ""} min={params.get("from") || ""} placeholder="Hoje"
        onChange={event => setFilter("to", event.target.value)} aria-label="Pagamentos até" /></label>
      {query && <button className="prefs-link" type="button" onClick={() => { setSearch(""); setParams({}, { replace: true }); }}>Limpar filtros</button>}
    </form>

    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="prefs-saved" role="status"><Icon name="check" size={14} />{notice}</p>}
    {!data && !error && <div className="creator-loading">A carregar...</div>}
    {data && <>
      <div className="stat-grid payment-totals">
        <div className="stat-box"><span>Pagamentos</span><strong>{data.totals.count.toLocaleString("pt-PT")}</strong></div>
        <div className="stat-box"><span>Recebido</span><strong>{formatPrice(data.totals.received)}</strong></div>
        <div className="stat-box"><span>Reembolsado</span><strong>{formatPrice(data.totals.refunded)}</strong></div>
        <div className={`stat-box${data.totals.refund_due > 0 ? " is-warning" : ""}`}><span>Reembolsos por fazer</span><strong>{formatPrice(data.totals.refund_due)}</strong></div>
      </div>
      {!data.payments.length ? <p className="muted">Nenhum pagamento com estes filtros.</p> : <div className="payment-table-wrap">
        <table className="payment-table">
          <thead><tr><th>Recibo</th><th>Data</th><th>Cliente</th><th>Descrição</th><th>Método</th><th className="is-amount">Valor</th><th>Estado</th></tr></thead>
          <tbody>{data.payments.map(payment => <tr key={`${payment.kind}-${payment.id}`}>
            <td><Link to={receiptPath(payment, true)}>{payment.receipt}</Link></td>
            <td>{dateTime(payment.paid_at)}</td>
            <td>{payment.customer ? <><Link to={`/u/${payment.customer.username}`}>{payment.customer.display_name}</Link><small>{payment.customer.email}</small></> : <span className="muted">Conta apagada</span>}</td>
            <td><span className="payment-kind">{payment.kind_label}</span>{payment.description}</td>
            <td>{methodDetail(payment)}</td>
            <td className="is-amount">{formatPrice(payment.amount)}</td>
            <td><PaymentStatus payment={payment} />
              {payment.status === "paid" && <button className="prefs-link payment-refund" type="button" onClick={() => refund(payment)}>Reembolsar</button>}
              {payment.status === "refund_due" && <button className="prefs-link payment-refund" type="button" onClick={() => markRefunded(payment)}>Marcar devolvido</button>}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {data.pages > 1 && <nav className="payment-pages" aria-label="Páginas">
        <button className="btn secondary" type="button" disabled={page <= 1} onClick={() => setFilter("page", String(page - 1))}>Anterior</button>
        <span>Página {page} de {data.pages}</span>
        <button className="btn secondary" type="button" disabled={page >= data.pages} onClick={() => setFilter("page", String(page + 1))}>Seguinte</button>
      </nav>}
      <p className="muted creator-footnote">Os recibos comprovam o pagamento; não são faturas com valor fiscal. As faturas legais têm de sair de um programa de faturação certificado pela AGT.</p>
    </>}
  </section>;
}

// ---------------------------------------------------------------------------------------------
// Definições → Pagamentos e recibos
// ---------------------------------------------------------------------------------------------
export function SettingsPayments() {
  const [payments, setPayments] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => { api("/payments").then(result => setPayments(result.payments)).catch(loadError => setError(loadError.message)); }, []);
  return <section className="prefs-card">
    <header className="prefs-card-head"><h3>Os teus pagamentos</h3><p>Abre um recibo para o imprimir ou guardar em PDF.</p></header>
    {error && <p className="error" role="alert">{error}</p>}
    {!payments && !error && <p className="muted">A carregar...</p>}
    {payments && !payments.length && <p className="muted payment-empty">Ainda não fizeste pagamentos no Tchilar.</p>}
    {payments?.map(payment => <Link key={`${payment.kind}-${payment.id}`} className="prefs-row payment-row" to={receiptPath(payment, false)}>
      <span className="prefs-row-icon"><Icon name="pages" /></span>
      <span className="prefs-row-text"><strong>{payment.description}</strong><small>{dateTime(payment.paid_at)} · {payment.method_label} · {payment.receipt}</small></span>
      <span className="prefs-row-action payment-row-amount"><strong>{formatPrice(payment.amount)}</strong>{payment.status !== "paid" && <PaymentStatus payment={payment} />}</span>
    </Link>)}
  </section>;
}

// ---------------------------------------------------------------------------------------------
// Recibo
// ---------------------------------------------------------------------------------------------
export function Receipt() {
  const { kind, id } = useParams();
  const [params] = useSearchParams();
  const { user, authReady } = useContext(UserContext);
  const team = params.get("equipa") === "1" && user?.is_admin;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!authReady || !user) return;
    api(team ? `/admin/payments/${kind}/${id}` : `/payments/${kind}/${id}/receipt`).then(setData).catch(loadError => setError(loadError.message));
  }, [authReady, user?.id, team, kind, id]);

  if (!authReady) return <div className="page narrow"><div className="empty card">A carregar...</div></div>;
  if (!user) return <div className="page narrow"><div className="empty card">Inicia sessão para ver os teus recibos. <Link to="/login">Entrar</Link></div></div>;
  if (error) return <div className="page narrow"><div className="empty card"><p className="error" role="alert">{error}</p></div></div>;
  if (!data) return <div className="page narrow"><div className="empty card">A carregar o recibo...</div></div>;
  const { payment, issuer } = data;

  return <div className="page narrow receipt-page">
    <div className="receipt-actions">
      <Link className="prefs-back" to={team ? "/admin/pagamentos" : "/settings/pagamentos"}><Icon name="previous" size={18} />{team ? "Pagamentos" : "Os teus pagamentos"}</Link>
      <button className="btn" type="button" onClick={() => window.print()}><Icon name="pages" size={16} />Imprimir ou guardar PDF</button>
    </div>
    <article className="receipt" aria-label={`Recibo ${payment.receipt}`}>
      <header className="receipt-head">
        <div><strong className="receipt-brand">{issuer.name}</strong>
          {issuer.nif && <small>NIF {issuer.nif}</small>}
          {issuer.address && <small>{issuer.address}</small>}
          {issuer.email && <small>{issuer.email}</small>}</div>
        <div className="receipt-number"><span>Recibo de pagamento</span><strong>{payment.receipt}</strong><small>{dateTime(payment.paid_at)}</small></div>
      </header>
      {payment.status !== "paid" && <p className={`receipt-banner is-${payment.status}`}>{payment.status === "refunded" ? "Este pagamento foi reembolsado." : "Este pagamento vai ser reembolsado pela equipa do Tchilar."}</p>}
      <dl className="receipt-meta">
        <div><dt>Cliente</dt><dd>{payment.customer ? `${payment.customer.display_name} (@${payment.customer.username})` : "Conta apagada"}{payment.customer?.email && <small>{payment.customer.email}</small>}</dd></div>
        <div><dt>Método</dt><dd>{payment.method_label}{payment.method === "reference" && payment.reference && <small>Entidade {payment.entity} · Referência {payment.reference}</small>}{payment.phone && <small>Telemóvel {payment.phone}</small>}</dd></div>
        {team && payment.provider_ref && <div><dt>Ref. do fornecedor</dt><dd className="receipt-code">{payment.provider_ref}</dd></div>}
      </dl>
      <table className="receipt-lines">
        <thead><tr><th>Descrição</th><th className="is-amount">Valor</th></tr></thead>
        <tbody><tr><td><span className="payment-kind">{payment.kind_label}</span>{payment.description}</td><td className="is-amount">{formatPrice(payment.amount)}</td></tr></tbody>
        <tfoot><tr><th>Total pago</th><th className="is-amount">{formatPrice(payment.amount)}</th></tr></tfoot>
      </table>
      <footer className="receipt-foot">
        <p>Comprovativo de pagamento emitido pelo {issuer.name}. Este documento não serve de fatura.</p>
        <p>Dúvidas sobre este pagamento? Indica o número <strong>{payment.receipt}</strong> quando contactares a equipa.</p>
      </footer>
    </article>
  </div>;
}
