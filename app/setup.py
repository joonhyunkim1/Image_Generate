"""웹 '초기 설정' 화면: 로컬 .env 파일 읽기/쓰기와 API 키 검증.

- .env는 이 PC의 프로젝트 폴더에만 저장된다(가능하면 권한 600 — Windows는 폴더 권한을 따름).
- 브라우저에는 비밀 키를 마스킹해서만 돌려준다.
- 키 검증은 각 제공사에 직접 요청한다(모델/잔액 조회 — 과금 없음).
"""
import os
import re
import shutil
import tempfile

import httpx

from .config import ENV_EXAMPLE_PATH, ENV_PATH, KEY_CHECKS, settings

FIELDS: list[dict] = [
    {"key": "OPENAI_API_KEY", "type": "secret"},
    {"key": "OPENAI_ADMIN_KEY", "type": "secret"},
    {"key": "GEMINI_API_KEY", "type": "secret"},
    {"key": "BFL_API_KEY", "type": "secret"},
    {"key": "OUTPUT_FORMAT", "type": "choice", "default": "png", "choices": ["png", "jpg"]},
    {"key": "USD_KRW", "type": "float", "default": "1400", "min": 1, "max": 100000},
    {"key": "MONTHLY_BUDGET_USD", "type": "float", "default": "20", "min": 0, "max": 1000000},
    {"key": "DEMO_MODE", "type": "bool", "default": "false"},
]
_BY_KEY = {f["key"]: f for f in FIELDS}
_LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$")


class SetupError(ValueError):
    pass


def mask_secret(v: str) -> str:
    if not v:
        return ""
    return v[:7] + "…" + v[-4:] if len(v) > 14 else "…" + v[-2:]


def _unquote(v: str) -> str:
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        return v[1:-1]
    return re.split(r"\s+#", v, maxsplit=1)[0].strip()


def read_env() -> dict[str, str]:
    if not ENV_PATH.exists():
        return {}
    out = {}
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        m = _LINE.match(line)
        if m:
            out[m.group(1)] = _unquote(m.group(2))
    return out


def _quote(v: str) -> str:
    return f'"{v}"' if re.search(r"[\s#'\"]", v) else v


def write_env(updates: dict[str, str]):
    """기존 주석·순서를 유지하며 값만 교체하고, 없는 키는 끝에 추가. 임시 파일 → 교체 방식으로 저장."""
    if not ENV_PATH.exists():
        if ENV_EXAMPLE_PATH.exists():
            shutil.copyfile(ENV_EXAMPLE_PATH, ENV_PATH)
        else:
            ENV_PATH.write_text("", encoding="utf-8")
    lines = ENV_PATH.read_text(encoding="utf-8").splitlines()
    remaining = dict(updates)
    for i, line in enumerate(lines):
        m = _LINE.match(line)
        if m and m.group(1) in remaining:
            k = m.group(1)
            lines[i] = f"{k}={_quote(remaining.pop(k))}"
    if remaining:
        lines.append("")
        lines.extend(f"{k}={_quote(v)}" for k, v in remaining.items())
    fd, tmp = tempfile.mkstemp(dir=ENV_PATH.parent, prefix=".env.", text=True)
    with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines) + "\n")
    try:
        os.chmod(tmp, 0o600)  # Windows에서는 제한적으로만 동작 — 실패해도 무시
    except OSError:
        pass
    os.replace(tmp, ENV_PATH)


def _validate(key: str, raw) -> str:
    f = _BY_KEY.get(key)
    if not f:
        raise SetupError(f"편집할 수 없는 항목입니다: {key}")
    v = str(raw if raw is not None else "").replace("\r", "").replace("\n", "").replace('"', "").strip()
    t = f["type"]
    if t == "secret" and v:
        if key in KEY_CHECKS and not KEY_CHECKS[key](v):
            hint = {"OPENAI_API_KEY": "'sk-'로 시작하는 전체 키", "GEMINI_API_KEY": "'AQ.' 또는 'AIza'로 시작하는 전체 키",
                    "BFL_API_KEY": "BFL 대시보드의 전체 키"}[key]
            raise SetupError(f"{key} 형식이 올바르지 않습니다. {hint}를 붙여넣으세요.")
        if key == "OPENAI_ADMIN_KEY" and not v.startswith("sk-admin-"):
            raise SetupError("Admin 키는 'sk-admin-'으로 시작합니다. 일반 API 키와 다릅니다.")
    elif t in ("int", "float"):
        try:
            n = int(v) if t == "int" else float(v)
        except ValueError:
            raise SetupError(f"{key}: 숫자를 입력하세요.")
        if not (f["min"] <= n <= f["max"]):
            raise SetupError(f"{key}: {f['min']}~{f['max']} 범위로 입력하세요.")
    elif t == "bool":
        v = "true" if v.lower() in ("1", "true", "yes", "on") else "false"
    elif t == "choice" and v not in f["choices"]:
        raise SetupError(f"{key}: {', '.join(f['choices'])} 중 하나를 선택하세요.")
    return v


