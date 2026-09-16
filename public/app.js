const state = { analysis: null, selectedBullet: null, copilot: null, questions: [], questionIndex: 0, recognition: null, interviewHistory: [], interviewTurn: 0, interviewStopped: false };
const $ = (s) => document.querySelector(s);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const labelText = { evidence: 'Có bằng chứng', partial: 'Một phần', 'not-found': 'Chưa tìm thấy' };
const labelClass = { 'from-cv': 'cv', 'from-posting': 'posting', 'needs-confirmation': 'confirm' };
const labelText2 = { 'from-cv': 'TỪ CV', 'from-posting': 'TỪ TIN', 'needs-confirmation': 'CẦN BẠN XÁC NHẬN' };

function notice(message, type = 'error') { const el = $('#notice'); el.className = `notice ${type}`; el.textContent = message; el.classList.remove('hidden'); window.scrollTo({ top: 0, behavior: 'smooth' }); }
function clearNotice() { $('#notice').classList.add('hidden'); }
async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Có lỗi không xác định.');
  return data;
}
function goTab(name) {
  if (name !== 'input' && !state.analysis) { notice('Hoàn thành bước 1 với tin và CV thật trước khi đi tiếp.'); name = 'input'; }
  document.querySelectorAll('.tab,.tab-panel').forEach(el => el.classList.remove('active'));
  const tab = $(`.tab[data-tab="${name}"]`); const panel = $(`#tab-${name}`);
  if (!tab || !panel) return;
  tab.classList.add('active'); panel.classList.add('active');
  if ($('#map-result')) $('#map-result').classList.toggle('hidden', name !== 'map' || !state.analysis);
}
document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => goTab(btn.dataset.tab)));
document.addEventListener('click', (event) => {
  const go = event.target.closest('[data-go]'); if (go) goTab(go.dataset.go);
  const nav = event.target.closest('[data-step-nav]'); if (nav) goTab(nav.dataset.stepNav);
  const entry = event.target.closest('[data-entry]'); if (entry) { entryMode = entry.dataset.entry; document.querySelectorAll('[data-entry]').forEach(x => x.classList.toggle('selected', x.dataset.entry === entryMode)); $('#discover-note').classList.toggle('hidden', entryMode !== 'discover'); }
});
$('#consent-check').addEventListener('change', (e) => { $('#consent-btn').disabled = !e.target.checked; });
$('#consent-btn').addEventListener('click', () => { $('#consent').classList.add('hidden'); });
$('#delete-btn').addEventListener('click', () => {
  state.analysis = null; state.copilot = null; state.questions = []; entryMode = 'existing'; document.querySelectorAll('[data-entry]').forEach(x => x.classList.toggle('selected', x.dataset.entry === entryMode)); $('#discover-note').classList.add('hidden'); $('#map-result').innerHTML = '<div class="empty-state">Hoàn thành bước 1 để xem bản đồ bằng chứng.</div>'; $('#map-result').classList.remove('hidden'); $('#copilot-workspace').classList.add('hidden'); $('#copilot-empty').classList.remove('hidden'); $('#interview-workspace').classList.add('hidden'); $('#interview-empty').classList.remove('hidden'); $('#posting-text').value = ''; $('#posting-url').value = ''; $('#cv-file').value = ''; $('#file-name').textContent = 'Chọn file CV'; $('#trust-result').classList.add('hidden'); goTab('input'); notice('Đã xóa dữ liệu phiên trên trình duyệt. Không có dữ liệu nào được lưu lại.', 'success');
});
$('#cv-file').addEventListener('change', (e) => { $('#file-name').textContent = e.target.files[0]?.name || 'Chọn file CV'; });

let entryMode = 'existing';
$('#analyze-form').addEventListener('submit', async (event) => {
  event.preventDefault(); clearNotice();
  if (entryMode === 'discover') return notice('Tìm tin giúp tôi từ CV là bước tiếp theo - demo này chưa kết nối nguồn tìm kiếm. Không có kết quả giả được tạo ra.');
  const file = $('#cv-file').files[0];
  if (!file) return notice('Hãy tải lên CV PDF hoặc DOCX của bạn.');
  if (!$('#posting-text').value.trim() && !$('#posting-url').value.trim()) return notice('Hãy dán nội dung tin hoặc nhập URL công khai.');
  const body = new FormData(event.target); body.append('consent', 'true');
  const button = $('#analyze-btn'); button.disabled = true; button.innerHTML = 'Đang đọc tin và CV <span>…</span>';
  try { state.analysis = await request('/api/analyze', { method: 'POST', body }); renderMap(); renderBullets(); await loadQuestions(); goTab('map'); notice('Đã phân tích xong. Các trích dẫn màu xám là nguyên văn từ nguồn.', 'success'); }
  catch (error) { notice(error.message); } finally { button.disabled = false; button.innerHTML = 'Phân tích bằng chứng <span>→</span>'; }
});

