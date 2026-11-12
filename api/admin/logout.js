"use strict";

const {
  error,
  handleError,
  json,
  methodNotAllowed,
  requireSameOrigin,
  setSessionCookie
} = require("../../lib/api");
const { deleteSession, validateSession } = require("../../lib/database");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    requireSameOrigin(request);
    if (!await validateSession(request)) throw error(401, "Your administrator session has expired.");
    await deleteSession(request);
    setSessionCookie(response, "", 0);
    return json(response, 200, { signedOut: true });
  } catch (exception) {
    return handleError(response, exception);
  }
};
