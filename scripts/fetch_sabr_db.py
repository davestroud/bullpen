#!/usr/bin/env python3
"""
Utility to download the SABR bullpen dataset into a local SQLite database.

Usage:
    python scripts/fetch_sabr_db.py \
        --source-url https://sabr.app.box.com/s/bxcnfvxe2m7gkvi06pgu9skie78te114 \
        --output data/sabr.db

The script accepts either a pre-built .db file or a .sql script. When a SQL
script is detected (by extension or the --force-sql flag), its contents are
executed against the SQLite database specified by --output.
"""

from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile

import requests


def download_file(url: str, chunk_size: int = 8192) -> Path:
    response = requests.get(url, stream=True)
    try:
        response.raise_for_status()
    except requests.HTTPError as exc:  # pragma: no cover - clarity only
        raise SystemExit(f"Download failed: {exc}") from exc

    suffix = Path(url).suffix or ".bin"
    temp_file = NamedTemporaryFile(delete=False, suffix=suffix)
    with temp_file as fh:
        for chunk in response.iter_content(chunk_size=chunk_size):
            if chunk:
                fh.write(chunk)
    return Path(temp_file.name)


def build_from_sql(sql_path: Path, output_db: Path) -> None:
    sql_text = sql_path.read_text()
    output_db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(output_db)
    try:
        conn.executescript(sql_text)
        conn.commit()
    finally:
        conn.close()


def copy_binary(db_path: Path, output_db: Path) -> None:
    output_db.parent.mkdir(parents=True, exist_ok=True)
    output_db.write_bytes(db_path.read_bytes())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Fetch SABR bullpen database.")
    parser.add_argument(
        "--source-url",
        required=True,
        help="HTTP(S) URL pointing to the SABR dataset (SQL or SQLite).",
    )
    parser.add_argument(
        "--output",
        default="data/sabr.db",
        type=Path,
        help="Path where the SQLite database will be written (default: data/sabr.db).",
    )
    parser.add_argument(
        "--force-sql",
        action="store_true",
        help="Treat the downloaded file as a SQL script even if the extension does not end in .sql.",
    )

    args = parser.parse_args(argv)

    downloaded = download_file(args.source_url)
    try:
        is_sql = args.force_sql or downloaded.suffix.lower() == ".sql"
        if is_sql:
            print(f"Building SQLite database at {args.output} from SQL script...")
            build_from_sql(downloaded, args.output)
        else:
            print(f"Saving downloaded SQLite database to {args.output}...")
            copy_binary(downloaded, args.output)
        print("Done.")
    finally:
        downloaded.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
