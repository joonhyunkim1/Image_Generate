/* 이미지 생성 페이지 */
const gen = { mode: "ratio", picker: null, board: null, busy: false };
const EXAMPLES = [
  ["스티커", "귀여운 시바견 스티커, 굵은 흰색 외곽선, 파스텔 색감, 플랫 일러스트, 투명 배경"],
  ["로고", "미니멀한 커피숍 로고, 원형 엠블럼, 갈색과 크림색 2색, 벡터 스타일, 흰 배경"],
  ["패턴", "열대 식물과 새가 있는 이음새 없는 패턴, 수채화 느낌, 밝은 청록색 팔레트"],
];

// 입력 허용 범위 (서버 app/sizing.py 와 동일하게 유지)
const RANGE = { side: [0.1, 100], ratioMax: 20, edge: [256, 4096], mm: [5, 2000], dpi: [72, 1200] };
const inRange = (v, [lo, hi]) => Number.isFinite(v) && v >= lo && v <= hi;
const num = (id) => parseFloat($("#" + id).value);

/** 입력값 검사. 문제가 있으면 안내 문구를 돌려주고 해당 입력칸을 빨갛게 표시한다. */
function validateGeometry() {
  const bad = [];
  let msg = null;
  const fail = (m, ...ids) => { msg = msg || m; bad.push(...ids); };
  if (gen.mode === "print") {
    if (!inRange(num("gW"), RANGE.mm)) fail("가로(mm)는 5 ~ 2000 범위로 입력하세요.", "gW");
    if (!inRange(num("gH"), RANGE.mm)) fail("세로(mm)는 5 ~ 2000 범위로 입력하세요.", "gH");
    if (!inRange(num("gDpi"), RANGE.dpi)) fail("DPI는 72 ~ 1200 범위로 입력하세요.", "gDpi");
    if (!bad.length) { const r = num("gW") / num("gH"); if (r > RANGE.ratioMax || r < 1 / RANGE.ratioMax) fail("가로:세로 비율은 1:20 ~ 20:1 이내여야 합니다.", "gW", "gH"); }
  } else {
    if (!inRange(num("gAW"), RANGE.side)) fail("비율 가로는 0.1 ~ 100 범위로 입력하세요.", "gAW");
    if (!inRange(num("gAH"), RANGE.side)) fail("비율 세로는 0.1 ~ 100 범위로 입력하세요.", "gAH");
    if (!bad.length) { const r = num("gAW") / num("gAH"); if (r > RANGE.ratioMax || r < 1 / RANGE.ratioMax) fail("가로:세로 비율은 1:20 ~ 20:1 이내여야 합니다.", "gAW", "gAH"); }
    if ($("#gTier").value === "custom" && !inRange(num("gEdge"), RANGE.edge)) fail("긴 변 픽셀은 256 ~ 4096 범위로 입력하세요.", "gEdge");
  }
  ["gAW", "gAH", "gEdge", "gW", "gH", "gDpi"].forEach((id) => $("#" + id).classList.toggle("bad", bad.includes(id)));
  $("#gGeomErr").hidden = !msg;
  $("#gGeomErr").textContent = msg || "";
  return msg;
}

function geometry() {
  if (gen.mode === "print") return { mode: "print", width_mm: num("gW"), height_mm: num("gH"), dpi: num("gDpi") };
  const g = { mode: "ratio", aspect: `${num("gAW")}:${num("gAH")}`, tier: $("#gTier").value };
  if (g.tier === "custom") g.long_edge = num("gEdge");
  return g;
}

/** 프리셋 칩 강조: 입력한 비율과 같은 값의 칩만 활성화 */
function syncAspectChips() {
  const r = num("gAW") / num("gAH");
  $$("#gAspect button").forEach((b) => {
    const [w, h] = b.dataset.a.split(":").map(Number);
    b.classList.toggle("active", Math.abs(w / h - r) < 1e-6);
  });
}
function syncDpiChips() { $$("#gDpiChips button").forEach((b) => b.classList.toggle("active", +b.dataset.d === num("gDpi"))); }

function updatePrintInfo() {
  if (gen.mode !== "print" || validateGeometry()) { if (gen.mode === "print") $("#gPrintInfo").textContent = ""; return; }
  const g = geometry();
  const w = Math.round(g.width_mm / 25.4 * g.dpi), h = Math.round(g.height_mm / 25.4 * g.dpi);
  $("#gPrintInfo").innerHTML = `${g.dpi}DPI 기준 필요 해상도 <b>${w}×${h}px</b> (${(w * h / 1e6).toFixed(1)}MP).<br/>모델 최대 해상도가 이보다 작으면 실제 DPI가 낮아지며, 결과 카드에 <b>실제 DPI</b>가 표시됩니다. 파일에는 지정한 mm 크기에 맞춘 DPI 값이 기록됩니다.`;
}

