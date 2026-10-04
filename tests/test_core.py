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


    def test_input_ranges(self):
        rg = sizing.request_geometry
        self.assertEqual(rg({"mode": "ratio", "aspect": "2.35:1", "tier": "custom", "long_edge": 1800}), (2.35, 1800.0))
        bad = [
            {"mode": "ratio", "aspect": "0:5", "tier": "1K"},            # 가로 0.1 미만
            {"mode": "ratio", "aspect": "500:1", "tier": "1K"},          # 가로 100 초과
            {"mode": "ratio", "aspect": "100:1", "tier": "1K"},          # 전체 비율 20:1 초과
            {"mode": "ratio", "aspect": "a:b", "tier": "1K"},
            {"mode": "ratio", "aspect": "1:1", "tier": "custom", "long_edge": 255},
            {"mode": "ratio", "aspect": "1:1", "tier": "custom", "long_edge": 4097},
            {"mode": "ratio", "aspect": "1:1", "tier": "9K"},
            {"mode": "print", "width_mm": 4.9, "height_mm": 50, "dpi": 300},
            {"mode": "print", "width_mm": 2001, "height_mm": 50, "dpi": 300},
            {"mode": "print", "width_mm": 50, "height_mm": 50, "dpi": 71},
            {"mode": "print", "width_mm": 50, "height_mm": 50, "dpi": 1201},
            {"mode": "print", "width_mm": 5, "height_mm": 2000, "dpi": 300},  # 비율 400:1
        ]
        for b in bad:
            with self.assertRaises(ValueError, msg=str(b)):
                rg(b)
        # 경계값은 허용
        rg({"mode": "ratio", "aspect": "0.1:0.1", "tier": "custom", "long_edge": 256})
        rg({"mode": "ratio", "aspect": "20:1", "tier": "custom", "long_edge": 4096})
        rg({"mode": "print", "width_mm": 5, "height_mm": 100, "dpi": 72})
        rg({"mode": "print", "width_mm": 2000, "height_mm": 2000, "dpi": 1200})

    def test_ratio_notes_and_cropped_size(self):
        self.assertIn("3:1", sizing.resolve(models.get("gpt-image-2.5-flare"), 10, 1024)["ratio_note"])
        self.assertIsNone(sizing.resolve(models.get("gpt-image-2.5-flare"), 2, 1024)["ratio_note"])
        self.assertIn("고정 비율", sizing.resolve(models.get("nano-banana-2"), 2.9, 1024)["ratio_note"])
        self.assertEqual(sizing.cropped_size(1000, 1000, 0.5), (500, 1000))
        self.assertEqual(sizing.cropped_size(1000, 500, 4.0), (1000, 250))


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


class KeyFormatTests(unittest.TestCase):
    def test_gemini_key_formats(self):
        from app.config import is_valid_bfl_key, is_valid_gemini_key, is_valid_openai_key
        self.assertTrue(is_valid_gemini_key("AQ.Ab8RN6" + "x" * 40))          # 새 형식 (Auth 키)
        self.assertTrue(is_valid_gemini_key("AIzaSy" + "x" * 33))             # 기존 형식
        for bad in ["", "abc", "AQ.", "AQ.short", "AIzaShort", "AQ.Ab " + "x" * 30, "AQ.Ab..." + "x" * 30, "sk-" + "x" * 40]:
            self.assertFalse(is_valid_gemini_key(bad), bad)
        self.assertTrue(is_valid_openai_key("sk-proj-" + "x" * 30))
        self.assertTrue(is_valid_bfl_key("0123456789abcdef0123456789abcdef"))


class BflKeyCheckTests(unittest.TestCase):
    """BFL 잔액 조회가 500이어도 키 오류와 구분해서 처리하는지 (mock)."""
    def run_check(self, credits_status, post_status, credits_body=None):
        from app import setup
        calls = []
        real_get, real_post, real_sleep = setup.httpx.get, setup.httpx.post, setup.time.sleep
        setup.httpx.get = lambda url, **kw: (calls.append(("GET", url)), httpx.Response(credits_status, json=credits_body or {"detail": "x"}))[1]
        setup.httpx.post = lambda url, **kw: (calls.append(("POST", url)), httpx.Response(post_status, json={"detail": "x"}))[1]
        setup.time.sleep = lambda s: None
        try:
            return setup.check_bfl_key("k" * 32), calls
        finally:
            setup.httpx.get, setup.httpx.post, setup.time.sleep = real_get, real_post, real_sleep

    def test_ok(self):
        r, calls = self.run_check(200, 422, {"credits": 12.5})
        self.assertTrue(r["ok"]); self.assertEqual(r["credits"], 12.5); self.assertEqual(len(calls), 1)

    def test_invalid_key(self):
        r, calls = self.run_check(403, 403)
        self.assertFalse(r["ok"]); self.assertIn("유효하지 않은", r["error"]); self.assertEqual(len(calls), 1)

    def test_credits_500_but_auth_ok(self):
        r, calls = self.run_check(500, 422)
        self.assertTrue(r["ok"]); self.assertIn("500", r["warning"])
        self.assertEqual([c[0] for c in calls], ["GET", "GET", "POST"])  # 재시도 1회 후 인증 확인

    def test_credits_500_and_key_invalid(self):
        r, _ = self.run_check(500, 403)
        self.assertFalse(r["ok"]); self.assertIn("유효하지 않은", r["error"])

    def test_total_outage(self):
        r, _ = self.run_check(500, 500)
        self.assertFalse(r["ok"]); self.assertIn("서버가 오류", r["error"])


