/* 가격·사용량 페이지 */
const PROVIDER_LABEL = { openai: "OpenAI", gemini: "Google (Gemini)", bfl: "Black Forest Labs" };

async function renderUsage() {
  const box = $("#usageContent");
  if (!box.innerHTML) box.innerHTML = `<span class="spinner"></span>불러오는 중...`;
  const [u, pt] = await Promise.all([api("/api/usage"), api("/api/price-table")]);
  const both = (v) => `${fmtUsd(v)} <span class="hint-i">(${fmtKrw(v)})</span>`;
  const budget = u.monthly_budget_usd;
  const pct = budget ? Math.min(100, u.month_usd / budget * 100) : 0;
  const maxCost = Math.max(0, ...u.daily.map((d) => d.cost));
  const byImages = maxCost === 0;  // 비용이 모두 0이면(데모 등) 이미지 수로 막대를 그린다
  const metric = (d) => (byImages ? d.images : d.cost);
  const maxDay = Math.max(1e-9, ...u.daily.map(metric));
  box.innerHTML = `
    <h2>💰 가격·사용량</h2>
    <p class="sub">이 앱으로 만든 이미지의 비용을 기록합니다. OpenAI·BFL은 API 응답의 사용량(토큰/credit)으로 <b>실측</b>하고, Google은 표 단가로 <b>추정</b>합니다. 환율 ${u.usd_krw}원/USD.</p>

    <div class="kpis">
      <div class="kpi"><div class="l">오늘</div><div class="v">${fmtUsd(u.today_usd)}</div><div class="s">${fmtKrw(u.today_usd)}</div></div>
      <div class="kpi"><div class="l">이번 달</div><div class="v">${fmtUsd(u.month_usd)}</div><div class="s">${fmtKrw(u.month_usd)}${budget ? ` · 예산 ${fmtUsd(budget)}의 ${pct.toFixed(0)}%` : ""}</div>
        ${budget ? `<div class="bar ${u.budget_exceeded ? "over" : ""}"><i style="width:${pct}%"></i></div>` : ""}</div>
      <div class="kpi"><div class="l">누적</div><div class="v">${fmtUsd(u.total_usd)}</div><div class="s">${fmtKrw(u.total_usd)}</div></div>
    </div>

    <div class="card">
      <div class="step-head"><h3>🔑 API 키별 사용량 (이번 달)</h3></div>
      <div class="table-wrap"><table class="table"><thead><tr><th>제공사</th><th>키 상태</th><th class="num">요청</th><th class="num">이미지</th><th class="num">비용</th></tr></thead><tbody>
        ${Object.keys(PROVIDER_LABEL).map((p) => {
          const r = u.by_provider.find((x) => x.provider === p) || { calls: 0, images: 0, cost: 0 };
          return `<tr><td>${PROVIDER_LABEL[p]}</td><td>${u.keys[p] ? `<span class="badge ok">설정됨</span>` : `<span class="badge">미설정</span>`}</td>
            <td class="num">${r.calls}</td><td class="num">${r.images || 0}</td><td class="num">${both(r.cost || 0)}</td></tr>`;
        }).join("")}
      </tbody></table></div>
    </div>

    <div class="card" id="billingCard">
      <div class="step-head"><h3>💳 청구 금액 요약 (제공사별 · 합산)</h3>
        <div class="row"><input type="month" id="billMonth" value="${new Date().toISOString().slice(0, 7)}" style="width:auto;margin:0" /><button class="btn sm" id="billBtn">조회</button></div></div>
      <p class="sub">제공사마다 확인할 수 있는 금액의 종류가 달라서, <b>가장 믿을 만한 금액</b>을 골라 합산하고 기준을 배지로 표시합니다.
        우선순위는 <b>직접 입력 &gt; 공식 조회 &gt; 앱 기록(API 응답 실측 &gt; 표 단가 추정)</b>입니다.</p>
      <div id="billingBox" class="hint"><span class="spinner"></span>조회 중...</div>
    </div>

    <div class="card">
      <h3>📈 최근 30일 일별 비용</h3>
      ${u.daily.length ? `<div class="daily">${u.daily.map((d) => `<div class="d" style="height:${Math.max(2, metric(d) / maxDay * 100)}%" title="${d.day} · ${fmtUsd(d.cost)} · ${d.images}장"></div>`).join("")}</div>
        <div class="daily-axis"><span>${u.daily[0].day}</span><span>${byImages ? `비용 기록 없음 — 이미지 수 기준, 최대 ${Math.round(maxDay)}장/일` : `최대 ${fmtUsd(maxDay)}/일`}</span><span>${u.daily[u.daily.length - 1].day}</span></div>` : `<div class="hint">아직 기록이 없습니다.</div>`}
    </div>

    <div class="card">
      <h3>모델별 사용량 (이번 달)</h3>
      <div class="table-wrap"><table class="table"><thead><tr><th>모델</th><th class="num">이미지</th><th class="num">장당 평균</th><th class="num">비용</th><th>산정</th></tr></thead><tbody>
        ${u.by_model.map((m) => {
          const lbl = state.config.models.find((x) => x.id === m.model)?.label || m.model;
          return `<tr><td>${esc(lbl)}</td><td class="num">${m.images}</td><td class="num">${fmtUsd(m.images ? m.cost / m.images : 0)}</td><td class="num">${both(m.cost)}</td>
            <td>${m.actual_cost >= m.cost - 1e-9 && m.cost > 0 ? `<span class="badge ok">실측</span>` : m.cost === 0 ? "" : `<span class="badge">추정 포함</span>`}</td></tr>`;
        }).join("") || `<tr><td colspan="5" class="hint">기록이 없습니다.</td></tr>`}
      </tbody></table></div>
    </div>

    <div class="card">
      <h3>모델별 장당 예상 가격표</h3>
      <p class="sub">정사각형 기준 단가표입니다. 직사각형·큰 해상도는 픽셀 수에 따라 달라지며, 이미지 생성 화면에서 현재 설정 기준 금액이 표시됩니다. 단가는 <code>app/pricing.json</code>에서 고칠 수 있습니다.</p>
      <div class="table-wrap"><table class="table"><thead><tr><th>모델</th><th>기준</th><th>가격 (USD / 장)</th></tr></thead><tbody>
        ${pt.rows.map((r) => `<tr><td>${esc(r.label)}</td><td>${esc(r.unit)}</td><td class="wrap">${r.entries.map((e) => `<span class="badge" style="margin-right:4px">${esc(e.label)} ${fmtUsd(e.usd)}</span>`).join("")}</td></tr>`).join("")}
      </tbody></table></div>
    </div>

    <div class="card">
      <h3>최근 요청 기록</h3>
      <div class="table-wrap"><table class="table"><thead><tr><th>시각</th><th>모델</th><th>구분</th><th class="num">이미지</th><th class="num">비용</th><th>산정</th></tr></thead><tbody>
        ${u.recent.map((r) => `<tr><td>${esc(r.ts.replace("T", " "))}</td><td>${esc(state.config.models.find((x) => x.id === r.model)?.label || r.model)}</td>
          <td>${r.purpose === "edit" ? "수정" : "생성"}</td><td class="num">${r.images}</td><td class="num">${fmtUsd(r.cost_usd)}</td>
          <td>${{ actual: "실측", estimate: "추정", demo: "데모" }[r.basis] || r.basis}</td></tr>`).join("") || `<tr><td colspan="6" class="hint">기록이 없습니다.</td></tr>`}
      </tbody></table></div>
    </div>`;
  $("#billBtn").onclick = () => loadBilling();
  $("#billMonth").onchange = () => loadBilling();
  loadBilling();
}

