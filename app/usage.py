"""사용량/비용 집계.

- 추정·실측 비용(실시간): 이 앱이 보낸 모든 요청을 SQLite에 기록 (OpenAI/BFL은 응답의 토큰·credit으로 실측, Gemini는 표 단가)
- 공식 비용(선택):
    · OpenAI  : OPENAI_ADMIN_KEY가 있으면 Costs API로 이번 달 청구 금액 조회 (일 단위, 수 시간 지연)
    · BFL     : API 키로 남은 credit 잔액 조회
    · Google  : API 키로는 사용량 조회 API가 없어 AI Studio 화면 링크만 안내
"""
import hashlib
import re
from datetime import date, datetime, timedelta, timezone

import httpx

from . import db
from .config import settings


def record(*, provider: str, model: str, purpose: str, images: int, cost_usd: float, basis: str,
           input_tokens: int = 0, output_tokens: int = 0):
    db.execute(
        "INSERT INTO usage(ts, provider, model, purpose, images, input_tokens, output_tokens, cost_usd, basis)"
        " VALUES(?,?,?,?,?,?,?,?,?)",
        (datetime.now().isoformat(timespec="seconds"), provider, model, purpose, images,
         input_tokens, output_tokens, round(cost_usd, 6), basis))


def _sum(where: str, params=()) -> float:
    r = db.row(f"SELECT COALESCE(SUM(cost_usd),0) AS c FROM usage WHERE {where}", params)
    return round(r["c"], 6)


def brief() -> dict:
    today = date.today()
    month_cost = _sum("ts LIKE ?", (f"{today.strftime('%Y-%m')}%",))
    return {
        "today_usd": _sum("ts LIKE ?", (f"{today.isoformat()}%",)),
        "month_usd": month_cost,
        "budget_exceeded": bool(settings.monthly_budget_usd and month_cost >= settings.monthly_budget_usd),
    }


def summary() -> dict:
    today = date.today()
    month = today.strftime("%Y-%m")
    since = (today - timedelta(days=29)).isoformat()
    d = brief()
    d.update({
        "total_usd": _sum("1=1"),
        "usd_krw": settings.usd_krw,
        "monthly_budget_usd": settings.monthly_budget_usd,
        "by_provider": db.rows(
            "SELECT provider, COUNT(*) AS calls, SUM(images) AS images, SUM(cost_usd) AS cost FROM usage"
            " WHERE ts LIKE ? GROUP BY provider ORDER BY cost DESC", (f"{month}%",)),
        "by_model": db.rows(
            "SELECT model, provider, SUM(images) AS images, SUM(cost_usd) AS cost,"
            " SUM(CASE WHEN basis='actual' THEN cost_usd ELSE 0 END) AS actual_cost FROM usage"
            " WHERE ts LIKE ? GROUP BY model ORDER BY cost DESC", (f"{month}%",)),
        "by_purpose": db.rows(
            "SELECT purpose, SUM(images) AS images, SUM(cost_usd) AS cost FROM usage WHERE ts LIKE ? GROUP BY purpose",
            (f"{month}%",)),
        "daily": db.rows(
            "SELECT substr(ts,1,10) AS day, SUM(cost_usd) AS cost, SUM(images) AS images FROM usage WHERE ts >= ?"
            " GROUP BY day ORDER BY day", (since,)),
        "recent": db.rows("SELECT * FROM usage ORDER BY id DESC LIMIT 40"),
        "keys": {p: settings.key_ok(p) for p in ("openai", "gemini", "bfl")},
        "openai_admin_set": bool(settings.openai_admin_key),
    })
    return d


# ---------------- OpenAI 공식 청구 ----------------
_API = "https://api.openai.com/v1/organization"
_key_cache: dict[str, dict | None] = {}


def _admin_get(path: str, params: dict | None = None) -> dict:
    r = httpx.get(f"{_API}{path}", params=params or {}, timeout=20,
                  headers={"Authorization": f"Bearer {settings.openai_admin_key}"})
    r.raise_for_status()
    return r.json()


