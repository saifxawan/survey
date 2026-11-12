"use strict";

const { error, handleError, json, methodNotAllowed } = require("../../lib/api");
const { getResponses, validateSession } = require("../../lib/database");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") return methodNotAllowed(response, ["GET"]);
  try {
    if (!await validateSession(request)) throw error(401, "Please sign in to access the administrator dashboard.");
    const responses = await getResponses();
    return json(response, 200, { responses });
  } catch (exception) {
    return handleError(response, exception);
  }
};
