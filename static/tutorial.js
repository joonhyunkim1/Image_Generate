/* 튜토리얼: 시작하기 · API 키 · 페이지별 사용법 · 수준별 프롬프트 가이드 · UV 팁 */
let tutLevel = ls.get("tutLevel", "beginner");
const tutSeen = () => ls.get("tutorialSeen", false);

const PROMPT_LEVELS = {
  beginner: {
    name: "🌱 초급", sub: "한 문장으로 말하기",
    intro: "무엇을 그릴지만 짧게 적습니다. 처음 모델을 써볼 때, 또는 아이디어를 빠르게 훑어볼 때 좋습니다.",
    formula: "[대상] + (분위기 한 단어)",
    points: ["문장은 짧고 구체적인 명사 위주로", "'예쁜', '멋진'보다 '파스텔', '귀여운', '미니멀'처럼 그림이 떠오르는 단어", "마음에 드는 결과가 나오면 그 느낌을 중급 프롬프트로 확장"],
    limits: "스타일·구도·배경을 모델이 마음대로 정해서, 같은 문장도 매번 결과가 다릅니다. 인쇄 용도(투명 배경, 여백)는 따로 말하지 않으면 지켜지지 않습니다.",
    examples: [
      ["귀여운 고양이 스티커", "귀여운 고양이 스티커"],
      ["미니멀한 산 로고", "미니멀한 산 모양 로고"],
    ],
  },
  intermediate: {
    name: "🌿 중급", sub: "대상 · 스타일 · 색 · 배경 · 구도",
    intro: "그림의 핵심 요소 5가지를 쉼표로 나열합니다. 대부분의 실용 이미지는 이 수준에서 충분히 좋아집니다.",
    formula: "[대상], [스타일], [색감], [구도], [배경]",
    points: ["스타일: 플랫 일러스트 / 수채화 / 3D 렌더 / 라인아트 / 픽셀아트 …", "배경은 꼭 적기: '투명 배경', '단색 흰 배경' 등 (UV 인쇄에서 특히 중요)", "구도: 정면, 중앙 정렬, 클로즈업, 위에서 내려다본 시점 등", "한 번에 하나씩만 바꿔가며 비교하면 어떤 단어가 효과적인지 알 수 있어요"],
    limits: "세밀한 색 지정, 글자 표현, 인쇄 사양(비율·여백)까지 통제하기는 어렵습니다.",
    examples: [
      ["스티커(투명 배경)", "파스텔 수채화 스타일의 시바견 스티커, 굵은 흰색 외곽선, 정면 구도, 투명 배경"],
      ["로고(2색)", "커피숍 원형 엠블럼 로고, 갈색과 크림색 2색, 플랫 벡터 스타일, 중앙 정렬, 흰 배경"],
      ["패턴", "열대 식물과 새의 이음새 없는 패턴, 수채화 느낌, 밝은 청록색 팔레트"],
    ],
  },
  advanced: {
    name: "🌳 고급", sub: "구조화된 항목 + 사양 + 제외 조건",
    intro: "항목 이름을 붙여 줄 단위로 씁니다. 모델이 요구사항을 빠뜨리지 않고, 나중에 일부만 고쳐 재사용하기 쉽습니다. 인쇄물처럼 조건이 많은 작업에 알맞습니다.",
    formula: "용도 / 주제 / 스타일 / 색상(HEX) / 구도 / 배경 / 글자 / 제외",
    points: ["용도와 출력 형태를 먼저 알려주기 (예: 세로형 폰케이스 UV 인쇄용 아트워크)", "색은 이름 + HEX 코드로: '파스텔 핑크 #F7C8D8'", "화면에 들어갈 글자는 큰따옴표로 정확한 철자 지정: 글자는 \"HELLO\"", "'제외' 항목으로 원치 않는 것(가는 선, 그림자, 사진 질감)을 명시", "수정 시에는 전체를 다시 쓰지 말고 바꿀 항목 한 줄만 고쳐서 재생성"],
    limits: "모델마다 해석이 달라 같은 프롬프트라도 결과 차이가 큽니다. 그래서 여러 모델을 동시에 돌려 비교하는 것이 좋습니다.",
    examples: [
      ["폰케이스 아트워크", `용도: 휴대폰 케이스 UV 인쇄용 아트워크 (세로형, 가장자리 여백 5%)
주제: 벚꽃나무 아래에서 졸고 있는 시바견
스타일: 플랫 벡터 일러스트, 굵은 외곽선, 셀 셰이딩
색상: 파스텔 핑크 #F7C8D8, 크림 #FFF3E0, 진한 갈색 #5B3A29
구도: 중앙 정렬, 피사체가 화면의 70%
배경: 완전한 투명 배경 (그림자·그라데이션 없음)
글자: 없음
제외: 사진 같은 질감, 0.5mm 이하의 가는 선, 흐린 가장자리`],
      ["글자가 있는 로고", `용도: 소형 굿즈용 로고 (정사각형)
주제: 'Moon Bakery' 베이커리 로고, 초승달과 밀 이삭
스타일: 미니멀 라인 + 면 채우기, 벡터 느낌
색상: 네이비 #1F2A44, 머스터드 #E0A526 (2색만 사용)
글자: "MOON BAKERY" (대문자, 철자 정확히, 굵은 산세리프)
배경: 단색 흰색
제외: 그라데이션, 그림자, 3D 효과`],
    ],
  },
  expert: {
    name: "🌲 전문가", sub: "JSON 구조 · 참조 이미지 역할 · 변경/유지 분리 · 모델 조합 전략",
    intro: "모델의 특성을 알고 의도를 정밀하게 제어하는 단계입니다. 결과의 재현성과 수정 효율을 높이는 것이 목표입니다.",
    formula: "구조화(JSON/섹션) + 참조 이미지별 역할 + '변경 / 유지' 분리 + 단계별 모델 전략",
    points: [
      "<b>JSON 프롬프트</b>: FLUX.2는 구조화된 JSON 프롬프트와 HEX 색상 지정을 지원합니다. 장면/피사체/팔레트/구도를 키로 나누면 일부만 바꾸기 쉽습니다.",
      "<b>참조 이미지 역할 지정</b>: '이미지 1은 캐릭터의 얼굴·비율 유지, 이미지 2는 색감만 참고'처럼 번호별 역할을 문장으로 명시합니다. (수정 페이지의 '참고 이미지 추가')",
      "<b>변경 / 유지 분리</b>: 수정 시 '바꿀 것'과 '그대로 둘 것'을 따로 씁니다. 마스크가 있는 모델(GPT Image)은 칠한 영역만 바뀌고, 없는 모델은 이 문장이 핵심입니다.",
      "<b>비용 전략</b>: ① 저렴한 설정(GPT low, Nano Banana 1K, FLUX Pro)으로 여러 장 시안 → ② 구도가 확정되면 같은 프롬프트를 고품질(Sunburst high/xhigh, FLUX Max)로 최종 생성.",
      "<b>UV 레이어 대비</b>: 화이트 잉크/바니시 레이어는 보통 인쇄 소프트웨어(RIP)에서 만들지만, 필요하면 '같은 모양의 순백색 실루엣, 검은 배경' 이미지를 따로 생성해 마스크 시안으로 쓸 수 있습니다.",
    ],
    limits: "모델 업데이트에 따라 반응이 달라질 수 있습니다. 좋은 프롬프트는 저장해 두고(갤러리의 '프롬프트 재사용') 같은 조건으로 비교하세요.",
    examples: [
      ["FLUX.2 JSON 구조 프롬프트", `{
  "scene": "벚꽃 아래에서 낮잠 자는 시바견, 평평한 벡터 일러스트",
  "subjects": [{"type": "dog", "description": "크림색 시바견, 눈 감음, 몸을 동그랗게 말고 있음", "position": "center"}],
  "style": "flat vector, thick outline, cel shading",
  "color_palette": ["#F7C8D8", "#FFF3E0", "#5B3A29"],
  "composition": "centered, subject fills 70% of frame, generous margin",
  "background": "pure white, no shadow"
}`],
      ["수정: 변경 / 유지 분리", `변경: 셔츠를 체크무늬 빨간 후드티로 바꿔줘.
유지: 얼굴, 헤어스타일, 자세, 배경, 조명, 이미지 구도와 해상도는 그대로 둬.
주의: 칠한 영역 밖의 픽셀은 건드리지 마.`],
      ["참조 이미지 역할 지정", `이미지 1(주 이미지)의 캐릭터 얼굴과 비율을 그대로 유지해줘.
이미지 2는 색감과 질감만 참고해서 의상에 적용해줘. 이미지 2의 인물이나 배경은 가져오지 마.`],
    ],
  },
};

