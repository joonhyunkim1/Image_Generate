"""이미지 수정 기록(히스토리).

한 번의 '이미지 수정' 실행(여러 모델을 동시에 돌려도 한 번)을 run 단위로 묶어 보관한다.
data/history/<run_id>/ 아래에 원본(source), 칠한 마스크(mask), 결과 이미지와 썸네일을 저장하고
메타데이터는 SQLite(edit_history)에 둔다. 임시 후보(3일 후 삭제)와 달리 직접 지우기 전까지 유지된다.
"""
import io
import json
import re
import shutil
import uuid
from datetime import datetime

from PIL import Image

from . import db, imaging
from .config import settings

ID_RE = re.compile(r"^[0-9a-f]{12}$")
FILE_RE = re.compile(r"^(source|mask|th_source|res_[0-9a-f]{12}_\d+|th_[0-9a-f]{12}_\d+)$")
MAX_RUNS = 200       # 오래된 기록부터 자동 정리
THUMB = 240


def hist_dir():
    d = settings.data_dir / "history"
    d.mkdir(parents=True, exist_ok=True)
    return d


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def _run_dir(run_id: str):
    if not ID_RE.match(run_id or ""):
        raise ValueError("잘못된 기록 ID입니다.")
    return hist_dir() / run_id


def _thumb_bytes(data: bytes) -> bytes:
    img = imaging.open_image(data).convert("RGBA")
    img.thumbnail((THUMB, THUMB), Image.LANCZOS)
    b = io.BytesIO()
    img.save(b, "PNG")
    return b.getvalue()


def _write_once(path, data: bytes):
    if not path.exists():
        tmp = path.with_suffix(path.suffix + f".{uuid.uuid4().hex[:6]}.tmp")
        tmp.write_bytes(data)
        try:
            tmp.replace(path)
        except OSError:
            tmp.unlink(missing_ok=True)


def add(*, run_id: str, model: dict, prompt: str, n: int, quality: str, tier: str, transparent: bool, keep_outside: bool,
        source_png: bytes, mask_png: bytes | None, src_size: tuple[int, int], images: list[dict],
        notes: list[str], errors: list[str], cost_usd: float) -> str:
    """수정 1회(모델 1개)의 결과를 기록. images는 main._finalize가 만든 후보 이미지 메타 목록."""
    rd = _run_dir(run_id)
    rd.mkdir(parents=True, exist_ok=True)
    _write_once(rd / "source.png", source_png)
    _write_once(rd / "th_source.png", _thumb_bytes(source_png))
    if mask_png:
        _write_once(rd / "mask.png", mask_png)
    req_id = new_id()
    results = []
    for i, img in enumerate(images):
        src = settings.temp_dir / f"{img['id']}.{img['ext']}"
        if not src.exists():
            continue
        data = src.read_bytes()
        (rd / f"res_{req_id}_{i}.{img['ext']}").write_bytes(data)
        (rd / f"th_{req_id}_{i}.png").write_bytes(_thumb_bytes(data))
        results.append({k: img.get(k) for k in ("ext", "width", "height", "dpi", "cost_usd", "basis", "transparent")} | {"index": i})
    db.execute(
        "INSERT INTO edit_history(id, run_id, ts, model, prompt, n, quality, tier, transparent, keep_outside, has_mask,"
        " src_w, src_h, cost_usd, results, notes, errors) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (req_id, run_id, datetime.now().isoformat(timespec="seconds"), model["id"], prompt, n, quality or "", tier,
         int(transparent), int(keep_outside), int(bool(mask_png)), src_size[0], src_size[1], round(cost_usd, 5),
         json.dumps(results, ensure_ascii=False), json.dumps(notes, ensure_ascii=False), json.dumps(errors, ensure_ascii=False)))
    prune()
    return req_id


def _rows(where: str = "", params=()) -> list[dict]:
    rows = db.rows(f"SELECT * FROM edit_history {where} ORDER BY ts DESC, rowid DESC", params)
    for r in rows:
        r["results"] = json.loads(r["results"])
        r["notes"] = json.loads(r["notes"])
        r["errors"] = json.loads(r["errors"])
    return rows


def _file_url(run_id: str, name: str) -> str:
    return f"/api/edit-history/{run_id}/file/{name}"