class BillingTests(unittest.TestCase):
    """제공사별 청구 금액 선택/합산 규칙 (메모리 DB + mock)."""
    MONTH = "2026-10"

    def setUp(self):
        import sqlite3
        from app import db, usage
        self.db, self.usage = db, usage
        self._old_conn = db._conn
        db._conn = sqlite3.connect(":memory:", check_same_thread=False)
        db._conn.row_factory = sqlite3.Row
        db._conn.executescript(db.SCHEMA)
        self._old = (usage.official_openai, usage.bfl_balance)
        usage.official_openai = lambda month=None: {"available": False}
        usage.bfl_balance = lambda: {"available": False}
        ins = lambda prov, model, cost, basis: db.execute(  # noqa: E731
            "INSERT INTO usage(ts, provider, model, purpose, images, cost_usd, basis) VALUES(?,?,?,?,?,?,?)",
            (f"{self.MONTH}-05T10:00:00", prov, model, "generate", 2, cost, basis))
        ins("openai", "gpt-image-2.5-flare", 3.0, "actual")
        ins("gemini", "nano-banana-2", 1.0, "estimate")
        ins("bfl", "flux-2-pro", 0.5, "actual")
        ins("bfl", "flux-2-pro", 9.9, "actual")  # 다른 달 기록은 제외되어야 함
        db.execute("UPDATE usage SET ts='2026-09-05T10:00:00' WHERE cost_usd=9.9")

    def tearDown(self):
        self.db._conn = self._old_conn
        self.usage.official_openai, self.usage.bfl_balance = self._old

    def rows(self, **kw):
        b = self.usage.billing(self.MONTH)
        return b, {r["provider"]: r for r in b["rows"]}

    def test_app_records_and_total(self):
        b, r = self.rows()
        self.assertEqual((r["openai"]["basis"], r["gemini"]["basis"], r["bfl"]["basis"]), ("actual", "estimate", "actual"))
        self.assertAlmostEqual(r["bfl"]["usd"], 0.5)           # 9월 기록(9.9)은 제외
        self.assertAlmostEqual(b["total_usd"], 4.5)
        self.assertTrue(b["basis_mixed"])

    def test_manual_overrides_and_delete(self):
        self.usage.set_manual("gemini", self.MONTH, 2.25)
        b, r = self.rows()
        self.assertEqual((r["gemini"]["basis"], r["gemini"]["usd"], r["gemini"]["app_usd"]), ("manual", 2.25, 1.0))
        self.assertAlmostEqual(b["total_usd"], 3.0 + 2.25 + 0.5)
        self.usage.set_manual("gemini", self.MONTH, 3.0); self.assertAlmostEqual(self.rows()[0]["total_usd"], 6.5)  # 덮어쓰기
        self.usage.set_manual("gemini", self.MONTH, None)
        self.assertEqual(self.rows()[1]["gemini"]["basis"], "estimate")

    def test_openai_official_used_when_key_found(self):
        self.usage.official_openai = lambda month=None: {"available": True, "key_found": True, "key_month_usd": 2.5, "org_month_usd": 9.0}
        b, r = self.rows()
        self.assertEqual((r["openai"]["basis"], r["openai"]["usd"]), ("official", 2.5))
        self.assertAlmostEqual(b["total_usd"], 2.5 + 1.0 + 0.5)

    def test_openai_official_not_used_when_key_unmatched(self):
        self.usage.official_openai = lambda month=None: {"available": True, "key_found": False, "org_month_usd": 9.0}
        _, r = self.rows()
        self.assertEqual((r["openai"]["basis"], r["openai"]["usd"]), ("actual", 3.0))   # 조직 전체 금액으로 합산하지 않음
        self.assertTrue(r["openai"]["note"])

    def test_openai_official_error_falls_back(self):
        self.usage.official_openai = lambda month=None: {"available": True, "error": "HTTP 403"}
        self.assertEqual(self.rows()[1]["openai"]["basis"], "actual")

    def test_month_validation_and_bounds(self):
        v = self.usage.VALID_MONTH
        for ok in ("2026-01", "2026-12"):
            self.assertTrue(v.match(ok))
        for bad in ("2026-13", "2026-00", "26-10", "2026-1", "2026-10-01", ""):
            self.assertFalse(v.match(bad), bad)
        s, e = self.usage.month_bounds_utc("2026-12")
        self.assertEqual((e.year, e.month), (2027, 1))


