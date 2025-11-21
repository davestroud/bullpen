import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8003";
const HERO_IMAGE_URL =
  "https://foxsports-wordpress-www-prsupports-prod.s3.amazonaws.com/uploads/sites/2/2022/06/presspass_placeholder.png";

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
      .split(/[,\\n]/)
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
        err instanceof Error ? err.message : "Unable to fetch recommendations.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-content">
          <p className="eyebrow">Bullpen</p>
          <h1>Game-ready relief picker</h1>
          <p className="lede">
            Feed in the current batter, leverage, and any names to skip. Bullpen
            returns the top three options from the CSV-backed model, plus an
            optional LLM rationale if configured.
          </p>
          <div className="status-pill">
            API target: <span>{API_BASE_URL}</span>
          </div>
        </div>
        <figure className="hero-media">
          <img
            src={HERO_IMAGE_URL}
            alt="Fox Sports broadcast desk placeholder graphic"
            loading="lazy"
          />
          <figcaption>
            Image courtesy of Fox Sports PressPass. Swap in your clubhouse
            visuals for production.
          </figcaption>
        </figure>
      </header>

      <main>
        <section className="panel">
          <h2>Game context</h2>
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

            <button type="submit" disabled={loading}>
              {loading ? "Scoring bullpen..." : "Get recommendation"}
            </button>
          </form>
        </section>

        <section className="panel results">
          <h2>Top candidates</h2>
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
                {result.top_relievers.map((reliever) => (
                  <li key={reliever.name}>
                    <div className="reliever-card">
                      <div>
                        <h3>{reliever.name}</h3>
                        <p className="sub">
                          {reliever.throws === "L" ? "Left" : "Right"} • Score:{" "}
                          <strong>{reliever.score.toFixed(3)}</strong>
                        </p>
                      </div>
                      <dl>
                        <div>
                          <dt>ERA</dt>
                          <dd>{reliever.era.toFixed(2)}</dd>
                        </div>
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
                        <div>
                          <dt>Days rest</dt>
                          <dd>{reliever.days_rest}</dd>
                        </div>
                      </dl>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="explanation-block">
                <h3>Explanation</h3>
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
