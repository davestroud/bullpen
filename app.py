"""Convenience launcher for the Bullpen FastAPI service."""

from bullpen.service import app  # re-export for ASGI servers

if __name__ == "__main__":
    import uvicorn

    uvicorn.run("bullpen.service:app", host="127.0.0.1", port=8003, reload=True)
