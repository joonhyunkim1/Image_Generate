"""FastAPI 앱: 로컬 웹 UI + REST API."""
import asyncio
import json
import logging
import mimetypes
import os
import re
import subprocess
import sys
import time
import uuid
from datetime import datetime
from urllib.parse import urlparse

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, imaging, models, pricing, providers, setup, sizing, usage
from .config import BASE_DIR, settings

# Windows는 레지스트리 설정에 따라 .js가 text/plain으로 내려가는 경우가 있어 명시적으로 고정
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
log = logging.getLogger("app")
db.init()
app = FastAPI(title="UV프린트 이미지 생성기")
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")

_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", settings.host}
_ID = re.compile(r"^[0-9a-f]{12}$")


def _purge_temp(days: int = 3):
    cutoff = time.time() - days * 86400
    for p in settings.temp_dir.glob("*"):
        try:
            if p.stat().st_mtime < cutoff:
                p.unlink()
        except OSError:
            pass


_purge_temp()


@app.middleware("http")
async def local_only(request: Request, call_next):
    """이 PC의 브라우저에서 온 요청만 허용 (.env 수정 API를 다른 웹사이트가 호출하지 못하게 차단)."""
    host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
    if host not in _LOCAL_HOSTS:
        return JSONResponse(status_code=403, content={"detail": "로컬에서만 접속할 수 있습니다."})
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and urlparse(origin).hostname not in _LOCAL_HOSTS:
            return JSONResponse(status_code=403, content={"detail": "허용되지 않은 요청 출처입니다."})
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@app.exception_handler(providers.ProviderError)
async def _provider_error(_, exc: providers.ProviderError):
    return JSONResponse(status_code=502, content={"detail": str(exc)})


@app.exception_handler(Exception)
async def _unexpected_error(request: Request, exc: Exception):
    log.exception("처리 중 오류: %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": f"서버 처리 중 오류가 발생했습니다: {type(exc).__name__}: {exc}"})


@app.get("/")
def index():
    return FileResponse(BASE_DIR / "static" / "index.html")


@app.get("/api/health")
def health():
    return {"ok": True}


def _public_model(m: dict) -> dict:
    keys = ("id", "label", "provider", "qualities", "default_quality", "transparent", "edit", "mask",
            "max_n", "max_refs", "tagline", "pros", "cons")
    d = {k: m[k] for k in keys}
    d["key_ok"] = settings.key_ok(m["provider"])
    d["usable"] = d["key_ok"] or settings.demo_mode
    return d


@app.get("/api/config")
def get_config():
    return {
        "models": [_public_model(m) for m in models.MODELS],
        "providers": {k: {**v, "key_ok": settings.key_ok(k)} for k, v in models.PROVIDERS.items()},
        "any_key": any(settings.key_ok(p) for p in models.PROVIDERS) or settings.demo_mode,
        "demo_mode": settings.demo_mode,
        "output_format": settings.output_format,
        "usd_krw": settings.usd_krw,
        "monthly_budget_usd": settings.monthly_budget_usd,
        "aspects": list(sizing.GEMINI_RATIOS.keys()),
        "tiers": list(sizing.TIERS.keys()),
        "usage": usage.brief(),
        "platform": sys.platform,
    }


# ---------------- 초기 설정 (.env) ----------------

@app.get("/api/setup")
def get_setup():
    return setup.get_state()


@app.put("/api/setup")
def save_setup(body: dict):
    try:
        return setup.save(body.get("values") or {})
    except setup.SetupError as e:
        raise HTTPException(400, str(e))


class KeyTestIn(BaseModel):
    provider: str
    key: str | None = None


@app.post("/api/setup/test-key")
def test_key(body: KeyTestIn):
    if body.provider not in models.PROVIDERS:
        raise HTTPException(400, "알 수 없는 제공사입니다.")
    return setup.test_key(body.provider, body.key)


class AdminKeyIn(BaseModel):
    key: str | None = None


