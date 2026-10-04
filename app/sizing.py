"""모델별 해상도 계산.

- 사용자는 '종횡비 + 해상도 단계(1K/2K/4K)' 또는 '인쇄 크기(mm) + DPI'로 요청한다.
- 모델마다 허용 규칙이 다르므로(OpenAI: 16의 배수·최대 3840, FLUX: 16의 배수·최대 4MP,
  Gemini: 고정 종횡비 목록 + 1K/2K/4K) 여기서 실제 API 파라미터로 변환한다.
"""
import math

TIERS = {"1K": 1024, "2K": 2048, "4K": 3840}
GEMINI_RATIOS = {
    "1:1": 1.0, "3:2": 3 / 2, "2:3": 2 / 3, "3:4": 3 / 4, "4:3": 4 / 3, "4:5": 4 / 5,
    "5:4": 5 / 4, "9:16": 9 / 16, "16:9": 16 / 9, "21:9": 21 / 9,
}
GEMINI_TIERS = [("1K", 1024), ("2K", 2048), ("4K", 4096)]

OPENAI_LIMITS = dict(min_px=655_360, max_px=8_294_400, max_edge=3840, max_ratio=3.0)
BFL_LIMITS = dict(min_px=64 * 64, max_px=4_194_304, max_edge=4096, max_ratio=8.0)


def _r16(x: float, up: bool = False) -> int:
    f = math.ceil if up else math.floor
    return max(16, int(f(x / 16)) * 16)


def _fit(aspect: float, long_edge: float, *, min_px: int, max_px: int, max_edge: int, max_ratio: float) -> tuple[int, int]:
    aspect = min(max(aspect, 1 / max_ratio), max_ratio)
    long_edge = min(long_edge, max_edge)

    def dims(le: float) -> tuple[float, float]:
        return (le, le / aspect) if aspect >= 1 else (le * aspect, le)

    w, h = dims(long_edge)
    px = w * h
    if px > max_px:
        long_edge *= math.sqrt(max_px / px)
    elif px < min_px:
        long_edge *= math.sqrt(min_px / px)
    long_edge = min(long_edge, max_edge)
    w, h = dims(long_edge)
    w, h = _r16(w), _r16(h)
    if w * h < min_px:  # 내림 반올림으로 하한 미달이면 올림
        w, h = _r16(dims(long_edge)[0], True), _r16(dims(long_edge)[1], True)
    while max(w, h) / min(w, h) > max_ratio:  # 반올림 때문에 비율 한도를 넘으면 긴 변을 줄임
        if w >= h:
            w -= 16
        else:
            h -= 16
    while w * h > max_px:  # 반올림으로 한도를 넘으면 긴 변부터 16씩 줄임
        if w >= h:
            w -= 16
        else:
            h -= 16
    return w, h


def print_to_px(width_mm: float, height_mm: float, dpi: float) -> tuple[float, float]:
    return width_mm / 25.4 * dpi, height_mm / 25.4 * dpi


def resolve(model: dict, aspect: float, long_edge: float) -> dict:
    """모델 규칙에 맞는 생성 크기를 돌려준다.
    반환: {width, height, api_size, image_size, aspect_label, megapixels, tier}
    """
    kind = model["sizing"]
    if kind == "gemini":
        label = min(GEMINI_RATIOS, key=lambda k: abs(math.log(GEMINI_RATIOS[k] / aspect)))
        ratio = GEMINI_RATIOS[label]
        tier, edge = next(((t, e) for t, e in GEMINI_TIERS if e >= min(long_edge, 4096) * 0.92), GEMINI_TIERS[-1])
        # Gemini는 단계별 '대략적' 크기. 화면 표시용 근사치(실제 크기는 응답 이미지에서 읽음)
        w, h = (edge, edge / ratio) if ratio >= 1 else (edge * ratio, edge)
        w, h = int(round(w)), int(round(h))
        return dict(width=w, height=h, api_size=None, image_size=tier, aspect_label=label,
                    megapixels=w * h / 1e6, tier=tier, approx=True)
    lim = OPENAI_LIMITS if kind == "openai" else BFL_LIMITS
    w, h = _fit(aspect, long_edge, **lim)
    return dict(width=w, height=h, api_size=f"{w}x{h}", image_size=None, aspect_label=None,
                megapixels=w * h / 1e6, tier=None, approx=False)


def request_geometry(payload: dict) -> tuple[float, float]:
    """요청에서 (종횡비, 목표 긴 변 px)을 구한다.
    payload: mode='ratio'|'print'; ratio 모드는 aspect('W:H' 또는 숫자)+tier, print 모드는 width_mm,height_mm,dpi
    """
    if payload.get("mode") == "print":
        w_mm, h_mm = float(payload["width_mm"]), float(payload["height_mm"])
        if not (5 <= w_mm <= 2000 and 5 <= h_mm <= 2000):
            raise ValueError("인쇄 크기는 5~2000mm 범위로 입력하세요.")
        dpi = float(payload.get("dpi") or 300)
        if not (72 <= dpi <= 1200):
            raise ValueError("DPI는 72~1200 범위로 입력하세요.")
        wp, hp = print_to_px(w_mm, h_mm, dpi)
        return w_mm / h_mm, max(wp, hp)
    a = payload.get("aspect", "1:1")
    if isinstance(a, str) and ":" in a:
        aw, ah = a.split(":", 1)
        aspect = float(aw) / float(ah)
    else:
        aspect = float(a)
    if aspect <= 0:
        raise ValueError("종횡비가 올바르지 않습니다.")
    tier = payload.get("tier", "1K")
    return aspect, float(TIERS.get(tier, 1024))