const BASIS = {
  manual: ["직접 입력", "acc", "청구 화면에서 확인해 직접 입력한 금액"],
  official: ["공식 조회", "ok", "제공사 API로 조회한 청구 금액 (이 앱의 키 기준)"],
  actual: ["API 응답 실측", "ok", "이 앱이 보낸 요청의 응답(토큰/credit)으로 계산한 금액 — 이 앱 밖에서 쓴 금액은 포함되지 않음"],
  estimate: ["앱 추정", "warn", "표 단가로 추정한 금액 — 실제 청구와 다를 수 있음"],
  none: ["기록 없음", "", ""],
};
const PNAME = { openai: "OpenAI", gemini: "Google (Gemini)", bfl: "Black Forest Labs" };

async function loadBilling() {
  const box = $("#billingBox");
  const month = $("#billMonth").value || new Date().toISOString().slice(0, 7);
  box.innerHTML = `<span class="spinner"></span>조회 중... (OpenAI·BFL에 직접 요청하므로 몇 초 걸릴 수 있어요)`;
  let d;
  try { d = await api(`/api/usage/billing?month=${encodeURIComponent(month)}`); } catch (e) { box.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const both = (v) => `${fmtUsd(v)} <span class="hint-i">(${fmtKrw(v)})</span>`;
  const oa = d.openai, bfl = d.bfl;
  const officialCell = (r) => {
    if (r.provider === "openai") {
      if (!oa.available) return `<span class="hint-i">Admin 키 없음</span>`;
      if (oa.error) return `<span class="err" style="display:inline-block">${esc(oa.error)}</span>`;
      return r.official_usd !== null ? both(r.official_usd) : `<span class="hint-i">키 매칭 실패</span>`;
    }
    if (r.provider === "bfl") {
      if (!bfl.available) return `<span class="hint-i">키 없음</span>`;
      if (bfl.error) return `<span class="hint-i">${esc(bfl.error)}</span>`;
      return `<span class="hint-i">지출 조회 API 없음 · 남은 잔액 ${bfl.credits} credit (≈ ${fmtUsd(bfl.usd)})</span>`;
    }
    return `<span class="hint-i">지출 조회 API 없음</span>`;
  };
  box.innerHTML = `
    <div class="table-wrap"><table class="table" id="billTable"><thead><tr>
      <th>제공사</th><th class="num">앱 기록</th><th>공식·제공사 조회</th><th class="num">합산에 쓴 금액</th><th>기준</th><th>직접 입력 (USD)</th></tr></thead><tbody>
      ${d.rows.map((r) => {
        const [lbl, cls, tip] = BASIS[r.basis];
        return `<tr data-p="${r.provider}">
          <td><b>${PNAME[r.provider]}</b>${r.key_set ? "" : ` <span class="badge">키 없음</span>`}</td>
          <td class="num">${both(r.app_usd)}<div class="hint-i">${r.images}장 · ${r.calls}회</div></td>
          <td class="wrap">${officialCell(r)}${r.note ? `<div class="hint-i" style="color:var(--warn)">${esc(r.note)}</div>` : ""}</td>
          <td class="num"><b>${both(r.usd)}</b></td>
          <td>${lbl && r.basis !== "none" ? `<span class="badge ${cls}" title="${esc(tip)}">${lbl}</span>` : `<span class="hint-i">기록 없음</span>`}</td>
          <td><div class="row" style="flex-wrap:nowrap"><input type="number" min="0" max="1000000" step="0.01" placeholder="예) 12.34" value="${r.manual_usd ?? ""}" style="width:92px;margin:0" data-manual="${r.provider}" />
            <button class="btn sm" data-save="${r.provider}">저장</button></div></td></tr>`;
      }).join("")}
      <tr style="font-weight:700"><td>합산 (${esc(d.month)})</td><td class="num">${both(d.total_app_usd)}</td><td></td><td class="num">${both(d.total_usd)}</td>
        <td>${d.basis_mixed ? `<span class="badge warn" title="제공사마다 금액의 기준이 달라 섞여 있습니다">혼합 기준</span>` : ""}</td><td></td></tr>
    </tbody></table></div>
    <ul class="hint" style="padding-left:18px;margin-top:10px">
      <li><b>OpenAI</b>: Admin 키가 있으면 공식 청구 금액을 가져옵니다(${oa.available && !oa.error ? `조직 전체 ${fmtUsd(oa.org_month_usd)}${oa.key_found ? ` · 이 앱의 키 ${fmtUsd(oa.key_month_usd)}` : ""}` : "미설정 또는 오류"}). 하루 단위·UTC 기준이라 수 시간 지연되며, 월 경계는 앱 기록(내 PC 시간)과 조금 다를 수 있습니다.</li>
      <li><b>Black Forest Labs</b>: 지출 금액을 알려주는 API가 없습니다. 이 앱이 받은 응답의 credit(1 credit = $0.01)이 정확한 금액이라 <b>이 앱으로 쓴 금액은 실측</b>입니다. 전체 지출은 <a href="https://dashboard.bfl.ai" target="_blank" rel="noopener">dashboard.bfl.ai</a>에서 확인해 직접 입력하세요.</li>
      <li><b>Google</b>: API 키로는 사용 금액을 조회할 수 없습니다. <a href="${d.gemini.url}" target="_blank" rel="noopener">AI Studio 사용량</a> 또는 Google Cloud 결제 화면에서 확인한 금액을 직접 입력하면 합산에 반영됩니다. 입력하지 않으면 표 단가 추정치를 씁니다.</li>
      <li>직접 입력한 값은 해당 월의 그 제공사 금액으로 <b>우선 적용</b>됩니다. 칸을 비우고 저장하면 삭제됩니다. 이 PC의 앱 데이터에만 저장됩니다.</li>
    </ul>`;
  $$("[data-save]", box).forEach((b) => (b.onclick = async () => {
    const p = b.dataset.save, v = $(`[data-manual=${p}]`, box).value.trim();
    if (v !== "" && !(parseFloat(v) >= 0 && parseFloat(v) <= 1e6)) return toast("금액은 0 ~ 1,000,000 USD 범위로 입력하세요.");
    await api("/api/usage/manual", { method: "PUT", json: { provider: p, month: d.month, usd: v === "" ? null : parseFloat(v) } });
    toast(v === "" ? "직접 입력 값을 삭제했습니다." : "저장했습니다.");
    loadBilling();
  }));
}
