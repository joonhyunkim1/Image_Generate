/* 이미지 수정 페이지: 이미지 첨부 + 브러시 마스크 + 프롬프트 */
const ed = { file: null, refs: [], picker: null, board: null, busy: false, tool: "brush", drawing: false, undo: [], maskScale: 1 };
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

function loadEditFile(file) {
  if (!/^image\//.test(file.type)) return toast("이미지 파일을 선택하세요.");
  ed.file = file;
  const img = new Image();
  img.onload = () => {
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
    updateEditInfo();
    refreshEditEstimate();
    URL.revokeObjectURL(img.src);
  };
  img.src = URL.createObjectURL(file);
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
  await Promise.all(ids.map(async (id) => {
    const m = modelById(id);
    const col = ed.board.column(id, m.label);
    col.loading(`${m.label} 수정 중...`);
    const fd = new FormData();
    fd.append("model", id);
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
}

/* 다른 페이지(생성 결과, 갤러리)에서 이미지를 수정 페이지로 보내기 */
async function sendToEdit(url, name) {
  const blob = await (await fetch(url)).blob();
  switchView("edit");
  loadEditFile(new File([blob], name, { type: blob.type || "image/png" }));
  toast("수정 페이지로 이미지를 보냈습니다.");
}