@app.post("/api/setup/test-admin-key")
def test_admin_key(body: AdminKeyIn):
    return setup.test_admin_key(body.key)


# ---------------- 크기 / 가격 ----------------

def _pick_quality(m: dict, q: str | None) -> str:
    """모델이 지원하지 않는 품질이면 가장 가까운 값으로 바꾼다 (예: GPT Image 2의 xhigh/max → high)."""
    if not m["qualities"]:
        return ""
    if q in m["qualities"]:
        return q
    if q in ("xhigh", "max"):
        return "high"
    return m["default_quality"]


def _geom_for(m: dict, geometry: dict) -> tuple[dict, float]:
    try:
        aspect, long_edge = sizing.request_geometry(geometry)
    except (ValueError, KeyError, TypeError, ZeroDivisionError) as e:
        raise HTTPException(400, f"크기 설정이 올바르지 않습니다: {e}")
    return sizing.resolve(m, aspect, long_edge), aspect


def _require_model(model_id: str) -> dict:
    try:
        m = models.get(model_id)
    except KeyError as e:
        raise HTTPException(400, str(e))
    if not settings.demo_mode and not settings.key_ok(m["provider"]):
        label = models.PROVIDERS[m["provider"]]["label"]
        raise HTTPException(400, f"{label} API 키가 설정되지 않았습니다. '초기 설정'에서 키를 입력하세요.")
    return m


class EstimateIn(BaseModel):
    models: list[str]
    quality: str | None = None
    geometry: dict
    n: int = 1
    edit: bool = False
    n_refs: int = 0


@app.post("/api/estimate")
def estimate(body: EstimateIn):
    out = []
    for mid in body.models:
        m = models.BY_ID.get(mid)
        if not m:
            continue
        geom, _ = _geom_for(m, body.geometry)
        q = _pick_quality(m, body.quality)
        per = pricing.estimate_per_image(m, quality=q, width=geom["width"], height=geom["height"], tier=geom["tier"],
                                         edit=body.edit, n_input_images=1 + body.n_refs)
        out.append({"id": mid, "width": geom["width"], "height": geom["height"], "approx": geom["approx"],
                    "aspect_label": geom["aspect_label"], "tier": geom["tier"], "quality": q,
                    "per_image_usd": round(per, 5), "total_usd": round(per * max(1, body.n), 5)})
    return {"estimates": out, "usd_krw": settings.usd_krw}


@app.get("/api/price-table")
def price_table():
    """모델별 장당 예상 가격표 (정사각형 기준). 가격 페이지 표시용."""
    rows = []
    for m in models.MODELS:
        entries, unit = [], ""
        if m["provider"] == "openai":
            unit = "1024×1024 · 품질별"
            for q in m["qualities"]:
                entries.append({"label": q, "usd": pricing.estimate_per_image(m, quality=q, width=1024, height=1024, tier=None)})
        elif m["provider"] == "gemini":
            unit = "해상도별(정사각형)"
            for t in ("1K", "2K", "4K"):
                entries.append({"label": t, "usd": pricing.estimate_per_image(m, quality="", width=0, height=0, tier=t)})
        else:
            unit = "출력 크기별(정사각형)"
            for edge in (1024, 1448, 2048):
                entries.append({"label": f"{edge}²({edge * edge / 1e6:.1f}MP)",
                                "usd": pricing.estimate_per_image(m, quality="", width=edge, height=edge, tier=None)})
        rows.append({"id": m["id"], "label": m["label"], "provider": m["provider"], "unit": unit, "entries": entries})
    return {"rows": rows, "usd_krw": settings.usd_krw}


@app.get("/api/usage/brief")
def usage_brief():
    return usage.brief()


# ---------------- 후보 이미지 저장 / 후처리 ----------------

def _new_id() -> str:
    return uuid.uuid4().hex[:12]


