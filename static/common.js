/* 공통 유틸 / 모델 선택기 / 결과 보드 (vanilla JS) */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const state = { config: null };

async function api(path, opts = {}) {
  const init = { ...opts };
  if (opts.json !== undefined) {
    init.body = JSON.stringify(opts.json);
    init.method = init.method || "POST";
    init.headers = { "Content-Type": "application/json" };
  }
  const res = await fetch(path, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const d = body?.detail;
    throw new Error(typeof d === "string" ? d : d ? JSON.stringify(d) : `요청 실패 (HTTP ${res.status})`);
  }
  return body ?? {};
}

window.addEventListener("unhandledrejection", (e) => {
  toast(`⚠️ ${e.reason?.message || e.reason}`, 5000);
  console.error(e.reason);
});

let toastTimer;
function toast(msg, ms = 2600) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

const fmtUsd = (v) => "$" + (v || 0).toFixed((v || 0) >= 1 ? 2 : (v || 0) >= 0.01 ? 3 : 4);
const fmtKrw = (v) => "₩" + Math.round((v || 0) * (state.config?.usd_krw || 1400)).toLocaleString();
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 무시 */ } },
};

function openModal(title, html) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $("#modal").hidden = false;
}
$("#modalClose").onclick = () => ($("#modal").hidden = true);
$("#modal").onclick = (e) => { if (e.target.id === "modal") $("#modal").hidden = true; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#modal").hidden = true; });

const VIEWS = { tutorial: () => renderTutorial(), setup: () => renderSetup(), gallery: () => renderGallery(), usage: () => renderUsage() };
function switchView(name) {
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  $$(".view").forEach((v) => (v.hidden = v.id !== `view-${name}`));
  VIEWS[name]?.();
  ls.set("lastView", name);
}
$$(".nav-btn").forEach((b) => (b.onclick = () => switchView(b.dataset.view)));
$("#costPill").onclick = () => switchView("usage");
$("#bannerSetup").onclick = () => switchView("setup");

async function loadConfig() {
  state.config = await api("/api/config");
  const c = state.config;
  $("#keyBanner").hidden = c.any_key;
  $("#setupDot").hidden = c.any_key;
  $("#demoPill").hidden = !c.demo_mode;
  refreshCostPill(c.usage);
  return c;
}
function refreshCostPill(u) {
  const pill = $("#costPill");
  pill.innerHTML = `오늘 ${fmtUsd(u.today_usd)}<br/>이번 달 ${fmtUsd(u.month_usd)}`;
  pill.classList.toggle("over", !!u.budget_exceeded);
}
async function refreshBrief() { refreshCostPill(await api("/api/usage/brief")); }
const modelById = (id) => state.config.models.find((m) => m.id === id);

/* ---------------- 모델 선택기 (복수 선택) ---------------- */
function createModelPicker(host, { storeKey, onChange }) {
  const saved = ls.get(storeKey, null);
  const sel = new Set(saved || ["gpt-image-2.5-flare", "nano-banana-2"]);
  const prices = {};
  function render() {
    host.innerHTML = state.config.models.map((m) => {
      const on = sel.has(m.id) && m.usable;
      const p = prices[m.id];
      const badges = [
        m.transparent ? `<span class="badge ok">투명 PNG</span>` : "",
        m.mask ? `<span class="badge acc">마스크 수정</span>` : "",
        !m.key_ok && !state.config.demo_mode ? `<span class="badge warn">키 필요</span>` : "",
      ].join("");
      return `<label class="mcard ${on ? "sel" : ""} ${m.usable ? "" : "off"}" data-id="${m.id}">
        <div class="top"><input type="checkbox" ${on ? "checked" : ""} ${m.usable ? "" : "disabled"} />
          <span class="nm">${esc(m.label)}</span><span class="pr">${p ? `${fmtUsd(p.per_image_usd)}${p.approx ? "~" : ""}/장` : ""}</span></div>
        <div class="tg">${esc(m.tagline)}</div>
        <div class="bd">${badges}</div>
        <details><summary>장단점 · 사이즈</summary>
          <ul>${m.pros.map((x) => `<li>👍 ${esc(x)}</li>`).join("")}${m.cons.map((x) => `<li>👎 ${esc(x)}</li>`).join("")}</ul>
          ${p ? `<div>출력 크기: ${p.width}×${p.height}px${p.approx ? " (대략, Gemini는 단계별 고정)" : ""}</div>` : ""}
        </details>
      </label>`;
    }).join("");
    $$(".mcard", host).forEach((card) => {
      const cb = $("input", card);
      cb.onchange = () => {
        cb.checked ? sel.add(card.dataset.id) : sel.delete(card.dataset.id);
        ls.set(storeKey, [...sel]);
        render();
        onChange?.();
      };
      $("details", card).onclick = (e) => e.stopPropagation();
    });
  }
  return {
    render,
    ids: () => state.config.models.filter((m) => sel.has(m.id) && m.usable).map((m) => m.id),
    setPrices(list) { for (const k in prices) delete prices[k]; list.forEach((e) => (prices[e.id] = e)); render(); },
  };
}

/* 품질 select 채우기: 선택된 모델 중 지원하는 품질의 합집합 */
function fillQuality(selectEl, boxEl, ids) {
  const ms = ids.map(modelById).filter((m) => m.qualities.length);
  boxEl.hidden = !ms.length;
  const all = ["low", "medium", "high", "xhigh", "max"].filter((q) => ms.some((m) => m.qualities.includes(q)));
  const prev = selectEl.value || ls.get(selectEl.id, "high");
  const names = { low: "low — 가장 저렴·빠름", medium: "medium — 균형", high: "high — 고품질", xhigh: "xhigh — 최고 (2.5 시리즈만)", max: "max — 최대 (2.5 시리즈만)" };
  selectEl.innerHTML = all.map((q) => `<option value="${q}">${names[q]}</option>`).join("");
  selectEl.value = all.includes(prev) ? prev : all.includes("high") ? "high" : all[0] || "";
}

/* 투명 배경 안내: 선택한 모델 중 지원 모델만 */
function transparentHint(el, ids) {
  const ms = ids.map(modelById);
  const ok = ms.filter((m) => m.transparent).map((m) => m.label);
  const no = ms.filter((m) => !m.transparent).map((m) => m.label);
  el.textContent = !ms.length ? "" : ok.length ? `지원: ${ok.join(", ")}${no.length ? ` / 미지원(일반 배경으로 생성): ${no.join(", ")}` : ""}` : "선택한 모델은 모두 투명 배경 미지원";
}

/* ---------------- 결과 보드 ---------------- */
function createBoard(host, { onEmptyChange } = {}) {
  host.className = "board";
  const cols = new Map();
  const changed = () => onEmptyChange?.(cols.size === 0);

  function column(modelId, label) {
    const el = document.createElement("div");
    el.className = "mcol";
    el.innerHTML = `<div class="mcol-head"><span class="nm">${esc(label)}</span><span class="meta"></span></div><div class="body"></div>`;
    host.prepend(el);
    cols.set(el, true);
    changed();
    return {
      loading(text) { $(".body", el).innerHTML = `<div class="loading"><span class="spinner"></span>${esc(text || "생성 중...")}</div>`; },
      fail(msg) { $(".body", el).innerHTML = `<div class="err">${esc(msg)}</div>`; },
      done(data) {
        $(".meta", el).innerHTML = `${data.images.length}장 · ${fmtUsd(data.cost_usd)}${state.config.demo_mode ? " (데모)" : ""}`;
        const body = $(".body", el);
        body.innerHTML = [
          ...data.notes.map((n) => `<div class="note warn">${esc(n)}</div>`),
          ...data.errors.map((e) => `<div class="err">${esc(e)}</div>`),
        ].join("");
        data.images.forEach((img) => body.appendChild(imageCard(img, () => { el.querySelector(`[data-iid="${img.id}"]`)?.remove(); })));
      },
      remove() { el.remove(); cols.delete(el); changed(); },
      el,
    };
  }
  return {
    column,
    clear() { host.innerHTML = ""; cols.clear(); changed(); },
  };
}

function imageCard(img, onRemove) {
  const el = document.createElement("div");
  el.className = "icard";
  el.dataset.iid = img.id;
  const dpi = img.dpi ? ` · ${img.dpi} DPI${img.dpi < 200 ? " ⚠ 낮음" : ""}` : "";
  el.innerHTML = `
    <div class="imgbox"><img src="${img.url}" alt="" loading="lazy" /></div>
    <div class="info"><span>${img.width}×${img.height}px${dpi}</span><span>${img.ext.toUpperCase()}</span>
      ${img.transparent ? `<span class="badge ok">투명 배경</span>` : ""}<span>${img.basis === "demo" ? "데모" : fmtUsd(img.cost_usd) + (img.basis === "actual" ? " (실측)" : " (추정)")}</span></div>
    <div class="acts">
      <button class="btn sm primary" data-a="save">💾 저장</button>
      <a class="btn sm" href="${img.url}" download="${esc(img.model)}_${img.id}.${img.ext}">⬇ 다운로드</a>
      <button class="btn sm" data-a="zoom">🔍</button>
      <button class="btn sm" data-a="edit">✏️ 수정</button>
      <button class="btn sm ghost danger" data-a="del">✕</button>
    </div>`;
  $("[data-a=zoom]", el).onclick = $("img", el).onclick = () =>
    openModal(`${img.label} · ${img.width}×${img.height}`, `<div class="checker" style="border-radius:8px"><img src="${img.url}" /></div><pre class="prompt">${esc(img.prompt)}</pre>`);
  $("[data-a=save]", el).onclick = async (e) => {
    const b = e.currentTarget;
    const r = await api("/api/images/save", { json: { id: img.id } });
    b.textContent = "✓ 저장됨";
    b.disabled = true;
    toast(r.already ? "이미 저장된 이미지입니다." : `저장했습니다: ${r.filename}`);
  };
  $("[data-a=edit]", el).onclick = () => sendToEdit(img.url, `${img.model}_${img.id}.${img.ext}`);
  $("[data-a=del]", el).onclick = async () => {
    await api(`/api/temp/${img.id}`, { method: "DELETE" }).catch(() => {});
    onRemove?.();
  };
  return el;
}

/* 견적 요청 (생성/수정 공통) */
async function fetchEstimates(payload) {
  if (!payload.models.length) return [];
  const r = await api("/api/estimate", { json: payload });
  return r.estimates;
}
function estimateSummary(boxEl, estimates, n) {
  if (!estimates.length) { boxEl.innerHTML = "모델을 하나 이상 선택하세요."; return; }
  const total = estimates.reduce((s, e) => s + e.per_image_usd * n, 0);
  boxEl.innerHTML = `예상 총 비용 <b>${fmtUsd(total)}</b> (${fmtKrw(total)}) · 모델 ${estimates.length}개 × ${n}장
    <div class="hint" style="margin-top:4px">장당 가격은 표 단가 기준 <b>예상치</b>입니다. 실제 비용은 가능한 경우 API 응답으로 다시 계산해 '가격·사용량'에 기록됩니다.</div>`;
}
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
