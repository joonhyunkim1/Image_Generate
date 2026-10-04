/* 저장한 이미지 갤러리 */
async function renderGallery() {
  const box = $("#galleryContent");
  box.innerHTML = `<span class="spinner"></span>불러오는 중...`;
  const d = await api("/api/images");
  box.innerHTML = `
    <div class="pane-title"><h2>🖼 저장한 이미지</h2>
      <button class="btn" id="openFolder">📂 저장 폴더 열기</button></div>
    <p class="sub">저장 위치: <code>${esc(d.dir)}</code> — 이 폴더의 파일을 그대로 인쇄 소프트웨어(RIP)에 가져가면 됩니다. 이 폴더는 git에 올라가지 않습니다.</p>
    ${d.images.length ? `<div class="gallery" id="galleryGrid"></div>` : `<div class="empty-state"><h3>아직 저장한 이미지가 없습니다</h3><p>이미지 생성/수정 결과에서 <b>💾 저장</b>을 누르면 여기에 모입니다.</p></div>`}`;
  $("#openFolder").onclick = async () => { await api("/api/open-folder", { method: "POST" }); };
  const grid = $("#galleryGrid");
  d.images.forEach((r) => {
    const m = state.config.models.find((x) => x.id === r.model);
    const el = document.createElement("div");
    el.className = "icard";
    el.innerHTML = `
      <div class="imgbox">${r.exists ? `<img src="${r.url}" loading="lazy" />` : `<div class="loading">파일 없음</div>`}</div>
      <div class="info"><span>${esc(m?.label || r.model)}</span><span>${r.width}×${r.height}px${r.dpi ? ` · ${r.dpi}DPI` : ""}</span>
        <span>${r.purpose === "edit" ? "수정" : "생성"} · ${esc(r.ts.replace("T", " "))}</span></div>
      <div class="info" title="${esc(r.prompt)}">${esc(r.prompt.slice(0, 80))}${r.prompt.length > 80 ? "…" : ""}</div>
      <div class="acts">
        <button class="btn sm" data-a="saveas" title="다른 이름으로 저장 — 저장 위치와 파일 이름을 직접 정합니다">⬇ 다운로드</button>
        <button class="btn sm" data-a="edit">✏️ 수정</button>
        <button class="btn sm" data-a="reuse">프롬프트 재사용</button>
        <button class="btn sm ghost danger" data-a="del">삭제</button>
      </div>`;
    const img = $("img", el);
    if (img) img.onclick = () => openImageViewer(`${r.filename} · ${r.width}×${r.height}`, r.url, `<pre class="prompt">${esc(r.prompt)}</pre>`);
    $("[data-a=saveas]", el).onclick = () => saveAs(r.url, r.filename);
    $("[data-a=edit]", el).onclick = () => sendToEdit(r.url, r.filename);
    $("[data-a=reuse]", el).onclick = () => { $("#gPrompt").value = r.prompt; switchView("generate"); toast("프롬프트를 불러왔습니다."); };
    $("[data-a=del]", el).onclick = async () => {
      if (!confirm("이 이미지를 삭제할까요? 저장 폴더의 파일도 함께 삭제됩니다.")) return;
      await api(`/api/images/${r.id}`, { method: "DELETE" });
      renderGallery();
    };
    grid.appendChild(el);
  });
}
