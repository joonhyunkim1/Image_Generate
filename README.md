# UV Image Generator — UV프린트용 AI 이미지 생성기

UV프린트에 쓸 이미지를 **여러 AI 모델로 동시에 생성·비교·수정**하고 PNG로 저장하는 **로컬 웹 앱**입니다.
macOS와 Windows에서 모두 실행되며, 키와 이미지는 모두 **내 PC에만** 저장됩니다.

> ⚠️ **API 사용 요금은 본인 부담입니다.** 이 프로그램은 무료(MIT)지만 이미지를 만들 때마다 각 제공사(OpenAI / Google / Black Forest Labs) 요금이 키 소유자 계정에 청구됩니다. 각 제공사 대시보드에서 월 사용 한도를 설정해 두세요.

## 주요 기능

| 페이지 | 설명 |
|---|---|
| 📘 튜토리얼 | 설치·실행, API 키 발급, 페이지별 사용법, **초급 → 전문가 수준별 프롬프트 가이드**, UV 인쇄 팁(DPI 계산표 등), 모델 비교, 문제 해결 |
| ⚙️ 초기 설정 | 제공사별 API 키를 입력하면 **로컬 `.env`에 저장**(재시작 불필요). 키 확인(무료), 단계별 발급 안내 |
| 🎨 이미지 생성 | **모델 복수 선택 → 같은 프롬프트로 모델별 비교**, 모델별 여러 장, 품질·해상도, **인쇄 크기(mm)+DPI**, **투명 배경 PNG**(지원 모델), **장당 예상 가격** 표시, 마음에 드는 이미지만 💾 저장 |
| ✏️ 이미지 수정 | 이미지 첨부 → **브러시로 수정 영역 칠하기** + 프롬프트. GPT Image는 마스크 인페인팅, 그 외 모델은 안내 이미지 방식. 참고 이미지 추가, 칠한 영역 밖 원본 유지 합성 |
| 🖼 저장한 이미지 | 저장 폴더 열기, 다운로드, 프롬프트 재사용, 수정으로 보내기 |
| 💰 가격·사용량 | 오늘/이번 달/누적 비용, API 키(제공사)별·모델별 사용량, 일별 그래프, 월 예산, **제공사별 청구 금액·합산(공식 조회/직접 입력)**, 모델별 가격표 |

### 지원 모델

| 모델 | 제공사 | API 모델 ID | 투명 배경 | 마스크 수정 |
|---|---|---|:-:|:-:|
| GPT Image 2.5 Sunburst | OpenAI | `gpt-image-2.5-sunburst` | ✓ | ✓ |
| GPT Image 2.5 Flare | OpenAI | `gpt-image-2.5-flare` | ✓ | ✓ |
| GPT Image 2 | OpenAI | `gpt-image-2` | — | ✓ |
| Nano Banana 2 | Google | `gemini-3.1-flash-image` | — | 프롬프트 |
| FLUX.2 Max / Pro / Flex | Black Forest Labs | `flux-2-max` / `flux-2-pro` / `flux-2-flex` | — | 프롬프트 |

쓰고 싶은 제공사의 키만 있으면 됩니다. (키 3개: `OPENAI_API_KEY`, `GEMINI_API_KEY`, `BFL_API_KEY`)

## 설치 및 실행

필요한 것: **Python 3.10 이상**, git

```bash
git clone <이 저장소 주소>
cd Image_Generate
```

| OS | 실행 방법 |
|---|---|
| macOS / Linux | `./run.sh` |
| Windows | `run.bat` 더블클릭 (Python 설치 시 *Add python.exe to PATH* 체크) |

처음 실행하면 가상환경(`.venv`) 생성 → 패키지 설치 → `.env` 생성 → 서버 실행 → 브라우저 열기를 자동으로 처리합니다. 주소는 <http://127.0.0.1:8100> 입니다. 종료는 `Ctrl+C`.

**업데이트**: `git pull` 후 다시 실행. `.env`와 저장한 이미지는 git에 포함되지 않아 그대로 유지됩니다.

