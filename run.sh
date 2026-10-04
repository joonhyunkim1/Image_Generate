#!/usr/bin/env bash
# macOS / Linux 실행 스크립트: 실제 작업은 run.py가 처리합니다.
cd "$(dirname "$0")"
if command -v python3 >/dev/null 2>&1; then exec python3 run.py "$@"; fi
echo "Python 3.10 이상이 필요합니다. https://www.python.org/downloads/ 에서 설치하세요."
exit 1
