import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8003";
const HERO_IMAGE_URL =
  "https://images.unsplash.com/photo-1579952363873-27f3bade9f55?auto=format&fit=crop&w=1400&q=80";

type Leverage = "low" | "medium" | "high";
type Batter = "L" | "R";

type RelieverResult = {
  name: string;
  throws: Batter;
  era: number;
  whip: number;
  k9: number;
  bb9: number;
  vsL_woba: number;
  vsR_woba: number;
  days_rest: number;
  score: number;
};

type RecommendationResponse = {
  deterministic: boolean;
  top_relievers: RelieverResult[];
  explanation: string | null;
  context: {
    batter: Batter;
    leverage: Leverage;
    exclude: string[];
  };
};

type FormState = {
  batter: Batter;
  leverage: Leverage;
  excludeRaw: string;
};

const leverageCopy: Record<Leverage, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function App() {
  const [form, setForm] = useState<FormState>({
    batter: "L",
    leverage: "medium",
    excludeRaw: "",
  });
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const excludeList = useMemo(() => {
    return form.excludeRaw
      .split(/[,\n]/)
      .map((token) => token.trim())
      .filter(Boolean);
  }, [form.excludeRaw]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch(`${API_BASE_URL}/recommendations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          batter: form.batter,
          leverage: form.leverage,
          exclude: excludeList,
        }),
      });
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || response.statusText);
      }
      const payload = (await response.json()) as RecommendationResponse;
      setResult(payload);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Unable to fetch recommendations."
      );
    } finally {
      setLoading(false);
    }
  };

  const primaryReliever = result?.top_relievers[0];

  return (
    <div className="app-shell">
      <div className="orb orb-one" aria-hidden />
      <div className="orb orb-two" aria-hidden />

      <header className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">Bullpen control room</p>
            <h1>
              Agentic relief commander
              <span className="accent">.</span>
            </h1>
            <p className="lede">
              Drive the bullpen with live context, deterministic scoring, and an
              optional LLM voice. Toggle the inputs, let the agent reason, and
              watch the rotation snap into place.
            </p>

            <div className="pill-row">
              <span className="pill">
                API target
                <strong>{API_BASE_URL}</strong>
              </span>
              <span className="pill pill-secondary">
                {result?.deterministic === false
                  ? "Generative rationale engaged"
                  : "Deterministic scoring ready"}
              </span>
              <span className="pill pill-ghost">
                {excludeList.length > 0
                  ? `${excludeList.length} exclusions loaded`
                  : "No exclusions applied"}
              </span>
            </div>

            <div className="agent-grid">
              <div className="agent-step">
                <div className="badge">01</div>
                <div>
                  <p className="step-title">Context ingest</p>
                  <p className="step-copy">
                    Batter: {form.batter === "L" ? "Left" : "Right"}. Leverage
                    tuned to {leverageCopy[form.leverage]} with a
                    {excludeList.length ? " guarded" : " clean"} bullpen.
                  </p>
                </div>
              </div>
              <div className="agent-step">
                <div className="badge">02</div>
                <div>
                  <p className="step-title">Score fusion</p>
                  <p className="step-copy">
                    The model balances ERA, WHIP, K/BB, platoon fit, and rest
                    days. Keep the deterministic core or enable LLM commentary.
                  </p>
                </div>
              </div>
              <div className="agent-step">
                <div className="badge">03</div>
                <div>
                  <p className="step-title">Recommend & brief</p>
                  <p className="step-copy">
                    Get the top three options with a crisp breakdown so the
                    skipper can call the right arm without hesitation.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <figure className="hero-visual">
            <div className="hero-glow" />
            <img
              src={HERO_IMAGE_URL}
              alt="Pitcher walking toward the mound with dramatic lighting"
              loading="lazy"
            />
            <figcaption>
              Automated bullpen brief powered by CSV stats and optional LLM
              support.
            </figcaption>

            <div className="summary-card">
              <div className="summary-header">
                <p className="summary-label">Live agent readout</p>
                <span className="status-dot" aria-hidden />
              </div>
              {primaryReliever ? (
                <div>
                  <p className="summary-name">{primaryReliever.name}</p>
                  <p className="summary-meta">
                    {primaryReliever.throws === "L" ? "Left" : "Right"} • Score
                    {" "}
                    <strong>{primaryReliever.score.toFixed(3)}</strong>
                  </p>
                  <div className="summary-grid">
                    <div>
                      <p className="label">ERA</p>
                      <p className="value">{primaryReliever.era.toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="label">WHIP</p>
                      <p className="value">
                        {primaryReliever.whip.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="label">Rest</p>
                      <p className="value">{primaryReliever.days_rest}d</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="placeholder">
                  <p className="summary-name">Awaiting run</p>
                  <p className="summary-meta">
                    Queue the model to see the agent pick light up.
                  </p>
                  <div className="placeholder-bars">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}
            </div>
          </figure>
        </div>
      </header>

      <main className="workspace">
        <section className="panel form-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Inputs</p>
              <h2>Feed the bullpen agent</h2>
              <p className="muted">
                Lock in the matchup, set the leverage expectation, and protect
                any arms you want to hold back.
              </p>
            </div>
            <div className="pill pill-ghost small">
              {excludeList.length} names filtered
            </div>
          </div>

          <form className="context-form" onSubmit={handleSubmit}>
            <label>
              Batter handedness
              <div className="toggle-row">
                {(["L", "R"] as Batter[]).map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={`toggle ${form.batter === side ? "active" : ""}`}
                    onClick={() => setForm((prev) => ({ ...prev, batter: side }))}
                  >
                    {side === "L" ? "Lefty" : "Righty"}
                  </button>
                ))}
              </div>
            </label>

            <label>
              Leverage
              <select
                value={form.leverage}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    leverage: event.target.value as Leverage,
                  }))
                }
              >
                {(Object.keys(leverageCopy) as Leverage[]).map((level) => (
                  <option key={level} value={level}>
                    {leverageCopy[level]}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Exclude relievers (comma or newline separated)
              <textarea
                placeholder="e.g. Joe Smith, Alex Reyes"
                value={form.excludeRaw}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    excludeRaw: event.target.value,
                  }))
                }
              />
            </label>

            <button type="submit" disabled={loading} className="primary-btn">
              {loading ? "Scoring bullpen..." : "Execute agent"}
            </button>
          </form>
        </section>

        <section className="panel results">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Output</p>
              <h2>Agent picks</h2>
              <p className="muted">
                Ordered recommendations blending run prevention, control, and
                platoon fit.
              </p>
            </div>
            {result && (
              <div className="pill pill-secondary small">
                {result.deterministic ? "Deterministic" : "LLM augmented"}
              </div>
            )}
          </div>

          {error && <div className="alert error">{error}</div>}
          {!error && !result && !loading && (
            <p className="muted">
              Run the model to see the top three relievers ranked by ERA, WHIP,
              K/BB, platoon fit, and rest.
            </p>
          )}
          {loading && <p className="muted">Crunching numbers…</p>}

          {result && (
            <>
              <ol className="reliever-list">
                {result.top_relievers.map((reliever, index) => (
                  <li key={reliever.name} className="reliever-card">
                    <div className="reliever-rank">#{index + 1}</div>
                    <div className="reliever-top">
                      <div>
                        <h3>{reliever.name}</h3>
                        <p className="sub">
                          {reliever.throws === "L" ? "Left" : "Right"} • Score
                          <strong> {reliever.score.toFixed(3)}</strong>
                        </p>
                      </div>
                      <div className="chip-group">
                        <span className="chip">Rest: {reliever.days_rest}d</span>
                        <span className="chip">ERA {reliever.era.toFixed(2)}</span>
                      </div>
                    </div>
                    <dl className="stat-grid">
                      <div>
                        <dt>WHIP</dt>
                        <dd>{reliever.whip.toFixed(2)}</dd>
                      </div>
                      <div>
                        <dt>K/9</dt>
                        <dd>{reliever.k9.toFixed(1)}</dd>
                      </div>
                      <div>
                        <dt>BB/9</dt>
                        <dd>{reliever.bb9.toFixed(1)}</dd>
                      </div>
                      <div>
                        <dt>vs L wOBA</dt>
                        <dd>{reliever.vsL_woba.toFixed(3)}</dd>
                      </div>
                      <div>
                        <dt>vs R wOBA</dt>
                        <dd>{reliever.vsR_woba.toFixed(3)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ol>

              <div className="explanation-block">
                <div className="explanation-heading">
                  <div>
                    <p className="eyebrow">Narrative</p>
                    <h3>LLM brief</h3>
                  </div>
                  <span className="pill pill-ghost small">
                    {result.deterministic
                      ? "LLM disabled"
                      : "Generated commentary"}
                  </span>
                </div>
                {result.explanation ? (
                  <p>{result.explanation}</p>
                ) : (
                  <p className="muted">
                    Set <code>OPENAI_API_KEY</code> on the backend to enable the
                    generated blurb for the #1 reliever.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