class HistoryTests(unittest.TestCase):
    """이미지 수정 기록: 묶음/복원/자동 정리/경로 검증 (임시 폴더 + 메모리 DB)."""
    def setUp(self):
        import sqlite3, tempfile
        from pathlib import Path
        from app import db, history
        self.db, self.history = db, history
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.old = (db._conn, settings.data_dir, settings.temp_dir)
        (root / "temp").mkdir()
        settings.data_dir, settings.temp_dir = root, root / "temp"
        db._conn = sqlite3.connect(":memory:", check_same_thread=False)
        db._conn.row_factory = sqlite3.Row
        db._conn.executescript(db.SCHEMA)

    def tearDown(self):
        self.db._conn, settings.data_dir, settings.temp_dir = self.old
        self.tmp.cleanup()

    def add(self, run, model="gpt-image-2.5-flare", n_images=2, mask=True, prompt="p"):
        h = self.history
        imgs = []
        for i in range(n_images):
            iid = h.new_id()
            (settings.temp_dir / f"{iid}.png").write_bytes(png_bytes((50, 40)))
            imgs.append({"id": iid, "ext": "png", "width": 50, "height": 40, "dpi": None, "cost_usd": 0.01, "basis": "actual", "transparent": False})
        return h.add(run_id=run, model=models.get(model), prompt=prompt, n=n_images, quality="high", tier="orig", transparent=False,
                     keep_outside=True, source_png=png_bytes((100, 80)), mask_png=png_bytes((100, 80)) if mask else None,
                     src_size=(100, 80), images=imgs, notes=["n"], errors=[], cost_usd=0.02)

    def test_group_by_run_and_files(self):
        h = self.history
        self.add("a" * 12, "gpt-image-2.5-flare"); self.add("a" * 12, "nano-banana-2"); self.add("b" * 12, "flux-2-pro", mask=False)
        runs = h.list_runs()["runs"]
        self.assertEqual(len(runs), 2)
        a = next(r for r in runs if r["run_id"] == "a" * 12)
        self.assertEqual((len(a["models"]), a["image_count"], a["has_mask"], len(a["thumbs"])), (2, 4, True, 4))
        self.assertAlmostEqual(a["cost_usd"], 0.04)
        self.assertIsNotNone(h.file_path("a" * 12, "source")); self.assertIsNotNone(h.file_path("a" * 12, "mask"))
        self.assertIsNone(h.file_path("b" * 12, "mask"))                      # 마스크 없는 기록
        for bad in ("../x", "secret", "res_zzz_0", "source.png"):
            with self.assertRaises(ValueError):
                h.file_path("a" * 12, bad)
        with self.assertRaises(ValueError):
            h.file_path("../../etc", "source")

    def test_restore_creates_independent_temp_copies(self):
        h = self.history
        self.add("c" * 12, "gpt-image-2.5-flare", prompt="복원 테스트")
        before = set(p.name for p in settings.temp_dir.glob("*.png"))
        r = h.restore("c" * 12)
        self.assertEqual(r["settings"]["prompt"], "복원 테스트")
        self.assertEqual(len(r["columns"][0]["images"]), 2)
        new = set(p.name for p in settings.temp_dir.glob("*.png")) - before
        self.assertEqual(len(new), 2)                                          # 새 임시 파일로 복사됨
        self.assertTrue(all((settings.temp_dir / f"{i['id']}.json").exists() for i in r["columns"][0]["images"]))
        self.assertIsNone(h.restore("d" * 12))

    def test_prune_removes_oldest_and_delete(self):
        h = self.history
        for i in range(4):
            self.add(f"{i}" * 12, mask=False)
            self.db.execute("UPDATE edit_history SET ts=? WHERE run_id=?", (f"2026-10-0{i + 1}T10:00:00", f"{i}" * 12))
        h.prune(max_runs=2)
        left = {r["run_id"] for r in h.list_runs()["runs"]}
        self.assertEqual(left, {"2" * 12, "3" * 12})                           # 오래된 0, 1 삭제
        self.assertFalse((h.hist_dir() / ("0" * 12)).exists())
        h.delete_run("3" * 12)
        self.assertEqual({r["run_id"] for r in h.list_runs()["runs"]}, {"2" * 12})
        h.clear_all()
        self.assertEqual(h.list_runs()["runs"], [])


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
