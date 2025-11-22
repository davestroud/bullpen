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

type GameState = {
  inning: number;
  half: "Top" | "Bottom";
  outs: number;
  pitch: number;
  lastPlay: string;
};

const randomBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const nextHalfInning = (state: GameState): GameState => {
  const nextHalf = state.half === "Top" ? "Bottom" : "Top";
  const nextInning = nextHalf === "Top" ? state.inning + 1 : state.inning;

  return {
    inning: nextInning,
    half: nextHalf,
    outs: 0,
    pitch: state.pitch,
    lastPlay: `${nextHalf} of the ${nextInning} — new pitcher warming up`,
  };
};

const formatNumber = (value: number): string =>
  value.toLocaleString("en-US", { maximumFractionDigits: 0 });

const createSimulatedFrame = (
  baseline: RelieverResult[],
): { relievers: RelieverResult[]; event: string; outsDelta: number } => {
  if (!baseline.length) {
    return { relievers: baseline, event: "Awaiting bullpen call", outsDelta: 0 };
  }

  const relieverIndex = randomBetween(0, Math.min(baseline.length - 1, 4));
  const reliever = baseline[relieverIndex];
  const updatedRelievers = baseline.map((entry) => ({ ...entry }));

  const outcomes = [
    {
      label: `${reliever.name} paints the corner for strike three`,
      apply: () => {
        updatedRelievers[relieverIndex].strikes += randomBetween(2, 3);
        updatedRelievers[relieverIndex].score = Math.max(
          0,
          reliever.score + randomBetween(-2, 0) / 100,
        );
        return 1;
      },
    },
    {
      label: `${reliever.name} issues a free pass`,
      apply: () => {
        updatedRelievers[relieverIndex].balls += randomBetween(2, 4);
        updatedRelievers[relieverIndex].walks += 1;
        updatedRelievers[relieverIndex].score = Math.max(
          0,
          reliever.score + randomBetween(0, 3) / 100,
        );
        return 0;
      },
    },
    {
      label: `${reliever.name} surrenders a sharp single`,
      apply: () => {
        updatedRelievers[relieverIndex].hits += 1;
        updatedRelievers[relieverIndex].total_bases += 1;
        updatedRelievers[relieverIndex].runs_batted_in += randomBetween(0, 1);
        updatedRelievers[relieverIndex].balls += randomBetween(0, 1);
        updatedRelievers[relieverIndex].strikes += randomBetween(1, 2);
        updatedRelievers[relieverIndex].score = Math.max(
          0,
          reliever.score + randomBetween(0, 2) / 100,
        );
        return 0;
      },
    },
    {
      label: `${reliever.name} induces a groundout to short`,
      apply: () => {
        updatedRelievers[relieverIndex].strikes += randomBetween(1, 2);
        updatedRelievers[relieverIndex].balls += randomBetween(0, 1);
        updatedRelievers[relieverIndex].score = Math.max(
          0,
          reliever.score + randomBetween(-1, 1) / 100,
        );
        return 1;
      },
    },
    {
      label: `${reliever.name} gives up a towering home run`,
      apply: () => {
        updatedRelievers[relieverIndex].home_runs += 1;
        updatedRelievers[relieverIndex].hits += 1;
        updatedRelievers[relieverIndex].extra_base_hits += 1;
        updatedRelievers[relieverIndex].total_bases += 4;
        updatedRelievers[relieverIndex].runs_batted_in += randomBetween(1, 3);
        updatedRelievers[relieverIndex].balls += randomBetween(0, 1);
        updatedRelievers[relieverIndex].score = Math.max(
          0,
          reliever.score + randomBetween(2, 4) / 100,
        );
        return 0;
      },
    },
    {
      label: `${reliever.name} freezes the batter looking`,
      apply: () => {
        updatedRelievers[relieverIndex].strikes += 2;
        updatedRelievers[relieverIndex].balls += randomBetween(0, 1);
        updatedRelievers[relieverIndex].score = Math.max(
          0,
          reliever.score + randomBetween(-2, 1) / 100,
        );
        return 1;
      },
    },
  ];

  const outcome = outcomes[randomBetween(0, outcomes.length - 1)];
  const outsDelta = outcome.apply();

  return { relievers: updatedRelievers, event: outcome.label, outsDelta };
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
  const [liveMode, setLiveMode] = useState(true);
  const [simulatedRelievers, setSimulatedRelievers] = useState<RelieverResult[]>(
    [],
  );
  const [gameState, setGameState] = useState<GameState>({
    inning: 1,
    half: "Top",
    outs: 0,
    pitch: 1,
    lastPlay: "First pitch coming up",
  });

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
      setGameState((prev) => ({
        ...prev,
        inning: 1,
        half: "Top",
        outs: 0,
        pitch: 1,
        lastPlay: "New matchup loaded — first pitch coming up",
      }));
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

  useEffect(() => {
    if (!liveMode) {
      setSimulatedRelievers([]);
      return undefined;
    }

    if (!result?.top_relievers.length) {
      return undefined;
    }


    const interval = window.setInterval(() => {
      setSimulatedRelievers((current) => {
        const source = current.length ? current : result.top_relievers;
        const { relievers: nextFrame, event, outsDelta } = createSimulatedFrame(
          source,
        );
        
        // Update gameState immediately with the computed values to avoid race condition
        setGameState((prev) => {
          const pitch = prev.pitch + randomBetween(1, 3);
          const outs = prev.outs + outsDelta;

          if (outs >= 3) {
            return nextHalfInning({ ...prev, outs, pitch, lastPlay: event });
          }

          return {
            ...prev,
            outs,
            pitch,
            lastPlay: event,
          };
        });
        
        return nextFrame;
      });
    }, 2600);

    return () => window.clearInterval(interval);
  }, [liveMode, result?.top_relievers]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void runRecommendations();
  };

  const relievers = result?.top_relievers ?? [];
  const displayedRelievers =
    liveMode && simulatedRelievers.length ? simulatedRelievers : relievers;
  const primaryReliever = displayedRelievers[0];

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
          <button
            type="button"
            className={`pill subtle live-toggle ${liveMode ? "on" : "off"}`}
            onClick={() => setLiveMode((prev) => !prev)}
            aria-pressed={liveMode}
          >
            <span className="pulse" aria-hidden />
            {liveMode ? "Live sim on" : "Live sim paused"}
          </button>
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
            <div className="live-readout" role="status" aria-live="polite">
              <div className="pill ghost small">Pitch #{formatNumber(gameState.pitch)}</div>
              <div className="pill ghost small">{gameState.outs} out{gameState.outs === 1 ? "" : "s"}</div>
              <div className="pill subtle small">
                {gameState.half} {gameState.inning}
              </div>
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

          <div className="ticker" role="status" aria-live="polite">
            <div className="ticker-meta">
              <span className="mini-dot" aria-hidden />
              <span className="ticker-label">In-game update</span>
            </div>
            <div className="ticker-body">
              <p className="muted">{gameState.lastPlay}</p>
            </div>
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
                {displayedRelievers.map((reliever, index) => (
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