def list_runs(limit: int = 60) -> dict:
    from . import models  # 순환 import 방지
    runs: dict[str, dict] = {}
    for r in _rows():
        run = runs.get(r["run_id"])
        if run is None:
            if len(runs) >= limit:
                continue
            run = runs[r["run_id"]] = {
                "run_id": r["run_id"], "ts": r["ts"], "prompt": r["prompt"], "has_mask": bool(r["has_mask"]),
                "src_w": r["src_w"], "src_h": r["src_h"], "cost_usd": 0.0, "models": [], "thumbs": [], "image_count": 0,
                "source_thumb": _file_url(r["run_id"], "th_source"),
            }
        run["ts"] = max(run["ts"], r["ts"])
        run["cost_usd"] += r["cost_usd"]
        m = models.BY_ID.get(r["model"])
        run["models"].append({"id": r["model"], "label": m["label"] if m else r["model"]})
        for res in r["results"]:
            run["image_count"] += 1
            if len(run["thumbs"]) < 4:
                run["thumbs"].append(_file_url(r["run_id"], f"th_{r['id']}_{res['index']}"))
    items = sorted(runs.values(), key=lambda x: x["ts"], reverse=True)
    for it in items:
        it["cost_usd"] = round(it["cost_usd"], 5)
    total = sum(f.stat().st_size for f in hist_dir().rglob("*") if f.is_file())
    return {"runs": items, "total_bytes": total, "max_runs": MAX_RUNS}


def file_path(run_id: str, name: str):
    if not FILE_RE.match(name):
        raise ValueError("잘못된 파일 이름입니다.")
    rd = _run_dir(run_id)
    for ext in ("png", "jpg"):
        p = rd / f"{name}.{ext}"
        if p.exists():
            return p
    return None


def delete_run(run_id: str):
    rd = _run_dir(run_id)
    db.execute("DELETE FROM edit_history WHERE run_id=?", (run_id,))
    shutil.rmtree(rd, ignore_errors=True)


def clear_all():
    db.execute("DELETE FROM edit_history")
    shutil.rmtree(hist_dir(), ignore_errors=True)
    hist_dir()


def prune(max_runs: int = MAX_RUNS):
    ids = [r["run_id"] for r in db.rows("SELECT run_id, MAX(ts) AS t FROM edit_history GROUP BY run_id ORDER BY t DESC")]
    for rid in ids[max_runs:]:
        delete_run(rid)


def restore(run_id: str) -> dict | None:
    """기록을 다시 불러온다: 결과 이미지를 새 임시 후보로 복사해(저장·다운로드·확대·재수정 가능) 화면용 정보를 돌려준다."""
    from . import models
    rows = _rows("WHERE run_id=?", (run_id,))
    if not rows:
        return None
    rd = _run_dir(run_id)
    first = rows[-1]  # 가장 먼저 기록된 행 (옵션은 run 안에서 동일)
    columns = []
    for r in reversed(rows):  # 오래된 것 → 최신 순
        m = models.BY_ID.get(r["model"])
        label = m["label"] if m else r["model"]
        images = []
        for res in r["results"]:
            src = rd / f"res_{r['id']}_{res['index']}.{res['ext']}"
            if not src.exists():
                continue
            iid = new_id()
            (settings.temp_dir / f"{iid}.{res['ext']}").write_bytes(src.read_bytes())
            meta = {"id": iid, "ext": res["ext"], "model": r["model"], "label": label, "prompt": r["prompt"], "purpose": "edit",
                    "width": res["width"], "height": res["height"], "dpi": res.get("dpi"), "cost_usd": res.get("cost_usd") or 0,
                    "basis": res.get("basis") or "estimate", "transparent": bool(res.get("transparent")),
                    "created": datetime.now().isoformat(timespec="seconds")}
            (settings.temp_dir / f"{iid}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
            images.append({**meta, "url": f"/api/temp/{iid}"})
        columns.append({"model": r["model"], "label": label, "images": images, "notes": r["notes"], "errors": r["errors"],
                        "cost_usd": r["cost_usd"]})
    return {
        "run_id": run_id,
        "settings": {"prompt": first["prompt"], "models": [c["model"] for c in columns], "n": first["n"], "quality": first["quality"],
                     "tier": first["tier"], "transparent": bool(first["transparent"]), "keep_outside": bool(first["keep_outside"])},
        "source_url": _file_url(run_id, "source"),
        "mask_url": _file_url(run_id, "mask") if (rd / "mask.png").exists() else None,
        "columns": columns,
    }
