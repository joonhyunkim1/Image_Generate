/* 초기 설정: 로컬 .env 편집 (API 키 입력·확인·저장) */
const setupState = { data: null, tests: {} };

const PROVIDER_GUIDE = {
  openai: {
    title: "OpenAI", env: "OPENAI_API_KEY", models: ["GPT Image 2.5 Sunburst", "GPT Image 2.5 Flare", "GPT Image 2"],
    placeholder: "sk-proj-로 시작하는 키", link: "https://platform.openai.com/api-keys",
    steps: [
      `<a href="https://platform.openai.com/" target="_blank" rel="noopener">platform.openai.com</a>에 로그인(또는 가입)합니다. <b>ChatGPT 구독과 API 요금은 별개</b>입니다.`,
      `<a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener">Billing</a>에서 결제수단을 등록하고 <b>크레딧을 충전</b>합니다(최소 $5). 자동 충전은 꺼두는 것을 권장합니다.`,
      `일부 GPT Image 모델은 <a href="https://platform.openai.com/settings/organization/general" target="_blank" rel="noopener">조직 인증(Verify Organization)</a>이 필요할 수 있습니다. 호출 시 인증 요구 오류가 나오면 이 단계를 진행하세요.`,
      `<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">API keys</a> → <b>Create new secret key</b>로 키(<code>sk-proj-…</code>)를 만들고 <b>바로 복사</b>합니다. 창을 닫으면 다시 볼 수 없습니다.`,
      `아래에 붙여넣고 <b>키 확인</b> → 맨 아래 <b>저장</b>.`,
    ],
  },
  gemini: {
    title: "Google (Nano Banana 2)", env: "GEMINI_API_KEY", models: ["Nano Banana 2"],
    placeholder: "AQ.Ab… 또는 AIza…로 시작하는 키", link: "https://aistudio.google.com/apikey",
    steps: [
      `<a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio → API keys</a>에 구글 계정으로 로그인합니다.`,
      `<b>Create API key</b>로 프로젝트를 선택(또는 새로 생성)해 키를 만듭니다. 새로 발급되는 키는 <code>AQ.Ab…</code> 형식이고, 예전 <code>AIza…</code> 키도 입력할 수 있습니다(단, 구글이 2026년 9월부터 AIza 키를 거절할 수 있어 새 키 사용을 권장).`,
      `이미지 생성 모델은 무료 등급에서 제한되거나 막혀 있을 수 있어, 해당 프로젝트에 <b>결제(Billing)를 연결</b>해야 할 수 있습니다. (AI Studio의 프로젝트 화면에서 <i>Set up billing</i>)`,
      `아래에 붙여넣고 <b>키 확인</b> → 맨 아래 <b>저장</b>.`,
    ],
  },
  bfl: {
    title: "Black Forest Labs (FLUX.2)", env: "BFL_API_KEY", models: ["FLUX.2 Max", "FLUX.2 Pro", "FLUX.2 Flex"],
    placeholder: "BFL 대시보드의 API 키", link: "https://dashboard.bfl.ai",
    steps: [
      `<a href="https://dashboard.bfl.ai" target="_blank" rel="noopener">dashboard.bfl.ai</a>에서 가입/로그인합니다.`,
      `<b>Credits</b> 메뉴에서 크레딧을 충전합니다. (1 credit = $0.01, 이미지 크기(메가픽셀)에 따라 차감)`,
      `<b>API</b> 메뉴에서 키를 발급해 복사합니다.`,
      `아래에 붙여넣고 <b>키 확인</b> → 맨 아래 <b>저장</b>.`,
    ],
  },
};

function secretBlock(key, v, placeholder) {
  return `<div class="secret-row">
    <input type="password" data-key="${key}" autocomplete="off" spellcheck="false"
      placeholder="${v.set ? `현재 저장됨: ${esc(v.masked)}  (바꾸려면 새 키 붙여넣기)` : esc(placeholder)}" />
    <button class="btn sm ghost" data-reveal="${key}" title="입력값 보기/숨기기">👁</button></div>`;
}

