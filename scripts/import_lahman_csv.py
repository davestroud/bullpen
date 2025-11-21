#!/usr/bin/env python3
"""
Import the Lahman CSV release (e.g., lahman_1871-2024u_csv) into a SQLite DB.

Usage example:

    python scripts/import_lahman_csv.py \
        --source-dir ~/Downloads/lahman_1871-2024u_csv \
        --output data/lahman.db \
        --replace

By default every *.csv file in the directory becomes a lowercase table whose
name matches the CSV stem (AllstarFull.csv -> allstarfull). Use --tables to
limit which files are imported.
"""

from __future__ import annotations

import argparse
import csv
import sqlite3
from pathlib import Path
from typing import Dict, Iterable, List, Sequence


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-dir",
        type=Path,
        required=True,
        help="Path to the extracted Lahman CSV directory (contains many *.csv files).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/lahman.db"),
        help="Destination SQLite DB file. Created if missing. Default: data/lahman.db.",
    )
    parser.add_argument(
        "--tables",
        nargs="*",
        help="Optional list of CSV stems (case-insensitive) to import. Example: People Teams Pitching.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Drop existing tables before importing (default: append/skip if table exists).",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=500,
        help="Rows sampled per CSV to infer column types. Default: 500.",
    )
    return parser.parse_args(argv)


def identifier(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def infer_column_types(rows: List[Dict[str, str]]) -> Dict[str, str]:
    def classify(value: str) -> str:
        if value is None or value == "":
            return "NULL"
        try:
            int(value)
            return "INTEGER"
        except ValueError:
            try:
                float(value)
                return "REAL"
            except ValueError:
                return "TEXT"

    type_precedence = {"INTEGER": 1, "REAL": 2, "TEXT": 3}

    column_types: Dict[str, str] = {}
    for row in rows:
        for column, value in row.items():
            current = column_types.get(column, "INTEGER")
            new_type = classify(value)
            if new_type == "NULL":
                continue
            if type_precedence[new_type] > type_precedence.get(current, 1):
                column_types[column] = new_type
            else:
                column_types.setdefault(column, new_type)
    # default TEXT if we never saw a value
    for column in rows[0].keys():
        column_types.setdefault(column, "TEXT")
    return column_types


def read_sample_rows(csv_path: Path, sample_size: int) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            rows.append(row)
            if len(rows) >= sample_size:
                break
    if not rows:
        raise ValueError(f"{csv_path} appears to be empty.")
    return rows


def iter_rows(csv_path: Path) -> Iterable[Dict[str, str]]:
    with csv_path.open(newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            yield row


def convert_value(value: str, target_type: str):
    if value is None or value == "":
        return None
    if target_type == "INTEGER":
        return int(value)
    if target_type == "REAL":
        return float(value)
    return value


def create_table(
    conn: sqlite3.Connection, table: str, columns: Dict[str, str], replace: bool
) -> None:
    cursor = conn.cursor()
    if replace:
        cursor.execute(f"DROP TABLE IF EXISTS {identifier(table)}")
    else:
        exists = cursor.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND lower(name)=lower(?)",
            (table,),
        ).fetchone()
        if exists:
            print(
                f"Skipping {table}: table already exists (use --replace to overwrite)."
            )
            return
    column_sql = ", ".join(f"{identifier(col)} {typ}" for col, typ in columns.items())
    cursor.execute(f"CREATE TABLE IF NOT EXISTS {identifier(table)} ({column_sql})")
    conn.commit()


def insert_rows(
    conn: sqlite3.Connection,
    table: str,
    columns: List[str],
    column_types: Dict[str, str],
    rows: Iterable[Dict[str, str]],
    batch_size: int = 500,
) -> None:
    cursor = conn.cursor()
    placeholders = ", ".join(["?"] * len(columns))
    column_list = ", ".join(identifier(col) for col in columns)
    sql = f"INSERT INTO {identifier(table)} ({column_list}) VALUES ({placeholders})"

    batch: List[List[object]] = []
    total = 0
    for row in rows:
        batch.append(
            [convert_value(row.get(col), column_types[col]) for col in columns]
        )
        if len(batch) >= batch_size:
            cursor.executemany(sql, batch)
            conn.commit()
            total += len(batch)
            batch.clear()
    if batch:
        cursor.executemany(sql, batch)
        conn.commit()
        total += len(batch)
    print(f"Inserted {total:,} rows into {table}.")


def main(argv: Sequence[str] | None = None) -> None:
    args = parse_args(argv)
    source_dir = args.source_dir.expanduser()
    if not source_dir.exists():
        raise SystemExit(f"Source directory not found: {source_dir}")

    csv_files = sorted(source_dir.glob("*.csv"))
    if not csv_files:
        raise SystemExit(f"No CSV files found in {source_dir}")

    whitelist = {name.lower() for name in args.tables} if args.tables else None

    args.output.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.output)
    conn.execute("PRAGMA journal_mode=WAL")

    try:
        for csv_path in csv_files:
            table = csv_path.stem.lower()
            if whitelist and table not in whitelist:
                continue
            print(f"Processing {csv_path.name} -> table '{table}'")
            sample_rows = read_sample_rows(csv_path, args.sample_size)
            column_types = infer_column_types(sample_rows)
            columns = list(sample_rows[0].keys())
            create_table(conn, table, column_types, args.replace)
            insert_rows(conn, table, columns, column_types, iter_rows(csv_path))
    finally:
        conn.close()
    print(f"Finished importing CSVs into {args.output}")


if __name__ == "__main__":
    main()
