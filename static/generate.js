/* 이미지 생성 페이지 */
const gen = { mode: "ratio", aspect: "1:1", picker: null, board: null, busy: false };
const EXAMPLES = [
  ["스티커", "귀여운 시바견 스티커, 굵은 흰색 외곽선, 파스텔 색감, 플랫 일러스트, 투명 배경"],
  ["로고", "미니멀한 커피숍 로고, 원형 엠블럼, 갈색과 크림색 2색, 벡터 스타일, 흰 배경"],
  ["패턴", "열대 식물과 새가 있는 이음새 없는 패턴, 수채화 느낌, 밝은 청록색 팔레트"],
];

function geometry() {
  if (gen.mode === "print") {
    return { mode: "print", width_mm: +$("#gW").value || 100, height_mm: +$("#gH").value || 100, dpi: +$("#gDpi").value || 300 };
  }
  return { mode: "ratio", aspect: gen.aspect, tier: $("#gTier").value };
}

function updatePrintInfo() {
  if (gen.mode !== "print") return;
  const g = geometry();
  const w = Math.round(g.width_mm / 25.4 * g.dpi), h = Math.round(g.height_mm / 25.4 * g.dpi);
  $("#gPrintInfo").innerHTML = `${g.dpi}DPI 기준 필요 해상도 <b>${w}×${h}px</b> (${(w * h / 1e6).toFixed(1)}MP).<br/>모델 최대 해상도가 이보다 작으면 실제 DPI가 낮아지며, 결과 카드에 <b>실제 DPI</b>가 표시됩니다. 파일에는 지정한 mm 크기에 맞춘 DPI 값이 기록됩니다.`;
}

const refreshGenEstimate = debounce(async () => {
  const ids = gen.picker.ids();
  const n = Math.max(1, +$("#gN").value || 1);
  fillQuality($("#gQuality"), $("#gQualityBox"), ids);
  transparentHint($("#gTransHint"), ids);
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
  $("#gAspect").innerHTML = state.config.aspects.map((a) => `<button data-a="${a}" class="${a === gen.aspect ? "active" : ""}">${a}</button>`).join("");
  $$("#gAspect button").forEach((b) => (b.onclick = () => {
    gen.aspect = b.dataset.a;
    $$("#gAspect button").forEach((x) => x.classList.toggle("active", x === b));
    refreshGenEstimate();
  }));
  $$("#gMode button").forEach((b) => (b.onclick = () => {
    gen.mode = b.dataset.mode;
    $$("#gMode button").forEach((x) => x.classList.toggle("active", x === b));
    $("#gRatioBox").hidden = gen.mode !== "ratio";
    $("#gPrintBox").hidden = gen.mode !== "print";
    refreshGenEstimate();
  }));
  ["gN", "gTier", "gQuality", "gW", "gH", "gDpi"].forEach((id) => ($("#" + id).oninput = () => { if (id === "gQuality") ls.set("gQuality", $("#gQuality").value); refreshGenEstimate(); }));
  $("#gQuality").onchange = $("#gQuality").oninput;
  $("#gClear").onclick = () => gen.board.clear();
  $("#gGo").onclick = runGenerate;
  gen.picker.render();
  refreshGenEstimate();
}

async function runGenerate() {
  if (gen.busy) return;
  const prompt = $("#gPrompt").value.trim();
  const ids = gen.picker.ids();
  if (!prompt) return toast("프롬프트를 입력하세요.");
  if (!ids.length) return toast("모델을 하나 이상 선택하세요.");
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
