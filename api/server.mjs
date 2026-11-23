import { createServer } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const curriculum = JSON.parse(readFileSync(new URL("../curriculum.json", import.meta.url), "utf8"));
const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://lingua-daily-iphone-preview.onrender.com";
const maxBody = 3000;
const maxTokensPerHour = 8;
const recentSessions = new Map();
const badAttempts = new Map();
const now = () => Date.now();

function compareSecrets(a, b) {
  if (!a || !b || typeof a !== "string" || typeof b !== "string") return false;
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(obj));
}

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    const parts = []; let total = 0;
    req.on("data", chunk => {
      total += chunk.length;
      if (total > maxBody) { reject(Object.assign(new Error("Large payload"), { status: 413 })); req.destroy(); return; }
      parts.push(chunk);
    });
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(parts).toString("utf8") || "{}")); } catch { reject(Object.assign(new Error("Bad JSON"), { status: 400 })); } });
    req.on("error", reject);
  });
}

function limit(map, id, windowMs, allowed) {
  const hits = (map.get(id) || []).filter(ts => ts > now() - windowMs);
  if (hits.length >= allowed) { map.set(id, hits); return false; }
  hits.push(now()); map.set(id, hits); return true;
}

function buildInstructions(lang, lessonIndex, errors = [], mastered = 0) {
  const lesson = curriculum[lang][lessonIndex];
  const previous = lessonIndex === 1 ? curriculum[lang][0] : null;
  const target = lang === "es" ? "испанском" : "английском";
  const words = [ ...(previous ? [...previous.nouns, ...previous.adjectives, ...previous.verbs] : []), ...lesson.nouns, ...lesson.adjectives, ...lesson.verbs ].map(x => x[0]);
  const errorExamples = errors.filter(n => Number.isInteger(n) && n >= 0 && n < lesson.tasks.length).slice(0, 6).map(n => lesson.tasks[n][1]);
  return [
    "Ты профессиональный терпеливый языковой преподаватель. Ученик — русскоязычный взрослый.",
    "Веди настоящий диалог голосом. Твой основной язык — " + target + ". Говори короткими естественными фразами, по одной мысли за раз, медленно, с паузами.",
    "Урок " + (lessonIndex + 1) + ". Тема: " + lesson.title + ". Сегодня тренируем спряжение глагола " + lesson.focus + ".",
    "Изученные формы: " + lesson.forms.map(f => f[0]).join("; ") + ".",
    "Словарь ученика: " + words.join(", ") + ".",
    "Задавай ОДИН вопрос за раз, дождись ответа ученика, продолжай разговор согласно ответу.",
    "Первое обращение: поприветствуй на изучаемом языке и задай вопрос по уровню ученика о " + lesson.focus + ". Не повторяй давно освоенные элементарные задания.",
    "Вводи новую лексику только при необходимости и тогда сразу коротко объясняй смысл на русском отдельной фразой.",
    "Когда ученик ошибается, сначала дай короткую корректировку с правильным примером, затем попроси повторить. Если не понял, объясни иначе или приведи другой пример. Не исправляй каждую мелочь, не прерывай постоянно.",
    "Для русского объяснения говори целую фразу по-русски, затем отдельную фразу на изучаемом языке. Никогда не произноси испанские или английские слова внутри русской фразы.",
    "Если ученик молчит или подбирает слова, жди терпеливо; избегай скороговорки.",
    "Реальная ситуация разговора важнее механического повторения двадцати предложений.",
    "В письменной практике уже верно выполнено " + mastered + " из 100 заданий этого урока. " + (mastered >= 70 ? "Используй более сложные ситуации и не повторяй освоенные вводные конструкции без необходимости." : "Сохраняй доступную сложность; усложняй, если ученик справляется."),
    errorExamples.length ? "Стоит аккуратно повторить прежние трудные конструкции: " + errorExamples.join(" | ") : "",
    "Не называй себя ChatGPT из этой беседы, не обещай точности оценки акцента и не утверждай, что распознавание всегда безошибочно."
  ].filter(Boolean).join("\n");
}

