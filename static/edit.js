/* 이미지 수정 페이지: 이미지 첨부 + 브러시 마스크 + 프롬프트 */
const ed = { file: null, refs: [], picker: null, board: null, busy: false, tool: "brush", drawing: false, undo: [], maskScale: 1, activeRun: null };
const MASK_MAX = 1024;

function initEdit() {
  ed.picker = createModelPicker($("#eModels"), { storeKey: "editModels", onChange: refreshEditEstimate });
  ed.board = createBoard($("#eBoard"));
  const drop = $("#eDrop");
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) loadEditFile(e.dataTransfer.files[0]); };
  $("#eFile").onchange = (e) => e.target.files[0] && loadEditFile(e.target.files[0]);
  $("#eRefs").onchange = (e) => {
    ed.refs.push(...[...e.target.files].slice(0, 6));
    e.target.value = "";
    renderRefs();
    refreshEditEstimate();
  };
  $$("#eTool button").forEach((b) => (b.onclick = () => {
    ed.tool = b.dataset.tool;
    $$("#eTool button").forEach((x) => x.classList.toggle("active", x === b));
  }));
  $("#eUndo").onclick = undoMask;
  $("#eClearMask").onclick = () => { pushUndo(); const c = $("#eMask"); c.getContext("2d").clearRect(0, 0, c.width, c.height); updateEditInfo(); };
  $("#eShowMask").onchange = () => ($("#eMask").style.opacity = $("#eShowMask").checked ? "" : 0);
  $("#eClear").onclick = () => ed.board.clear();
  ["eN", "eTier", "eQuality"].forEach((id) => ($("#" + id).oninput = refreshEditEstimate));
  $("#eGo").onclick = runEdit;
  setupMaskDrawing();
  initHistory();
  ed.picker.render();
  refreshEditEstimate();
}

function renderRefs() {
  const host = $("#eRefThumbs");
  host.innerHTML = "";
  ed.refs.forEach((f, i) => {
    const d = document.createElement("div");
    d.className = "th";
    d.innerHTML = `<img src="${URL.createObjectURL(f)}" title="${esc(f.name)}" /><button class="x">×</button>`;
    $(".x", d).onclick = () => { ed.refs.splice(i, 1); renderRefs(); refreshEditEstimate(); };
    host.appendChild(d);
  });
}

function loadEditFile(file, { maskUrl = null } = {}) {
  if (!/^image\//.test(file.type)) { toast("이미지 파일을 선택하세요."); return Promise.resolve(false); }
  ed.file = file;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = async () => {
      const base = $("#eBase"), mask = $("#eMask");
      base.width = img.naturalWidth; base.height = img.naturalHeight;
      base.getContext("2d").drawImage(img, 0, 0);
      ed.maskScale = Math.min(1, MASK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
      mask.width = Math.round(img.naturalWidth * ed.maskScale);
      mask.height = Math.round(img.naturalHeight * ed.maskScale);
      ed.undo = [];
      $("#eEmpty").hidden = true;
      $("#eEditor").hidden = false;
      $("#eCanvasWrap").style.width = `min(${Math.min(img.naturalWidth, 760)}px, 100%)`;
      $("#eDrop").querySelector("b").textContent = `✓ ${file.name}`;
      URL.revokeObjectURL(img.src);
      if (maskUrl) {  // 기록에서 불러온 마스크를 캔버스에 다시 그린다
        try {
          const m = new Image();
          await new Promise((res, rej) => { m.onload = res; m.onerror = rej; m.src = maskUrl; });
          mask.getContext("2d").drawImage(m, 0, 0, mask.width, mask.height);
        } catch { toast("저장된 마스크를 불러오지 못했습니다."); }
      }
      updateEditInfo();
      refreshEditEstimate();
      resolve(true);
    };
    img.src = URL.createObjectURL(file);
  });
}

function setupMaskDrawing() {
  const c = $("#eMask");
  const pos = (e) => {
    const r = c.getBoundingClientRect();
    return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height];
  };
  const stroke = (x, y) => {
    const ctx = c.getContext("2d");
    const scale = c.width / c.getBoundingClientRect().width;
    // 지우개는 브러시보다 살짝 크게 — 가장자리 안티앨리어싱 잔상이 남지 않도록
    const size = $("#eBrush").value * scale * (ed.tool === "erase" ? 1.12 : 1) + (ed.tool === "erase" ? 3 : 0);
    ctx.globalCompositeOperation = ed.tool === "erase" ? "destination-out" : "source-over";
    ctx.fillStyle = "rgb(255, 60, 60)";
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
  };
  let last = null;
  c.onpointerdown = (e) => {
    c.setPointerCapture(e.pointerId);
    pushUndo();
    ed.drawing = true;
    last = pos(e);
    stroke(...last);
  };
  c.onpointermove = (e) => {
    if (!ed.drawing) return;
    const p = pos(e);
    // 빠르게 움직여도 끊기지 않도록 두 점 사이를 보간
    const dist = Math.hypot(p[0] - last[0], p[1] - last[1]);
    const steps = Math.max(1, Math.ceil(dist / 3));
    for (let i = 1; i <= steps; i++) stroke(last[0] + (p[0] - last[0]) * i / steps, last[1] + (p[1] - last[1]) * i / steps);
    last = p;
  };
  const end = () => { if (ed.drawing) { ed.drawing = false; updateEditInfo(); } };
  c.onpointerup = end;
  c.onpointercancel = end;
}