def _finalize(res: providers.Result, *, model: dict, prompt: str, purpose: str, crop_aspect: float | None,
              print_mm: tuple[float, float] | None, composite=None) -> dict:
    """제공사가 준 이미지를 PNG(또는 JPG)로 정리해 temp에 저장하고 화면용 정보를 돌려준다."""
    img = imaging.open_image(res.data)
    if crop_aspect:
        img = imaging.crop_to_aspect(img, crop_aspect)
    if composite:
        img = composite(img)
    dpi = None
    effective = None
    if print_mm:
        # 파일의 DPI를 '실제 인쇄 크기(mm)'에 맞춰 기록 → 프린터 소프트웨어에서 지정한 mm 크기로 열린다
        dx = img.width / (print_mm[0] / 25.4)
        dy = img.height / (print_mm[1] / 25.4)
        dpi = (dx, dy)
        effective = round(min(dx, dy), 1)
    transparent = imaging.has_transparency(img)
    fmt = "png" if transparent else settings.output_format  # 투명도가 있으면 JPG로 바꾸지 않는다
    data, ext = imaging.encode(img, fmt, dpi)
    iid = _new_id()
    (settings.temp_dir / f"{iid}.{ext}").write_bytes(data)
    meta = {"id": iid, "ext": ext, "model": model["id"], "label": model["label"], "prompt": prompt, "purpose": purpose,
            "width": img.width, "height": img.height, "dpi": effective, "cost_usd": round(res.cost_usd, 5),
            "basis": res.basis, "transparent": transparent, "created": datetime.now().isoformat(timespec="seconds")}
    (settings.temp_dir / f"{iid}.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return {**meta, "url": f"/api/temp/{iid}"}


def _record_usage(model: dict, purpose: str, results: list[providers.Result]):
    if not results:
        return
    basis = "demo" if settings.demo_mode else ("actual" if all(r.basis == "actual" for r in results) else "estimate")
    usage.record(provider=model["provider"], model=model["id"], purpose=purpose, images=len(results),
                 cost_usd=sum(r.cost_usd for r in results), basis=basis,
                 input_tokens=sum(r.input_tokens for r in results), output_tokens=sum(r.output_tokens for r in results))


def _print_info(geometry: dict) -> tuple[float, float] | None:
    if geometry.get("mode") == "print":
        return float(geometry["width_mm"]), float(geometry["height_mm"])
    return None


class GenerateIn(BaseModel):
    model: str
    prompt: str
    n: int = 1
    quality: str | None = None
    geometry: dict
    transparent: bool = False
    exact_crop: bool = True


@app.post("/api/generate")
async def generate(body: GenerateIn):
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(400, "프롬프트를 입력하세요.")
    m = _require_model(body.model)
    n = max(1, min(body.n, m["max_n"]))
    geom, aspect = _geom_for(m, body.geometry)
    quality = _pick_quality(m, body.quality)
    want_t = bool(body.transparent and m["transparent"])
    results, errors = await providers.generate(m, prompt, n, geom, quality, want_t)
    _record_usage(m, "generate", results)
    pm = _print_info(body.geometry)
    crop = aspect if (body.exact_crop or pm) else None
    images = [await asyncio.to_thread(_finalize, r, model=m, prompt=prompt, purpose="generate", crop_aspect=crop,
                                      print_mm=pm) for r in results]
    notes = []
    if body.transparent and not m["transparent"]:
        notes.append("이 모델은 투명 배경을 지원하지 않아 일반 배경으로 생성했습니다.")
    if want_t and images and not any(i["transparent"] for i in images):
        notes.append("투명 배경을 요청했지만 결과에 투명 영역이 없습니다. 프롬프트에 'on a transparent background'를 명시해 보세요.")
    return {"model": m["id"], "label": m["label"], "images": images, "errors": errors, "notes": notes,
            "size": {"width": geom["width"], "height": geom["height"], "approx": geom["approx"]},
            "cost_usd": round(sum(r.cost_usd for r in results), 5)}


@app.post("/api/edit")
async def edit(
    model: str = Form(...), prompt: str = Form(...), n: int = Form(1), quality: str = Form(""),
    tier: str = Form("orig"), transparent: bool = Form(False), keep_outside: bool = Form(True),
    image: UploadFile = File(...), mask: UploadFile | None = File(None), refs: list[UploadFile] = File(default=[]),
):
    prompt = prompt.strip()
    if not prompt:
        raise HTTPException(400, "수정할 내용을 프롬프트로 입력하세요.")
    m = _require_model(model)
    if not m["edit"]:
        raise HTTPException(400, "이 모델은 이미지 수정을 지원하지 않습니다.")
    n = max(1, min(n, m["max_n"]))
    try:
        original = imaging.open_image(await image.read())
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "이미지를 열 수 없습니다. PNG/JPG/WEBP 파일을 첨부하세요.")
    ref_imgs = []
    for f in refs[: max(0, m["max_refs"] - 1)]:
        try:
            ref_imgs.append(imaging.to_rgba_png_bytes(imaging.open_image(await f.read()), imaging.MAX_API_EDGE))
        except Exception:  # noqa: BLE001
            raise HTTPException(400, f"참고 이미지를 열 수 없습니다: {f.filename}")

    work_png = imaging.to_rgba_png_bytes(original, imaging.MAX_API_EDGE)
    work = imaging.open_image(work_png)
    painted_bytes = await mask.read() if mask else b""
    painted = imaging.painted_alpha(painted_bytes, work.size) if painted_bytes else None
    if painted is not None and painted.histogram()[255] < max(30, painted.width * painted.height * 0.0001):
        painted = None  # 지우개 잔상 등 아주 작은 얼룩은 '칠하지 않음'으로 취급

    api_prompt, api_images, api_mask = prompt, [work_png], None
    if painted is not None:
        if m["mask"]:
            api_mask = imaging.build_api_mask(painted_bytes, work.size)
        else:
            api_images.append(imaging.mark_region(work, painted))
            api_prompt = (
                "Image 1 is the original. Image 2 is the same picture with the area to change tinted red. "
                "Apply the following change ONLY inside the red-tinted area and keep everything else exactly the same. "
                "Do not draw any red tint in the result. Change: " + prompt)
    api_images += ref_imgs

    aspect = work.width / work.height
    long_edge = float(max(work.size)) if tier == "orig" else float(sizing.TIERS.get(tier, 1024))
    geom = sizing.resolve(m, aspect, long_edge)
    q = _pick_quality(m, quality)
    want_t = bool(transparent and m["transparent"])
    results, errors = await providers.edit(m, api_prompt, n, geom, q, want_t, api_images, api_mask)
    _record_usage(m, "edit", results)

    def composite(img):
        if painted is not None and keep_outside:
            return imaging.composite_keep_outside(original, img, painted_full)
        return img

    painted_full = painted.resize(original.size) if painted is not None else None
    images = []
    for r in results:
        # 결과 비율을 원본에 맞춘 뒤, (옵션) 칠한 영역 밖은 원본 픽셀 유지
        images.append(await asyncio.to_thread(
            _finalize, r, model=m, prompt=prompt, purpose="edit", crop_aspect=aspect, print_mm=None,
            composite=composite))
    notes = []
    if transparent and not m["transparent"]:
        notes.append("이 모델은 투명 배경을 지원하지 않아 일반 배경으로 처리했습니다.")
    if painted is not None and not m["mask"]:
        notes.append("이 모델은 마스크 편집을 지원하지 않아 '붉게 표시한 안내 이미지'로 수정 영역을 알려주었습니다. 정확도는 모델에 따라 다릅니다.")
    return {"model": m["id"], "label": m["label"], "images": images, "errors": errors, "notes": notes,
            "cost_usd": round(sum(r.cost_usd for r in results), 5)}


