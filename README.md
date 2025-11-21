# Bullpen — JSON-first reliever recommender

Bullpen is a Python backend service that ranks relief pitchers using a deterministic scoring function backed by CSV data. Given batter handedness, leverage, and optional exclusions, it returns the top three candidates as JSON. If `OPENAI_API_KEY` is set, it will also call an OpenAI chat model to generate an 80–120 word justification for the #1 option (the ranking itself always remains deterministic).

## Quick start

```bash
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# optional, enables LLM explanations
export OPENAI_API_KEY=sk-...
export LLM_MODEL=gpt-4o-mini

# run the ASGI service (port 8003)
uvicorn bullpen.service:app --reload --port 8003
# -> http://127.0.0.1:8003/docs for Swagger UI

# optional SPA (new terminal)
cd frontend
npm install            # once
npm run dev            # -> http://127.0.0.1:5173
```

Set `VITE_API_BASE_URL` in `frontend/.env` if your API runs somewhere other than `http://127.0.0.1:8003`.

## Refresh reliever data from Baseball Savant (pybaseball)

Use the Statcast-backed helper to regenerate `data/relievers.csv` from Baseball Savant via [pybaseball](https://pypi.org/project/pybaseball/):

```bash
python scripts/fetch_relievers_statcast.py \
  --start-date 2024-03-01 \
  --end-date 2024-10-01 \
  --min-innings 10
```

- Defaults to the current season (March 1 → today) if you omit the dates.
- Filters to pitchers with at least the given innings pitched and writes the normalized CSV format the service expects.
- Requires network access because pybaseball pulls directly from Baseball Savant.

You can also refresh the data from the running FastAPI service without a separate script:

```bash
curl -X POST "http://127.0.0.1:8003/refresh-data" \
  -H "Content-Type: application/json" \
  -d '{"min_innings": 8.0}'
```

- `start_date` and `end_date` are optional JSON fields (YYYY-MM-DD). They default to March 1 of the given year through today.
- The endpoint writes to `BULLPEN_DATA`/`data/relievers.csv`, clears cached rows, and returns how many relievers were recorded.

## SABR dataset helper

If you need the SABR bullpen dataset locally for LangChain/LangSmith experiments, use the helper script:

```bash
python scripts/fetch_sabr_db.py \
  --source-url https://sabr.app.box.com/s/bxcnfvxe2m7gkvi06pgu9skie78te114 \
  --output data/sabr.db
```

- Works with either a `.db` or `.sql` download; pass `--force-sql` if the URL lacks an extension.
- The resulting `data/sabr.db` can be opened with `sqlite3`, SQLAlchemy, or LangChain’s `SQLDatabase`.

## Lahman CSV → SQLite helper

Use the latest Lahman CSV release (e.g., `lahman_1871-2024u_csv`) and load it into SQLite:

```bash
python scripts/import_lahman_csv.py \
  --source-dir ~/Downloads/lahman_1871-2024u_csv \
  --output data/lahman.db \
  --replace
```

- Every `.csv` becomes a lowercase table; limit the import with `--tables People Teams Pitching`.
- Columns are type-inferred automatically. Blank values become `NULL`.
- Once populated, query with `sqlite3 data/lahman.db` or point LangChain to `sqlite:///data/lahman.db`.

## Frontend SPA

- Built with Vite + React + TypeScript in `frontend/`.
- Calls `POST /recommendations` and renders the response (top 3 relievers + explanation).
- Shows which API URL it targets so you can point at staging/prod without rebuilding.
- Gracefully handles missing LLM explanations and displays helpful states for loading/errors.

You can customize palettes/UX via `frontend/src/App.css`.

## API

- `GET /healthz` — lightweight readiness check
- `POST /recommendations`
  ```jsonc
  {
    "batter": "L",
    "leverage": "high",
    "exclude": ["Joe Smith"]
  }
  ```
  Response payload:
  ```jsonc
  {
    "deterministic": true,
    "top_relievers": [
      {
        "name": "Hayden Stone",
        "throws": "R",
        "era": 2.83,
        "whip": 1.03,
        "k9": 11.2,
        "bb9": 2.9,
        "vsL_woba": 0.280,
        "vsR_woba": 0.225,
        "days_rest": 2,
        "score": 0.8123
      }
      // ...
    ],
    "explanation": "If OPENAI_API_KEY was set; otherwise null",
    "context": {
      "batter": "L",
      "leverage": "high",
      "exclude": ["Joe Smith"]
    }
  }
  ```
- `POST /refresh-data`
  ```jsonc
  {
    "start_date": "2024-03-01", // optional
    "end_date": "2024-10-01",   // optional
    "min_innings": 8.0           // optional, defaults to 5.0
  }
  ```
  Downloads Statcast data via pybaseball, rewrites the reliever CSV at
  `BULLPEN_DATA`/`data/relievers.csv`, clears caches, and returns a count of
  relievers captured for the window.

## Design notes

- **Deterministic ranking**: CSV is loaded once, scores are pure functions of inputs, and no randomness is involved in ordering.
- **Transparent scoring**: see `bullpen/scoring.py` for the normalized weights on ERA, WHIP, K/BB, platoon, and rest.
- **LLM optionality**: ranking works offline; the OpenAI client is only invoked when `OPENAI_API_KEY` is set.
- **Extensibility hooks**: the package layout (`data`, `scoring`, `llm`, `service`) keeps room for RAG modules, tracing/metrics, and test harnesses for prompt quality.

## Repository layout

```
bullpen-mvp/
├── app.py                  # convenience launcher for uvicorn
├── bullpen/
│   ├── __init__.py
│   ├── data.py
│   ├── llm.py
│   ├── models.py
│   ├── scoring.py
│   ├── service.py
│   └── settings.py
├── frontend/               # React SPA (Vite)
│   └── ...
├── scripts/
│   ├── fetch_sabr_db.py
│   └── import_lahman_csv.py
├── data/
│   └── relievers.csv
├── requirements.txt
└── README.md
```
