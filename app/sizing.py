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
        note = None
        if abs(math.log(ratio / aspect)) > 0.02:
            note = f"이 모델은 고정 비율만 지원해 가장 가까운 {label}로 생성합니다."
        return dict(width=w, height=h, api_size=None, image_size=tier, aspect_label=label,
                    megapixels=w * h / 1e6, tier=tier, approx=True, ratio_note=note)
    lim = OPENAI_LIMITS if kind == "openai" else BFL_LIMITS
    w, h = _fit(aspect, long_edge, **lim)
    note = None
    if aspect > lim["max_ratio"] * 1.001 or aspect < 1 / lim["max_ratio"] / 1.001:
        note = f"이 모델의 최대 비율은 {lim['max_ratio']:g}:1이라 그 비율로 생성합니다."
    return dict(width=w, height=h, api_size=f"{w}x{h}", image_size=None, aspect_label=None,
                megapixels=w * h / 1e6, tier=None, approx=False, ratio_note=note)


# ---- 사용자 입력 허용 범위 (화면 안내문과 동일하게 유지) ----
RANGE_ASPECT_SIDE = (0.1, 100.0)   # 비율의 가로/세로 각 값
RANGE_ASPECT_RATIO = 20.0          # 가로:세로 전체 비율은 1:20 ~ 20:1
RANGE_EDGE_PX = (256, 4096)        # '직접 입력' 해상도: 긴 변 픽셀
RANGE_MM = (5, 2000)               # 인쇄 가로/세로 mm
RANGE_DPI = (72, 1200)


def _num(v, label: str, lo: float, hi: float, unit: str = "") -> float:
    try:
        x = float(v)
    except (TypeError, ValueError):
        raise ValueError(f"{label}: 숫자를 입력하세요. ({lo:g}~{hi:g}{unit})")
    if not math.isfinite(x) or not (lo <= x <= hi):
        raise ValueError(f"{label}: {lo:g}~{hi:g}{unit} 범위로 입력하세요.")
    return x


def parse_aspect(a) -> float:
    """'16:9' 형식 또는 숫자(가로/세로). 범위를 벗어나면 ValueError."""
    if isinstance(a, str) and ":" in a:
        aw, ah = a.split(":", 1)
        w = _num(aw, "비율 가로", *RANGE_ASPECT_SIDE)
        h = _num(ah, "비율 세로", *RANGE_ASPECT_SIDE)
        aspect = w / h
    else:
        aspect = _num(a, "비율", 1 / RANGE_ASPECT_RATIO, RANGE_ASPECT_RATIO)
    if not (1 / RANGE_ASPECT_RATIO <= aspect <= RANGE_ASPECT_RATIO):
        raise ValueError(f"비율: 가로:세로가 1:{RANGE_ASPECT_RATIO:g} ~ {RANGE_ASPECT_RATIO:g}:1 범위여야 합니다.")
    return aspect


def request_geometry(payload: dict) -> tuple[float, float]:
    """요청에서 (종횡비, 목표 긴 변 px)을 구한다. 범위를 벗어나면 ValueError(한국어 안내).
    payload: mode='ratio'|'print'
      ratio: aspect('W:H'), tier('1K'|'2K'|'4K'|'custom'), long_edge(tier=custom일 때 px)
      print: width_mm, height_mm, dpi
    """
    if payload.get("mode") == "print":
        w_mm = _num(payload.get("width_mm"), "가로(mm)", *RANGE_MM, "mm")
        h_mm = _num(payload.get("height_mm"), "세로(mm)", *RANGE_MM, "mm")
        dpi = _num(payload.get("dpi") or 300, "DPI", *RANGE_DPI)
        aspect = w_mm / h_mm
        if not (1 / RANGE_ASPECT_RATIO <= aspect <= RANGE_ASPECT_RATIO):
            raise ValueError(f"인쇄 크기: 가로:세로 비율이 1:{RANGE_ASPECT_RATIO:g} ~ {RANGE_ASPECT_RATIO:g}:1 범위여야 합니다.")
        wp, hp = print_to_px(w_mm, h_mm, dpi)
        return aspect, max(wp, hp)
    aspect = parse_aspect(payload.get("aspect", "1:1"))
    tier = payload.get("tier", "1K")
    if tier == "custom":
        return aspect, _num(payload.get("long_edge"), "긴 변 픽셀", *RANGE_EDGE_PX, "px")
    if tier not in TIERS:
        raise ValueError(f"해상도 단계는 {', '.join(TIERS)} 또는 직접 입력(custom)이어야 합니다.")
    return aspect, float(TIERS[tier])


def cropped_size(width: int, height: int, aspect: float) -> tuple[int, int]:
    """(width, height) 이미지를 aspect로 중앙 크롭했을 때의 크기."""
    if width / height > aspect:
        return int(round(height * aspect)), height
    return width, int(round(width / aspect))
