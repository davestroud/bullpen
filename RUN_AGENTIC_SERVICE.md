# Running the Agentic Bullpen Service

## Prerequisites

1. **Python environment** - Make sure you have Python 3.11+ installed
2. **Dependencies** - Install all required packages
3. **Data file** - Ensure `data/relievers.csv` exists (or it will auto-refresh)
4. **Optional: OpenAI API key** - For LLM explanations

## Setup Steps

### 1. Install Dependencies

```bash
# Create virtual environment (if not already done)
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install all dependencies (includes LangGraph)
pip install -r requirements.txt
```

### 2. Set Environment Variables (Optional)

```bash
# For LLM explanations (optional)
export OPENAI_API_KEY=sk-your-key-here
export LLM_MODEL=gpt-4o-mini  # or gpt-4o, etc.

# For LangSmith tracing (optional - for debugging agent workflow)
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_ENDPOINT=https://api.smith.langchain.com
export LANGCHAIN_API_KEY=your-langsmith-key
```

### 3. Ensure Data File Exists

The service will auto-refresh if `data/relievers.csv` is missing, but you can pre-populate it:

```bash
# Option 1: Use the script (if you have Statcast data access)
python scripts/fetch_relievers_statcast.py --min-innings 5.0

# Option 2: The service will auto-refresh on first request if file is missing
```

## Running the Service

### Method 1: Using the convenience launcher

```bash
python app.py
```

This starts the server at `http://127.0.0.1:8003` with auto-reload enabled.

### Method 2: Using uvicorn directly

```bash
uvicorn bullpen.service:app --reload --host 127.0.0.1 --port 8003
```

### Method 3: Production mode (no reload)

```bash
uvicorn bullpen.service:app --host 0.0.0.0 --port 8003
```

## Testing the Agent Workflow

### 1. Check Health Endpoint

```bash
curl http://127.0.0.1:8003/healthz
```

Expected response:
```json
{"status": "ok"}
```

### 2. Test Recommendations Endpoint (with agents)

```bash
curl -X POST "http://127.0.0.1:8003/recommendations" \
  -H "Content-Type: application/json" \
  -d '{
    "batter": "L",
    "leverage": "high",
    "exclude": []
  }'
```

### 3. View API Documentation

Open in browser: `http://127.0.0.1:8003/docs`

This provides an interactive Swagger UI where you can test the endpoints.

## Expected Response Format

The response now includes agent workflow notes:

```json
{
  "deterministic": true,
  "top_relievers": [
    {
      "name": "Reliever Name",
      "throws": "R",
      "era": 2.83,
      "whip": 1.03,
      "k9": 11.2,
      "bb9": 2.9,
      "vsL_woba": 0.280,
      "vsR_woba": 0.225,
      "days_rest": 2,
      "score": 0.8123,
      "hits": 0,
      "extra_base_hits": 0,
      "home_runs": 0,
      "total_bases": 0,
      "runs_batted_in": 0,
      "walks": 0,
      "balls": 0,
      "strikes": 0
    }
  ],
  "explanation": "LLM-generated explanation...",
  "context": {
    "batter": "L",
    "leverage": "high",
    "exclude": []
  },
  "notes": [
    "Critic: explanation references the top candidate by name.",
    "Auto-refreshed reliever CSV with 150 Statcast rows."
  ]
}
```

## Agent Workflow Details

The `/recommendations` endpoint now runs through 4 agent nodes:

1. **load_data** - Loads reliever data (auto-refreshes if missing)
2. **score** - Deterministically ranks relievers
3. **explain** - Generates LLM explanation (if API key set)
4. **critic** - Validates explanation quality

The `notes` field contains feedback from each agent stage.

## Troubleshooting

### Issue: Import errors for LangGraph

**Solution**: Make sure you installed requirements:
```bash
pip install -r requirements.txt
```

### Issue: No relievers returned

**Solution**: Check if `data/relievers.csv` exists. The service will try to auto-refresh, but needs network access for Statcast data.

### Issue: LLM explanation is null

**Solution**: Set `OPENAI_API_KEY` environment variable. The service works without it, but won't generate explanations.

### Issue: Statcast refresh fails

**Solution**: Ensure you have network access and pybaseball can reach Baseball Savant. Check your internet connection.

## Running Frontend (Optional)

If you want to test with the React frontend:

```bash
cd frontend
npm install  # First time only
npm run dev
```

Then open `http://127.0.0.1:5173` in your browser.