const PRINT_SIZES = [["명함", 90, 50], ["50mm 정사각 굿즈", 50, 50], ["폰케이스", 75, 160], ["A5", 148, 210], ["A4", 210, 297], ["머그컵 랩", 210, 90]];

function promptBlock(text, applyable) {
  return `<pre class="prompt">${esc(text)}</pre>
    <div class="row"><button class="btn sm" data-copy>복사</button>${applyable ? `<button class="btn sm primary" data-apply>이미지 생성에 적용 →</button>` : ""}</div>`;
}

function renderLevel() {
  const L = PROMPT_LEVELS[tutLevel];
  $("#levelBody").innerHTML = `
    <div class="lvl">
      <p><b>${L.name}</b> — ${L.sub}</p><p>${L.intro}</p>
      <p>공식: <code>${esc(L.formula)}</code></p>
      <h4>핵심 요령</h4><ul>${L.points.map((p) => `<li>${p}</li>`).join("")}</ul>
      <div class="note"><b>한계</b> · ${L.limits}</div>
    </div>
    <h4>예시 프롬프트</h4>
    ${L.examples.map(([t, p]) => `<div class="ex"><b>${esc(t)}</b>${promptBlock(p, true)}</div>`).join("")}`;
  $$("#levelBody .ex").forEach((ex) => {
    const text = $("pre", ex).textContent;
    $("[data-copy]", ex).onclick = async () => { try { await navigator.clipboard.writeText(text); toast("복사했습니다."); } catch { toast("복사하지 못했습니다. 직접 선택해 복사하세요."); } };
    $("[data-apply]", ex).onclick = () => { $("#gPrompt").value = text; switchView("generate"); toast("프롬프트를 적용했습니다."); };
  });
  $$("#levelTabs .tab").forEach((t) => t.classList.toggle("active", t.dataset.l === tutLevel));
}

