import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { promisify } from "node:util";
import { normalizeAiAnalysis } from "../core.js";
import { buildAiMessages } from "./ai-prompt.mjs";
import { createShareSvg } from "./share-image.mjs";

const scryptAsync = promisify(scrypt);

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const dataDir = join(root, "data");
const configPath = join(dataDir, "ai-config.json");
const adminConfigPath = join(dataDir, "admin-config.json");
const ratesCachePath = join(dataDir, "rates-cache.json");
const shareDirectory = join(root, "storage", "shares");
const publicFiles = new Set(["index.html", "styles.css", "app.js", "core.js", "favicon.svg"]);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

/* ---------- Password hashing (scrypt) ---------- */

async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64);
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) return false;
  const derived = await scryptAsync(password, salt, 64);
  const keyBuffer = Buffer.from(key, "hex");
  if (derived.length !== keyBuffer.length) return false;
  return timingSafeEqual(derived, keyBuffer);
}

/* ---------- Session management ---------- */

const SESSION_TTL = Number(process.env.SESSION_TTL_MINUTES || 120) * 60_000;
const SESSION_COOKIE = "vpsvalue_session";
const sessions = new Map();

function createSession() {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { createdAt: Date.now() });
  return token;
}

function validateSession(request) {
  const cookie = String(request.headers.cookie || "");
  const match = cookie.match(new RegExp(`(?:^|;)\\s*${SESSION_COOKIE}=([a-f0-9]{64})`));
  if (!match) return false;
  const token = match[1];
  const entry = sessions.get(token);
  if (!entry) return false;
  if (Date.now() - entry.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return false;
  }
  entry.createdAt = Date.now();
  return true;
}

function assertAdminSession(request) {
  if (!validateSession(request)) throw Object.assign(new Error("请先登录管理后台"), { statusCode: 401 });
}

function sessionCookieHeader(token) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_TTL / 1000)}`;
}

function clearSessionCookie() {
  return `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

function destroySession(request) {
  const cookie = String(request.headers.cookie || "");
  const match = cookie.match(new RegExp(`(?:^|;)\\s*${SESSION_COOKIE}=([a-f0-9]{64})`));
  if (match) sessions.delete(match[1]);
}

/* ---------- Login rate limiting ---------- */

const LOGIN_WINDOW = 60_000;
const LOGIN_MAX = 5;
const loginAttempts = new Map();

function checkLoginRate(request) {
  const ip = request.socket.remoteAddress || "unknown";
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + LOGIN_WINDOW };
    loginAttempts.set(ip, entry);
  }
  entry.count += 1;
  if (entry.count > LOGIN_MAX) {
    throw new Error("登录尝试过于频繁，请稍后再试");
  }
}

// Periodically clean up expired entries
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (now > entry.resetAt) loginAttempts.delete(ip);
  }
  for (const [token, entry] of sessions) {
    if (now - entry.createdAt > SESSION_TTL) sessions.delete(token);
  }
}, 60_000).unref();

/* ---------- Admin config (password storage) ---------- */

async function readAdminConfig() {
  try {
    return JSON.parse(await readFile(adminConfigPath, "utf8"));
  } catch {
    return {};
  }
}

async function needsSetup() {
  if (process.env.ADMIN_PASSWORD) return false;
  const config = await readAdminConfig();
  return !config.passwordHash;
}