def get_state() -> dict:
    env = read_env()
    values = {}
    for f in FIELDS:
        v = env.get(f["key"], "")
        if f["type"] == "secret":
            ok = KEY_CHECKS[f["key"]](v) if f["key"] in KEY_CHECKS else bool(v)
            values[f["key"]] = {"set": ok, "masked": mask_secret(v) if ok else ""}
        else:
            values[f["key"]] = v if v != "" else f["default"]
    return {"env_exists": ENV_PATH.exists(), "env_path": str(ENV_PATH), "values": values, "fields": FIELDS,
            "keys_ok": {p: settings.key_ok(p) for p in ("openai", "gemini", "bfl")}}


def save(values: dict) -> dict:
    updates = {}
    for key, raw in values.items():
        f = _BY_KEY.get(key)
        # 비밀 키: 빈 값이면 '변경 안 함'. 삭제는 {"__clear__": true}
        if f and f["type"] == "secret":
            if isinstance(raw, dict) and raw.get("__clear__"):
                updates[key] = ""
                continue
            if not raw:
                continue
        updates[key] = _validate(key, raw)
    if updates:
        write_env(updates)
    settings.reload()
    return get_state()


# ---------------- 키 검증 (과금 없음) ----------------

def _msg(r: httpx.Response) -> str:
    try:
        j = r.json()
        e = j.get("error", j)
        return str(e.get("message", e)) if isinstance(e, dict) else str(e)
    except Exception:  # noqa: BLE001
        return r.text[:200]


def test_key(provider: str, key: str | None) -> dict:
    key = (key or "").strip() or settings.key_for(provider)
    env = {"openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY", "bfl": "BFL_API_KEY"}[provider]
    if not key or not KEY_CHECKS[env](key):
        return {"ok": False, "error": "키가 입력되지 않았거나 형식이 올바르지 않습니다."}
    try:
        if provider == "openai":
            r = httpx.get("https://api.openai.com/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=15)
            if r.status_code != 200:
                return {"ok": False, "error": "유효하지 않은 키입니다." if r.status_code == 401 else f"HTTP {r.status_code}: {_msg(r)[:160]}"}
            ids = {m["id"] for m in r.json().get("data", [])}
            from .models import MODELS
            return {"ok": True, "models": {m["id"]: m["api_model"] in ids for m in MODELS if m["provider"] == "openai"}}
        if provider == "gemini":
            r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models", params={"pageSize": 200},
                          headers={"x-goog-api-key": key}, timeout=15)
            if r.status_code != 200:
                if r.status_code in (400, 401, 403):
                    return {"ok": False, "error": "구글이 이 키를 인증하지 못했습니다. 키를 처음부터 끝까지 복사했는지, AI Studio에서 삭제·제한된 키는 아닌지 확인하세요. "
                                                  f"(HTTP {r.status_code}: {_msg(r)[:120]})"}
                return {"ok": False, "error": f"HTTP {r.status_code}: {_msg(r)[:160]}"}
            names = {m["name"].split("/")[-1] for m in r.json().get("models", [])}
            return {"ok": True, "models": {"nano-banana-2": "gemini-3.1-flash-image" in names}}
        r = httpx.get("https://api.bfl.ai/v1/credits", headers={"x-key": key}, timeout=15)
        if r.status_code != 200:
            return {"ok": False, "error": "유효하지 않은 키입니다." if r.status_code in (401, 403) else f"HTTP {r.status_code}: {_msg(r)[:160]}"}
        credits = r.json().get("credits")
        return {"ok": True, "credits": credits, "usd": round(float(credits) * 0.01, 2) if credits is not None else None}
    except httpx.HTTPError as e:
        return {"ok": False, "error": f"네트워크 오류: {e}"}


def test_admin_key(key: str | None) -> dict:
    key = (key or "").strip() or settings.openai_admin_key
    if not key:
        return {"ok": False, "error": "Admin 키가 입력되지 않았습니다."}
    try:
        r = httpx.get("https://api.openai.com/v1/organization/costs", params={"start_time": 1735689600, "limit": 1},
                      headers={"Authorization": f"Bearer {key}"}, timeout=15)
        if r.status_code == 200:
            return {"ok": True}
        return {"ok": False, "error": f"HTTP {r.status_code}: {_msg(r)[:200]}"}
    except httpx.HTTPError as e:
        return {"ok": False, "error": str(e)}
