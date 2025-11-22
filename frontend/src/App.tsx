import { useEffect, useMemo, useState, useRef, useCallback } from "react";
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

type GameState = {
  inning: number;
  half: "Top" | "Bottom";
  outs: number;
  balls: number;
  strikes: number;
  lastPlay: string;
  score: {
    home: number;
    away: number;
  };
  runners: {
    first: boolean;
    second: boolean;
    third: boolean;
  };
};

type PitchOutcome =
  | "strike"
  | "ball"
  | "foul"
  | "single"
  | "double"
  | "triple"
  | "home_run"
  | "walk"
  | "strikeout"
  | "ground_out"
  | "fly_out";

type RelieverResult = {
  team: string;
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

const randomBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

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
  const [liveMode, setLiveMode] = useState(false);
  const [simulatedRelievers, setSimulatedRelievers] = useState<RelieverResult[]>(
    [],
  );
  const [gameState, setGameState] = useState<GameState>({
    inning: 1,
    half: "Top",
    outs: 0,
    balls: 0,
    strikes: 0,
    lastPlay: "Game simulation ready — click 'Start Simulation' to begin",
    score: {
      home: 0,
      away: 0,
    },
    runners: {
      first: false,
      second: false,
      third: false,
    },
  });
  const simulationIntervalRef = useRef<number | null>(null);

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
      // Initialize simulated relievers with current data
      setSimulatedRelievers(payload.top_relievers.map(r => ({ ...r })));
      // Reset game state
      setGameState({
        inning: 1,
        half: "Top",
        outs: 0,
        balls: 0,
        strikes: 0,
        lastPlay: "New matchup loaded — ready to simulate",
        score: {
          home: 0,
          away: 0,
        },
        runners: {
          first: false,
          second: false,
          third: false,
        },
      });
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

  // Game simulation logic
  const simulatePitch = useCallback((reliever: RelieverResult, batter: Batter): PitchOutcome => {
    const woba = batter === "L" ? reliever.vsL_woba : reliever.vsR_woba;
    const random = Math.random();
    
    // Base probabilities derived from wOBA and reliever stats
    const strikeoutRate = reliever.k9 / 27; // Approximate K rate
    const walkRate = reliever.bb9 / 27; // Approximate BB rate
    const hitRate = woba * 0.4; // Simplified hit probability
    
    if (random < strikeoutRate) {
      return "strikeout";
    }
    if (random < strikeoutRate + walkRate) {
      return "walk";
    }
    if (random < strikeoutRate + walkRate + hitRate * 0.1) {
      return "home_run";
    }
    if (random < strikeoutRate + walkRate + hitRate * 0.3) {
      return "double";
    }
    if (random < strikeoutRate + walkRate + hitRate * 0.5) {
      return "single";
    }
    if (random < strikeoutRate + walkRate + hitRate + 0.2) {
      return "strike";
    }
    if (random < strikeoutRate + walkRate + hitRate + 0.35) {
      return "foul";
    }
    if (random < strikeoutRate + walkRate + hitRate + 0.5) {
      return "ball";
    }
    return Math.random() < 0.5 ? "ground_out" : "fly_out";
  }, []);

  const getPlayDescription = (
    outcome: PitchOutcome,
    reliever: RelieverResult,
    count: { balls: number; strikes: number }
  ): string => {
    const countStr = `${count.balls}-${count.strikes}`;
    switch (outcome) {
      case "strikeout":
        return `Strikeout! ${reliever.name} gets the K on a ${countStr} count`;
      case "walk":
        return `Walk. ${reliever.name} issues a base on balls (${countStr})`;
      case "single":
        return `Single! Batter lines one into left field (${countStr})`;
      case "double":
        return `Double! Ball bounces off the wall (${countStr})`;
      case "home_run":
        return `HOME RUN! Ball sails over the fence (${countStr})`;
      case "strike":
        return `Strike ${count.strikes + 1} — ${reliever.name} gets a called strike (${countStr})`;
      case "ball":
        return `Ball ${count.balls + 1} — pitch misses outside (${countStr})`;
      case "foul":
        return `Foul ball — batter stays alive (${countStr})`;
      case "ground_out":
        return `Ground out — ${reliever.name} gets the out (${countStr})`;
      case "fly_out":
        return `Fly out — caught in the outfield (${countStr})`;
      default:
        return `Pitch result: ${outcome} (${countStr})`;
    }
  };

  const advanceRunners = (
    bases: number,
    currentRunners: GameState["runners"]
  ): { runners: GameState["runners"]; runs: number } => {
    const newRunners = { ...currentRunners };
    let runs = 0;

    // Score runners who can advance enough bases to score
    if (bases >= 1 && newRunners.third) {
      runs++;
      newRunners.third = false;
    }
    if (bases >= 2 && newRunners.second) {
      runs++;
      newRunners.second = false;
    }
    if (bases >= 3 && newRunners.first) {
      runs++;
      newRunners.first = false;
    }

    // Move remaining runners forward
    if (bases >= 4) {
      // Home run - all runners score, bases cleared
      newRunners.third = false;
      newRunners.second = false;
      newRunners.first = false;
    } else if (bases >= 3) {
      // Triple - clear bases, batter goes to third
      newRunners.third = true;
      newRunners.second = false;
      newRunners.first = false;
    } else if (bases >= 2) {
      // Double - move everyone up 2 bases
      if (newRunners.first) {
        newRunners.third = true;
        newRunners.first = false;
      } else {
        newRunners.third = false;
      }
      if (newRunners.second) {
        newRunners.second = false;
      }
      newRunners.second = true; // Batter goes to second
    } else if (bases >= 1) {
      // Single or walk - move everyone up 1 base
      const hadThird = newRunners.third;
      const hadSecond = newRunners.second;
      const hadFirst = newRunners.first;
      
      newRunners.third = hadSecond;
      newRunners.second = hadFirst;
      newRunners.first = true; // Batter goes to first
    }

    return { runners: newRunners, runs };
  };

  const simulateAtBat = useCallback(() => {
    if (!result || result.top_relievers.length === 0) return;

    const activeReliever = simulatedRelievers[0] || result.top_relievers[0];
    const batter = form.batter;

    setGameState((prev) => {
      if (prev.outs >= 3) {
        // End of inning
        const newHalf = prev.half === "Top" ? "Bottom" : "Top";
        const newInning = newHalf === "Top" ? prev.inning + 1 : prev.inning;
        
        if (newInning > 9) {
          // Game over
          return {
            ...prev,
            lastPlay: `Game complete! Final: ${prev.score.away}-${prev.score.home}`,
          };
        }

        return {
          ...prev,
          inning: newInning,
          half: newHalf,
          outs: 0,
          balls: 0,
          strikes: 0,
          runners: { first: false, second: false, third: false },
          lastPlay: `${newHalf} of the ${newInning}${newInning === 1 ? "st" : newInning === 2 ? "nd" : newInning === 3 ? "rd" : "th"} inning`,
        };
      }

      const currentCount = { balls: prev.balls, strikes: prev.strikes };
      const outcome = simulatePitch(activeReliever, batter);
      const playDescription = getPlayDescription(outcome, activeReliever, currentCount);

      // Update reliever stats
      const updatedRelievers = simulatedRelievers.map((r) => {
        if (r.name === activeReliever.name) {
          const updated = { ...r };
          switch (outcome) {
            case "strikeout":
              updated.strikes += 1;
              break;
            case "walk":
              updated.balls += 1;
              updated.walks += 1;
              break;
            case "single":
              updated.hits += 1;
              updated.total_bases += 1;
              break;
            case "double":
              updated.hits += 1;
              updated.extra_base_hits += 1;
              updated.total_bases += 2;
              break;
            case "home_run":
              updated.hits += 1;
              updated.extra_base_hits += 1;
              updated.home_runs += 1;
              updated.total_bases += 4;
              updated.runs_batted_in += 1;
              break;
            case "strike":
              updated.strikes += 1;
              break;
            case "ball":
              updated.balls += 1;
              break;
            case "ground_out":
            case "fly_out":
              // No stat updates for outs
              break;
          }
          return updated;
        }
        return r;
      });
      setSimulatedRelievers(updatedRelievers);

      let newBalls = prev.balls;
      let newStrikes = prev.strikes;
      let newOuts = prev.outs;
      let newRunners = prev.runners;
      let newScore = { ...prev.score };
      let finalPlay = playDescription;

      switch (outcome) {
        case "strikeout":
          newStrikes = 0;
          newBalls = 0;
          newOuts += 1;
          break;
        case "walk":
          newBalls = 0;
          newStrikes = 0;
          const walkResult = advanceRunners(1, newRunners);
          newRunners = { ...walkResult.runners, first: true };
          if (walkResult.runs > 0) {
            if (prev.half === "Top") {
              newScore.away += walkResult.runs;
            } else {
              newScore.home += walkResult.runs;
            }
            finalPlay += ` — ${walkResult.runs} run${walkResult.runs > 1 ? "s" : ""} scores`;
          }
          break;
        case "single":
          newBalls = 0;
          newStrikes = 0;
          const singleResult = advanceRunners(1, newRunners);
          newRunners = { ...singleResult.runners, first: true };
          if (singleResult.runs > 0) {
            if (prev.half === "Top") {
              newScore.away += singleResult.runs;
            } else {
              newScore.home += singleResult.runs;
            }
            finalPlay += ` — ${singleResult.runs} run${singleResult.runs > 1 ? "s" : ""} scores`;
          }
          break;
        case "double":
          newBalls = 0;
          newStrikes = 0;
          const doubleResult = advanceRunners(2, newRunners);
          newRunners = { ...doubleResult.runners, second: true };
          if (doubleResult.runs > 0) {
            if (prev.half === "Top") {
              newScore.away += doubleResult.runs;
            } else {
              newScore.home += doubleResult.runs;
            }
            finalPlay += ` — ${doubleResult.runs} run${doubleResult.runs > 1 ? "s" : ""} scores`;
          }
          break;
        case "home_run":
          newBalls = 0;
          newStrikes = 0;
          const hrResult = advanceRunners(4, newRunners);
          // Count all runners plus the batter
          const totalRuns = hrResult.runs + 1;
          if (prev.half === "Top") {
            newScore.away += totalRuns;
          } else {
            newScore.home += totalRuns;
          }
          finalPlay += ` — ${totalRuns} run${totalRuns > 1 ? "s" : ""} scores`;
          break;
        case "strike":
          newStrikes += 1;
          if (newStrikes >= 3) {
            newStrikes = 0;
            newBalls = 0;
            newOuts += 1;
            finalPlay = `Strikeout! ${activeReliever.name} gets the K`;
          }
          break;
        case "ball":
          newBalls += 1;
          if (newBalls >= 4) {
            newBalls = 0;
            newStrikes = 0;
            const bbResult = advanceRunners(1, newRunners);
            newRunners = { ...bbResult.runners, first: true };
            finalPlay = `Walk — ${activeReliever.name} issues a base on balls`;
            if (bbResult.runs > 0) {
              if (prev.half === "Top") {
                newScore.away += bbResult.runs;
              } else {
                newScore.home += bbResult.runs;
              }
              finalPlay += ` — ${bbResult.runs} run${bbResult.runs > 1 ? "s" : ""} scores`;
            }
          }
          break;
        case "foul":
          if (newStrikes < 2) {
            newStrikes += 1;
          }
          break;
        case "ground_out":
        case "fly_out":
          newBalls = 0;
          newStrikes = 0;
          newOuts += 1;
          break;
      }

      return {
        ...prev,
        balls: newBalls,
        strikes: newStrikes,
        outs: newOuts,
        runners: newRunners,
        score: newScore,
        lastPlay: finalPlay,
      };
    });
  }, [result, simulatedRelievers, form.batter, simulatePitch]);

  // Auto-progression timer
  useEffect(() => {
    if (liveMode && result) {
      simulationIntervalRef.current = window.setInterval(() => {
        simulateAtBat();
      }, 3000); // Simulate every 3 seconds

      return () => {
        if (simulationIntervalRef.current) {
          clearInterval(simulationIntervalRef.current);
        }
      };
    } else {
      if (simulationIntervalRef.current) {
        clearInterval(simulationIntervalRef.current);
        simulationIntervalRef.current = null;
      }
    }
  }, [liveMode, result, simulateAtBat]);

  const handleStartSimulation = () => {
    if (!result || result.top_relievers.length === 0) {
      setError("Please load relievers first");
      return;
    }
    setLiveMode(true);
    setGameState((prev) => ({
      ...prev,
      lastPlay: "Simulation started — first pitch coming up",
    }));
  };

  const handleStopSimulation = () => {
    setLiveMode(false);
  };

  const handleStepSimulation = () => {
    if (!liveMode) {
      simulateAtBat();
    }
  };

  const relievers = liveMode && simulatedRelievers.length > 0 
    ? simulatedRelievers 
    : (result?.top_relievers ?? []);
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
              <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 500 }}>{gameState.lastPlay}</p>
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

          {/* Game Simulation Panel */}
          <div className="game-simulation-panel" style={{ marginTop: "2rem", padding: "1.5rem", border: "1px solid #e0e0e0", borderRadius: "8px" }}>
            <div className="panel-header" style={{ marginBottom: "1rem" }}>
              <div>
                <p className="eyebrow">Game Simulation</p>
                <h3 style={{ margin: "0.25rem 0", fontSize: "1.25rem" }}>Live Game</h3>
              </div>
              <div className="pill" style={{ backgroundColor: liveMode ? "#4caf50" : "#757575" }}>
                {liveMode ? "● LIVE" : "Paused"}
              </div>
            </div>

            {/* Game State Display */}
            <div className="game-state-display" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>Inning</p>
                <strong style={{ fontSize: "1.5rem" }}>{gameState.half} {gameState.inning}</strong>
              </div>
              <div>
                <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>Outs</p>
                <strong style={{ fontSize: "1.5rem" }}>{gameState.outs}</strong>
              </div>
              <div>
                <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>Count</p>
                <strong style={{ fontSize: "1.5rem" }}>{gameState.balls}-{gameState.strikes}</strong>
              </div>
              <div>
                <p className="muted" style={{ fontSize: "0.75rem", margin: 0 }}>Score</p>
                <strong style={{ fontSize: "1.5rem" }}>{gameState.score.away}-{gameState.score.home}</strong>
              </div>
            </div>

            {/* Runners Display */}
            <div style={{ marginBottom: "1rem" }}>
              <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>Runners</p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <span className={`pill ${gameState.runners.first ? "" : "ghost"}`} style={{ fontSize: "0.75rem" }}>1st</span>
                <span className={`pill ${gameState.runners.second ? "" : "ghost"}`} style={{ fontSize: "0.75rem" }}>2nd</span>
                <span className={`pill ${gameState.runners.third ? "" : "ghost"}`} style={{ fontSize: "0.75rem" }}>3rd</span>
              </div>
            </div>

            {/* Last Play */}
            <div style={{ marginBottom: "1rem", padding: "0.75rem", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
              <p className="muted" style={{ fontSize: "0.75rem", margin: "0 0 0.25rem 0" }}>Last Play</p>
              <p style={{ margin: 0, fontSize: "0.9rem" }}>{gameState.lastPlay}</p>
            </div>

            {/* Simulation Controls */}
            <div className="actions" style={{ display: "flex", gap: "0.5rem" }}>
              {!liveMode ? (
                <>
                  <button
                    type="button"
                    className="primary"
                    onClick={handleStartSimulation}
                    disabled={!result || result.top_relievers.length === 0}
                  >
                    Start Simulation
                  </button>
                  <button
                    type="button"
                    onClick={handleStepSimulation}
                    disabled={!result || result.top_relievers.length === 0}
                  >
                    Step
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleStopSimulation}
                  style={{ backgroundColor: "#f44336", color: "white" }}
                >
                  Stop Simulation
                </button>
              )}
            </div>
          </div>
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

          {/* Baseball Field Visualization */}
          <div className="baseball-field-container" style={{ marginBottom: "2rem", padding: "1.5rem", backgroundColor: "rgba(255, 255, 255, 0.02)", borderRadius: "12px", border: "1px solid rgba(255, 255, 255, 0.08)" }}>
            <div className="baseball-field">
              {/* Outfield Wall */}
              <div className="outfield-wall"></div>
              
              {/* Outfield Grass */}
              <div className="outfield">
                <div className="outfield-grass">
                  <div className="grass-pattern"></div>
                </div>
              </div>
              
              {/* Foul Lines */}
              <div className="foul-line foul-line-left"></div>
              <div className="foul-line foul-line-right"></div>
              
              {/* Infield */}
              <div className="infield">
                <div className="infield-dirt">
                  <div className="dirt-texture"></div>
                </div>
                
                {/* Batter's Box */}
                <div className="batters-box batters-box-left"></div>
                <div className="batters-box batters-box-right"></div>
                
                {/* Bases */}
                <div className={`base base-home ${gameState.runners.first && gameState.runners.second && gameState.runners.third ? 'all-loaded' : ''}`}>
                  <div className="base-inner">
                    <div className="base-top"></div>
                    <div className="base-label">HOME</div>
                  </div>
                  {gameState.balls > 0 || gameState.strikes > 0 ? (
                    <div className="count-indicator">
                      {gameState.balls}-{gameState.strikes}
                    </div>
                  ) : null}
                </div>
                
                <div className={`base base-first ${gameState.runners.first ? 'occupied' : ''}`}>
                  <div className="base-inner">
                    <div className="base-top"></div>
                    <div className="base-label">1</div>
                  </div>
                  {gameState.runners.first && <div className="runner">👤</div>}
                </div>
                
                <div className={`base base-second ${gameState.runners.second ? 'occupied' : ''}`}>
                  <div className="base-inner">
                    <div className="base-top"></div>
                    <div className="base-label">2</div>
                  </div>
                  {gameState.runners.second && <div className="runner">👤</div>}
                </div>
                
                <div className={`base base-third ${gameState.runners.third ? 'occupied' : ''}`}>
                  <div className="base-inner">
                    <div className="base-top"></div>
                    <div className="base-label">3</div>
                  </div>
                  {gameState.runners.third && <div className="runner">👤</div>}
                </div>
                
                {/* Pitcher's Mound */}
                <div className="pitchers-mound">
                  <div className="mound-slope"></div>
                  <div className="mound-circle">
                    <div className="rubber"></div>
                    {primaryReliever && (
                      <div className="pitcher-info">
                        <div className="pitcher-name">{primaryReliever.name.split(' ').pop()}</div>
                        <div className="pitcher-stats">{primaryReliever.throws}</div>
                      </div>
                    )}
                  </div>
                  {/* Pitcher */}
                  <div className="player player-pitcher">⚾</div>
                </div>
                
                {/* Fielders */}
                <div className="player player-catcher">🧤</div>
                <div className="player player-first-base">👤</div>
                <div className="player player-second-base">👤</div>
                <div className="player player-third-base">👤</div>
                <div className="player player-shortstop">👤</div>
                <div className="player player-left-field">👤</div>
                <div className="player player-center-field">👤</div>
                <div className="player player-right-field">👤</div>
                
                {/* Batter */}
                <div className="player player-batter">🏃</div>
                
                {/* Base paths */}
                <svg className="base-paths" viewBox="0 0 200 200" preserveAspectRatio="none">
                  <path d="M 100 180 L 160 60 L 40 60 Z" fill="none" stroke="#8B5A3C" strokeWidth="3" opacity="0.6" />
                  <line x1="100" y1="180" x2="160" y2="60" stroke="#8B5A3C" strokeWidth="2" opacity="0.4" />
                  <line x1="160" y1="60" x2="40" y2="60" stroke="#8B5A3C" strokeWidth="2" opacity="0.4" />
                  <line x1="40" y1="60" x2="100" y2="180" stroke="#8B5A3C" strokeWidth="2" opacity="0.4" />
                </svg>
              </div>
              
              {/* Scoreboard */}
              <div className="field-scoreboard">
                <div className="scoreboard-team">
                  <span className="team-label">Away</span>
                  <span className="team-score">{gameState.score.away}</span>
                </div>
                <div className="scoreboard-inning">
                  <span className="inning-half">{gameState.half}</span>
                  <span className="inning-number">{gameState.inning}</span>
                </div>
                <div className="scoreboard-team">
                  <span className="team-label">Home</span>
                  <span className="team-score">{gameState.score.home}</span>
                </div>
              </div>
              
              {/* Outs indicator */}
              <div className="outs-indicator">
                {[1, 2, 3].map((outNum) => (
                  <div
                    key={outNum}
                    className={`out-dot ${outNum <= gameState.outs ? 'active' : ''}`}
                  />
                ))}
                <span className="outs-label">{gameState.outs} OUT{gameState.outs !== 1 ? 'S' : ''}</span>
              </div>
            </div>
            
            {/* Play animation indicator */}
            {gameState.lastPlay && gameState.lastPlay !== "Game simulation ready — click 'Start Simulation' to begin" && (
              <div className="play-indicator" style={{ marginTop: "1rem", padding: "0.75rem", backgroundColor: "rgba(255, 209, 48, 0.1)", borderRadius: "6px", border: "1px solid rgba(255, 209, 48, 0.3)" }}>
                <p style={{ margin: 0, fontSize: "0.85rem", color: "#ffd130" }}>{gameState.lastPlay}</p>
              </div>
            )}
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
              <div className="pill ghost small">Count {gameState.balls}-{gameState.strikes}</div>
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
                  <th className="narrow">Team</th>
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
                      <div className="pill ghost small">{reliever.team}</div>
                    </td>
                    <td>
                      <div className="name-stack">
                        <div className="name">{reliever.name}</div>
                        <div className="sub">
                          {reliever.team} • {reliever.throws === "L" ? "Left" : "Right"} • Rest {reliever.days_rest}d
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
                    <td colSpan={13} className="empty">
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