## API 키 설정

브라우저에서 **⚙️ 초기 설정**으로 이동 → 제공사별 키 입력 → **키 확인 → 저장**. 값은 프로젝트 폴더의 `.env`에 저장됩니다. 직접 편집하려면 `.env.example`을 참고하세요.

| 키 | 발급 |
|---|---|
| `OPENAI_API_KEY` | <https://platform.openai.com/api-keys> (크레딧 충전 필요, 모델에 따라 조직 인증 필요) |
| `OPENAI_ADMIN_KEY` *(선택)* | <https://platform.openai.com/settings/organization/admin-keys> — 공식 청구 금액 조회용 |
| `GEMINI_API_KEY` | <https://aistudio.google.com/apikey> (이미지 모델은 결제 연결이 필요할 수 있음) |
| `BFL_API_KEY` | <https://dashboard.bfl.ai> (크레딧 충전 필요) |

기타 `.env` 항목: `OUTPUT_FORMAT`(`png` 기본 / `jpg`), `USD_KRW`, `MONTHLY_BUDGET_USD`, `DEMO_MODE`(API 호출 없이 화면 체험), `HOST`, `PORT`.

### 보안

- 서버는 `127.0.0.1`에서만 열리며, 다른 호스트/외부 사이트의 요청은 차단합니다.
- 키는 `.env`에만 저장되고 화면에는 앞뒤 일부만 표시됩니다. `.env`는 `.gitignore`에 포함되어 **push되지 않습니다.**
- 이미지 요청은 내 PC → 각 제공사로 직접 전송됩니다(중간 서버 없음).
- Windows에서는 파일 권한(600)을 지정하지 않으므로 폴더를 타인과 공유하지 마세요.

## 크기 · DPI · 투명 배경

**직접 입력 범위** (벗어나면 입력칸이 빨갛게 표시되고 생성이 막힙니다)

| 입력칸 | 범위 |
|---|---|
| 비율 가로 / 세로 | 각 0.1 ~ 100 (소수 가능), 가로:세로는 1:20 ~ 20:1 |
| 해상도 직접 입력 (긴 변) | 256 ~ 4096px (모델 상한 초과 시 자동 축소) |
| 인쇄 가로 / 세로 | 각 5 ~ 2000mm, 가로:세로는 1:20 ~ 20:1 |
| DPI | 72 ~ 1200 |

모델이 지원하지 않는 비율(GPT는 3:1 초과, Nano Banana 2는 고정 비율 10종 밖)은 가장 가까운 값으로 만든 뒤 요청한 비율로 잘라 맞춥니다(해상도 감소, 화면에 안내 표시). 인쇄 크기 모드에서는 모델 카드에 **예상 실제 DPI**가 표시됩니다.

- **비율 + 해상도(1K/2K/4K)** 또는 **인쇄 크기(mm) + DPI** 중 선택. 모델별 제약(OpenAI: 16의 배수·최대 3840px·최대 약 8.3MP, FLUX: 16의 배수·최대 4MP, Gemini: 고정 비율 목록 + 1K/2K/4K)을 자동 반영합니다.
- 인쇄 크기 모드에서는 결과를 정확한 비율로 자르고, **PNG에 지정한 mm 크기에 맞는 DPI를 기록**합니다. 모델 최대 해상도가 부족하면 실제 DPI가 낮아지며 결과 카드에 표시됩니다(업스케일은 하지 않습니다).
- 투명 배경은 피사체만 남은 누끼 형태의 PNG(알파 채널)이지만, 완성된 그림에서 배경을 오려내는 방식이 아니라 **모델이 투명 배경으로 직접 그리는 방식**입니다. 가장자리나 그림자가 반투명 픽셀로 남을 수 있으니 인쇄 전에 확인하세요.
- **투명 배경 PNG는 API가 지원하는 모델에서만** 동작합니다(현재 GPT Image 2.5 Sunburst / Flare). 투명 영역이 있는 이미지는 `OUTPUT_FORMAT=jpg`여도 PNG로 저장합니다.
- 저장 형식은 기본 **PNG**, 필요하면 `.env`의 `OUTPUT_FORMAT=jpg`.

