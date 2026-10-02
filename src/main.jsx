import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const STATUS_LABELS = {
  DIRECT_VERIFIED_MATCH: "Correspondência direta verificada",
  SAME_FAMILY_VERIFIED_MATCH: "Alternativa verificada da mesma família",
  CLOSEST_VERIFIED_TECHNICAL_MATCH: "Alternativa técnica verificada mais próxima",
  CURRENT_FAMILY_VERIFIED_MATCH: "Alternativa verificada da família atual",
  VERIFIED_CONFIGURABLE_PRODUCT: "Configuração verificada",
  CURRENT_FAMILY_CONFIGURATION_IDENTIFIED: "Configuração da família atual identificada",
  NO_VERIFIED_ALTERNATIVE: "Sem alternativa verificada",
  SOURCE_UNAVAILABLE: "Fonte oficial indisponível",
  NEEDS_REVIEW: "Referência por rever",
  ERROR: "Erro",
};

const CONFIGURATOR_REASON_LABELS = {
  CONFIGURATOR_SESSION_NOT_AVAILABLE: "não foi possível iniciar a sessão",
  CONTROL_VARIABLE_NOT_DISCOVERED: "variável de controlo não encontrada",
  TARGET_CONTROL_NOT_SELECTABLE: "DALI não aparece como selecionável",
  TARGET_CONTROL_NOT_SELECTED: "a seleção DALI não foi confirmada",
  FINAL_COMMERCIAL_DESCRIPTION_NOT_RETURNED: "a descrição comercial final não foi devolvida",
  CONFIGURATOR_RETURNED_UNEXPECTED_FAMILY: "o configurador devolveu outra família",
  CONFIGURATION_TECHNICALLY_INCOMPATIBLE: "a configuração final não preservou os requisitos",
  SUCCESSOR_EVIDENCE_NOT_VALIDATED: "a família sucessora não atingiu confiança suficiente",
  NOT_ATTEMPTED: "não foi possível iniciar a validação",
};

function ProductCard({ title, product, recommended = false }) {
  if (!product) return null;
  return (
    <article className={recommended ? "product-card recommended" : "product-card"}>
      <div className="card-label">{title}</div>
      <h3>{product.description || product.input || "Referência não disponível"}</h3>
      {product.control && <span className={recommended ? "control-badge target" : "control-badge"}>{product.control}</span>}
      <dl>
        {product.orderCode && <><dt>12NC</dt><dd>{product.orderCode}</dd></>}
        {product.family && <><dt>Família</dt><dd>{product.family}</dd></>}
        
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
  const hasIdentifiedConfiguration = Boolean(result.recommended && result.status === "CURRENT_FAMILY_CONFIGURATION_IDENTIFIED");
  const showRecommended = isSuccess || hasIdentifiedConfiguration;
  const statusClass = isSuccess ? "success" : hasIdentifiedConfiguration ? "warning" : result.status === "SOURCE_UNAVAILABLE" ? "warning" : "neutral";
  return (
    <section className="result-panel" aria-live="polite">
      <div className="result-heading">
        <span className={"status " + statusClass}>{STATUS_LABELS[result.status] || result.statusLabel || result.status}</span>
        {result.compatibility && result.compatibility !== "NONE" && <span className="compatibility">{result.compatibility.replaceAll("_", " ")}</span>}
      </div>

      <div className={showRecommended ? "comparison" : "comparison single"}>
        <ProductCard title="Referência pesquisada" product={result.original} />
        {showRecommended && <div className="change-arrow" aria-hidden="true">→</div>}
        {showRecommended && <ProductCard title={isSuccess ? "Mesma versão com controlo alternativo" : "Configuração identificada"} product={result.recommended} recommended />}
      </div>

      {showRecommended && <div className="control-summary"><strong>{result.original?.control || "Original"}</strong><span>→</span><strong>{result.recommended?.control || "Alternativa"}</strong><small>As restantes características são preservadas sempre que a validação oficial o permite.</small></div>}

      <Validation validation={result.validation} />

      {result.technicalValidation?.verified && <div className="tech-validation"><strong>Validação técnica Signify</strong><p>✓ Família Outdoor confirmada no Luminaire Configurator V2 ({result.technicalValidation.segment}).</p></div>}

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
          <p>Estes identificadores foram encontrados oficialmente, mas ainda não constituem uma recomendação:</p>
          <div className="chips">
            {result.configurators.map((item) => (
              <span key={item.id}>
                {item.id}{item.reason && <> · {CONFIGURATOR_REASON_LABELS[item.reason] || item.reason.replaceAll("_", " ").toLowerCase()}</>}
                {item.httpStatus && <> · HTTP {item.httpStatus}</>}
              </span>
            ))}
          </div>
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
          <p className="subtitle">Compara a referência atual com a mesma versão em PSU ↔ PSD/DALI, usando catálogo, CPQ/Configurator e validação técnica Outdoor quando aplicável.</p>
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
        <p className="hint">A referência original fica sempre visível. A alternativa só é apresentada como confirmada quando existe evidência oficial suficiente.</p>
      </form>

      {result && <Result result={result} />}

      <footer>
        <strong>Regra de segurança:</strong> a ferramenta não transforma PSU em PSD por texto. Product API/CPQ validam a referência comercial e o Luminaire Configurator V2 acrescenta validação técnica às famílias Outdoor suportadas.
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
