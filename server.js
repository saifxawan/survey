"use strict";

const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "responses.json");
const SESSION_COOKIE = "reading_survey_admin";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const BODY_LIMIT = 20 * 1024;
const loginAttempts = new Map();
const submissionAttempts = new Map();
const sessions = new Map();
const LIKERT = ["Strongly Agree", "Agree", "Neutral", "Disagree", "Strongly Disagree", "Not Applicable"];
const CHOICES = {
  q1: ["18–22 years", "23–27 years", "28–32 years", "Above 32 years"],
  q2: ["Male", "Female", "Prefer not to say"],
  q3: ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"],
  q4: ["English Literature", "English Linguistics", "Education", "Computer Science", "Other"],
  q5: ["Daily", "Several times a week", "Once a week", "Less than once a week", "Not at all"],
  q6: ["Less than 30 minutes", "30 minutes–1 hour", "1–2 hours", "More than 2 hours", "I do not currently read books"],
  q7: ["E-books", "Printed books", "Both equally", "Neither"],
  q8: ["E-books", "Printed books", "Both equally", "No preference"],
  q9: ["Academic study", "Research", "Entertainment (novels, stories, etc.)", "Personal knowledge and development", "Other"],
  q10: ["Smartphone", "Laptop or desktop computer", "Tablet", "Dedicated e-reader (e.g., Kindle)", "I do not read e-books"],
  q21: ["E-books", "Printed books", "Both equally", "Not sure"],
  q22: ["E-books", "Printed books", "Both equally", "Not sure"],
  q23: ["Lack of time", "Digital distractions", "Cost or unavailability of books", "Lack of interest or motivation", "Difficulty concentrating", "Other"]
};
for (let id = 11; id <= 20; id++) CHOICES[`q${id}`] = LIKERT;

function loadEnvFile() {
  let contents;
  try {
    contents = require("node:fs").readFileSync(path.join(ROOT, ".env"), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnvFile();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "fasiha";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  throw new Error("Set ADMIN_PASSWORD to a password of at least 12 characters in .env or the environment before starting the survey server.");
}

const ADMIN_SALT = crypto.randomBytes(16);
const ADMIN_PASSWORD_HASH = crypto.scryptSync(ADMIN_PASSWORD, ADMIN_SALT, 64);
const ADMIN_USERNAME_HASH = crypto.createHash("sha256").update(ADMIN_USERNAME).digest();
const SECURE_COOKIE = process.env.NODE_ENV === "production";

function jsonResponse(response, status, value, headers = {}) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(body);
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function secureEqual(left, right) {
  const leftBuffer = Buffer.isBuffer(left) ? left : Buffer.from(String(left));
  const rightBuffer = Buffer.isBuffer(right) ? right : Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) {
    crypto.timingSafeEqual(Buffer.alloc(rightBuffer.length), rightBuffer);
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function secureHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
  };
}

async function readJsonBody(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw fail(415, "This endpoint accepts JSON requests only.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw fail(413, "The request is too large.");
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || Array.isArray(body) || typeof body !== "object") throw new Error("Expected an object");
    return body;
  } catch {
    throw fail(400, "The request body must be a valid JSON object.");
  }
}

function checkRateLimit(map, key, max, windowMs) {
  const now = Date.now();
  const prior = map.get(key) || { count: 0, resetAt: now + windowMs };
  if (prior.resetAt <= now) {
    prior.count = 0;
    prior.resetAt = now + windowMs;
  }
  prior.count++;
  map.set(key, prior);
  if (map.size > 2000) {
    for (const [entryKey, entry] of map) {
      if (entry.resetAt <= now) map.delete(entryKey);
    }
  }
  if (prior.count > max) {
    throw fail(429, "Too many attempts. Please wait a little while and try again.");
  }
}

function validateResponse(body) {
  const answer = {};
  for (let id = 1; id <= 25; id++) {
    const key = `q${id}`;
    if (typeof body[key] !== "string") throw fail(400, `Please answer question ${id}.`);
    const value = body[key].trim();
    if (value.length > (id >= 24 ? 2000 : 160)) throw fail(400, `The answer to question ${id} is too long.`);
    if (id <= 23) {
      const options = CHOICES[key];
      if (!options.includes(value)) throw fail(400, `The answer to question ${id} is not valid.`);
    }
    answer[key] = value;
  }
  for (const id of [4, 9, 23]) {
    const key = `q${id}Other`;
    const value = body[key];
    if (answer[`q${id}`] === "Other") {
      if (typeof value !== "string" || !value.trim() || value.trim().length > 160) {
        throw fail(400, `Please specify your answer to question ${id}.`);
      }
      answer[key] = value.trim();
    } else {
      answer[key] = "";
    }
  }
  answer.submittedAt = new Date().toISOString();
  return answer;
}

