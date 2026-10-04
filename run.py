"""크로스플랫폼(macOS / Windows / Linux) 실행기.

가상환경 준비 → 의존성 설치 → .env 생성 → 서버 실행 → 브라우저 열기를 한 번에 처리한다.
사용법:  macOS/Linux → ./run.sh    Windows → run.bat 더블클릭    (또는 python run.py)
"""
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.request
import venv
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
IS_WIN = os.name == "nt"
VENV_PY = VENV / ("Scripts/python.exe" if IS_WIN else "bin/python")
STAMP = VENV / ".installed"
REQ = ROOT / "requirements.txt"


def say(msg: str):
    print(f"▶ {msg}", flush=True)


def env_value(key: str, default: str) -> str:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            m = re.match(rf"^\s*{key}\s*=\s*(.*)$", line)
            if m and m.group(1).strip().strip("\"'"):
                return m.group(1).strip().strip("\"'")
    return default


def ensure_venv():
    if sys.version_info < (3, 10):
        sys.exit(f"Python 3.10 이상이 필요합니다. (현재 {sys.version.split()[0]})")
    if not VENV_PY.exists():
        say("가상환경 생성 (.venv)")
        venv.create(VENV, with_pip=True)
    if not STAMP.exists() or REQ.stat().st_mtime > STAMP.stat().st_mtime:
        say("의존성 설치 (처음 한 번만, 1~2분 걸릴 수 있습니다)")
        subprocess.check_call([str(VENV_PY), "-m", "pip", "install", "-q", "--upgrade", "pip"])
        subprocess.check_call([str(VENV_PY), "-m", "pip", "install", "-q", "-r", str(REQ)])
        STAMP.write_text("ok", encoding="utf-8")


def ensure_env():
    env, example = ROOT / ".env", ROOT / ".env.example"
    if not env.exists() and example.exists():
        shutil.copyfile(example, env)
        try:
            os.chmod(env, 0o600)  # Windows에서는 무시됨
        except OSError:
            pass
        say(".env 파일을 만들었습니다. 브라우저의 '초기 설정' 화면에서 API 키를 입력하세요.")


def open_browser_when_ready(url: str):
    def _run():
        for _ in range(60):
            try:
                urllib.request.urlopen(url + "/api/health", timeout=1).read()
                webbrowser.open(url)
                return
            except Exception:  # noqa: BLE001
                time.sleep(0.5)
    threading.Thread(target=_run, daemon=True).start()


def main():
    os.chdir(ROOT)
    ensure_venv()
    ensure_env()
    host, port = env_value("HOST", "127.0.0.1"), env_value("PORT", "8100")
    url = f"http://{host}:{port}"
    say(f"{url} 에서 실행합니다 (종료: Ctrl+C)")
    if "--no-browser" not in sys.argv:
        open_browser_when_ready(url)
    env = dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8")
    try:
        subprocess.call([str(VENV_PY), "-m", "uvicorn", "app.main:app", "--host", host, "--port", port], env=env)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