function sessionParams({lang, lesson, errors, mastered}) {
  const safeLang = ["es","en"].includes(lang) ? lang : "es";
  const n = lesson === 1 ? 1 : 0;
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime-2.1";
  return {
    expires_after: { anchor: "created_at", seconds: 60 },
    session: {
      type: "realtime",
      model,
      instructions: buildInstructions(safeLang, n, Array.isArray(errors) ? errors : [], Number.isInteger(mastered) ? Math.max(0,Math.min(100,mastered)) : 0),
      max_output_tokens: 320,
      audio: {
        input: {
          noise_reduction: { type: "near_field" },
          transcription: { model: "gpt-4o-mini-transcribe", language: safeLang },
          turn_detection: { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true }
        },
        output: { voice: "marin", speed: 0.84 }
      }
    }
  };
}

export function makeHandler(opts = {}) {
  const getEnv = opts.env || (() => process.env);
  const upstreamFetch = opts.fetch || fetch;
  return async function handle(req, res) {
    const origin = req.headers.origin || "";
    // Require a trusted browser origin for all protected requests; never use '*' with a token endpoint.
    if (origin === allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Preview-Access");
      res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "OPTIONS") {
      if (origin !== allowedOrigin) return json(res, 403, { error: "origin_denied" });
      res.writeHead(204); res.end(); return;
    }
    // Serve the standalone preview from the same origin as the protected token endpoint.
    if ((req.url === "/" || req.url === "/index.html") && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer"
      });
      res.end(readFileSync(new URL("../index.html", import.meta.url)));
      return;
    }
    if (req.url === "/health" && req.method === "GET") return json(res, 200, { ok: true, configured: Boolean(getEnv().OPENAI_API_KEY && getEnv().PREVIEW_ACCESS_CODE) });
    if (req.url !== "/api/realtime/token" || req.method !== "POST") return json(res, 404, { error: "not_found" });
    if (origin !== allowedOrigin) return json(res, 403, { error: "origin_denied" });

    const {OPENAI_API_KEY, PREVIEW_ACCESS_CODE} = getEnv();
    if (!OPENAI_API_KEY || !PREVIEW_ACCESS_CODE) return json(res, 503, { error: "not_configured" });

    const client = req.socket.remoteAddress || "unknown";
    if (!compareSecrets(req.headers["x-preview-access"], PREVIEW_ACCESS_CODE)) {
      if (!limit(badAttempts, client, 15 * 60_000, 5)) return json(res, 429, { error: "too_many_attempts" });
      return json(res, 401, { error: "invalid_access_code" });
    }
    if (!limit(recentSessions, "sessions:" + client, 60 * 60_000, maxTokensPerHour)) return json(res, 429, { error: "session_limit" });
    let body;
    try { body = await jsonBody(req); } catch(e) { return json(res, e.status || 400, { error: "invalid_body" }); }
    if (!["es","en"].includes(body.lang) || ![0,1].includes(body.lesson)) return json(res, 400, { error: "invalid_lesson" });
    const safeErrors = Array.isArray(body.errors) ? body.errors.slice(0, 6) : [];
    const safeMastered = Number.isInteger(body.mastered) ? Math.max(0,Math.min(100,body.mastered)) : 0;
    const params = sessionParams({ lang: body.lang, lesson: body.lesson, errors: safeErrors, mastered: safeMastered });

    try {
      const safetyId = createHash("sha256").update("lingua-preview-user:" + PREVIEW_ACCESS_CODE).digest("hex");
      const response = await upstreamFetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + OPENAI_API_KEY,
          "Content-Type": "application/json",
          "OpenAI-Safety-Identifier": safetyId
        },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(12000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.value !== "string" || !data.value.startsWith("ek_")) return json(res, 502, { error: "openai_connection_failed" });
      // Only issue the short-lived client token, never send the long-lived API key.
      return json(res, 200, { value: data.value, expires_at: data.expires_at || null });
    } catch { return json(res, 502, { error: "openai_unreachable" }); }
  };
}

export function startServer() {
  const port = Number(process.env.PORT || 8787);
  const server = createServer(makeHandler());
  server.listen(port, "0.0.0.0", () => console.log("Lingua voice API listening on " + port));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) startServer();