function renderMap() {
  const a = state.analysis; const rows = (a.requirements || []).map((r) => `<div class="map-row"><div><div class="req-main">${esc(r.requirement)}</div><div class="req-quote">“${esc(r.postingSentence)}”</div></div><div><span class="status ${esc(r.status)}">${esc(labelText[r.status] || r.status)}</span><div class="priority">${r.priority === 'must-have' ? 'Must-have' : 'Nice-to-have'}</div></div><div class="cv-quote"><strong>Dòng CV hỗ trợ</strong>“${esc(r.cvLine || 'Không tìm thấy dòng CV hỗ trợ.')}”</div></div>`).join('');
  $('#map-result').innerHTML = `<div class="result-head"><h4>${a.requirements?.length || 0} yêu cầu được tách</h4><div class="source-meta"><b>Nguồn tin</b> ${esc(a.sourceUrl)}<br>Đọc lúc ${esc(new Date(a.sourceTime).toLocaleString('vi-VN'))}</div></div><div class="map-table"><div class="map-head"><span>YÊU CẦU + CÂU NGUYÊN VĂN</span><span>TRẠNG THÁI</span><span>BẰNG CHỨNG TỪ CV</span></div>${rows || '<div class="empty-state">Không tách được yêu cầu từ nội dung này.</div>'}</div><p class="model-note">${a.modelAvailable ? '✦ Phân tích bởi mô hình AI. Hãy đọc lại trích dẫn trước khi dùng.' : 'ⓘ Model chưa được bật. Đây là bản tách từ khóa dự phòng, không phải kết luận AI.'}</p><div class="path-nav panel-nav"><button class="secondary" data-step-nav="input">← Quay lại</button><span class="microcopy">Mọi trích dẫn được giữ nguyên để bạn kiểm tra.</span><button class="primary" data-step-nav="copilot">Tiếp theo: viết thật <span>→</span></button></div>`;
  $('#map-result').classList.remove('hidden');
}
function renderBullets() {
  const lines = [...new Set((state.analysis.requirements || []).map(r => r.cvLine).filter(x => x && !x.startsWith('Không tìm')))].slice(0, 8);
  $('#bullet-list').innerHTML = lines.length ? lines.map((line, i) => `<button class="bullet-option ${i === 0 ? 'selected' : ''}" data-bullet="${esc(line)}">${esc(line)}</button>`).join('') : '<p class="microcopy">Chưa có dòng CV được trích dẫn.</p>';
  state.selectedBullet = lines[0] || null; $('#copilot-empty').classList.toggle('hidden', Boolean(lines.length)); $('#copilot-workspace').classList.toggle('hidden', !lines.length);
  document.querySelectorAll('.bullet-option').forEach((button) => button.addEventListener('click', () => { document.querySelectorAll('.bullet-option').forEach(x => x.classList.remove('selected')); button.classList.add('selected'); state.selectedBullet = button.dataset.bullet; $('#copilot-result').innerHTML = ''; }));
}

$('#generate-copilot').addEventListener('click', async () => {
  if (!state.selectedBullet || !state.analysis) return; clearNotice(); const b = $('#generate-copilot'); b.disabled = true; b.innerHTML = 'Đang viết nháp <span>…</span>';
  try { state.copilot = await request('/api/copilot', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ bullet: state.selectedBullet, posting: state.analysis.postingText, cv: state.analysis.cvText }) }); renderCopilot(); }
  catch (error) { notice(error.message); } finally { b.disabled = false; b.innerHTML = 'Tạo bản nháp <span>→</span>'; }
});
function draftCard(title, draft, key) {
  const sentences = draft?.sentences || [{text: draft?.text || '', label:'needs-confirmation'}];
  return `<article class="draft-card"><h4>${title}</h4><p class="draft-text">${esc(draft?.text || '')}</p><div>${sentences.map((s, i) => `<div class="sentence"><span class="label ${labelClass[s.label] || 'confirm'}">${labelText2[s.label] || 'CẦN XÁC NHẬN'}</span><span>${esc(s.text)}</span></div>`).join('')}</div><div class="approve-row"><label><input class="approve-check" data-draft="${key}" type="checkbox"> Tôi đã kiểm tra và duyệt mọi câu trong bản này.</label><button class="secondary copy-btn" data-copy="${key}" disabled>Copy sau khi duyệt</button><div class="copy-status"></div></div></article>`;
}
function renderCopilot() { const c = state.copilot; $('#copilot-result').innerHTML = draftCard('CV bullet · action → result', c.rewrite, 'rewrite') + draftCard('Mở đầu cover letter', c.opening, 'opening'); document.querySelectorAll('.approve-check').forEach(ch => ch.addEventListener('change', (e) => { const card = e.target.closest('.draft-card'); const btn = card.querySelector('.copy-btn'); btn.disabled = !e.target.checked; card.querySelector('.copy-status').textContent = e.target.checked ? 'Đã duyệt - có thể copy.' : ''; card.querySelector('.copy-status').className = 'copy-status copy-ready'; })); document.querySelectorAll('.copy-btn').forEach(btn => btn.addEventListener('click', async () => { const draft = state.copilot[btn.dataset.copy]; try { await navigator.clipboard.writeText(draft.text); btn.nextElementSibling.textContent = 'Đã copy vào clipboard.'; } catch { btn.nextElementSibling.textContent = 'Trình duyệt không cho phép clipboard.'; } })); }

