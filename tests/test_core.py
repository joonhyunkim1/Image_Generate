"""핵심 로직 테스트 (실제 API 호출 없음). 실행: python -m unittest discover -s tests -v"""
import asyncio
import base64
import io
import json
import os
import sys
import unittest

os.environ["DEMO_MODE"] = "false"
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from PIL import Image  # noqa: E402

from app import imaging, models, pricing, providers, sizing  # noqa: E402
from app.config import settings  # noqa: E402


def png_bytes(size=(64, 48), color=(10, 200, 30, 255)):
    b = io.BytesIO()
    Image.new("RGBA", size, color).save(b, "PNG")
    return b.getvalue()


class SizingTests(unittest.TestCase):
    def test_openai_rules(self):
        m = models.get("gpt-image-2.5-sunburst")
        for a in (1, 16 / 9, 9 / 16, 3, 1 / 3, 0.625, 2.9):
            for le in (300, 1024, 2048, 3840, 6000):
                g = sizing.resolve(m, a, le)
                w, h = g["width"], g["height"]
                self.assertTrue(655_360 <= w * h <= 8_294_400, (a, le, w, h))
                self.assertTrue(max(w, h) <= 3840 and w % 16 == 0 and h % 16 == 0)
                self.assertTrue(max(w / h, h / w) <= 3.0001)

    def test_bfl_rules(self):
        m = models.get("flux-2-pro")
        for a in (1, 16 / 9, 0.625):
            for le in (64, 1024, 3840, 6000):
                g = sizing.resolve(m, a, le)
                self.assertTrue(g["width"] * g["height"] <= 4_194_304 and g["width"] % 16 == 0 and g["height"] % 16 == 0)

    def test_gemini_ratio_and_tier(self):
        g = sizing.resolve(models.get("nano-banana-2"), 16 / 9, 2000)
        self.assertEqual((g["aspect_label"], g["image_size"]), ("16:9", "2K"))

    def test_print_geometry(self):
        aspect, edge = sizing.request_geometry({"mode": "print", "width_mm": 50, "height_mm": 80, "dpi": 300})
        self.assertAlmostEqual(aspect, 0.625)
        self.assertAlmostEqual(edge, 80 / 25.4 * 300)
        with self.assertRaises(ValueError):
            sizing.request_geometry({"mode": "print", "width_mm": 1, "height_mm": 80})


class ImagingTests(unittest.TestCase):
    def test_api_mask_alpha_zero_where_painted(self):
        painted = Image.new("RGBA", (40, 40), (0, 0, 0, 0))
        for x in range(10, 20):
            for y in range(10, 20):
                painted.putpixel((x, y), (255, 60, 60, 128))
        b = io.BytesIO(); painted.save(b, "PNG")
        mask = imaging.open_image(imaging.build_api_mask(b.getvalue(), (40, 40)))
        self.assertEqual(mask.getpixel((15, 15))[3], 0)     # 칠한 곳 = 수정 영역
        self.assertEqual(mask.getpixel((30, 30))[3], 255)   # 나머지 = 유지

    def test_composite_keeps_outside(self):
        orig = Image.new("RGBA", (40, 40), (255, 0, 0, 255))
        edited = Image.new("RGBA", (40, 40), (0, 0, 255, 255))
        m = Image.new("L", (40, 40), 0)
        for x in range(10, 30):
            for y in range(10, 30):
                m.putpixel((x, y), 255)
        out = imaging.composite_keep_outside(orig, edited, m, feather=0)
        self.assertEqual(out.getpixel((20, 20))[:3], (0, 0, 255))
        self.assertEqual(out.getpixel((2, 2))[:3], (255, 0, 0))

    def test_crop_and_dpi_and_jpg(self):
        img = Image.new("RGBA", (200, 100), (1, 2, 3, 255))
        c = imaging.crop_to_aspect(img, 1.0)
        self.assertEqual(c.size, (100, 100))
        data, ext = imaging.encode(c, "png", (300, 300))
        self.assertEqual(ext, "png")
        self.assertAlmostEqual(Image.open(io.BytesIO(data)).info["dpi"][0], 300, delta=0.5)
        data, ext = imaging.encode(Image.new("RGBA", (10, 10), (0, 0, 0, 0)), "jpg")
        self.assertEqual(ext, "jpg")
        self.assertEqual(Image.open(io.BytesIO(data)).getpixel((5, 5)), (255, 255, 255))  # 투명 → 흰색

    def test_transparency_detect(self):
        self.assertFalse(imaging.has_transparency(Image.new("RGBA", (4, 4), (0, 0, 0, 255))))
        self.assertTrue(imaging.has_transparency(Image.new("RGBA", (4, 4), (0, 0, 0, 0))))


