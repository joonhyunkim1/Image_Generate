"""이미지 생성 API 클라이언트: OpenAI / Google Gemini / Black Forest Labs (+ 키 없이 화면만 체험하는 데모).

모든 함수는 (결과 리스트, 오류 메시지 리스트)를 돌려준다. 일부만 성공해도 성공분은 보여주기 위해서다.
"""
import asyncio
import base64
import io
import random
from dataclasses import dataclass

import httpx

from . import pricing
from .config import settings

TIMEOUT = httpx.Timeout(300.0, connect=15.0)


class ProviderError(Exception):
    """사용자에게 그대로 보여줄 수 있는 한국어 오류."""


@dataclass
class Result:
    data: bytes                 # 제공사가 준 원본 이미지 바이트 (PNG/JPEG/WEBP 등)
    cost_usd: float = 0.0
    basis: str = "estimate"     # actual | estimate | demo
    input_tokens: int = 0
    output_tokens: int = 0
    note: str = ""


def _explain(status: int, message: str, provider: str) -> str:
    low = (message or "").lower()
    if status in (401, 403):
        return f"[{provider}] API 키가 올바르지 않거나 권한이 없습니다. 초기 설정에서 키를 확인하세요. ({message[:160]})"
    if status == 402 or "credit" in low or "billing" in low or "quota" in low or "insufficient" in low:
        return f"[{provider}] 크레딧/결제 문제로 요청이 거절되었습니다. 결제수단과 잔액을 확인하세요. ({message[:160]})"
    if status == 429:
        return f"[{provider}] 요청이 너무 많거나 한도를 넘었습니다. 잠시 후 다시 시도하세요. ({message[:160]})"
    if "moderation" in low or "safety" in low or "policy" in low or "blocked" in low:
        return f"[{provider}] 안전 정책에 의해 거절되었습니다. 프롬프트/이미지를 바꿔보세요. ({message[:160]})"
    return f"[{provider}] 요청 실패 (HTTP {status}): {message[:300]}"


def _err_message(r: httpx.Response) -> str:
    try:
        j = r.json()
        e = j.get("error", j)
        if isinstance(e, dict):
            return str(e.get("message") or e.get("detail") or j)
        return str(e)
    except Exception:  # noqa: BLE001
        return r.text[:300]


async def _client_call(coro):
    try:
        return await coro
    except httpx.TimeoutException:
        raise ProviderError("응답 시간이 초과되었습니다. 해상도/품질을 낮추거나 다시 시도하세요.")
    except httpx.HTTPError as e:
        raise ProviderError(f"네트워크 오류: {type(e).__name__}: {e}")


# ---------------------------------------------------------------- OpenAI

async def openai_generate(model: dict, prompt: str, n: int, geom: dict, quality: str, transparent: bool):
    body = {"model": model["api_model"], "prompt": prompt, "n": n, "size": geom["api_size"], "output_format": "png"}
    if quality:
        body["quality"] = quality
    if transparent:
        body["background"] = "transparent"
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await _client_call(c.post("https://api.openai.com/v1/images/generations", json=body,
                                      headers={"Authorization": f"Bearer {settings.openai_api_key}"}))
    return _openai_parse(r, model, geom, quality, n, edit=False)


async def openai_edit(model: dict, prompt: str, n: int, geom: dict, quality: str, transparent: bool,
                      images: list[bytes], mask: bytes | None):
    files = [("image[]", (f"image{i}.png", b, "image/png")) for i, b in enumerate(images)]
    if mask:
        files.append(("mask", ("mask.png", mask, "image/png")))
    data = {"model": model["api_model"], "prompt": prompt, "n": str(n), "size": geom["api_size"], "output_format": "png"}
    if quality:
        data["quality"] = quality
    if transparent:
        data["background"] = "transparent"
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await _client_call(c.post("https://api.openai.com/v1/images/edits", data=data, files=files,
                                      headers={"Authorization": f"Bearer {settings.openai_api_key}"}))
    return _openai_parse(r, model, geom, quality, n, edit=True, n_in=len(images))