async function renderSetup() {
  const box = $("#setupContent");
  if (!setupState.data) box.innerHTML = `<span class="spinner"></span>불러오는 중...`;
  const d = (setupState.data = await api("/api/setup"));
  const v = d.values;
  const isWin = state.config.platform === "win32";

  box.innerHTML = `
    <h2>⚙️ 초기 설정</h2>
    <p class="sub">쓰고 싶은 제공사의 키만 입력하면 됩니다. 키가 없는 제공사의 모델은 선택할 수 없고, <b>하나만 있어도 시작</b>할 수 있어요. 저장하면 <code>.env</code> 파일에 기록되고 <b>서버 재시작 없이 바로 적용</b>됩니다.</p>

    <div class="card safe">
      <h3 style="margin-top:0">🔒 입력한 키는 이 PC의 .env 파일에만 저장됩니다</h3>
      <ul>
        <li>이 앱은 <b>내 컴퓨터(127.0.0.1)에서만</b> 실행됩니다. 저장하면 아래 파일에 기록되며 개발자나 다른 서버로 전송되지 않습니다.<br/><code>${esc(d.env_path)}</code></li>
        <li>이미지 생성 요청은 <b>내 PC → 각 제공사(OpenAI/Google/BFL)</b>로 직접 전송됩니다. 중간 서버는 없습니다.</li>
        <li><code>.env</code>는 <code>.gitignore</code>에 포함되어 <b>git push로 올라가지 않습니다.</b> 화면에는 키의 앞뒤 일부만 표시됩니다.</li>
        <li>${isWin ? "Windows에서는 파일 권한(600)을 따로 지정하지 않으므로, 이 폴더를 다른 사람과 공유하지 마세요." : "파일 권한은 본인만 읽을 수 있게(600) 저장됩니다."}</li>
      </ul>
    </div>

    ${Object.entries(PROVIDER_GUIDE).map(([p, g]) => `
      <div class="card" id="prov-${p}">
        <div class="step-head"><h3>${g.title}</h3>
          <span class="badge ${v[g.env].set ? "ok" : "warn"}">${v[g.env].set ? "✓ 설정됨" : "미설정"}</span></div>
        <div class="hint" style="margin-top:2px">사용 가능 모델: ${g.models.map((m) => `<span class="badge acc">${m}</span>`).join(" ")}</div>
        <details class="guide" ${v[g.env].set ? "" : "open"}><summary>📖 API 키 발급 방법</summary><ol>${g.steps.map((s) => `<li>${s}</li>`).join("")}</ol></details>
        ${secretBlock(g.env, v[g.env], g.placeholder)}
        <div class="row" style="margin-top:8px">
          <button class="btn" data-test="${p}">키 확인 (무료)</button>
          ${v[g.env].set ? `<button class="btn ghost danger" data-clear="${g.env}">저장된 키 삭제</button>` : ""}
          <span class="status" id="res-${p}"></span>
        </div>
      </div>`).join("")}

    <div class="card">
      <div class="step-head"><h3>OpenAI Admin 키 <span class="badge">선택</span></h3><span class="badge ${v.OPENAI_ADMIN_KEY.set ? "ok" : ""}">${v.OPENAI_ADMIN_KEY.set ? "✓ 설정됨" : "미설정"}</span></div>
      <p class="sub">'가격·사용량' 페이지에서 OpenAI의 <b>공식 청구 금액</b>을 보려면 필요합니다. 없어도 앱 자체 기록(토큰 기반 실측)은 동작합니다.
        <a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noopener">Admin keys</a>에서 발급(조직 Owner 권한 필요, <code>sk-admin-</code>으로 시작).</p>
      ${secretBlock("OPENAI_ADMIN_KEY", v.OPENAI_ADMIN_KEY, "sk-admin-…")}
      <div class="row" style="margin-top:8px"><button class="btn" id="testAdmin">키 확인</button>
        ${v.OPENAI_ADMIN_KEY.set ? `<button class="btn ghost danger" data-clear="OPENAI_ADMIN_KEY">삭제</button>` : ""}<span class="status" id="res-admin"></span></div>
    </div>

    <div class="card">
      <h3 style="margin-top:0">저장 · 비용 표시</h3>
      <div class="grid2">
        <label>저장 형식
          <select data-key="OUTPUT_FORMAT"><option value="png" ${v.OUTPUT_FORMAT === "png" ? "selected" : ""}>PNG (기본, 투명 배경 가능)</option><option value="jpg" ${v.OUTPUT_FORMAT === "jpg" ? "selected" : ""}>JPG (PNG가 안 될 때만)</option></select>
          <span class="hint-i">투명 배경이 있는 이미지는 JPG 설정이어도 PNG로 저장됩니다.</span></label>
        <label>환율 (원/USD)<input data-key="USD_KRW" type="number" value="${esc(v.USD_KRW)}" /></label>
        <label>월 예산 (USD, 0이면 표시 안 함)<input data-key="MONTHLY_BUDGET_USD" type="number" value="${esc(v.MONTHLY_BUDGET_USD)}" /></label>
        <label class="check" style="align-self:end"><input type="checkbox" data-key="DEMO_MODE" ${v.DEMO_MODE === "true" ? "checked" : ""} /> 데모 모드 <span class="hint-i">API 호출 없이 가짜 이미지로 화면만 체험</span></label>
      </div>
    </div>

    <div class="row" style="position:sticky;bottom:0;background:var(--bg);padding:10px 0">
      <button class="btn primary" id="saveSetup">저장</button><span class="status" id="saveResult"></span>
    </div>`;

  $$("[data-reveal]", box).forEach((b) => (b.onclick = () => {
    const i = $(`input[data-key=${b.dataset.reveal}]`, box);
    i.type = i.type === "password" ? "text" : "password";
  }));
  $$("[data-test]", box).forEach((b) => (b.onclick = () => testKey(b.dataset.test)));
  $("#testAdmin").onclick = async () => {
    const out = $("#res-admin");
    out.innerHTML = `<span class="spinner"></span>`;
    const r = await api("/api/setup/test-admin-key", { json: { key: $("input[data-key=OPENAI_ADMIN_KEY]").value } });
    out.innerHTML = r.ok ? `<span class="badge ok">✓ 유효</span>` : `<span class="err">${esc(r.error)}</span>`;
  };
  $$("[data-clear]", box).forEach((b) => (b.onclick = async () => {
    if (!confirm("저장된 키를 .env에서 삭제할까요?")) return;
    setupState.data = await api("/api/setup", { method: "PUT", json: { values: { [b.dataset.clear]: { __clear__: true } } } });
    await loadConfig();
    renderSetup();
    toast("삭제했습니다.");
  }));
  $("#saveSetup").onclick = saveSetup;
}