async function setupPassword(password) {
  if (!(await needsSetup())) throw new Error("管理密码已设置");
  if (!password || password.length < 6) throw new Error("密码长度至少 6 位");
  const hash = await hashPassword(password);
  await mkdir(dataDir, { recursive: true });
  await writeFile(adminConfigPath, `${JSON.stringify({ passwordHash: hash }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

async function checkPassword(password) {
  const envPassword = process.env.ADMIN_PASSWORD;
  if (envPassword) return password === envPassword;
  const config = await readAdminConfig();
  if (!config.passwordHash) throw new Error("请先设置管理密码");
  return verifyPassword(password, config.passwordHash);
}



/* ---------- HTTP helpers ---------- */

function allowedOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return "";
  if (origin === "null" || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin)) return origin;
  const protocol = request.headers["x-forwarded-proto"] || "http";
  return origin === `${protocol}://${request.headers.host}` ? origin : "";
}

function commonHeaders(request, extra = {}) {
  const origin = allowedOrigin(request);
  return {
    "X-Content-Type-Options": "nosniff",
    ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
    ...extra,
  };
}

function adminHeaders(request, extra = {}) {
  return commonHeaders(request, {
    "X-Robots-Tag": "noindex, nofollow",
    "Cache-Control": "no-store",
    ...extra,
  });
}

function sendJson(request, response, status, payload, headers) {
  response.writeHead(status, (headers || commonHeaders)(request, { "Content-Type": "application/json; charset=utf-8" }));
  response.end(JSON.stringify(payload));
}

function sendAdminJson(request, response, status, payload, extraHeaders = {}) {
  response.writeHead(status, adminHeaders(request, { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }));
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request, limit = 65_536) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new Error("请求内容过大");
  }
  try {
    return JSON.parse(body || "{}");
  } catch {
    throw new Error("请求不是有效的 JSON");
  }
}

/* ---------- Rates ---------- */

function localDateKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

async function readRatesCache() {
  try {
    return JSON.parse(await readFile(ratesCachePath, "utf8"));
  } catch {
    return null;
  }
}

async function loadServerRates() {
  const cached = await readRatesCache();
  if (cached?.cachedOn === localDateKey() && cached?.rates?.USD) {
    return { ...cached, stale: false, source: "Frankfurter" };
  }
  try {
    const response = await fetch("https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,EUR,GBP,HKD,JPY", {
      headers: { Accept: "application/json" },
      signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15_000) : undefined,
    });
    if (!response.ok) throw new Error(`汇率接口返回 HTTP ${response.status}`);
    const data = await response.json();
    const rates = { CNY: 1 };
    Object.entries(data.rates || {}).forEach(([currency, perCny]) => {
      if (Number(perCny) > 0) rates[currency] = 1 / Number(perCny);
    });
    if (!rates.USD) throw new Error("汇率接口缺少 USD 数据");
    const record = { rates, date: data.date || localDateKey(), cachedOn: localDateKey() };
    await mkdir(dataDir, { recursive: true });
    await writeFile(ratesCachePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    return { ...record, stale: false, source: "Frankfurter" };
  } catch (error) {
    if (cached?.rates?.USD) return { ...cached, stale: true, source: "Frankfurter", warning: error.message };
    throw new Error(`服务器无法取得参考汇率：${error.message}`);
  }
}

/* ---------- AI config ---------- */

async function readSavedAiConfig() {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return {};
  }
}

async function readAiConfig() {
  const saved = await readSavedAiConfig();
  return {
    baseUrl: process.env.AI_BASE_URL || saved.baseUrl || "https://api.openai.com/v1",
    model: process.env.AI_MODEL || saved.model || "gpt-4.1-mini",
    apiKey: process.env.AI_API_KEY || saved.apiKey || "",
  };
}

function publicAiConfig(config) {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: Boolean(config.apiKey),
    enabled: Boolean(config.apiKey && config.baseUrl && config.model),
  };
}

async function saveAiConfig(input) {
  const current = await readSavedAiConfig();
  const baseUrl = String(input.baseUrl || current.baseUrl).trim().replace(/\/$/, "");
  const model = String(input.model || current.model).trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error("API 地址格式不正确");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("API 地址必须使用 HTTP 或 HTTPS");
  if (!model || model.length > 160) throw new Error("请填写有效的模型名称");
  const config = {
    baseUrl,
    model,
    apiKey: String(input.apiKey || current.apiKey || "").trim(),
  };
  await mkdir(dataDir, { recursive: true });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return config;
}

/* ---------- AI analysis ---------- */

