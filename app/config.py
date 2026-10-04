"""환경 변수(.env) 로드 및 전역 설정.

웹의 '초기 설정' 화면에서 .env를 수정하면 settings.reload()로 서버 재시작 없이 반영된다.
(HOST, PORT는 실행 시점에만 읽으므로 변경 시 재시작 필요)
"""
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"
ENV_EXAMPLE_PATH = BASE_DIR / ".env.example"


def _str(name: str, default: str = "") -> str:
    v = os.getenv(name)
    return v.strip() if v and v.strip() else default


def _bool(name: str, default: bool) -> bool:
    v = _str(name)
    return default if not v else v.lower() in ("1", "true", "yes", "on")


def _float(name: str, default: float) -> float:
    try:
        return float(_str(name, str(default)))
    except ValueError:
        return default


def _int(name: str, default: int) -> int:
    try:
        return int(_str(name, str(default)))
    except ValueError:
        return default


# ---- API 키 형식 검사 (자리표시자·빈 값을 '미설정'으로 취급하기 위한 가벼운 검사) ----
def is_valid_openai_key(k: str) -> bool:
    return k.startswith("sk-") and len(k) >= 20 and "..." not in k


def is_valid_gemini_key(k: str) -> bool:
    """Gemini 키는 기존 'AIza…'(Standard 키)와 새로 발급되는 'AQ.Ab…'(Auth 키) 두 형식이 있다.
    형식은 가볍게만 검사하고, 실제 유효 여부는 '키 확인'(제공사 호출)에서 판단한다."""
    if any(c.isspace() for c in k) or "..." in k:
        return False
    return (k.startswith("AIza") and len(k) >= 30) or (k.startswith("AQ.") and len(k) >= 20)


def is_valid_bfl_key(k: str) -> bool:
    return len(k) >= 20 and "..." not in k and " " not in k


KEY_CHECKS = {
    "OPENAI_API_KEY": is_valid_openai_key,
    "GEMINI_API_KEY": is_valid_gemini_key,
    "BFL_API_KEY": is_valid_bfl_key,
}


class Settings:
    def __init__(self):
        load_dotenv(ENV_PATH)
        self.host = _str("HOST", "127.0.0.1")
        self.port = _int("PORT", 8100)
        self.data_dir = Path(_str("DATA_DIR") or BASE_DIR / "data")
        self.temp_dir = self.data_dir / "temp"          # 아직 저장하지 않은 후보 이미지
        self.saved_dir = Path(_str("SAVE_DIR") or BASE_DIR / "saved_images")  # 사용자가 '저장'한 이미지
        self.db_path = self.data_dir / "app.db"
        self.reload()

    def reload(self):
        load_dotenv(ENV_PATH, override=True)
        self.openai_api_key = _str("OPENAI_API_KEY")
        self.openai_admin_key = _str("OPENAI_ADMIN_KEY")
        self.gemini_api_key = _str("GEMINI_API_KEY") or _str("GOOGLE_API_KEY")
        self.bfl_api_key = _str("BFL_API_KEY")
        fmt = _str("OUTPUT_FORMAT", "png").lower()
        self.output_format = "jpg" if fmt in ("jpg", "jpeg") else "png"
        self.usd_krw = _float("USD_KRW", 1400)
        self.monthly_budget_usd = _float("MONTHLY_BUDGET_USD", 0)
        self.demo_mode = _bool("DEMO_MODE", False)

    def key_for(self, provider: str) -> str:
        return {"openai": self.openai_api_key, "gemini": self.gemini_api_key, "bfl": self.bfl_api_key}[provider]

    def key_ok(self, provider: str) -> bool:
        env = {"openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY", "bfl": "BFL_API_KEY"}[provider]
        return KEY_CHECKS[env](self.key_for(provider))


settings = Settings()
for _d in (settings.data_dir, settings.temp_dir, settings.saved_dir):
    _d.mkdir(parents=True, exist_ok=True)
