"""SQLite (표준 라이브러리). 사용량 기록과 저장한 이미지 메타데이터를 보관한다."""
import sqlite3
import threading
from contextlib import contextmanager

from .config import settings

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                -- 로컬 시간 ISO (YYYY-MM-DDTHH:MM:SS)
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,           -- generate | edit
  images INTEGER NOT NULL DEFAULT 1,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  basis TEXT NOT NULL DEFAULT 'estimate'   -- actual(API가 알려준 사용량) | estimate(표 단가) | demo
);
CREATE INDEX IF NOT EXISTS idx_usage_ts ON usage(ts);
CREATE TABLE IF NOT EXISTS saved_images (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  filename TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  width INTEGER, height INTEGER,
  dpi REAL,
  cost_usd REAL NOT NULL DEFAULT 0,
  meta TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS manual_billing (   -- 제공사 청구 화면에서 확인한 금액을 사용자가 직접 입력
  provider TEXT NOT NULL,
  month TEXT NOT NULL,                        -- YYYY-MM
  usd REAL NOT NULL,
  ts TEXT NOT NULL,
  PRIMARY KEY (provider, month)
);
"""


def init():
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(str(settings.db_path), check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
        _conn.commit()


@contextmanager
def _cursor():
    with _lock:
        cur = _conn.cursor()
        try:
            yield cur
            _conn.commit()
        finally:
            cur.close()


def execute(sql: str, params=()):
    with _cursor() as cur:
        cur.execute(sql, params)
        return cur.lastrowid


def rows(sql: str, params=()) -> list[dict]:
    with _cursor() as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


def row(sql: str, params=()) -> dict | None:
    r = rows(sql, params)
    return r[0] if r else None
