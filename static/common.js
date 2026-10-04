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

function openModal(title, html, { wide = false } = {}) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $(".modal-box").classList.toggle("wide", wide);
  $("#modal").hidden = false;
}
$("#modalClose").onclick = () => ($("#modal").hidden = true);
// 이미지를 드래그하다 모달 바깥에서 손을 떼도 닫히지 않게: 누른 곳과 뗀 곳이 모두 배경일 때만 닫는다
let modalDownOnBackdrop = false;
$("#modal").addEventListener("pointerdown", (e) => (modalDownOnBackdrop = e.target.id === "modal"));
$("#modal").onclick = (e) => { if (e.target.id === "modal" && modalDownOnBackdrop) $("#modal").hidden = true; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#modal").hidden = true; });

/* ---------------- 다른 이름으로 저장 ----------------
 * Chrome/Edge: 파일 저장 창(File System Access API)으로 위치와 이름을 직접 고른다.
 * Safari/Firefox 등 미지원 브라우저: 이름만 물어본 뒤 다운로드한다(저장 위치는 브라우저 설정을 따름). */
async function saveAs(url, suggestedName) {
  const ext = (suggestedName.split(".").pop() || "png").toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : "image/png";
  if (window.showSaveFilePicker) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: mime === "image/png" ? "PNG 이미지" : "JPEG 이미지", accept: { [mime]: ["." + ext] } }],
      });
    } catch (e) {
      if (e.name === "AbortError") return false;  // 사용자가 취소
      throw e;
    }
    const blob = await (await fetch(url)).blob();
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    toast(`저장했습니다: ${handle.name}`);
    return true;
  }
  let name = prompt("저장할 파일 이름을 입력하세요.\n(이 브라우저는 저장 위치 선택 창을 지원하지 않아, 저장 위치는 브라우저의 다운로드 설정을 따릅니다. Chrome·Edge에서는 위치도 고를 수 있어요.)", suggestedName);
  if (!name) return false;
  name = name.replace(/[\\/:*?"<>|]/g, "_").trim();
  if (!name.toLowerCase().endsWith("." + ext)) name += "." + ext;
  const blob = await (await fetch(url)).blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`다운로드했습니다: ${name}`);
  return true;
}

