import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import "./App.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8003";

const leverageCopy = {
  low: "Low",
  medium: "Medium",
  high: "High",
} as const;

type Leverage = keyof typeof leverageCopy;
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
  hits: number;
  extra_base_hits: number;
  home_runs: number;
  total_bases: number;
  runs_batted_in: number;
  walks: number;
  balls: number;
  strikes: number;
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

const formatNumber = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 0 });

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
      .split(/[\n,]/)
      .map((token) => token.trim())
      .filter(Boolean);
  }, [form.excludeRaw]);

  const runRecommendations = async () => {
    setLoading(true);
    setError(null);
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
      setError(err instanceof Error ? err.message : "Unable to fetch predictions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runRecommendations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runRecommendations();
  };

  const relievers = result?.top_relievers ?? [];
  const primaryReliever = relievers[0];

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">B</div>
        <nav className="nav-tabs" aria-label="Primary">
          <span className="tab">Work-Ahead</span>
          <span className="tab">Story Builder</span>
          <span className="tab active">Predictions</span>
        </nav>
        <div className="top-meta">
          <span className="pill subtle">API {API_BASE_URL}</span>
          <span className="pill subtle">{leverageCopy[form.leverage]} leverage</span>
          <span className="pill">{form.batter === "L" ? "Lefty" : "Righty"} lineup</span>
        </div>
      </header>

      <main className="layout">
        <section className="control-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Configure</p>
              <h2>Batting filters</h2>
              <p className="muted">
                Align the predictions with the current matchup and keep arms with
                too little rest out of rotation.
              </p>
            </div>
            <div className="pill subtle">{excludeList.length} exclusions</div>
          </div>

          <form className="control-grid" onSubmit={handleSubmit}>
            <label className="field">
              <span className="label">Batter handedness</span>
              <div className="toggle-row">
                {(["L", "R"] as Batter[]).map((side) => (
                  <button
                    key={side}
                    type="button"
                    className={`toggle ${form.batter === side ? "active" : ""}`}
                    onClick={() => setForm((prev) => ({ ...prev, batter: side }))}
                  >
                    {side === "L" ? "Left" : "Right"}
                  </button>
                ))}
              </div>
            </label>

            <label className="field">
              <span className="label">Leverage</span>
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

            <label className="field full">
              <span className="label">Exclude relievers</span>
              <textarea
                rows={3}
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

            <div className="actions">
              <button type="submit" className="primary" disabled={loading}>
                {loading ? "Updating predictions..." : "Refresh table"}
              </button>
              {error && <div className="alert">{error}</div>}
            </div>
          </form>
        </section>

        <section className="table-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Predictions</p>
              <h2>Matchup table</h2>
              <p className="muted">
                Ordered recommendations blending run prevention, control, and platoon fit.
              </p>
            </div>
            <div className="pill">{result?.deterministic === false ? "LLM augmented" : "Deterministic"}</div>
          </div>

          <div className="table-chrome">
            <div className="table-meta">
              <div className="mode">
                <span className="dot" />
                Batting
              </div>
              <div className="pill ghost">Player</div>
            </div>
            {primaryReliever && (
              <div className="count-boxes" aria-label="Count summary">
                <div>
                  <p>Balls</p>
                  <strong>{formatNumber(primaryReliever.balls)}</strong>
                </div>
                <div>
                  <p>Strikes</p>
                  <strong>{formatNumber(primaryReliever.strikes)}</strong>
                </div>
              </div>
            )}
          </div>

          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th aria-label="priority" className="narrow" />
                  <th className="narrow">Score</th>
                  <th>Name</th>
                  <th>Hits</th>
                  <th>Extra base hits</th>
                  <th>Home runs</th>
                  <th>Total bases</th>
                  <th>Runs batted in</th>
                  <th>Walks</th>
                  <th>Splits vs Right</th>
                  <th>Splits vs Left</th>
                  <th className="count">Count</th>
                </tr>
              </thead>
              <tbody>
                {relievers.map((reliever, index) => (
                  <tr key={reliever.name} className={index === 0 ? "accent-row" : index === 1 ? "secondary-row" : ""}>
                    <td className="narrow">
                      <span className="selector" aria-hidden />
                    </td>
                    <td className="mono">{reliever.score.toFixed(3)}</td>
                    <td>
                      <div className="name-stack">
                        <div className="name">{reliever.name}</div>
                        <div className="sub">
                          {reliever.throws === "L" ? "Left" : "Right"} • Rest {reliever.days_rest}d
                        </div>
                      </div>
                    </td>
                    <td className="numeric">{formatNumber(reliever.hits)}</td>
                    <td className="numeric">{formatNumber(reliever.extra_base_hits)}</td>
                    <td className="numeric">{formatNumber(reliever.home_runs)}</td>
                    <td className="numeric">{formatNumber(reliever.total_bases)}</td>
                    <td className="numeric">{formatNumber(reliever.runs_batted_in)}</td>
                    <td className="numeric">{formatNumber(reliever.walks)}</td>
                    <td className="numeric">{reliever.vsR_woba.toFixed(3)}</td>
                    <td className="numeric">{reliever.vsL_woba.toFixed(3)}</td>
                    <td className="count-cell">
                      <div>
                        <p className="sub">Balls</p>
                        <strong>{formatNumber(reliever.balls)}</strong>
                      </div>
                      <div>
                        <p className="sub">Strikes</p>
                        <strong>{formatNumber(reliever.strikes)}</strong>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && relievers.length === 0 && (
                  <tr>
                    <td colSpan={12} className="empty">
                      Run the query to see predictions.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