async function loadQuestions() {
  $('#interview-empty').classList.add('hidden'); $('#interview-workspace').classList.remove('hidden');
  state.interviewHistory = []; state.interviewTurn = 0; state.interviewStopped = false; $('#answer-text').disabled = false; $('#review-answer').disabled = false; $('#stop-interview').disabled = false; $('#replay').classList.add('hidden'); $('#replay').innerHTML = '';
  $('#question-text').textContent = 'Đang tạo câu hỏi từ tin và CV…';
  try { const data = await interviewRequest(''); state.questions = data.questions || []; state.questionIndex = 0; updateQuestion(); if (data.modelError) notice('Model đang chậm hoặc lỗi - đã chuyển sang thang câu hỏi dự phòng.', 'success'); }
  catch (error) { notice(error.message); }
}
async function interviewRequest(answer) {
  return request('/api/interview', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ posting: state.analysis.postingText, cv: state.analysis.cvText, answer, history: state.interviewHistory, pressure: $('#pressure').value, turn: state.interviewTurn }) });
}
function updateQuestion(question) { $('#question-index').textContent = state.interviewTurn + 1; $('#question-text').textContent = question || state.questions[state.questionIndex] || 'Chưa tạo được câu hỏi.'; $('#answer-text').value = ''; $('#feedback').classList.add('hidden'); }
function safeFollowup(missing) { const focus = missing?.[0] === 'no-context' ? 'bối cảnh cụ thể' : missing?.[0] === 'no-action' ? 'hành động cụ thể của bạn' : 'kết quả cụ thể'; return `Bạn vừa trả lời. Bạn có thể nói rõ hơn về ${focus} không?`; }
$('#type-answer').addEventListener('click', () => { $('#answer-text').focus(); });
$('#stop-interview').addEventListener('click', () => { stopRecognition(); state.interviewStopped = true; $('#question-text').textContent = 'Buổi luyện đã dừng.'; $('#answer-text').disabled = true; $('#review-answer').disabled = true; $('#stop-interview').disabled = true; $('#feedback').classList.add('hidden'); notice('Đã dừng ngay lập tức. Dữ liệu chỉ ở trong phiên này.', 'success'); });
$('#record-btn').addEventListener('click', () => {
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Speech) return notice('Trình duyệt chưa hỗ trợ speech recognition. Hãy dùng ô gõ câu trả lời bên cạnh.');
  if (state.recognition) { state.recognition.stop(); return; }
  const recognition = new Speech(); state.recognition = recognition; recognition.lang = 'vi-VN'; recognition.continuous = true; recognition.interimResults = true; let finalText = $('#answer-text').value;
  recognition.onresult = (event) => { let interim = ''; for (let i = event.resultIndex; i < event.results.length; i++) event.results[i].isFinal ? finalText += event.results[i][0].transcript + ' ' : interim += event.results[i][0].transcript; $('#answer-text').value = finalText + interim; };
  recognition.onerror = () => { notice('Không đọc được microphone. Bản gõ vẫn dùng được.'); stopRecognition(); }; recognition.onend = () => stopRecognition(); recognition.start(); $('#record-btn').classList.add('recording'); $('#record-label').textContent = 'Dừng ghi âm';
});
function stopRecognition() { if (state.recognition) { state.recognition = null; $('#record-btn').classList.remove('recording'); $('#record-label').textContent = 'Bắt đầu ghi âm'; } }
function renderTurn(turn, answer, feedback) {
  const missing = feedback?.missing || []; const held = feedback?.structure === 'held';
  const replay = $('#replay'); replay.classList.remove('hidden');
  replay.insertAdjacentHTML('beforeend', `<article class="replay-turn"><div><span class="replay-number">LƯỢT ${turn}</span><span class="replay-state ${held ? 'held' : 'lost'}">${held ? 'GIỮ ĐƯỢC CẤU TRÚC' : 'CẦN SỬA'}</span></div><p>“${esc(answer)}”</p><small>${esc(feedback?.fix || feedback?.note || '')}</small></article>`);
}
$('#review-answer').addEventListener('click', async () => {
  if (!state.analysis || state.interviewStopped || !$('#answer-text').value.trim()) return notice('Hãy trả lời bằng mic hoặc gõ câu trả lời trước khi gửi.');
  const answer = $('#answer-text').value.trim(); const question = $('#question-text').textContent; const button = $('#review-answer'); button.disabled = true; button.innerHTML = 'Đang nghe và hỏi tiếp <span>…</span>';
  try {
    state.interviewHistory.push({ turn: state.interviewTurn + 1, question, answer });
    const data = await interviewRequest(answer); if (data.modelError) notice('Model đang chậm hoặc lỗi - tiếp tục bằng câu hỏi dự phòng.', 'success'); renderTurn(state.interviewTurn + 1, answer, data.feedback); state.interviewTurn += 1;
    if (state.interviewTurn >= 4 || !data.nextQuestion) { $('#question-text').textContent = 'Đã hoàn thành 4 lượt. Xem lại từng lượt bên dưới.'; $('#answer-text').disabled = true; $('#stop-interview').disabled = true; $('#review-answer').disabled = true; }
    else { const nextQuestion = data.nextQuestion || safeFollowup(data.feedback?.missing); const wait = $('#pressure').value === 'intense' && data.feedback?.missing?.length ? 900 : 0; if (wait) { $('#question-text').textContent = '…'; await new Promise(resolve => setTimeout(resolve, wait)); } updateQuestion(nextQuestion); }
  } catch(error) { notice(error.message); } finally { if (!state.interviewStopped && state.interviewTurn < 4) { button.disabled = false; button.innerHTML = 'Gửi câu trả lời <span>→</span>'; } }
});