/* ---------------- 이미지 뷰어: 휠 확대/축소 · 드래그 이동 · 더블클릭 맞춤↔100% · 핀치 ---------------- */
function openImageViewer(title, url, footerHtml = "") {
  openModal(title, `
    <div class="viewer" tabindex="0">
      <div class="viewer-bar">
        <button class="btn sm" data-z="out" title="축소 (-)">－</button><span class="zlabel">-</span><button class="btn sm" data-z="in" title="확대 (+)">＋</button>
        <button class="btn sm" data-z="fit" title="화면에 맞춤 (0)">맞춤</button><button class="btn sm" data-z="100" title="원본 크기 (1)">100%</button>
        <span class="hint-i">휠: 확대/축소 · 드래그: 이동 · 더블클릭: 맞춤↔100%</span><span class="hint-i viewer-dim" style="margin-left:auto"></span>
      </div>
      <div class="viewer-stage"><img class="viewer-img checker" draggable="false" alt="" /></div>
    </div>${footerHtml}`, { wide: true });
  const root = $(".viewer"), stage = $(".viewer-stage", root), img = $(".viewer-img", root), label = $(".zlabel", root);
  let s = 1, tx = 0, ty = 0, iw = 0, ih = 0;
  const MIN = 0.02, MAX = 32;
  const apply = () => {
    const cw = stage.clientWidth, ch = stage.clientHeight, keep = 60;  // 이미지가 화면 밖으로 완전히 사라지지 않게 제한
    tx = Math.min(cw - keep, Math.max(keep - iw * s, tx));
    ty = Math.min(ch - keep, Math.max(keep - ih * s, ty));
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
    img.style.imageRendering = s >= 3 ? "pixelated" : "auto";
    label.textContent = Math.round(s * 100) + "%";
    stage.style.cursor = "grab";
  };
  const fit = () => {
    const cw = stage.clientWidth, ch = stage.clientHeight;
    s = Math.min(cw / iw, ch / ih, 1);
    tx = (cw - iw * s) / 2; ty = (ch - ih * s) / 2;
    apply();
  };
  const zoomAt = (factor, cx, cy) => {
    const ns = Math.min(MAX, Math.max(MIN, s * factor)), r = ns / s;
    tx = cx - (cx - tx) * r; ty = cy - (cy - ty) * r; s = ns;
    apply();
  };
  const center = () => [stage.clientWidth / 2, stage.clientHeight / 2];
  const setActual = () => { const [cx, cy] = center(); zoomAt(1 / s, cx, cy); };
  img.onload = () => { iw = img.naturalWidth; ih = img.naturalHeight; $(".viewer-dim", root).textContent = `${iw}×${ih}px`; fit(); root.focus(); };
  img.src = url;

  $$("[data-z]", root).forEach((b) => (b.onclick = () => {
    const [cx, cy] = center(), z = b.dataset.z;
    if (z === "in") zoomAt(1.25, cx, cy); else if (z === "out") zoomAt(1 / 1.25, cx, cy);
    else if (z === "fit") fit(); else setActual();
  }));
  const rect = () => stage.getBoundingClientRect();
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = rect();
    zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  stage.addEventListener("dblclick", (e) => {
    if (Math.abs(s - 1) < 0.01) fit(); else { const r = rect(); zoomAt(1 / s, e.clientX - r.left, e.clientY - r.top); }
  });
  const ptrs = new Map();
  let pinch = 0;
  stage.addEventListener("pointerdown", (e) => {
    stage.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); }
    stage.style.cursor = "grabbing";
  });
  stage.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return;
    const prev = ptrs.get(e.pointerId);
    ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 2) {  // 두 손가락 핀치
      const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), r = rect();
      if (pinch) zoomAt(d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top);
      pinch = d;
    } else {
      tx += e.clientX - prev[0]; ty += e.clientY - prev[1];
      apply(); stage.style.cursor = "grabbing";
    }
  });
  const up = (e) => { ptrs.delete(e.pointerId); pinch = 0; stage.style.cursor = "grab"; };
  stage.addEventListener("pointerup", up);
  stage.addEventListener("pointercancel", up);
  root.addEventListener("keydown", (e) => {
    const [cx, cy] = center();
    if (e.key === "+" || e.key === "=") zoomAt(1.25, cx, cy);
    else if (e.key === "-") zoomAt(1 / 1.25, cx, cy);
    else if (e.key === "0") fit();
    else if (e.key === "1") setActual();
    else if (e.key.startsWith("Arrow")) { const d = 60; tx += e.key === "ArrowLeft" ? d : e.key === "ArrowRight" ? -d : 0; ty += e.key === "ArrowUp" ? d : e.key === "ArrowDown" ? -d : 0; apply(); }
    else return;
    e.preventDefault();
  });
}

const VIEWS = { edit: () => loadHistory(), tutorial: () => renderTutorial(), setup: () => renderSetup(), gallery: () => renderGallery(), usage: () => renderUsage() };
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
        ${p?.est_dpi ? `<div class="dpi ${p.est_dpi < p.target_dpi ? "low" : "ok"}">예상 실제 DPI ${p.approx ? "약 " : ""}${p.est_dpi}${p.est_dpi < p.target_dpi ? ` ⚠ 목표 ${p.target_dpi} 미달 (모델 해상도 한도)` : " ✓"}</div>` : ""}
        ${p?.ratio_note ? `<div class="adj">${esc(p.ratio_note)}</div>` : ""}
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
    select(ids) { sel.clear(); ids.forEach((i) => sel.add(i)); ls.set(storeKey, [...sel]); render(); onChange?.(); },
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
      <button class="btn sm" data-a="saveas" title="다른 이름으로 저장 — 저장 위치와 파일 이름을 직접 정합니다">⬇ 다운로드</button>
      <button class="btn sm" data-a="zoom">🔍</button>
      <button class="btn sm" data-a="edit">✏️ 수정</button>
      <button class="btn sm ghost danger" data-a="del">✕</button>
    </div>`;
  $("[data-a=zoom]", el).onclick = $("img", el).onclick = () =>
    openImageViewer(`${img.label} · ${img.width}×${img.height}`, img.url, `<pre class="prompt">${esc(img.prompt)}</pre>`);
  $("[data-a=saveas]", el).onclick = () => saveAs(img.url, `${img.model}_${img.id}.${img.ext}`);
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
