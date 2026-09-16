import "dotenv/config";
import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { unlink } from "node:fs/promises";
import path from "node:path";
const execFileAsync = promisify(execFile);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });
const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const retrievedAt = () => new Date().toISOString();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(root, "public")));

function cleanText(text: string): string {
  return text.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ").replace(/\n[ \t]+/g, "\n").trim();
}

async function parseCv(file?: Express.Multer.File): Promise<string> {
  if (!file) throw new Error("Vui lòng tải CV PDF hoặc DOCX.");
  if (file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf")) {
    const temporary = path.join("/tmp", `jobpilot-${Date.now()}.pdf`);
    await import("node:fs/promises").then(fs => fs.writeFile(temporary, file.buffer));
    try {
      const { stdout } = await execFileAsync("pdftotext", ["-layout", temporary, "-"]);
      return stdout.trim();
    } finally { await unlink(temporary).catch(() => {}); }
  }
  if (file.originalname.toLowerCase().endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: file.buffer });
    return result.value.trim();
  }
  throw new Error("Định dạng chưa được hỗ trợ. Hãy dùng PDF hoặc DOCX.");
}

async function fetchPosting(url: string): Promise<{ text: string; retrievedAt: string }> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new Error("URL tin tuyển dụng không hợp lệ."); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Chỉ hỗ trợ URL http/https công khai.");
  const response = await fetch(parsed, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "JobPilot demo/1.0 (public-page request)" } });
  if (!response.ok) throw new Error(`Không thể tải tin tuyển dụng (HTTP ${response.status}).`);
  const type = response.headers.get("content-type") || "";
  if (!type.includes("text/html") && !type.includes("text/plain")) throw new Error("Trang không trả về nội dung văn bản công khai.");
  const text = cleanText(await response.text());
  if (text.length < 80) throw new Error("Trang tải được nhưng không có đủ nội dung văn bản.");
  return { text: text.slice(0, 30000), retrievedAt: retrievedAt() };
}

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || text.match(/[\[{][\s\S]*[\]}]/)?.[0];
  if (!candidate) throw new Error("Model không trả về JSON hợp lệ.");
  return JSON.parse(candidate);
}

async function model(system: string, user: string): Promise<any> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) return null;
  const response = await fetch("https://api.deepseek.com/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(45000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "deepseek-chat", temperature: 0.1, messages: [{ role: "system", content: system }, { role: "user", content: user }] })
  });
  if (!response.ok) throw new Error(`Model không phản hồi (HTTP ${response.status}).`);
  const data = await response.json() as any;
  return extractJson(data.choices?.[0]?.message?.content || "");
}

function localMap(posting: string, cv: string) {
  const lines = posting.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(x => x.length > 15);
  const cvLines = cv.split(/\n+/).map(x => x.trim()).filter(Boolean);
  const terms = ["javascript", "typescript", "react", "python", "english", "tiếng anh", "experience", "kinh nghiệm", "communication", "giao tiếp", "sql", "team"];
  const selected = lines.filter(line => terms.some(term => line.toLowerCase().includes(term))).slice(0, 8);
  return { requirements: (selected.length ? selected : lines.slice(0, 5)).map((sentence, index) => {
    const lower = sentence.toLowerCase();
    const relevant = terms.filter(term => lower.includes(term));
    const evidence = cvLines.find(line => relevant.some(term => line.toLowerCase().includes(term)));
    const hasMissingNumber = /\d/.test(sentence) && !(evidence && /\d/.test(evidence));
    const status = evidence ? (hasMissingNumber ? "partial" : "evidence") : "not-found";
    return { id: String(index + 1), requirement: sentence.slice(0, 240), priority: /\b(required|must|need|bắt buộc|yêu cầu)\b/i.test(sentence) ? "must-have" : "nice-to-have", status, postingSentence: sentence, cvLine: evidence || "Không tìm thấy dòng CV hỗ trợ." };
  }) };
}

async function checkOfficialPage(url: string, post: string) {
  try {
    const fetched = await fetchPosting(url);
    const words = post.toLowerCase().split(/\W+/).filter(word => word.length > 5).slice(0, 20);
    const foundTerms = words.filter(word => fetched.text.toLowerCase().includes(word));
    return { status: foundTerms.length >= 2 ? "found-related-text" : "not-found-in-page", url, retrievedAt: fetched.retrievedAt };
  } catch (error) {
    return { status: "could-not-verify", url, error: (error as Error).message };
  }
}