function renderTutorial() {
  ls.set("tutorialSeen", true);
  const c = state.config;
  const isWin = c.platform === "win32";
  const section = (id, title, html) => `<div class="card" id="t-${id}"><h3 style="margin-top:0">${title}</h3>${html}</div>`;

  $("#tutorialContent").innerHTML = `
    <h2>📘 튜토리얼</h2>
    <p class="sub">UV프린트용 이미지를 AI로 만들고, 여러 모델을 비교해 저장하는 프로그램입니다. 처음이라면 위에서부터 차례로 따라오세요.</p>
    <div class="toc">${[["start", "1. 시작하기"], ["keys", "2. API 키"], ["pages", "3. 사용법"], ["prompt", "4. 프롬프트 가이드"], ["uv", "5. UV 인쇄 팁"], ["models", "6. 모델 비교"], ["cost", "7. 비용"], ["faq", "8. 문제 해결"]]
      .map(([id, t]) => `<a href="#t-${id}" data-to="t-${id}">${t}</a>`).join("")}</div>

    ${section("start", "1. 시작하기 (설치 · 실행)", `
      <ol>
        <li><b>Python 3.10 이상</b>을 설치합니다. ${isWin ? `Windows는 설치 화면에서 <b>“Add python.exe to PATH”</b>를 꼭 체크하세요.` : `macOS는 <code>python3 --version</code>으로 확인하고, 없다면 python.org에서 설치합니다.`}</li>
        <li>저장소를 받습니다: <code>git clone &lt;저장소 주소&gt;</code> (이미 받았다면 <code>git pull</code>로 최신 버전 갱신)</li>
        <li>실행합니다.
          <ul><li><b>macOS / Linux</b>: 터미널에서 <code>./run.sh</code></li><li><b>Windows</b>: <code>run.bat</code> 더블클릭</li></ul>
          처음 실행하면 가상환경과 필요한 패키지를 자동 설치한 뒤 브라우저가 열립니다(1~2분).</li>
        <li>열린 화면에서 <b>⚙️ 초기 설정</b>으로 이동해 API 키를 입력합니다(다음 단계).</li>
        <li><b>🎨 이미지 생성</b>에서 프롬프트와 모델을 고르고 생성합니다.</li>
      </ol>
      <div class="note">이 프로그램은 <b>내 컴퓨터에서만</b> 실행됩니다(127.0.0.1). 종료는 실행 창에서 <code>Ctrl+C</code>. 키 없이 화면만 둘러보려면 초기 설정에서 <b>데모 모드</b>를 켜세요(요금 없음).</div>`)}

    ${section("keys", "2. API 키 준비", `
      <p>모델은 3개 제공사에서 나옵니다. <b>쓰고 싶은 곳의 키만</b> 있으면 됩니다. 키는 <b>⚙️ 초기 설정</b>에 붙여넣고 <b>키 확인 → 저장</b>하면 로컬 <code>.env</code> 파일에 저장되어, 다음에 실행해도 유지됩니다.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>제공사</th><th>모델</th><th>키 발급</th></tr></thead><tbody>
        <tr><td>OpenAI</td><td>GPT Image 2.5 Sunburst / Flare / GPT Image 2</td><td><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com/api-keys</a></td></tr>
        <tr><td>Google</td><td>Nano Banana 2</td><td><a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></td></tr>
        <tr><td>Black Forest Labs</td><td>FLUX.2 Max / Pro / Flex</td><td><a href="https://dashboard.bfl.ai" target="_blank" rel="noopener">dashboard.bfl.ai</a></td></tr>
      </tbody></table></div>
      <p>세 곳 모두 <b>크레딧 충전(결제수단 등록)</b>이 있어야 이미지가 생성됩니다. 자세한 발급 단계는 초기 설정 화면의 “📖 API 키 발급 방법”에 있습니다. <button class="btn sm" data-go="setup">초기 설정으로 이동 →</button></p>
      <div class="note warn">⚠ API 요금은 키 소유자에게 청구됩니다. 각 제공사 대시보드에서 <b>월 사용 한도</b>를 설정해 두세요. 키가 노출됐다면 즉시 폐기(Revoke)하고 새로 발급하세요. <code>.env</code> 파일은 절대 공유하지 마세요.</div>`)}

    ${section("pages", "3. 페이지별 사용법", `
      <h4>🎨 이미지 생성</h4>
      <ol>
        <li>프롬프트 입력 (아래 “프롬프트 가이드” 참고)</li>
        <li><b>모델을 1개 이상 선택</b> — 여러 개를 고르면 같은 프롬프트로 만든 결과가 모델별 열로 나란히 표시되어 비교할 수 있습니다. 모델 카드에는 <b>장당 예상 가격</b>과 장단점이 표시됩니다.</li>
        <li><b>모델별 생성 장수</b>를 정합니다(모델마다 같은 장수).</li>
        <li>크기: <b>비율 + 해상도</b> 또는 <b>인쇄 크기(mm) + DPI</b>. 프리셋 버튼을 누르거나 값을 <b>직접 입력</b>할 수 있습니다. 인쇄 크기를 쓰면 필요한 픽셀을 계산하고, 파일에 mm 크기에 맞는 DPI를 기록하며, 모델 카드에 <b>예상 실제 DPI</b>를 보여줍니다.
          <div class="table-wrap"><table class="table compact"><thead><tr><th>입력칸</th><th>입력 가능 범위</th></tr></thead><tbody>
            <tr><td>비율 (가로 : 세로)</td><td>각각 0.1 ~ 100 (소수 가능), 가로:세로는 1:20 ~ 20:1 이내</td></tr>
            <tr><td>해상도 직접 입력 (긴 변)</td><td>256 ~ 4096px (모델 상한을 넘으면 자동으로 줄어듦)</td></tr>
            <tr><td>인쇄 가로 · 세로</td><td>각각 5 ~ 2000mm, 가로:세로는 1:20 ~ 20:1 이내</td></tr>
            <tr><td>DPI</td><td>72 ~ 1200</td></tr>
          </tbody></table></div>
          범위를 벗어나면 입력칸이 빨갛게 바뀌고 생성이 막힙니다. 모델이 지원하지 않는 비율(GPT는 3:1 초과, Nano Banana 2는 고정 비율 10종 밖)은 가장 가까운 값으로 만든 뒤 요청한 비율로 잘라 맞추며, 그만큼 해상도가 줄어듭니다.</li>
        <li>품질(GPT Image 계열), 투명 배경 여부를 정하고 <b>이미지 생성</b>.</li>
        <li>마음에 드는 결과에서 <b>💾 저장</b> — 저장한 이미지만 영구 보관됩니다. 저장하지 않은 후보는 3일 후 자동 삭제됩니다. <b>⬇ 다운로드</b>는 '다른 이름으로 저장'처럼 파일 저장 창에서 위치와 이름을 직접 정합니다(Chrome·Edge. 다른 브라우저는 이름만 묻고 저장 위치는 브라우저 설정을 따릅니다). 🔍를 누르면 휠로 확대·축소하고 드래그로 이동하는 뷰어가 열립니다.</li>
      </ol>
      <h4>✏️ 이미지 수정</h4>
      <ol>
        <li>수정할 이미지를 첨부합니다. (생성 결과/갤러리의 <b>✏️ 수정</b> 버튼으로도 보낼 수 있어요)</li>
        <li><b>브러시로 바꿀 부분을 칠합니다.</b> 칠하지 않으면 전체를 수정합니다. 지우개·되돌리기를 쓸 수 있습니다.</li>
        <li>바꿀 내용을 프롬프트로 입력하고 모델을 고릅니다(복수 선택 가능).</li>
        <li><b>GPT Image 계열</b>은 칠한 영역을 마스크로 직접 사용합니다. <b>Nano Banana 2 / FLUX.2</b>는 마스크 기능이 없어, 수정 영역을 붉게 표시한 안내 이미지를 함께 보내 프롬프트로 처리합니다.</li>
        <li>“칠한 영역 밖은 원본 그대로 유지”를 켜면 결과의 바깥쪽을 원본 픽셀로 되돌려 합성하므로, 모델이 다른 곳을 건드려도 보호됩니다.</li>
        <li>참고 이미지(스타일/소품)를 추가로 올릴 수 있습니다. 모델별 최대 개수는 다릅니다.</li>
        <li>오른쪽 <b>🕘 수정 기록</b> 막대에 지금까지의 수정이 쌓입니다. 항목을 클릭하면 그때의 <b>원본 이미지·칠한 마스크·프롬프트·모델·옵션·결과</b>가 그대로 복원되어, 프롬프트만 바꿔 다시 실행하거나 결과를 이어서 수정할 수 있습니다. 막대는 <b>🕘 수정 기록</b> 버튼으로 접을 수 있고, ✕로 개별 삭제·전체 삭제를 할 수 있습니다(최대 200건 보관).</li>
      </ol>
      <h4>🖼 저장한 이미지</h4><p>저장 폴더(<code>saved_images/</code>)의 파일을 모아 보여줍니다. 이미지를 클릭하면 <b>확대·축소·이동</b>이 되는 미리보기가 열립니다(휠: 확대/축소, 드래그: 이동, 더블클릭: 맞춤↔100%). 폴더 열기, 다른 이름으로 저장, 프롬프트 재사용, 수정으로 보내기를 지원합니다.</p>
      <h4>💰 가격·사용량</h4><p>오늘/이번 달/누적 비용, 제공사·모델별 사용량, 일별 그래프, 모델별 가격표를 보여줍니다. <b>청구 금액 요약</b>에서는 월을 골라 OpenAI·Google·BFL 금액과 <b>합산</b>을 확인합니다. OpenAI는 Admin 키가 있으면 공식 청구 금액을 가져오고, BFL·Google은 지출 조회 API가 없어 앱 기록을 쓰거나 각 사이트에서 확인한 금액을 <b>직접 입력</b>할 수 있습니다. 금액 옆 배지로 어떤 기준의 금액인지 구분합니다.</p>`)}

    ${section("prompt", "4. 프롬프트 가이드 (수준별)", `
      <p>자신의 수준에 맞는 탭부터 시작하세요. 예시 옆 <b>“이미지 생성에 적용”</b>을 누르면 프롬프트가 입력칸에 들어갑니다. 한국어도 잘 이해하지만, 모델에 따라 영어가 더 정확할 때가 있어 결과가 아쉬우면 영어로도 시도해 보세요.</p>
      <div class="tabs" id="levelTabs">${Object.entries(PROMPT_LEVELS).map(([k, L]) => `<button class="tab" data-l="${k}">${L.name}</button>`).join("")}</div>
      <div id="levelBody"></div>`)}

    ${section("uv", "5. UV프린트용 이미지 팁", `
      <ul>
        <li><b>투명 배경 = 누끼 형태?</b> 결과는 배경이 투명한 PNG(알파 채널)라서 피사체만 오려낸 누끼처럼 쓸 수 있습니다. 다만 완성된 그림에서 배경을 잘라내는 후처리가 아니라, <b>모델이 처음부터 투명 배경으로 그려주는 방식</b>입니다. 그래서 가장자리가 완벽하지 않거나, 그림자·빛 번짐이 반투명 픽셀로 남을 수 있습니다. 프롬프트에 “isolated subject, clean edges, no shadow, transparent background(깔끔한 외곽, 그림자 없음)”를 함께 쓰고, 결과를 체커보드 위에서 확인한 뒤 인쇄하세요.</li>
        <li><b>투명 배경 PNG</b>: 생성 옵션의 “투명 배경 PNG”는 <b>지원하는 모델에서만</b> 동작합니다(현재 GPT Image 2.5 Sunburst / Flare). 프롬프트에도 “transparent background / 투명 배경”을 함께 적으면 안정적입니다. 지원하지 않는 모델은 일반 배경으로 만들어집니다.</li>
        <li><b>해상도(DPI)</b>: 필요한 픽셀 = 크기(mm) ÷ 25.4 × DPI. 인쇄 크기 모드에서 자동 계산됩니다. 모델의 최대 해상도보다 크면 실제 DPI가 낮아지고, 결과 카드에 <b>실제 DPI</b>가 표시됩니다. (큰 인쇄물은 보는 거리가 멀어 150~200DPI로도 충분한 경우가 많습니다.)</li>
        <li><b>선 굵기</b>: 가는 선과 작은 글자는 인쇄에서 뭉개지기 쉬우므로 프롬프트에서 “굵은 외곽선, 단순한 형태”를 요청하세요.</li>
        <li><b>여백</b>: 가장자리가 잘릴 수 있으니 “피사체가 화면의 70~80%, 가장자리 여백” 같이 명시하세요.</li>
        <li><b>흰색 잉크·바니시 레이어</b>와 색상 모드 변환(RGB→CMYK)은 보통 인쇄 소프트웨어(RIP)에서 처리합니다. 장비마다 요구 사항이 다르니 <b>인쇄소/장비 가이드를 먼저 확인</b>하세요.</li>
        <li>글자는 AI가 틀리게 그릴 수 있습니다. 중요한 문구는 결과를 꼭 확인하거나 편집 프로그램에서 직접 올리는 것을 권장합니다.</li>
      </ul>
      <h4>인쇄 크기별 필요 픽셀 (300DPI)</h4>
      <div class="table-wrap"><table class="table"><thead><tr><th>용도(예시)</th><th>크기(mm)</th><th class="num">필요 픽셀</th><th class="num">메가픽셀</th></tr></thead><tbody>
        ${PRINT_SIZES.map(([n, w, h]) => { const pw = Math.round(w / 25.4 * 300), ph = Math.round(h / 25.4 * 300); return `<tr><td>${n}</td><td>${w}×${h}</td><td class="num">${pw}×${ph}</td><td class="num">${(pw * ph / 1e6).toFixed(1)}</td></tr>`; }).join("")}
      </tbody></table></div>`)}

    ${section("models", "6. 모델 비교", `
      <div class="table-wrap"><table class="table"><thead><tr><th>모델</th><th>특징</th><th>장점</th><th>단점</th><th>투명</th><th>마스크 수정</th></tr></thead><tbody>
        ${c.models.map((m) => `<tr><td><b>${esc(m.label)}</b></td><td class="wrap">${esc(m.tagline)}</td><td class="wrap"><ul style="margin:0;padding-left:16px">${m.pros.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></td>
          <td class="wrap"><ul style="margin:0;padding-left:16px">${m.cons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></td><td>${m.transparent ? "✓" : "—"}</td><td>${m.mask ? "✓" : "프롬프트"}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="note">장단점은 제공사 공개 정보와 일반적인 평가를 요약한 것입니다. 실제 체감은 프롬프트에 따라 달라지므로, 같은 프롬프트로 여러 모델을 함께 돌려 직접 비교해 보세요.</div>`)}

    ${section("cost", "7. 비용 이해하기", `
      <ul>
        <li><b>GPT Image</b>: 토큰 기반 과금. 품질(low~max)과 해상도가 높을수록 비쌉니다. 품질을 한 단계 낮추면 가격이 몇 배 줄어들기도 합니다.</li>
        <li><b>Nano Banana 2</b>: 해상도 단계(1K/2K/4K)별 장당 고정 가격.</li>
        <li><b>FLUX.2</b>: 출력 메가픽셀(MP) 기반. 모델별로 첫 1MP와 추가 MP 단가가 다릅니다.</li>
        <li>화면의 <b>예상 가격은 표 단가 기준 추정치</b>입니다(<code>app/pricing.json</code>에서 수정 가능). 실제 비용은 가능한 경우(OpenAI 토큰, BFL credit) 응답값으로 다시 계산해 기록합니다.</li>
        <li>수정 시에는 입력 이미지/참고 이미지 비용이 추가됩니다. 실패하거나 안전 정책으로 차단된 요청은 과금되지 않는 것이 일반적이지만 제공사 정책을 확인하세요.</li>
      </ul>
      <button class="btn sm" data-go="usage">가격·사용량 보기 →</button>`)}

    ${section("faq", "8. 자주 묻는 질문 · 문제 해결", `
      <details class="guide"><summary>브라우저가 안 열려요 / 포트가 사용 중이에요</summary><p><code>http://127.0.0.1:8100</code>을 직접 여세요. 포트 충돌이면 <code>.env</code>의 <code>PORT</code>를 바꾸고 다시 실행합니다.</p></details>
      <details class="guide"><summary>${isWin ? "Windows에서 python을 찾을 수 없다고 나와요" : "python3를 찾을 수 없다고 나와요"}</summary><p>Python 3.10 이상을 설치하세요. Windows는 설치 시 “Add python.exe to PATH” 체크가 필요합니다. 설치 후 창을 닫고 다시 실행합니다.</p></details>
      <details class="guide"><summary>키 확인은 되는데 생성이 실패해요</summary><p>① 크레딧/결제 상태, ② (OpenAI) 조직 인증 필요 여부, ③ (Google) 프로젝트에 결제 연결 여부, ④ 프롬프트가 안전 정책에 걸렸는지 확인하세요. 오류 메시지는 결과 칸에 그대로 표시됩니다.</p></details>
      <details class="guide"><summary>투명 배경이 안 나와요</summary><p>투명 배경은 GPT Image 2.5 Sunburst / Flare에서만 지원합니다. 프롬프트에 “transparent background”를 함께 적고, 저장 형식이 PNG인지 확인하세요.</p></details>
      <details class="guide"><summary>이미지가 사라졌어요</summary><p>💾 저장하지 않은 후보는 3일 뒤 삭제됩니다. 저장한 이미지는 <code>saved_images/</code> 폴더에 있습니다.</p></details>
      <details class="guide"><summary>새 버전으로 업데이트하려면?</summary><p>폴더에서 <code>git pull</code> 후 다시 실행하면 됩니다. <code>.env</code>와 저장한 이미지는 git에 포함되지 않아 그대로 유지됩니다.</p></details>`)}
  `;

  $$("#tutorialContent [data-to]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); document.getElementById(a.dataset.to).scrollIntoView({ behavior: "smooth", block: "start" }); }));
  $$("#tutorialContent [data-go]").forEach((b) => (b.onclick = () => switchView(b.dataset.go)));
  $$("#levelTabs .tab").forEach((t) => (t.onclick = () => { tutLevel = t.dataset.l; ls.set("tutLevel", tutLevel); renderLevel(); }));
  renderLevel();
}
