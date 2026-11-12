"use strict";

const crypto = require("node:crypto");

const BODY_LIMIT = 20 * 1024;
const SESSION_COOKIE = "reading_survey_admin";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

function json(response, status, value, headers = {}) {
  response.status(status);
  for (const [name, content] of Object.entries({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    ...headers
  })) {
    response.setHeader(name, content);
  }
  response.json(value);
}

function error(status, message) {
  const result = new Error(message);
  result.status = status;
  return result;
}

function handleError(response, exception) {
  const status = Number.isInteger(exception.status) ? exception.status : 500;
  if (status >= 500) console.error(exception);
  json(response, status, {
    error: status === 503 ? exception.message : status >= 500 ? "The survey service could not complete the request." : exception.message
  });
}

function methodNotAllowed(response, allowed) {
  response.setHeader("Allow", allowed.join(", "));
  json(response, 405, { error: `Use ${allowed.join(" or ")} for this endpoint.` });
}

function readBody(request) {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw error(415, "This endpoint accepts JSON requests only.");
  }
  let value = request.body;
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value === "string") {
    if (Buffer.byteLength(value) > BODY_LIMIT) throw error(413, "The request is too large.");
    try {
      value = JSON.parse(value);
    } catch {
      throw error(400, "The request body must be valid JSON.");
    }
  }
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw error(400, "The request body must be a JSON object.");
  }
  if (Buffer.byteLength(JSON.stringify(value)) > BODY_LIMIT) throw error(413, "The request is too large.");
  return value;
}

function requireSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return;
  try {
    const originUrl = new URL(origin);
    const host = request.headers["x-forwarded-host"] || request.headers.host;
    if (originUrl.host !== host) throw error(403, "The request origin is not allowed.");
  } catch (exception) {
    if (exception.status) throw exception;
    throw error(403, "The request origin is not allowed.");
  }
}

function readCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  const item = cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : "";
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(response, token, maxAge) {
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}; Secure`
  );
}

function constantTimeEqual(left, right) {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

module.exports = {
  BODY_LIMIT,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  constantTimeEqual,
  error,
  handleError,
  hashToken,
  json,
  methodNotAllowed,
  readBody,
  readCookie,
  requireSameOrigin,
  setSessionCookie
};