class PricingTests(unittest.TestCase):
    def test_estimates(self):
        m = models.get("gpt-image-2.5-flare")
        self.assertAlmostEqual(pricing.estimate_per_image(m, quality="high", width=1024, height=1024, tier=None), 0.05268)
        self.assertAlmostEqual(pricing.estimate_per_image(models.get("nano-banana-2"), quality="", width=0, height=0, tier="2K"), 0.101)
        pro = pricing.estimate_per_image(models.get("flux-2-pro"), quality="", width=2048, height=2048, tier=None)
        self.assertAlmostEqual(pro, 0.03 + (2048 * 2048 / 1e6 - 1) * 0.015)

    def test_actual_openai_cost(self):
        usage = {"input_tokens": 1000, "output_tokens": 1000, "input_tokens_details": {"text_tokens": 1000, "image_tokens": 0}}
        self.assertAlmostEqual(pricing.openai_actual(usage), (1000 * 5 + 1000 * 30) / 1e6)
        self.assertAlmostEqual(pricing.bfl_actual(7), 0.07)


def with_mock(handler):
    """providers가 만드는 httpx.AsyncClient를 MockTransport로 교체."""
    real = httpx.AsyncClient

    class Patched(real):
        def __init__(self, *a, **kw):
            kw["transport"] = httpx.MockTransport(handler)
            super().__init__(*a, **kw)

    providers.httpx.AsyncClient = Patched
    return lambda: setattr(providers.httpx, "AsyncClient", real)


GEOM_PX = {"width": 1024, "height": 1024, "api_size": "1024x1024", "image_size": None, "aspect_label": None, "tier": None}
GEOM_GM = {"width": 1024, "height": 1024, "api_size": None, "image_size": "1K", "aspect_label": "1:1", "tier": "1K"}