function pushUndo() {
  const c = $("#eMask");
  ed.undo.push(c.getContext("2d").getImageData(0, 0, c.width, c.height));
  if (ed.undo.length > 20) ed.undo.shift();
}
function undoMask() {
  const snap = ed.undo.pop();
  if (snap) { $("#eMask").getContext("2d").putImageData(snap, 0, 0); updateEditInfo(); }
}
function maskHasPaint() {
  const c = $("#eMask");
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 24 && ++n >= 30) return true;
  return false;
}
function updateEditInfo() {
  if (!ed.file) return;
  const b = $("#eBase");
  $("#eInfo").textContent = `${b.width}×${b.height}px · ${maskHasPaint() ? "칠한 영역만 수정" : "마스크 없음 → 전체 수정"}`;
}

const refreshEditEstimate = debounce(async () => {
  const ids = ed.picker.ids();
  const n = Math.max(1, +$("#eN").value || 1);
  fillQuality($("#eQuality"), $("#eQualityBox"), ids);
  transparentHint($("#eTransHint"), ids);
  const geom = { mode: "ratio", aspect: ed.file ? Math.min(20, Math.max(0.05, $("#eBase").width / $("#eBase").height)) : 1, tier: $("#eTier").value === "orig" ? "1K" : $("#eTier").value };
  try {
    const est = await fetchEstimates({ models: ids, quality: $("#eQuality").value, geometry: geom, n, edit: true, n_refs: ed.refs.length });
    ed.picker.setPrices(est);
    estimateSummary($("#eEstimate"), est, n);
  } catch (e) { $("#eEstimate").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}, 200);

async function runEdit() {
  if (ed.busy) return;
  if (!ed.file) return toast("수정할 이미지를 먼저 첨부하세요.");
  const prompt = $("#ePrompt").value.trim();
  if (!prompt) return toast("수정할 내용을 입력하세요.");
  const ids = ed.picker.ids();
  if (!ids.length) return toast("모델을 하나 이상 선택하세요.");
  ed.busy = true;
  $("#eGo").disabled = true;
  $("#eGo").textContent = "수정 중...";
  const maskBlob = maskHasPaint() ? await new Promise((r) => $("#eMask").toBlob(r, "image/png")) : null;
  const runId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);  // 이번 수정에 쓴 모델들을 하나의 기록으로 묶는 ID
  await Promise.all(ids.map(async (id) => {
    const m = modelById(id);
    const col = ed.board.column(id, m.label);
    col.loading(`${m.label} 수정 중...`);
    const fd = new FormData();
    fd.append("model", id);
    fd.append("run_id", runId);
    fd.append("prompt", prompt);
    fd.append("n", Math.min(Math.max(1, +$("#eN").value || 1), m.max_n));
    fd.append("quality", $("#eQuality").value || "");
    fd.append("tier", $("#eTier").value);
    fd.append("transparent", $("#eTransparent").checked);
    fd.append("keep_outside", $("#eKeep").checked);
    fd.append("image", ed.file);
    if (maskBlob) fd.append("mask", maskBlob, "mask.png");
    ed.refs.forEach((f) => fd.append("refs", f));
    try { col.done(await api("/api/edit", { method: "POST", body: fd })); } catch (e) { col.fail(e.message); }
  }));
  ed.busy = false;
  $("#eGo").disabled = false;
  $("#eGo").textContent = "✏️ 이미지 수정";
  refreshBrief();
  ed.activeRun = runId;
  loadHistory();
}

/* 다른 페이지(생성 결과, 갤러리)에서 이미지를 수정 페이지로 보내기 */
async function sendToEdit(url, name) {
  const blob = await (await fetch(url)).blob();
  switchView("edit");
  loadEditFile(new File([blob], name, { type: blob.type || "image/png" }));
  toast("수정 페이지로 이미지를 보냈습니다.");
}

/* ---------------- 수정 기록(히스토리) 막대 ---------------- */
const fmtBytes = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + "MB" : Math.max(1, Math.round(b / 1024)) + "KB");
const fmtTs = (ts) => ts.slice(5, 16).replace("T", " ");