$('#trust-form').addEventListener('submit', async (event) => { event.preventDefault(); clearNotice(); const post = $('#trust-text').value.trim(); const file = $('#screenshot').files[0]; if (!post && !file) return notice('Hãy dán nguyên văn bài đăng hoặc tải ảnh chụp màn hình.'); const body = new FormData(); body.append('postText', post); body.append('officialUrl', $('#official-url').value.trim()); if (file) body.append('screenshot', file); const btn = event.target.querySelector('button'); btn.disabled = true; btn.innerHTML = 'Đang kiểm tra <span>…</span>'; try { const data = await request('/api/trust', { method:'POST', body }); renderTrust(data); } catch(error) { notice(error.message); } finally { btn.disabled = false; btn.innerHTML = 'Kiểm tra tín hiệu <span>→</span>'; } });
function renderTrust(data) { const facts = [['CÔNG TY',data.company],['MỨC LƯƠNG',data.salary],['ĐỊA ĐIỂM',data.location],['LIÊN HỆ',data.contact],['PHÍ / ĐẶT CỌC',data.fee]]; $('#trust-result').innerHTML = `<div class="result-head"><h4>Thông tin được trích xuất</h4><div class="source-meta">Đọc lúc ${esc(new Date(data.checkedAt).toLocaleString('vi-VN'))}<br>Nguồn: bài đăng bạn cung cấp</div></div><div class="trust-grid">${facts.map(f => `<div class="trust-fact"><label>${f[0]}</label><strong>${esc(f[1])}</strong></div>`).join('')}</div>${(data.warnings || []).map(w => `<div class="warning"><q>${esc(w.quote)}</q><br>${esc(w.text || 'Needs verification / exercise caution')}</div>`).join('') || '<p class="caution-note">Chưa nhận diện cảnh báo tự động. Vẫn cần xác minh qua kênh chính thức.</p>'}<div class="official-check"><strong>Trang tuyển dụng chính thức</strong><span>${esc({ 'found-related-text':'Có nội dung liên quan trên trang được cung cấp', 'not-found-in-page':'Chưa thấy nội dung liên quan trên trang được cung cấp', 'could-not-verify':'Không thể xác minh trang được cung cấp', 'not-provided':'Chưa cung cấp URL trang chính thức' }[data.officialPage?.status] || data.officialPage?.status)}</span>${data.officialPage?.retrievedAt ? `<small>Nguồn: ${esc(data.officialPage.url)} · đọc lúc ${esc(new Date(data.officialPage.retrievedAt).toLocaleString('vi-VN'))}</small>` : ''}</div><p class="caution-note">⚠ ${esc(data.note)} ${data.modelAvailable ? '' : 'Model chưa bật; ảnh chụp chưa được OCR trong demo.'}</p>`; $('#trust-result').classList.remove('hidden'); }
