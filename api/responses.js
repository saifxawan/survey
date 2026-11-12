"use strict";

const { handleError, json, methodNotAllowed, readBody } = require("../lib/api");
const { saveResponse, validateResponse } = require("../lib/database");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") return methodNotAllowed(response, ["POST"]);
  try {
    const answers = validateResponse(readBody(request));
    await saveResponse(answers);
    return json(response, 201, { received: true });
  } catch (exception) {
    return handleError(response, exception);
  }
};