async function loadHistory() {
  let d;
  try { d = await api("/api/edit-history"); } catch (e) { $("#hList").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  $("#hInfo").textContent = d.runs.length ? `${d.runs.length}건 · ${fmtBytes(d.total_bytes)} 사용 · 최대 ${d.max_runs}건 보관(넘으면 오래된 것부터 삭제)` : "";
  $("#hClearAll").hidden = !d.runs.length;
  if (!d.runs.length) {
    $("#hList").innerHTML = `<div class="empty-state" style="padding:24px 10px"><p style="margin:0">아직 수정 기록이 없습니다.<br/>이미지를 수정하면 여기에 쌓이고, 클릭하면 그때의 이미지·마스크·설정·결과를 다시 불러옵니다.</p></div>`;
    return;
  }
  $("#hList").innerHTML = "";
  d.runs.forEach((r) => {
    const el = document.createElement("div");
    el.className = "hist-item" + (r.run_id === ed.activeRun ? " active" : "");
    el.title = `${r.prompt}\n\n클릭하면 이 수정을 다시 불러옵니다.`;
    const extra = r.image_count - r.thumbs.length;
    el.innerHTML = `
      <button class="x" title="이 기록 삭제">✕</button>
      <div class="hist-thumbs"><img src="${r.source_thumb}" loading="lazy" alt="원본" /><span class="arrow">→</span>
        ${r.thumbs.slice(0, 3).map((u) => `<img src="${u}" loading="lazy" alt="결과" />`).join("")}${extra > 0 || r.thumbs.length > 3 ? `<span class="more">+${Math.max(extra, 1)}</span>` : ""}</div>
      <div class="hist-prompt">${esc(r.prompt)}</div>
      <div class="hist-meta"><span>${esc(fmtTs(r.ts))}</span><span>${r.models.map((m) => esc(m.label)).join(", ")}</span>
        <span>${r.image_count}장</span>${r.has_mask ? `<span>🖌 마스크</span>` : ""}<span>${state.config.demo_mode ? "데모" : fmtUsd(r.cost_usd)}</span></div>`;
    el.onclick = (e) => { if (!e.target.closest(".x")) restoreHistory(r.run_id); };
    $(".x", el).onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("이 수정 기록을 삭제할까요? 기록에 보관된 원본·결과 이미지가 지워집니다. (저장한 이미지는 영향 없음)")) return;
      await api(`/api/edit-history/${r.run_id}`, { method: "DELETE" });
      if (ed.activeRun === r.run_id) ed.activeRun = null;
      loadHistory();
    };
    $("#hList").appendChild(el);
  });
}

async function restoreHistory(runId) {
  if (ed.busy) return toast("수정이 진행 중입니다. 끝난 뒤 불러오세요.");
  const d = await api(`/api/edit-history/${runId}/restore`, { method: "POST" });
  const blob = await (await fetch(d.source_url)).blob();
  await loadEditFile(new File([blob], `history_${runId}.png`, { type: blob.type || "image/png" }), { maskUrl: d.mask_url });
  const s = d.settings;
  $("#ePrompt").value = s.prompt;
  $("#eN").value = s.n;
  $("#eTier").value = s.tier;
  $("#eTransparent").checked = s.transparent;
  $("#eKeep").checked = s.keep_outside;
  ed.picker.select(s.models.filter((id) => modelById(id)?.usable));
  if (s.quality) { const qs = $("#eQuality"); if ([...qs.options].some((o) => o.value === s.quality)) qs.value = s.quality; }
  ed.board.clear();
  d.columns.forEach((c) => { const col = ed.board.column(c.model, c.label); col.done({ images: c.images, notes: c.notes, errors: c.errors, cost_usd: c.cost_usd }); });
  ed.activeRun = runId;
  loadHistory();
  toast("수정 기록을 불러왔습니다. 프롬프트를 고쳐 다시 실행하거나 결과를 이어서 수정할 수 있어요.");
}

function initHistory() {
  const apply = (open) => { $("#eHistory").hidden = !open; ls.set("histOpen", open); };
  apply(ls.get("histOpen", true));
  $("#hToggle").onclick = () => apply($("#eHistory").hidden);
  $("#hClearAll").onclick = async () => {
    if (!confirm("모든 수정 기록을 삭제할까요? 기록에 보관된 원본·결과 이미지가 모두 지워집니다. (저장한 이미지는 영향 없음)")) return;
    await api("/api/edit-history", { method: "DELETE" });
    ed.activeRun = null;
    loadHistory();
    toast("수정 기록을 모두 삭제했습니다.");
  };
  loadHistory();
}