def _paged(path: str, params: dict | None = None, max_pages: int = 10):
    params = dict(params or {})
    for _ in range(max_pages):
        body = _admin_get(path, params)
        yield from body.get("data", [])
        if not body.get("has_more"):
            break
        params["after"] = body.get("last_id") or body["data"][-1]["id"]


def _redacted_matches(redacted: str, key: str) -> bool:
    m = re.match(r"^(.*?)[*.…]+(.*)$", redacted or "")
    if not m:
        return False
    pre, suf = m.groups()
    return bool(pre or suf) and key.startswith(pre) and key.endswith(suf)


def _find_app_key() -> dict | None:
    key = settings.openai_api_key
    h = hashlib.sha256(key.encode()).hexdigest()
    if h in _key_cache:
        return _key_cache[h]
    matches = [
        {"id": k["id"], "name": k.get("name") or "(이름 없음)", "project": proj.get("name") or proj["id"]}
        for proj in _paged("/projects", {"limit": 100})
        for k in _paged(f"/projects/{proj['id']}/api_keys", {"limit": 100})
        if _redacted_matches(k.get("redacted_value", ""), key)
    ]
    found = matches[0] if len(matches) == 1 else None
    _key_cache[h] = found
    return found


def official_openai() -> dict:
    if not settings.openai_admin_key:
        return {"available": False}
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    params = {"start_time": int(start.timestamp()), "bucket_width": "1d", "limit": 31, "group_by": ["api_key_id"]}
    key_error = None
    try:
        app_key = _find_app_key() if settings.key_ok("openai") else None
    except httpx.HTTPError as e:
        app_key, key_error = None, f"이 앱의 키를 조회하지 못했습니다: {e}"
    key_id = app_key["id"] if app_key else None
    try:
        org_total, key_total, key_days = 0.0, 0.0, []
        page = None
        for _ in range(5):
            if page:
                params["page"] = page
            body = _admin_get("/costs", params)
            for b in body.get("data", []):
                day_key = 0.0
                for x in b.get("results", []):
                    amt = float(x.get("amount", {}).get("value", 0) or 0)
                    org_total += amt
                    if key_id and x.get("api_key_id") == key_id:
                        day_key += amt
                key_total += day_key
                day = datetime.fromtimestamp(b["start_time"], timezone.utc).date().isoformat()
                key_days.append({"day": day, "cost": round(day_key, 4)})
            if not body.get("has_more"):
                break
            page = body.get("next_page")
    except httpx.HTTPStatusError as e:
        return {"available": True, "error": f"공식 비용 조회 실패 (HTTP {e.response.status_code}): {e.response.text[:200]}"}
    except httpx.HTTPError as e:
        return {"available": True, "error": f"공식 비용 조회 실패: {e}"}
    return {
        "available": True, "org_month_usd": round(org_total, 4), "key_found": bool(app_key), "key_error": key_error,
        "key_name": app_key["name"] if app_key else None, "key_project": app_key["project"] if app_key else None,
        "key_month_usd": round(key_total, 4) if app_key else None, "key_daily": key_days if app_key else [],
    }


def bfl_balance() -> dict:
    if not settings.key_ok("bfl"):
        return {"available": False}
    try:
        r = httpx.get("https://api.bfl.ai/v1/credits", headers={"x-key": settings.bfl_api_key}, timeout=15)
        if r.status_code != 200:
            return {"available": True, "error": f"잔액 조회 실패 (HTTP {r.status_code})"}
        credits = float(r.json().get("credits", 0))
        return {"available": True, "credits": credits, "usd": round(credits * 0.01, 4)}
    except (httpx.HTTPError, ValueError) as e:
        return {"available": True, "error": f"잔액 조회 실패: {e}"}


def official() -> dict:
    return {"openai": official_openai(), "bfl": bfl_balance(),
            "gemini": {"available": settings.key_ok("gemini"), "url": "https://aistudio.google.com/usage"}}