function chatEndpoint(baseUrl) {
  return /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl.replace(/\/$/, "")}/chat/completions`;
}

function extractMessageText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part?.text || "").join("");
  throw new Error("AI 接口没有返回可解析的内容");
}

function parseAiJson(text) {
  const source = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(source);
  } catch {
    const match = source.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI 返回的不是 JSON");
    return JSON.parse(match[0]);
  }
}

async function analyzeWithAi(text) {
  const config = await readAiConfig();
  if (!config.apiKey) throw new Error("尚未配置 AI API Key");
  const response = await fetch(chatEndpoint(config.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: buildAiMessages(text),
    }),
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(35_000) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.message || `AI 接口返回 HTTP ${response.status}`;
    throw new Error(String(detail).slice(0, 240));
  }
  const normalized = normalizeAiAnalysis(parseAiJson(extractMessageText(data)));
  if (!normalized.ok) throw new Error(normalized.error);
  return { ...normalized, source: "ai", model: config.model };
}

async function testAiConnection(input) {
  const current = await readAiConfig();
  const config = {
    baseUrl: String(input.baseUrl || current.baseUrl || "").trim().replace(/\/$/, ""),
    model: String(input.model || current.model || "").trim(),
    apiKey: String(input.apiKey || current.apiKey || "").trim(),
  };
  let parsedUrl;
  try {
    parsedUrl = new URL(config.baseUrl);
  } catch {
    throw new Error("API 地址格式不正确");
  }
  if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("API 地址必须使用 HTTP 或 HTTPS");
  if (!config.model) throw new Error("请填写模型名称");
  if (!config.apiKey) throw new Error("请填写或先保存 API Key");

  const startedAt = Date.now();
  const response = await fetch(chatEndpoint(config.baseUrl), {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      max_tokens: 8,
      messages: [
        { role: "system", content: "Reply with exactly OK." },
        { role: "user", content: "Connection test" },
      ],
    }),
    signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(20_000) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(data?.error?.message || `AI 接口返回 HTTP ${response.status}`).slice(0, 240));
  const reply = extractMessageText(data).trim().slice(0, 80);
  return { ok: true, model: config.model, latencyMs: Date.now() - startedAt, reply };
}

/* ---------- Share image ---------- */

function sharePayload(input) {
  return {
    cnyValue: Math.max(0, Math.min(Number(input.cnyValue) || 0, 100_000_000)),
    remainingDays: Math.max(0, Math.min(Number(input.remainingDays) || 0, 36_500)),
    totalDays: Math.max(1, Math.min(Number(input.totalDays) || 1, 36_500)),
    renewalPrice: Math.max(0, Math.min(Number(input.renewalPrice) || 0, 100_000_000)),
    currency: String(input.currency || "CNY").slice(0, 8),
    cycleLabel: String(input.cycleLabel || "账单周期").slice(0, 20),
    nextPayment: String(input.nextPayment || "—").slice(0, 20),
    valuationDate: String(input.valuationDate || "—").slice(0, 20),
  };
}

async function createShare(request, input) {
  const id = `${Date.now().toString(36)}-${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const fileName = `${id}.svg`;
  const svgContent = createShareSvg(sharePayload(input));

  // Local storage
  await mkdir(shareDirectory, { recursive: true });
  await writeFile(join(shareDirectory, fileName), svgContent, "utf8");
  const forwardedProtocol = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const publicRoot = String(process.env.PUBLIC_BASE_URL || `${forwardedProtocol}://${request.headers.host}`).replace(/\/$/, "");
  const url = `${publicRoot}/shares/${fileName}`;
  return { id, url, markdown: `![VPS 剩余价值](${url})` };
}

/* ---------- API routing ---------- */