function localTrust(post: string) {
  const find = (pattern: RegExp) => post.match(pattern)?.[1]?.trim() || "Không nêu";
  const feeMatch = post.match(/(?:phí|lệ phí|đặt cọc|deposit|fee)[^.!?\n]{0,80}/i);
  const warnings = feeMatch ? [{ quote: feeMatch[0].trim(), text: "Cần xác minh kỹ - không chuyển phí hoặc đặt cọc trước khi xác minh qua kênh chính thức." }] : [];
  return {
    company: find(/(?:công ty|cty|company)\s*[:：-]?\s*([^,;.\n]+)/i),
    salary: find(/(?:lương|mức lương|salary)\s*[:：-]?\s*([^,;.\n]+)/i),
    location: find(/(?:địa điểm|location|tại)\s*[:：-]?\s*([^,;.\n]+)/i),
    contact: find(/(?:liên hệ|contact|zalo|email|sđt|điện thoại)\s*[:：-]?\s*([^,;.\n]+)/i),
    fee: feeMatch ? feeMatch[0].trim() : "Không nêu",
    warnings
  };
}

const mappingSystem = `Bạn là JobPilot, trợ lý ứng tuyển trung thực. Chỉ dùng thông tin trong văn bản được cung cấp, không suy diễn hay bịa số liệu. Trả về JSON thuần theo dạng {"requirements":[{"id":"1","requirement":"...","priority":"must-have|nice-to-have","status":"evidence|partial|not-found","postingSentence":"một câu nguyên văn từ tin","cvLine":"một dòng nguyên văn từ CV hoặc Không tìm thấy dòng CV hỗ trợ."}]}. Tách các yêu cầu tuyển dụng thành tối đa 10 mục. status evidence chỉ khi CV nói rõ, partial khi có liên quan nhưng thiếu chi tiết, not-found khi không có. postingSentence và cvLine phải được chép nguyên văn.`;

app.post("/api/analyze", upload.single("cv"), async (req, res) => {
  try {
    if (req.body.consent !== "true") return res.status(400).json({ error: "Cần xác nhận đồng ý xử lý CV trước khi tiếp tục." });
    const cv = await parseCv(req.file);
    let posting = String(req.body.postingText || "").trim();
    let sourceUrl = "Văn bản do bạn dán";
    let sourceTime = retrievedAt();
    if (!posting && req.body.postingUrl) {
      const fetched = await fetchPosting(String(req.body.postingUrl)); posting = fetched.text; sourceUrl = String(req.body.postingUrl); sourceTime = fetched.retrievedAt;
    }
    if (!posting) return res.status(400).json({ error: "Hãy dán nội dung tin hoặc nhập URL công khai." });
    let map: any;
    try { map = await model(mappingSystem, `TIN TUYỂN DỤNG:\\n${posting.slice(0, 26000)}\\n\\nCV:\\n${cv.slice(0, 18000)}`); } catch (error) { return res.status(502).json({ error: (error as Error).message }); }
    const modelAvailable = Boolean(map);
    map = map || localMap(posting, cv);
    map.requirements = (Array.isArray(map.requirements) ? map.requirements : []).slice(0, 10).map((item: any, index: number) => ({
      id: String(item.id || index + 1), requirement: String(item.requirement || item.postingSentence || "Yêu cầu chưa có mô tả"),
      priority: item.priority === "must-have" ? "must-have" : "nice-to-have",
      status: ({ found: "evidence", "evidence-found": "evidence", "not_found": "not-found", missing: "not-found" } as Record<string, string>)[item.status] || (item.status === "partial" ? "partial" : "not-found"),
      postingSentence: String(item.postingSentence || item.requirement || "Không có câu trích dẫn từ tin."), cvLine: String(item.cvLine || "Không tìm thấy dòng CV hỗ trợ.")
    }));
    return res.json({ ...map, cvText: cv, postingText: posting, sourceUrl, sourceTime, modelAvailable });
  } catch (error) { return res.status(400).json({ error: (error as Error).message }); }
});