class ProviderTests(unittest.TestCase):
    def setUp(self):
        settings.demo_mode = False  # 로컬 .env의 DEMO_MODE 값과 무관하게 실제 경로를 검증
        settings.openai_api_key, settings.gemini_api_key, settings.bfl_api_key = "sk-test" + "x" * 30, "AIza" + "x" * 35, "b" * 30

    def test_openai_generate_request_and_cost(self):
        seen = {}

        def handler(req):
            seen["url"], seen["auth"], seen["body"] = str(req.url), req.headers["authorization"], json.loads(req.content)
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png_bytes()).decode()}] * 2,
                                             "usage": {"input_tokens": 50, "output_tokens": 1756,
                                                       "input_tokens_details": {"text_tokens": 50, "image_tokens": 0}}})
        undo = with_mock(handler)
        try:
            res, errs = asyncio.run(providers.generate(models.get("gpt-image-2.5-flare"), "cat", 2, GEOM_PX, "high", True))
        finally:
            undo()
        self.assertEqual(errs, [])
        self.assertEqual(len(res), 2)
        self.assertTrue(seen["url"].endswith("/v1/images/generations"))
        self.assertEqual(seen["body"]["model"], "gpt-image-2.5-flare")
        self.assertEqual((seen["body"]["size"], seen["body"]["quality"], seen["body"]["background"], seen["body"]["n"]),
                         ("1024x1024", "high", "transparent", 2))
        self.assertAlmostEqual(sum(r.cost_usd for r in res), (50 * 5 + 1756 * 30) / 1e6)
        self.assertEqual(res[0].basis, "actual")

    def test_openai_edit_sends_mask_and_images(self):
        seen = {}

        def handler(req):
            seen["ct"], seen["body"] = req.headers["content-type"], req.content
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png_bytes()).decode()}]})
        undo = with_mock(handler)
        try:
            res, errs = asyncio.run(providers.edit(models.get("gpt-image-2"), "red", 1, GEOM_PX, "medium", False,
                                                   [png_bytes(), png_bytes()], png_bytes()))
        finally:
            undo()
        self.assertEqual(errs, [])
        self.assertIn("multipart/form-data", seen["ct"])
        self.assertEqual(seen["body"].count(b'name="image[]"'), 2)
        self.assertIn(b'name="mask"', seen["body"])
        self.assertEqual(res[0].basis, "estimate")  # usage 없으면 표 단가

    def test_openai_error_message(self):
        undo = with_mock(lambda req: httpx.Response(400, json={"error": {"message": "Transparent background is not supported for this model."}}))
        try:
            res, errs = asyncio.run(providers.generate(models.get("gpt-image-2"), "x", 1, GEOM_PX, "low", True))
        finally:
            undo()
        self.assertEqual(res, [])
        self.assertIn("Transparent background", errs[0])

    def test_gemini_interactions_and_fallback(self):
        calls = []
        b64 = base64.b64encode(png_bytes()).decode() * 3  # data 길이 검사를 통과시키기 위해 길게

        def handler(req):
            calls.append(str(req.url))
            if req.url.path.endswith("/interactions"):
                return httpx.Response(404, json={"error": {"message": "not found"}})
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"inlineData": {"mimeType": "image/png", "data": b64}}]}}]})
        undo = with_mock(handler)
        try:
            res, errs = asyncio.run(providers.generate(models.get("nano-banana-2"), "cat", 2, GEOM_GM, "", False))
        finally:
            undo()
        self.assertEqual(errs, [])
        self.assertEqual(len(res), 2)
        self.assertTrue(any("interactions" in c for c in calls) and any("generateContent" in c for c in calls))

    def test_gemini_interactions_body(self):
        seen = {}
        b64 = base64.b64encode(png_bytes()).decode() * 3

        def handler(req):
            seen["body"], seen["key"] = json.loads(req.content), req.headers["x-goog-api-key"]
            return httpx.Response(200, json={"output_image": {"mime_type": "image/png", "data": b64}})
        undo = with_mock(handler)
        try:
            res, errs = asyncio.run(providers.edit(models.get("nano-banana-2"), "edit", 1, GEOM_GM, "", False, [png_bytes()], None))
        finally:
            undo()
        self.assertEqual(errs, [])
        self.assertEqual(seen["body"]["model"], "gemini-3.1-flash-image")
        self.assertEqual(seen["body"]["response_format"]["aspect_ratio"], "1:1")
        self.assertEqual([i["type"] for i in seen["body"]["input"]], ["text", "image"])

    def test_bfl_submit_poll_download(self):
        seen = {"polls": 0}

        def handler(req):
            if req.method == "POST":
                seen["url"], seen["body"], seen["key"] = str(req.url), json.loads(req.content), req.headers["x-key"]
                return httpx.Response(200, json={"id": "abc", "polling_url": "https://api.bfl.ai/v1/get_result?id=abc", "cost": 3.0})
            if "get_result" in str(req.url):
                seen["polls"] += 1
                return httpx.Response(200, json={"status": "Ready", "result": {"sample": "https://delivery.example/img.png"}})
            return httpx.Response(200, content=png_bytes())
        async def no_sleep(_):
            return None
        real_sleep, providers.asyncio.sleep = providers.asyncio.sleep, no_sleep
        undo = with_mock(handler)
        try:
            res, errs = asyncio.run(providers.edit(models.get("flux-2-max"), "edit", 1,
                                                   {**GEOM_PX, "width": 1024, "height": 768}, "", False, [png_bytes(), png_bytes()], None))
        finally:
            undo()
            providers.asyncio.sleep = real_sleep
        self.assertEqual(errs, [])
        self.assertTrue(seen["url"].endswith("/v1/flux-2-max"))
        self.assertIn("input_image", seen["body"])
        self.assertIn("input_image_2", seen["body"])
        self.assertEqual(seen["body"]["output_format"], "png")
        self.assertAlmostEqual(res[0].cost_usd, 0.03)
        self.assertEqual(res[0].basis, "actual")

    def test_bfl_moderated(self):
        def handler(req):
            if req.method == "POST":
                return httpx.Response(200, json={"id": "a", "polling_url": "https://api.bfl.ai/v1/get_result?id=a"})
            return httpx.Response(200, json={"status": "Content Moderated"})
        async def no_sleep(_):
            return None
        real_sleep, providers.asyncio.sleep = providers.asyncio.sleep, no_sleep
        undo = with_mock(handler)
        try:
            res, errs = asyncio.run(providers.generate(models.get("flux-2-pro"), "x", 1, GEOM_PX, "", False))
        finally:
            undo()
            providers.asyncio.sleep = real_sleep
        self.assertEqual(res, [])
        self.assertIn("안전 정책", errs[0])


if __name__ == "__main__":
    unittest.main()