async function handleAdminApi(request, response, pathname) {
  try {
    if (request.method === "GET" && pathname === "/api/admin/status") {
      sendAdminJson(request, response, 200, {
        needsSetup: await needsSetup(),
        loggedIn: validateSession(request),
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/admin/setup") {
      const body = await readJsonBody(request);
      const password = String(body.password || "");
      const confirm = String(body.confirm || "");
      if (password !== confirm) throw new Error("两次输入的密码不一致");
      await setupPassword(password);
      sendAdminJson(request, response, 200, { ok: true });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/admin/login") {
      checkLoginRate(request);
      const body = await readJsonBody(request);
      const password = String(body.password || "");
      if (!password) throw new Error("请输入密码");
      const valid = await checkPassword(password);
      if (!valid) throw new Error("密码不正确");
      const token = createSession();
      sendAdminJson(request, response, 200, { ok: true }, {
        "Set-Cookie": sessionCookieHeader(token),
      });
      return true;
    }

    if (request.method === "POST" && pathname === "/api/admin/logout") {
      destroySession(request);
      sendAdminJson(request, response, 200, { ok: true }, {
        "Set-Cookie": clearSessionCookie(),
      });
      return true;
    }

  } catch (error) {
    const status = error.statusCode || 400;
    sendAdminJson(request, response, status, { ok: false, error: error.message || "请求失败" });
    return true;
  }
  return false;
}

async function handleApi(request, response, pathname) {
  if (pathname.startsWith("/api/admin/")) return handleAdminApi(request, response, pathname);

  try {
    if (request.method === "GET" && pathname === "/api/rates") {
      sendJson(request, response, 200, { ok: true, ...(await loadServerRates()) });
      return true;
    }
    if (request.method === "GET" && pathname === "/api/ai-config") {
      sendJson(request, response, 200, publicAiConfig(await readAiConfig()));
      return true;
    }
    if (request.method === "POST" && pathname === "/api/ai-config") {
      assertAdminSession(request);
      const saved = await saveAiConfig(await readJsonBody(request));
      sendAdminJson(request, response, 200, { ok: true, ...publicAiConfig(saved) });
      return true;
    }
    if (request.method === "POST" && pathname === "/api/ai-test") {
      assertAdminSession(request);
      sendAdminJson(request, response, 200, await testAiConnection(await readJsonBody(request)));
      return true;
    }
    if (request.method === "POST" && pathname === "/api/analyze") {
      const body = await readJsonBody(request);
      const text = String(body.text || "").trim();
      if (!text) throw new Error("请提供需要分析的账单文字");
      if (text.length > 20_000) throw new Error("账单文字不能超过 20,000 字");
      sendJson(request, response, 200, await analyzeWithAi(text));
      return true;
    }
    if (request.method === "POST" && pathname === "/api/share") {
      sendJson(request, response, 201, { ok: true, ...(await createShare(request, await readJsonBody(request))) });
      return true;
    }
  } catch (error) {
    const status = error.statusCode || (/未配置|尚未配置/.test(error.message) ? 503 : 400);
    sendJson(request, response, status, { ok: false, error: error.message || "请求失败" });
    return true;
  }
  return false;
}

/* ---------- HTTP server ---------- */

createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, commonHeaders(request, {
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    }));
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  if (pathname.startsWith("/api/") && await handleApi(request, response, pathname)) return;

  // Serve admin page
  if (pathname === "/admin" || pathname === "/admin/") {
    const adminFile = join(root, "admin.html");
    try {
      const content = await readFile(adminFile);
      response.writeHead(200, adminHeaders(request, { "Content-Type": "text/html; charset=utf-8" }));
      response.end(content);
    } catch {
      response.writeHead(404, adminHeaders(request)).end("Not found");
    }
    return;
  }

  const isShare = pathname.startsWith("/shares/");
  const shareFile = isShare ? decodeURIComponent(pathname.slice(8)) : "";
  if (isShare && !/^[a-z0-9][a-z0-9._-]*\.svg$/i.test(shareFile)) {
    response.writeHead(404, commonHeaders(request)).end("Not found");
    return;
  }
  const relative = pathname === "/"
    ? "index.html"
    : isShare
      ? join("storage", "shares", shareFile)
      : decodeURIComponent(pathname).slice(1);
  if (!isShare && !publicFiles.has(relative)) {
    response.writeHead(404, commonHeaders(request)).end("Not found");
    return;
  }
  const target = normalize(join(root, relative));
  if (!target.startsWith(root)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const details = await stat(target);
    if (!details.isFile()) throw new Error("Not a file");
    response.writeHead(200, commonHeaders(request, {
      "Content-Type": types[extname(target)] || "application/octet-stream",
      ...(isShare ? { "Cache-Control": "public, max-age=31536000, immutable" } : {}),
    }));
    response.end(await readFile(target));
  } catch {
    response.writeHead(404, commonHeaders(request)).end("Not found");
  }
}).listen(port, host, () => {
  console.log(`VPS Value running at http://${host}:${port}`);
});