app.post("/api/copilot", async (req, res) => {
  const { bullet, posting, cv } = req.body || {};
  if (!bullet || !posting || !cv) return res.status(400).json({ error: "Thiếu bullet, tin tuyển dụng hoặc CV." });
  try {
    const result = await model(`Bạn là copilot trung thực. Chỉ viết lại dựa trên CV và tin tuyển dụng. Không được bịa con số, công cụ, vai trò hoặc kết quả. Trả JSON: {"rewrite":{"text":"...","sentences":[{"text":"...","label":"from-cv|from-posting|needs-confirmation"}]},"opening":{"text":"...","sentences":[{"text":"...","label":"from-cv|from-posting|needs-confirmation"}]},"questions":["..."]}. Mỗi câu phải có nhãn. Nếu thiếu số liệu, dùng [CẦN BẠN XÁC NHẬN: ...] và nhãn needs-confirmation.`, `BULLET ĐƯỢC CHỌN:\n${bullet}\nTIN:\n${String(posting).slice(0, 18000)}\nCV:\n${String(cv).slice(0, 18000)}`);
    if (result) return res.json(result);
    return res.json({ rewrite: { text: `${bullet} [CẦN BẠN XÁC NHẬN: kết quả hoặc số liệu cụ thể]`, sentences: [{ text: bullet, label: "from-cv" }, { text: "[CẦN BẠN XÁC NHẬN: kết quả hoặc số liệu cụ thể]", label: "needs-confirmation" }] }, opening: { text: "Tôi quan tâm đến vị trí này vì kinh nghiệm được nêu trong CV của tôi liên quan đến yêu cầu của tin tuyển dụng. [CẦN BẠN XÁC NHẬN: lý do cụ thể]", sentences: [{ text: "Tôi quan tâm đến vị trí này vì kinh nghiệm được nêu trong CV của tôi liên quan đến yêu cầu của tin tuyển dụng.", label: "needs-confirmation" }, { text: "[CẦN BẠN XÁC NHẬN: lý do cụ thể]", label: "needs-confirmation" }] }, questions: ["Bạn có thể xác nhận kết quả cụ thể của bullet này không?"], modelAvailable: false });
  } catch (error) { return res.status(502).json({ error: (error as Error).message }); }
});

const openingQuestions = [
  "Hãy kể về một dự án trong CV liên quan nhất với vị trí này.",
  "Trong dự án đó, bạn đã thực hiện hành động cụ thể nào?",
  "Kết quả nào cho thấy hành động đó có hiệu quả?",
  "Nếu làm lại, bạn sẽ kiểm tra giả định nào đầu tiên?"
];

function fallbackInterview(answer: string, turn: number, pressure: string) {
  const text = answer.trim();
  const missing: string[] = [];
  if (!text || text.split(/\s+/).length < 18 || !/(khi|trong|dự án|bối cảnh|vấn đề|lúc)/i.test(text)) missing.push("no-context");
  if (!/(tôi|mình).{0,80}(đã|thực hiện|xây dựng|dùng|phối hợp|giải quyết|làm)/is.test(text)) missing.push("no-action");
  if (!/\d|kết quả|hoàn thành|tăng|giảm|cải thiện|giúp/i.test(text)) missing.push("no-result");
  const firstMissing = missing[0];
  const pressurePrefix = pressure === "intense" && firstMissing ? "Bạn đang nói khá chung chung. " : "";
  const followups = [
    `${pressurePrefix}Bạn vừa nhắc đến điều đó - bối cảnh hoặc vấn đề cụ thể lúc ấy là gì?`,
    `${pressurePrefix}Bạn đã tự mình làm bước nào, dùng công cụ gì, và vì sao chọn cách đó?`,
    `${pressurePrefix}Con số hoặc dấu hiệu nào cho thấy kết quả? Nếu không có số, bạn quan sát thay đổi cụ thể nào?`,
    `${pressurePrefix}Bạn đang giả định điều gì về cách làm đó? Bạn sẽ kiểm tra giả định ấy ra sao?`
  ];
  const fix = firstMissing === "no-context" ? "Thêm một câu về bối cảnh hoặc vấn đề trước khi kể hành động." : firstMissing === "no-action" ? "Nói rõ bạn đã tự làm bước nào, thay vì chỉ mô tả nhiệm vụ của nhóm." : firstMissing === "no-result" ? "Thêm kết quả cụ thể hoặc dấu hiệu quan sát được, không cần bịa số." : "Cấu trúc bối cảnh - hành động - kết quả đang rõ.";
  return { questions: openingQuestions, nextQuestion: turn < 4 ? followups[Math.min(turn, followups.length - 1)] : null, feedback: { missing, structure: missing.length ? "needs-work" : "held", fix, note: missing.length ? "Câu trả lời cần thêm bằng chứng nội dung." : "Câu trả lời giữ được bối cảnh, hành động và kết quả." }, modelAvailable: false };
}

