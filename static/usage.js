/* 가격·사용량 페이지 */
const PROVIDER_LABEL = { openai: "OpenAI", gemini: "Google (Gemini)", bfl: "Black Forest Labs" };

async function renderUsage() {
  const box = $("#usageContent");
  if (!box.innerHTML) box.innerHTML = `<span class="spinner"></span>불러오는 중...`;
  const [u, pt] = await Promise.all([api("/api/usage"), api("/api/price-table")]);
  const both = (v) => `${fmtUsd(v)} <span class="hint-i">(${fmtKrw(v)})</span>`;
  const budget = u.monthly_budget_usd;
  const pct = budget ? Math.min(100, u.month_usd / budget * 100) : 0;
  const maxDay = Math.max(...u.daily.map((d) => d.cost), 0.0001);
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

    <div class="card">
      <div class="step-head"><h3>🏦 공식 청구·잔액 확인</h3><button class="btn sm" id="officialBtn">조회</button></div>
      <p class="sub">앱 기록과 별개로 제공사에서 직접 가져온 금액입니다. 조회 버튼을 누르면 각 제공사에 키로 요청합니다(과금 없음).</p>
      <div id="officialBox" class="hint">조회 버튼을 눌러주세요.</div>
    </div>

    <div class="card">
      <h3>📈 최근 30일 일별 비용</h3>
      ${u.daily.length ? `<div class="daily">${u.daily.map((d) => `<div class="d" style="height:${Math.max(2, d.cost / maxDay * 100)}%" title="${d.day} · ${fmtUsd(d.cost)} · ${d.images}장"></div>`).join("")}</div>
        <div class="daily-axis"><span>${u.daily[0].day}</span><span>최대 ${fmtUsd(maxDay)}/일</span><span>${u.daily[u.daily.length - 1].day}</span></div>` : `<div class="hint">아직 기록이 없습니다.</div>`}
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
  $("#officialBtn").onclick = loadOfficial;
}

async function loadOfficial() {
  const out = $("#officialBox");
  out.innerHTML = `<span class="spinner"></span>조회 중...`;
  const o = await api("/api/usage/official");
  const parts = [];
  const oa = o.openai;
  if (!oa.available) parts.push(`<p><b>OpenAI</b> — Admin 키가 없어 공식 청구 금액을 조회할 수 없습니다. <a href="#" data-go="setup">초기 설정</a>에서 선택 입력하거나, <a href="https://platform.openai.com/settings/organization/usage" target="_blank" rel="noopener">OpenAI Usage 페이지</a>에서 확인하세요.</p>`);
  else if (oa.error) parts.push(`<p><b>OpenAI</b> — <span class="err">${esc(oa.error)}</span></p>`);
  else parts.push(`<p><b>OpenAI</b> 이번 달(UTC) — 조직 전체 <b>${fmtUsd(oa.org_month_usd)}</b>${oa.key_found
    ? ` · 이 앱의 키(${esc(oa.key_name)} / ${esc(oa.key_project)}) <b>${fmtUsd(oa.key_month_usd)}</b>` : ` · 이 앱의 키를 찾지 못해 조직 전체 금액만 표시`}
    <span class="hint-i">(하루 단위, 수 시간 지연될 수 있음)</span>${oa.key_error ? `<br/><span class="err">${esc(oa.key_error)}</span>` : ""}</p>`);
  const b = o.bfl;
  if (!b.available) parts.push(`<p><b>BFL</b> — 키가 설정되지 않았습니다.</p>`);
  else if (b.error) parts.push(`<p><b>BFL</b> — <span class="err">${esc(b.error)}</span></p>`);
  else parts.push(`<p><b>BFL</b> 남은 크레딧 <b>${b.credits}</b> (≈ ${fmtUsd(b.usd)}, 1 credit = $0.01)</p>`);
  parts.push(o.gemini.available
    ? `<p><b>Google</b> — API 키로는 사용량을 조회할 수 없습니다. <a href="${o.gemini.url}" target="_blank" rel="noopener">AI Studio 사용량 페이지</a>에서 확인하세요. (앱 기록은 표 단가 추정치)</p>`
    : `<p><b>Google</b> — 키가 설정되지 않았습니다.</p>`);
  out.innerHTML = parts.join("");
  $$("[data-go]", out).forEach((a) => (a.onclick = (e) => { e.preventDefault(); switchView(a.dataset.go); }));
}
