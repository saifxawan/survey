"use strict";

const { handleError, json, methodNotAllowed } = require("../../lib/api");
const { validateSession } = require("../../lib/database");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  try {
    const authenticated = await validateSession(request);
    return json(response, 200, { authenticated });
  } catch (exception) {
    return handleError(response, exception);
  }
};