# ---------------- 후보 / 저장 이미지 ----------------

def _check_id(iid: str):
    if not _ID.match(iid):
        raise HTTPException(400, "잘못된 이미지 ID입니다.")


def _temp_file(iid: str):
    _check_id(iid)
    for ext in ("png", "jpg"):
        p = settings.temp_dir / f"{iid}.{ext}"
        if p.exists():
            return p
    raise HTTPException(404, "이미지를 찾을 수 없습니다. (임시 이미지는 3일 후 삭제됩니다)")


@app.get("/api/temp/{iid}")
def get_temp(iid: str):
    p = _temp_file(iid)
    return FileResponse(p, media_type="image/png" if p.suffix == ".png" else "image/jpeg")


@app.delete("/api/temp/{iid}")
def delete_temp(iid: str):
    p = _temp_file(iid)
    p.unlink(missing_ok=True)
    p.with_suffix(".json").unlink(missing_ok=True)
    return {"ok": True}


class SaveIn(BaseModel):
    id: str


@app.post("/api/images/save")
def save_image(body: SaveIn):
    p = _temp_file(body.id)
    meta = json.loads(p.with_suffix(".json").read_text(encoding="utf-8")) if p.with_suffix(".json").exists() else {}
    if db.row("SELECT id FROM saved_images WHERE id=?", (body.id,)):
        return {"ok": True, "already": True}
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    fname = f"{stamp}_{meta.get('model', 'image')}_{body.id[:6]}{p.suffix}"
    dest = settings.saved_dir / fname
    dest.write_bytes(p.read_bytes())
    db.execute(
        "INSERT INTO saved_images(id, ts, filename, model, purpose, prompt, width, height, dpi, cost_usd, meta)"
        " VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (body.id, datetime.now().isoformat(timespec="seconds"), fname, meta.get("model", ""), meta.get("purpose", ""),
         meta.get("prompt", ""), meta.get("width"), meta.get("height"), meta.get("dpi"), meta.get("cost_usd", 0),
         json.dumps(meta, ensure_ascii=False)))
    return {"ok": True, "filename": fname, "path": str(dest)}