app.post("/api/interview", async (req, res) => {
  const { posting, cv, answer, history = [], pressure = "medium", turn = 0 } = req.body || {};
  if (!posting || !cv) return res.status(400).json({ error: "Cần phân tích tin và CV trước." });
  try {
    const result = await model(`Bạn là agent phỏng vấn thử của JobPilot. Đây là MÔ PHỎNG LUYỆN TẬP. Hỏi từng câu một trong 3-4 lượt. Câu hỏi tiếp theo phải dựa trên câu trả lời vừa nghe và đào sâu bối cảnh, hành động, kết quả, con số hoặc lỗ hổng trong CV. Mức áp lực là ${pressure}: light thân thiện, medium truy vấn rõ, intense có thể hỏi dồn khi câu trả lời mơ hồ, thách thức giả định trực tiếp và giữ im lặng có chủ đích sau câu yếu. Áp lực chỉ nhắm vào nội dung/lập luận, tuyệt đối không nhận xét con người, giọng, ngoại hình, cảm xúc, sự tự tin hay tính cách. Không đưa đáp án mẫu, ví dụ câu trả lời, hoặc câu chữ để người dùng lặp lại; chỉ gợi mở bằng câu hỏi và mô tả điểm cần bổ sung. Trả JSON thuần: {"questions":["4 câu hỏi mở đầu"],"nextQuestion":"một câu hỏi tiếp theo hoặc null sau lượt 4","feedback":{"missing":["no-result|no-context|no-action"],"structure":"held|needs-work","fix":"một câu cụ thể cần sửa","note":"nhận xét nội dung bằng tiếng Việt"}}.`, `TIN:\n${String(posting).slice(0, 18000)}\nCV:\n${String(cv).slice(0, 18000)}\nLỊCH SỬ TRONG PHIÊN:\n${JSON.stringify(history).slice(0, 10000)}\nLƯỢT HIỆN TẠI: ${turn}\nCÂU TRẢ LỜI VỪA NGHE:\n${String(answer || "")}`);
    if (result) return res.json({ ...result, modelAvailable: true });
    return res.json(fallbackInterview(String(answer || ""), Number(turn), String(pressure)));
  } catch (error) {
    const fallback = fallbackInterview(String(answer || ""), Number(turn), String(pressure));
    return res.json({ ...fallback, modelError: (error as Error).message });
  }
});

app.post("/api/trust", upload.single("screenshot"), async (req, res) => {
  const post = String(req.body.postText || "").trim();
  if (!post && !req.file) return res.status(400).json({ error: "Hãy dán nội dung bài đăng (ảnh cần OCR bên ngoài demo)." });
  try {
    const result = await model(`Phân tích tin tuyển dụng mạng xã hội một cách thận trọng. Không kết luận lừa đảo. Trả JSON {"company":"...","salary":"...","location":"...","contact":"...","fee":"...","warnings":[{"quote":"nguyên văn trong bài","text":"needs verification / exercise caution"}]}. Chỉ ghi Không nêu nếu thiếu. Mọi cảnh báo phải trích nguyên văn.`, post || "Ảnh được tải lên nhưng chưa có OCR văn bản.");
    const data = result || localTrust(post);
    const officialUrl = String(req.body.officialUrl || "").trim();
    const officialPage = officialUrl ? await checkOfficialPage(officialUrl, post) : { status: "not-provided" };
    return res.json({ ...data, officialPage, modelAvailable: Boolean(result), checkedAt: retrievedAt(), note: "Đây là tín hiệu cần xác minh, không phải kết luận về công ty hay người đăng." });
  } catch (error) { return res.status(502).json({ error: (error as Error).message }); }
});

app.use((_req, res) => res.sendFile(path.join(root, "public", "index.html")));
app.listen(port, () => console.log(`JobPilot chạy tại http://localhost:${port}`));