const refreshGenEstimate = debounce(async () => {
  const ids = gen.picker.ids();
  const n = Math.max(1, +$("#gN").value || 1);
  fillQuality($("#gQuality"), $("#gQualityBox"), ids);
  transparentHint($("#gTransHint"), ids);
  $("#gEdgeBox").hidden = $("#gTier").value !== "custom";
  if (validateGeometry()) { $("#gEstimate").innerHTML = "입력값을 확인하세요. (위 빨간 안내 참고)"; return; }
  updatePrintInfo();
  try {
    const est = await fetchEstimates({ models: ids, quality: $("#gQuality").value, geometry: geometry(), n, edit: false, n_refs: 0 });
    gen.picker.setPrices(est);
    estimateSummary($("#gEstimate"), est, n);
  } catch (e) { $("#gEstimate").innerHTML = `<span class="err">${esc(e.message)}</span>`; }
}, 200);

function initGenerate() {
  gen.picker = createModelPicker($("#gModels"), { storeKey: "genModels", onChange: refreshGenEstimate });
  gen.board = createBoard($("#gBoard"), { onEmptyChange: (empty) => ($("#gEmpty").hidden = !empty) });
  $("#gExamples").innerHTML = EXAMPLES.map(([t], i) => `<button data-i="${i}">예시: ${t}</button>`).join("");
  $$("#gExamples button").forEach((b) => (b.onclick = () => { $("#gPrompt").value = EXAMPLES[b.dataset.i][1]; }));
  $("#gAspect").innerHTML = state.config.aspects.map((a) => `<button data-a="${a}">${a}</button>`).join("");
  $$("#gAspect button").forEach((b) => (b.onclick = () => {
    const [w, h] = b.dataset.a.split(":");
    $("#gAW").value = w; $("#gAH").value = h;
    syncAspectChips();
    refreshGenEstimate();
  }));
  ["gAW", "gAH"].forEach((id) => ($("#" + id).addEventListener("input", syncAspectChips)));
  $$("#gDpiChips button").forEach((b) => (b.onclick = () => { $("#gDpi").value = b.dataset.d; syncDpiChips(); refreshGenEstimate(); }));
  $("#gDpi").addEventListener("input", syncDpiChips);
  $("#gTier").addEventListener("change", () => { $("#gEdgeBox").hidden = $("#gTier").value !== "custom"; });
  $$("#gMode button").forEach((b) => (b.onclick = () => {
    gen.mode = b.dataset.mode;
    $$("#gMode button").forEach((x) => x.classList.toggle("active", x === b));
    $("#gRatioBox").hidden = gen.mode !== "ratio";
    $("#gPrintBox").hidden = gen.mode !== "print";
    refreshGenEstimate();
  }));
  ["gN", "gTier", "gQuality", "gW", "gH", "gDpi", "gAW", "gAH", "gEdge"].forEach((id) => ($("#" + id).oninput = () => { if (id === "gQuality") ls.set("gQuality", $("#gQuality").value); refreshGenEstimate(); }));
  $("#gQuality").onchange = $("#gQuality").oninput;
  $("#gClear").onclick = () => gen.board.clear();
  $("#gGo").onclick = runGenerate;
  gen.picker.render();
  syncAspectChips(); syncDpiChips();
  refreshGenEstimate();
}

async function runGenerate() {
  if (gen.busy) return;
  const prompt = $("#gPrompt").value.trim();
  const ids = gen.picker.ids();
  if (!prompt) return toast("프롬프트를 입력하세요.");
  if (!ids.length) return toast("모델을 하나 이상 선택하세요.");
  const geomErr = validateGeometry();
  if (geomErr) return toast(`⚠️ ${geomErr}`, 4000);
  gen.busy = true;
  $("#gGo").disabled = true;
  $("#gGo").textContent = "생성 중...";
  const base = {
    prompt, n: Math.max(1, +$("#gN").value || 1), quality: $("#gQuality").value || null,
    geometry: geometry(), transparent: $("#gTransparent").checked, exact_crop: $("#gCrop").checked,
  };
  await Promise.all(ids.map(async (id) => {
    const m = modelById(id);
    const col = gen.board.column(id, m.label);
    col.loading(`${m.label} 생성 중... (최대 1~2분)`);
    try {
      col.done(await api("/api/generate", { json: { ...base, model: id, n: Math.min(base.n, m.max_n) } }));
    } catch (e) { col.fail(e.message); }
  }));
  gen.busy = false;
  $("#gGo").disabled = false;
  $("#gGo").textContent = "🎨 이미지 생성";
  refreshBrief();
}