@app.get("/api/images")
def list_images():
    rows = db.rows("SELECT * FROM saved_images ORDER BY ts DESC")
    for r in rows:
        r["exists"] = (settings.saved_dir / r["filename"]).exists()
        r["url"] = f"/api/images/{r['id']}/file"
        r.pop("meta", None)
    return {"images": rows, "dir": str(settings.saved_dir)}


@app.get("/api/images/{iid}/file")
def image_file(iid: str, download: bool = False):
    _check_id(iid)
    r = db.row("SELECT filename FROM saved_images WHERE id=?", (iid,))
    if not r or not (settings.saved_dir / r["filename"]).exists():
        raise HTTPException(404, "저장된 파일을 찾을 수 없습니다.")
    p = settings.saved_dir / r["filename"]
    return FileResponse(p, media_type="image/png" if p.suffix == ".png" else "image/jpeg",
                        filename=r["filename"] if download else None)


@app.delete("/api/images/{iid}")
def delete_image(iid: str):
    _check_id(iid)
    r = db.row("SELECT filename FROM saved_images WHERE id=?", (iid,))
    if r:
        (settings.saved_dir / r["filename"]).unlink(missing_ok=True)
        db.execute("DELETE FROM saved_images WHERE id=?", (iid,))
    return {"ok": True}


@app.post("/api/open-folder")
def open_folder():
    """저장 폴더를 탐색기(Windows) / Finder(macOS)로 연다."""
    path = str(settings.saved_dir)
    try:
        if sys.platform == "win32":
            os.startfile(path)  # noqa: S606
        elif sys.platform == "darwin":
            subprocess.Popen(["open", path])
        else:
            subprocess.Popen(["xdg-open", path])
    except Exception as e:  # noqa: BLE001
        raise HTTPException(500, f"폴더를 열지 못했습니다: {e}")
    return {"ok": True, "path": path}


# ---------------- 사용량 ----------------

@app.get("/api/usage")
def get_usage():
    return usage.summary()


@app.get("/api/usage/official")
async def get_usage_official():
    return await asyncio.to_thread(usage.official)