def _openai_parse(r: httpx.Response, model, geom, quality, n, edit, n_in=1):
    if r.status_code != 200:
        raise ProviderError(_explain(r.status_code, _err_message(r), "OpenAI"))
    j = r.json()
    items = [d.get("b64_json") for d in j.get("data", []) if d.get("b64_json")]
    if not items:
        raise ProviderError("[OpenAI] 응답에 이미지가 없습니다.")
    usage = j.get("usage") or {}
    total = pricing.openai_actual(usage)
    if total is None:
        total = pricing.estimate_per_image(model, quality=quality, width=geom["width"], height=geom["height"],
                                           tier=None, edit=edit, n_input_images=n_in) * len(items)
        basis = "estimate"
    else:
        basis = "actual"
    per = total / len(items)
    return [Result(base64.b64decode(b), per, basis, usage.get("input_tokens", 0) // len(items),
                   usage.get("output_tokens", 0) // len(items)) for b in items], []


# ---------------------------------------------------------------- Gemini (Nano Banana 2)

def _find_gemini_image(node) -> str | None:
    """응답 JSON 어디에 있든 base64 이미지 데이터를 찾는다 (Interactions / generateContent 응답 형태 모두 대응)."""
    if isinstance(node, dict):
        mime = node.get("mime_type") or node.get("mimeType") or ""
        data = node.get("data")
        if isinstance(data, str) and len(data) > 100 and str(mime).startswith("image/"):
            return data
        if node.get("type") == "image" and isinstance(data, str) and len(data) > 100:
            return data
        for v in node.values():
            found = _find_gemini_image(v)
            if found:
                return found
    elif isinstance(node, list):
        for v in node:
            found = _find_gemini_image(v)
            if found:
                return found
    return None


async def _gemini_one(model: dict, prompt: str, geom: dict, images: list[bytes]) -> Result:
    key = {"x-goog-api-key": settings.gemini_api_key}
    base = "https://generativelanguage.googleapis.com/v1beta"
    inter = {
        "model": model["api_model"],
        "input": [{"type": "text", "text": prompt}] + [
            {"type": "image", "mime_type": "image/png", "data": base64.b64encode(b).decode()} for b in images],
        "response_format": {"type": "image", "mime_type": "image/png",
                            "aspect_ratio": geom["aspect_label"], "image_size": geom["image_size"]},
    }
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await _client_call(c.post(f"{base}/interactions", json=inter, headers=key))
        data = _find_gemini_image(r.json()) if r.status_code == 200 else None
        if not data and r.status_code in (400, 404, 405):
            # Interactions API를 쓸 수 없는 환경이면 기존 generateContent로 재시도
            gc = {
                "contents": [{"parts": [{"text": prompt}] + [
                    {"inline_data": {"mime_type": "image/png", "data": base64.b64encode(b).decode()}} for b in images]}],
                "generationConfig": {"responseModalities": ["IMAGE"],
                                     "imageConfig": {"aspectRatio": geom["aspect_label"], "imageSize": geom["image_size"]}},
            }
            r = await _client_call(c.post(f"{base}/models/{model['api_model']}:generateContent", json=gc, headers=key))
            data = _find_gemini_image(r.json()) if r.status_code == 200 else None
    if r.status_code != 200:
        raise ProviderError(_explain(r.status_code, _err_message(r), "Google"))
    if not data:
        raise ProviderError("[Google] 응답에 이미지가 없습니다. 안전 정책으로 차단되었을 수 있습니다. 프롬프트를 바꿔보세요.")
    usd = pricing.estimate_per_image(model, quality="", width=geom["width"], height=geom["height"],
                                     tier=geom["tier"], edit=bool(images), n_input_images=len(images))
    return Result(base64.b64decode(data), usd, "estimate")


# ---------------------------------------------------------------- BFL (FLUX.2)

async def _bfl_one(model: dict, prompt: str, geom: dict, images: list[bytes]) -> Result:
    headers = {"x-key": settings.bfl_api_key, "accept": "application/json"}
    body = {"prompt": prompt, "width": geom["width"], "height": geom["height"], "output_format": "png"}
    for i, b in enumerate(images):
        body["input_image" if i == 0 else f"input_image_{i + 1}"] = base64.b64encode(b).decode()
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await _client_call(c.post(f"https://api.bfl.ai/v1/{model['api_model']}", json=body, headers=headers))
        if r.status_code != 200:
            raise ProviderError(_explain(r.status_code, _err_message(r), "BFL"))
        job = r.json()
        poll_url = job.get("polling_url")
        if not poll_url:
            raise ProviderError("[BFL] 작업 조회 주소(polling_url)를 받지 못했습니다.")
        for _ in range(240):  # 최대 약 4분
            await asyncio.sleep(1.0)
            pr = await _client_call(c.get(poll_url, headers=headers))
            if pr.status_code != 200:
                raise ProviderError(_explain(pr.status_code, _err_message(pr), "BFL"))
            pj = pr.json()
            status = pj.get("status")
            if status == "Ready":
                sample = (pj.get("result") or {}).get("sample")
                if not sample:
                    raise ProviderError("[BFL] 결과 이미지 주소가 없습니다.")
                img = await _client_call(c.get(sample))
                if img.status_code != 200:
                    raise ProviderError(f"[BFL] 결과 이미지를 내려받지 못했습니다 (HTTP {img.status_code}). 주소는 10분 후 만료됩니다.")
                credits = job.get("cost")
                actual = pricing.bfl_actual(credits)
                if actual is None:
                    actual = pricing.estimate_per_image(model, quality="", width=geom["width"], height=geom["height"],
                                                        tier=None, edit=bool(images), n_input_images=len(images))
                return Result(img.content, actual, "actual" if credits is not None else "estimate")
            if status in ("Error", "Failed") or "Moderated" in str(status):
                raise ProviderError(f"[BFL] 생성 실패: {status}" + (" (안전 정책에 의해 차단됨)" if "Moderated" in str(status) else ""))
        raise ProviderError("[BFL] 생성 시간이 너무 오래 걸려 중단했습니다.")


# ---------------------------------------------------------------- 데모 (API 호출 없음)

def _demo_image(model: dict, prompt: str, geom: dict, transparent: bool, idx: int) -> Result:
    from PIL import Image, ImageDraw

    rnd = random.Random(f"{model['id']}|{prompt}|{idx}|{random.random()}")
    w, h = geom["width"], geom["height"]
    scale = min(1.0, 1024 / max(w, h))
    w, h = max(64, int(w * scale)), max(64, int(h * scale))
    can_alpha = transparent and model["transparent"]
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0) if can_alpha else (255, 255, 255, 255))
    d = ImageDraw.Draw(img)
    if not can_alpha:
        c1 = tuple(rnd.randint(40, 230) for _ in range(3))
        c2 = tuple(rnd.randint(40, 230) for _ in range(3))
        for y in range(h):
            t = y / max(h - 1, 1)
            d.line([(0, y), (w, y)], fill=tuple(int(c1[i] * (1 - t) + c2[i] * t) for i in range(3)) + (255,))
    for _ in range(5):
        r = rnd.randint(min(w, h) // 10, min(w, h) // 4)
        x, y = rnd.randint(0, w), rnd.randint(0, h)
        d.ellipse([x - r, y - r, x + r, y + r], fill=tuple(rnd.randint(0, 255) for _ in range(3)) + (255,))
    d.text((12, 12), f"DEMO · {model['label']}", fill=(0, 0, 0, 255))
    d.text((12, 28), prompt[:60], fill=(0, 0, 0, 255))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return Result(buf.getvalue(), 0.0, "demo")


# ---------------------------------------------------------------- 공통 진입점

async def _gather(n: int, make) -> tuple[list[Result], list[str]]:
    outs = await asyncio.gather(*[make(i) for i in range(n)], return_exceptions=True)
    ok, errs = [], []
    for o in outs:
        if isinstance(o, Result):
            ok.append(o)
        elif isinstance(o, ProviderError):
            errs.append(str(o))
        else:
            errs.append(f"예상하지 못한 오류: {type(o).__name__}: {o}")
    return ok, errs


async def generate(model: dict, prompt: str, n: int, geom: dict, quality: str, transparent: bool):
    if settings.demo_mode:
        return [_demo_image(model, prompt, geom, transparent, i) for i in range(n)], []
    p = model["provider"]
    if p == "openai":
        try:
            return await openai_generate(model, prompt, n, geom, quality, transparent)
        except ProviderError as e:
            return [], [str(e)]
    if p == "gemini":
        return await _gather(n, lambda i: _gemini_one(model, prompt, geom, []))
    return await _gather(n, lambda i: _bfl_one(model, prompt, geom, []))


async def edit(model: dict, prompt: str, n: int, geom: dict, quality: str, transparent: bool,
               images: list[bytes], mask: bytes | None):
    if settings.demo_mode:
        return [_demo_image(model, prompt, geom, transparent, i) for i in range(n)], []
    p = model["provider"]
    if p == "openai":
        try:
            return await openai_edit(model, prompt, n, geom, quality, transparent, images, mask)
        except ProviderError as e:
            return [], [str(e)]
    if p == "gemini":
        return await _gather(n, lambda i: _gemini_one(model, prompt, geom, images))
    return await _gather(n, lambda i: _bfl_one(model, prompt, geom, images))
