import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const STATUS_LABELS = {
  DIRECT_VERIFIED_MATCH: "Correspondência direta verificada",
  SAME_FAMILY_VERIFIED_MATCH: "Alternativa verificada da mesma família",
  CLOSEST_VERIFIED_TECHNICAL_MATCH: "Alternativa técnica verificada mais próxima",
  CURRENT_FAMILY_VERIFIED_MATCH: "Alternativa verificada da família atual",
  VERIFIED_CONFIGURABLE_PRODUCT: "Configuração verificada",
  NO_VERIFIED_ALTERNATIVE: "Sem alternativa verificada",
  SOURCE_UNAVAILABLE: "Fonte oficial indisponível",
  NEEDS_REVIEW: "Referência por rever",
  ERROR: "Erro",
};

function ProductCard({ title, product, recommended = false }) {
  if (!product) return null;
  return (
    <article className={recommended ? "product-card recommended" : "product-card"}>
      <div className="card-label">{title}</div>
      <h3>{product.description || product.input || "Referência não disponível"}</h3>
      <dl>
        {product.orderCode && <><dt>12NC</dt><dd>{product.orderCode}</dd></>}
        {product.family && <><dt>Família</dt><dd>{product.family}</dd></>}
        {product.control && <><dt>Controlo</dt><dd>{product.control}</dd></>}
        {product.configuratorId && <><dt>Configurador</dt><dd>{product.configuratorId}</dd></>}
      </dl>
      {product.productUrl && (
        <a className="product-link" href={product.productUrl} target="_blank" rel="noreferrer">
          Abrir produto oficial
        </a>
      )}
    </article>
  );
}

function Validation({ validation }) {
  if (!validation) return null;
  const checkedAt = validation.checkedAt
    ? new Intl.DateTimeFormat("pt-PT", { dateStyle: "short", timeStyle: "short" }).format(new Date(validation.checkedAt))
    : null;
  const details = [validation.source, validation.method, checkedAt].filter(Boolean).join(" · ");
  return (
    <div className={validation.verified ? "validation verified" : "validation"}>
      <span className="validation-icon" aria-hidden="true">{validation.verified ? "✓" : "!"}</span>
      <div>
        <strong>{validation.verified ? "Validação oficial concluída" : "Resultado não validado"}</strong>
        <p>{details}</p>
      </div>
    </div>
  );
}

function Result({ result }) {
  const isSuccess = Boolean(result.recommended && result.validation?.verified);
  const statusClass = isSuccess ? "success" : result.status === "SOURCE_UNAVAILABLE" ? "warning" : "neutral";
  return (
    <section className="result-panel" aria-live="polite">
      <div className="result-heading">
        <span className={"status " + statusClass}>{STATUS_LABELS[result.status] || result.statusLabel || result.status}</span>
        {result.compatibility && result.compatibility !== "NONE" && <span className="compatibility">{result.compatibility.replaceAll("_", " ")}</span>}
      </div>

      <div className={isSuccess ? "comparison" : "comparison single"}>
        <ProductCard title="Original" product={result.original} />
        {isSuccess && <ProductCard title="Alternativa recomendada" product={result.recommended} recommended />}
      </div>

      <Validation validation={result.validation} />

      {result.familyMigration && (
        <div className="detail-block migration">
          <h3>Família atual identificada</h3>
          <p>
            <strong>{result.familyMigration.oldFamily}</strong>
            <span aria-hidden="true"> → </span>
            <strong>{result.familyMigration.currentFamily}</strong>
          </p>
          <small>
            Relação determinada pelos metadados oficiais da família e pela compatibilidade técnica; não por uma tabela fixa.
          </small>
        </div>
      )}

      {result.changes?.length > 0 && (
        <div className="detail-block changes">
          <h3>O que muda</h3>
          <ul>
            {result.changes.map((change, index) => (
              <li key={change.field + "-" + index}>
                <strong>{change.field}:</strong> {change.from} <span aria-hidden="true">→</span> {change.to}
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.preserved?.length > 0 && (
        <details className="detail-block preserved">
          <summary>O que se mantém ({result.preserved.length})</summary>
          <ul>{result.preserved.map((item) => <li key={item}>✓ {item}</li>)}</ul>
        </details>
      )}

      {result.configurators?.length > 0 && (
        <div className="detail-block configurators">
          <h3>Configurador encontrado, mas não validado</h3>
          <p>O sistema não recebeu estado de sessão suficiente para confirmar uma configuração. Estes IDs não são recomendações:</p>
          <div className="chips">{result.configurators.map((item) => <span key={item.id}>{item.id}</span>)}</div>
        </div>
      )}

      {result.alternatives?.length > 0 && (
        <details className="detail-block">
          <summary>Ver segunda opção validada</summary>
          {result.alternatives.map((item) => (
            <div className="alternative" key={item.orderCode || item.description}>
              <strong>{item.description}</strong>
              {item.orderCode && <span>12NC {item.orderCode}</span>}
            </div>
          ))}
        </details>
      )}

      {result.message && <p className="message">{result.message}</p>}
      {!isSuccess && result.reason && <p className="reason">Motivo técnico: {result.reason.replaceAll("_", " ").toLowerCase()}.</p>}
    </section>
  );
}

function App() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  async function search(event) {
    event?.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery || loading) return;
    setLoading(true);
    setResult(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40000);
    try {
      const response = await fetch("/api/alternative", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: cleanQuery }),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }
      if (!payload) throw new Error("A API devolveu uma resposta inválida (HTTP " + response.status + ").");
      setResult(payload);
    } catch (error) {
      setResult({
        status: "SOURCE_UNAVAILABLE",
        message: error?.name === "AbortError"
          ? "A pesquisa excedeu o tempo limite. Tente novamente."
          : error.message || "Não foi possível concluir a pesquisa.",
        validation: { verified: false, source: "Signify APIs" },
      });
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }

  return (
    <main>
      <header className="hero">
        <div className="brand-mark" aria-hidden="true">S</div>
        <div>
          <p className="eyebrow">QUOTE SUPPORT · PROFESSIONAL LIGHTING</p>
          <h1>Signify Alternative Finder</h1>
          <p className="subtitle">Encontra a alternativa PSU ↔ DALI mais próxima e só recomenda produtos validados em fontes oficiais.</p>
        </div>
      </header>

      <form className="search" onSubmit={search}>
        <label htmlFor="reference">Referência Signify / Philips ou 12NC</label>
        <div className="search-row">
          <input
            id="reference"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ex.: DN142B 10S/840 PSU-E WR IP54"
            autoComplete="off"
            maxLength={500}
          />
          <button type="submit" disabled={!query.trim() || loading}>
            {loading ? <><span className="spinner" />A validar…</> : "Encontrar alternativa"}
          </button>
        </div>
        <p className="hint">A pesquisa pode demorar alguns segundos: um artigo standard é confirmado pelo 12NC; uma solução configurável é confirmada pelo Configurator.</p>
      </form>

      {result && <Result result={result} />}

      <footer>
        <strong>Regra de segurança:</strong> nenhuma referência gerada por texto é apresentada como produto. É necessária validação pelo Product API ou pelo Configurator API.
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
