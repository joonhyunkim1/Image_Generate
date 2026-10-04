"""예상 가격 / 실제 비용 계산. 단가는 pricing.json."""
import json
import math

from .config import BASE_DIR

_P = json.loads((BASE_DIR / "app" / "pricing.json").read_text(encoding="utf-8"))


def reload():
    global _P
    _P = json.loads((BASE_DIR / "app" / "pricing.json").read_text(encoding="utf-8"))


def _openai_base(model_id: str, quality: str, w: int, h: int) -> float:
    table = _P["openai"]["per_image"].get(model_id) or {}
    q = quality if quality in table else ("medium" if "medium" in table else next(iter(table), None))
    if q is None:
        return 0.0
    sizes = table[q]
    key = f"{w}x{h}"
    if key in sizes:
        return sizes[key]
    if f"{h}x{w}" in sizes:  # 세로형은 가로형과 같은 가격으로 취급
        return sizes[f"{h}x{w}"]
    # 표에 없는 크기: 1024x1024 가격을 픽셀 수 비율로 환산 (토큰 수가 대략 면적에 비례)
    return sizes["1024x1024"] * (w * h) / (1024 * 1024)


def estimate_per_image(model: dict, *, quality: str, width: int, height: int, tier: str | None,
                       edit: bool = False, n_input_images: int = 1, input_mp: float = 0.0) -> float:
    """장당 예상 가격(USD)."""
    p = model["provider"]
    if p == "openai":
        usd = _openai_base(model["id"], quality, width, height)
        if edit:
            r = _P["openai"]["token_rates_per_1m"]
            usd += n_input_images * _P["openai"]["edit_input_image_tokens"] * r["image_in"] / 1e6
        return usd
    if p == "gemini":
        usd = _P["gemini"]["per_image_by_tier"].get(tier or "1K", 0.067)
        if edit:
            usd += n_input_images * 1290 * _P["gemini"]["input_per_1m_tokens"] / 1e6
        return usd
    if p == "bfl":
        c = _P["bfl"]["models"][model["api_model"]]
        mp = width * height / 1e6
        usd = c["first_mp"] + max(0.0, mp - 1) * c["extra_mp"]
        if edit:
            usd += (input_mp or n_input_images * 1.0) * c["input_mp"]
        return usd
    return 0.0


def openai_actual(usage: dict) -> float | None:
    """OpenAI 이미지 응답의 usage(토큰)로 실제 비용을 계산."""
    if not usage:
        return None
    r = _P["openai"]["token_rates_per_1m"]
    det = usage.get("input_tokens_details") or {}
    text_in = det.get("text_tokens")
    img_in = det.get("image_tokens")
    total_in = usage.get("input_tokens", 0)
    if text_in is None and img_in is None:
        text_in, img_in = total_in, 0
    text_in, img_in = text_in or 0, img_in or 0
    out = usage.get("output_tokens", 0)
    return (text_in * r["text_in"] + img_in * r["image_in"] + out * r["image_out"]) / 1e6


def bfl_actual(cost_credits: float | None) -> float | None:
    if cost_credits is None:
        return None
    return float(cost_credits) * _P["bfl"]["usd_per_credit"]


def megapixels(w: int, h: int) -> float:
    return math.ceil(w * h / 1e5) / 10
