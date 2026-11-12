"use strict";

const {
  constantTimeEqual,
  error,
  handleError,
  json,
  methodNotAllowed,
  readBody,
  requireSameOrigin,
  setSessionCookie,
  SESSION_TTL_SECONDS
} = require("../../lib/api");
const { createSession, getAdminCredentials } = require("../../lib/database");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    requireSameOrigin(request);
    const body = readBody(request);
    if (typeof body.username !== "string" || typeof body.password !== "string" || body.password.length > 1024) {
      throw error(400, "Enter a valid username and password.");
    }
    const credentials = getAdminCredentials();
    const usernameMatches = constantTimeEqual(body.username, credentials.username);
    const passwordMatches = constantTimeEqual(body.password, credentials.password);
    if (!usernameMatches || !passwordMatches) {
      throw error(401, "The username or password is incorrect.");
    }
    const token = await createSession();
    setSessionCookie(response, token, SESSION_TTL_SECONDS);
    return json(response, 200, { authenticated: true });
  } catch (exception) {
    return handleError(response, exception);
  }
};
