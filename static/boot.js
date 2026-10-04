/* 시작: 설정 로드 → 첫 실행이면 튜토리얼, 키가 없으면 초기 설정으로 */
(async function boot() {
  try {
    await loadConfig();
  } catch (e) {
    document.body.innerHTML = `<div style="padding:40px">서버에 연결할 수 없습니다: ${esc(e.message)}<br/>실행 창이 켜져 있는지 확인하세요.</div>`;
    return;
  }
  initGenerate();
  initEdit();
  let view = ls.get("lastView", "generate");
  if (!ls.get("tutorialSeen", false)) view = "tutorial";
  else if (!state.config.any_key) view = "setup";
  if (!["tutorial", "setup", "generate", "edit", "gallery", "usage"].includes(view)) view = "generate";
  switchView(view);
})();