async function getResponses() {
  try {
    const content = await fs.readFile(DATA_FILE, "utf8");
    const responses = JSON.parse(content);
    if (!Array.isArray(responses)) throw new Error("Response data must be an array.");
    return responses;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw new Error(`Could not read survey response data: ${error.message}`);
  }
}

let writeQueue = Promise.resolve();
function saveResponse(response) {
  const write = writeQueue.then(async () => {
    const responses = await getResponses();
    responses.push(response);
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporaryFile = `${DATA_FILE}.${process.pid}.tmp`;
    await fs.writeFile(temporaryFile, JSON.stringify(responses, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryFile, DATA_FILE);
  });
  writeQueue = write.catch(() => {});
  return write;
}

function getSession(request) {
  const cookie = request.headers.cookie || "";
  const token = cookie.split(";").map(value => value.trim()).find(value => value.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  const session = token && sessions.get(token);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return token;
}

function ensureSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    if (new URL(origin).host !== request.headers.host) throw fail(403, "The request origin is not allowed.");
  } catch (error) {
    if (error.status) throw error;
    throw fail(403, "The request origin is not allowed.");
  }
}

function requireAdmin(request) {
  const token = getSession(request);
  if (!token) throw fail(401, "Please sign in to access the administrator dashboard.");
  return token;
}

function setSessionCookie(response, token, maxAge) {
  const secure = SECURE_COOKIE ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}${secure}`);
}

async function serveFile(response, filename) {
  const contents = await fs.readFile(path.join(ROOT, filename));
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": contents.length,
    "Cache-Control": "no-cache",
    ...secureHeaders()
  });
  response.end(contents);
}

async function handleRequest(request, response) {
  response.setHeaders(new Headers(secureHeaders()));
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const ip = request.socket.remoteAddress || "unknown";

  if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    await serveFile(response, "index.html");
    return;
  }
  if (request.method === "GET" && (url.pathname === "/admin" || url.pathname === "/admin/")) {
    await serveFile(response, "admin.html");
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/responses") {
    checkRateLimit(submissionAttempts, ip, 120, 60 * 60 * 1000);
    const body = await readJsonBody(request);
    const surveyResponse = validateResponse(body);
    await saveResponse(surveyResponse);
    jsonResponse(response, 201, { received: true });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/admin/login") {
    ensureSameOrigin(request);
    checkRateLimit(loginAttempts, ip, 10, 15 * 60 * 1000);
    const body = await readJsonBody(request);
    if (typeof body.username !== "string" || typeof body.password !== "string" || body.password.length > 1024) {
      throw fail(400, "Enter a valid username and password.");
    }
    const usernameHash = crypto.createHash("sha256").update(body.username).digest();
    const passwordHash = crypto.scryptSync(body.password, ADMIN_SALT, 64);
    const valid = secureEqual(usernameHash, ADMIN_USERNAME_HASH) && secureEqual(passwordHash, ADMIN_PASSWORD_HASH);
    if (!valid) throw fail(401, "The username or password is incorrect.");
    loginAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString("base64url");
    sessions.set(token, { expiresAt: Date.now() + SESSION_TTL_MS });
    setSessionCookie(response, token, Math.floor(SESSION_TTL_MS / 1000));
    jsonResponse(response, 200, { authenticated: true });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/admin/session") {
    jsonResponse(response, 200, { authenticated: Boolean(getSession(request)) });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/admin/responses") {
    requireAdmin(request);
    await writeQueue;
    const responses = await getResponses();
    jsonResponse(response, 200, { responses });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/admin/logout") {
    ensureSameOrigin(request);
    const token = requireAdmin(request);
    sessions.delete(token);
    setSessionCookie(response, "", 0);
    jsonResponse(response, 200, { signedOut: true });
    return;
  }
  jsonResponse(response, 404, { error: "Not found." });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    const status = Number.isInteger(error.status) ? error.status : 500;
    if (status >= 500) console.error(error);
    if (response.headersSent) {
      response.destroy();
      return;
    }
    jsonResponse(response, status, {
      error: status >= 500 ? "The server could not complete the request." : error.message
    });
  });
});

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3000);
server.listen(port, host, () => {
  console.log(`Reading survey is available at http://${host}:${port}`);
  console.log(`Administrator dashboard: http://${host}:${port}/admin`);
});

function shutdown() {
  server.close(error => {
    if (error) {
      console.error("Could not close the survey server cleanly.", error);
      process.exitCode = 1;
    }
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