async function testKey(p) {
  const g = PROVIDER_GUIDE[p], out = $(`#res-${p}`);
  out.innerHTML = `<span class="spinner"></span>확인 중...`;
  const r = await api("/api/setup/test-key", { json: { provider: p, key: $(`input[data-key=${g.env}]`).value } });
  if (!r.ok) { out.innerHTML = `<span class="err">${esc(r.error)}</span>`; return; }
  let extra = "";
  if (r.models) extra = " · " + Object.entries(r.models).map(([id, ok]) => `${esc(modelById(id)?.label || id)} ${ok ? "✓" : "⚠ 이 키로 사용 불가"}`).join(", ");
  if (r.credits !== undefined && r.credits !== null) extra = ` · 남은 크레딧 ${r.credits} (≈ $${r.usd})`;
  out.innerHTML = `<span class="badge ok">✓ 유효한 키</span><span class="hint-i">${extra}</span>` +
    (r.warning ? `<div class="note warn" style="margin-top:6px">${esc(r.warning)}</div>` : "");
}

async function saveSetup() {
  const values = {};
  $$("#setupContent [data-key]").forEach((el) => {
    values[el.dataset.key] = el.type === "checkbox" ? String(el.checked) : el.value;
  });
  const out = $("#saveResult");
  try {
    setupState.data = await api("/api/setup", { method: "PUT", json: { values } });
    await loadConfig();
    out.innerHTML = `<span class="badge ok">✓ 저장했습니다 (.env 갱신, 즉시 적용)</span>`;
    gen.picker?.render(); ed.picker?.render();
    refreshGenEstimate(); refreshEditEstimate();
    setTimeout(renderSetup, 600);
  } catch (e) { out.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}
