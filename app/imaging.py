"""이미지 후처리 (Pillow): PNG/JPG 변환, 정확한 비율 크롭, DPI 기록, 마스크 생성·합성."""
import io

from PIL import Image, ImageFilter, ImageOps

MAX_API_EDGE = 2048  # 수정용 입력 이미지가 너무 크면 이 크기로 줄여서 보낸다


def open_image(data: bytes) -> Image.Image:
    img = Image.open(io.BytesIO(data))
    img.load()
    img = ImageOps.exif_transpose(img)  # 휴대폰 사진 회전 반영
    return img


def to_rgba_png_bytes(img: Image.Image, max_edge: int | None = None) -> bytes:
    img = img.convert("RGBA")
    if max_edge and max(img.size) > max_edge:
        img.thumbnail((max_edge, max_edge), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def crop_to_aspect(img: Image.Image, aspect: float) -> Image.Image:
    """중앙 기준으로 정확한 종횡비(W/H)로 자른다. 이미 거의 같으면 그대로."""
    w, h = img.size
    if abs(w / h - aspect) / aspect < 0.004:
        return img
    if w / h > aspect:
        nw = int(round(h * aspect))
        x = (w - nw) // 2
        return img.crop((x, 0, x + nw, h))
    nh = int(round(w / aspect))
    y = (h - nh) // 2
    return img.crop((0, y, w, y + nh))


def encode(img: Image.Image, fmt: str, dpi: tuple[float, float] | None = None) -> tuple[bytes, str]:
    """PNG(기본) 또는 JPG로 인코딩. 반환: (bytes, 확장자). JPG는 투명 영역을 흰색으로 채운다."""
    buf = io.BytesIO()
    kw = {"dpi": (round(dpi[0], 2), round(dpi[1], 2))} if dpi else {}
    if fmt == "jpg":
        rgb = Image.new("RGB", img.size, (255, 255, 255))
        rgba = img.convert("RGBA")
        rgb.paste(rgba, mask=rgba.split()[3])
        rgb.save(buf, "JPEG", quality=95, subsampling=0, **kw)
        return buf.getvalue(), "jpg"
    img.save(buf, "PNG", optimize=False, **kw)
    return buf.getvalue(), "png"


def has_transparency(img: Image.Image) -> bool:
    if img.mode != "RGBA":
        return False
    return img.getchannel("A").getextrema()[0] < 255


def build_api_mask(painted_png: bytes, size: tuple[int, int]) -> bytes:
    """브러시로 칠한 영역(불투명) → OpenAI 편집 마스크(칠한 곳 alpha=0, 나머지 255)."""
    painted = open_image(painted_png).convert("RGBA").resize(size, Image.LANCZOS)
    a = painted.getchannel("A").point(lambda v: 255 if v > 24 else 0)
    mask = Image.new("RGBA", size, (0, 0, 0, 255))
    mask.putalpha(a.point(lambda v: 0 if v else 255))
    buf = io.BytesIO()
    mask.save(buf, "PNG")
    return buf.getvalue()


def painted_alpha(painted_png: bytes, size: tuple[int, int]) -> Image.Image:
    painted = open_image(painted_png).convert("RGBA").resize(size, Image.LANCZOS)
    return painted.getchannel("A").point(lambda v: 255 if v > 24 else 0)


def mark_region(original: Image.Image, painted_alpha_img: Image.Image) -> bytes:
    """마스크 미지원 모델용: 수정 영역을 붉게 칠한 안내용 이미지."""
    base = original.convert("RGBA")
    red = Image.new("RGBA", base.size, (255, 0, 0, 255))
    soft = painted_alpha_img.point(lambda v: int(v * 0.55))
    out = Image.composite(red, base, soft)
    buf = io.BytesIO()
    out.convert("RGB").save(buf, "PNG")
    return buf.getvalue()


def composite_keep_outside(original: Image.Image, edited: Image.Image, painted_alpha_img: Image.Image, feather: int = 6) -> Image.Image:
    """수정 영역 안쪽만 결과를 쓰고, 바깥쪽은 원본 픽셀을 그대로 유지."""
    base = original.convert("RGBA")
    ed = edited.convert("RGBA").resize(base.size, Image.LANCZOS)
    m = painted_alpha_img.resize(base.size)
    if feather:
        m = m.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(feather))
    return Image.composite(ed, base, m)