## 가격 정보

- 화면의 **장당 예상 가격은 `app/pricing.json`의 표 단가 기준 추정치**입니다. 제공사 요금이 바뀌면 이 파일만 수정하세요(확인일 2026-10).
- 실제 비용은 가능한 경우 **API 응답으로 재계산**합니다: OpenAI는 응답 `usage` 토큰, BFL은 응답 `cost`(credit, 1 credit = $0.01). Google은 API가 사용량을 돌려주지 않아 표 단가 추정입니다.
- **청구 금액 요약 (가격·사용량 페이지)**: 월을 골라 제공사별 금액과 합산을 봅니다. 제공사마다 확인 가능한 금액이 달라 **가장 믿을 만한 금액을 골라 합산하고 기준 배지를 표시**합니다. 우선순위는 `직접 입력 > 공식 조회 > 앱 기록(API 응답 실측 > 표 단가 추정)`입니다.

| 제공사 | 공식 조회 | 앱 기록 | 비고 |
|---|---|---|---|
| OpenAI | ✓ Admin 키로 이 앱의 키 기준 청구 금액 조회 (하루 단위·UTC, 수 시간 지연) | 토큰 기반 실측 | Admin 키가 없으면 앱 기록 사용 |
| Black Forest Labs | ✗ 지출 API 없음 (남은 크레딧 잔액만 표시) | 응답의 credit으로 실측 | 전체 지출은 dashboard.bfl.ai에서 확인해 직접 입력 |
| Google (Gemini) | ✗ API 키로 조회 불가 | 표 단가 추정 | [AI Studio 사용량](https://aistudio.google.com/usage)/Cloud 결제 화면의 금액을 직접 입력 |

  앱 기록은 **이 앱으로 만든 이미지만** 포함하므로, 같은 키를 다른 곳에서 쓴 금액은 빠집니다. 직접 입력한 값은 월별·제공사별로 이 PC의 앱 데이터에만 저장됩니다.

## 프로젝트 구조

```
run.py / run.sh / run.bat   실행기 (venv·설치·서버·브라우저, macOS/Windows 공통은 run.py)
app/
  main.py        FastAPI 서버 + REST API
  providers.py   OpenAI / Gemini / BFL 클라이언트 (+ 데모)
  models.py      모델 레지스트리 (모델 추가·수정은 여기)
  sizing.py      모델별 해상도 규칙 / 인쇄 크기 계산
  pricing.py, pricing.json   예상 가격 / 실제 비용 계산, 단가표
  imaging.py     PNG/JPG 변환, 크롭, DPI, 마스크 생성·합성 (Pillow)
  usage.py       사용량 기록, 공식 청구·잔액 조회
  setup.py       .env 읽기/쓰기, 키 검증
  config.py, db.py
static/          프런트엔드 (순수 JS): 튜토리얼 · 설정 · 생성 · 수정 · 갤러리 · 가격
tests/           단위 테스트 (API 호출 없이 mock)
data/            (git 제외) 임시 후보 이미지, SQLite
saved_images/    (git 제외) 💾 저장한 이미지
```

테스트: `python -m unittest discover -s tests` (가상환경의 python 사용)

## 문제 해결

- **포트 충돌**: `.env`의 `PORT` 변경 후 재실행
- **Windows에서 python을 못 찾음**: Python 재설치 시 *Add python.exe to PATH* 체크
- **키 확인은 되는데 생성 실패**: 크레딧/결제, OpenAI 조직 인증, Google 결제 연결, 안전 정책 차단 여부 확인 (오류 메시지가 결과 칸에 표시됩니다)
- **투명 배경이 안 나옴**: 지원 모델(GPT Image 2.5)을 쓰고 프롬프트에 “transparent background”를 함께 적기

## 라이선스

MIT
