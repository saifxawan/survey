"use strict";

const { neon } = require("@neondatabase/serverless");
const { error, hashToken, readCookie, SESSION_COOKIE, SESSION_TTL_SECONDS } = require("./api");

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

let sqlClient;
let schemaPromise;

function getSql() {
  if (!process.env.DATABASE_URL) {
    throw error(503, "Survey storage is not configured. Add DATABASE_URL to your Vercel project environment variables, then redeploy.");
  }
  if (!sqlClient) sqlClient = neon(process.env.DATABASE_URL);
  return sqlClient;
}

async function ensureSchema() {
  const sql = getSql();
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS survey_responses (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          answers JSONB NOT NULL
        )
      `;
      await sql`
        CREATE TABLE IF NOT EXISTS survey_admin_sessions (
          token_hash CHAR(64) PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL
        )
      `;
      await sql`CREATE INDEX IF NOT EXISTS survey_responses_submitted_at_idx ON survey_responses (submitted_at DESC)`;
      await sql`CREATE INDEX IF NOT EXISTS survey_admin_sessions_expires_at_idx ON survey_admin_sessions (expires_at)`;
    })().catch(exception => {
      schemaPromise = null;
      throw exception;
    });
  }
  await schemaPromise;
  return sql;
}

function validateResponse(body) {
  const answers = {};
  for (let id = 1; id <= 25; id++) {
    const key = `q${id}`;
    if (typeof body[key] !== "string") throw error(400, `Please answer question ${id}.`);
    const value = body[key].trim();
    if (value.length > (id >= 24 ? 2000 : 160)) throw error(400, `The answer to question ${id} is too long.`);
    if (id <= 23 && !CHOICES[key].includes(value)) throw error(400, `The answer to question ${id} is not valid.`);
    answers[key] = value;
  }
  for (const id of [4, 9, 23]) {
    const key = `q${id}Other`;
    if (answers[`q${id}`] === "Other") {
      if (typeof body[key] !== "string" || !body[key].trim() || body[key].trim().length > 160) {
        throw error(400, `Please specify your answer to question ${id}.`);
      }
      answers[key] = body[key].trim();
    } else {
      answers[key] = "";
    }
  }
  return answers;
}

async function saveResponse(answers) {
  const sql = await ensureSchema();
  await sql`INSERT INTO survey_responses (answers) VALUES (${JSON.stringify(answers)}::jsonb)`;
}

async function getResponses() {
  const sql = await ensureSchema();
  const rows = await sql`
    SELECT submitted_at, answers
    FROM survey_responses
    ORDER BY submitted_at DESC, id DESC
  `;
  return rows.map(row => ({
    ...row.answers,
    submittedAt: new Date(row.submitted_at).toISOString()
  }));
}

function getAdminCredentials() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) {
    throw error(503, "Admin sign-in is not configured. Set ADMIN_USERNAME and a private ADMIN_PASSWORD of at least 12 characters in Vercel, then redeploy.");
  }
  return { username, password };
}

async function createSession() {
  const token = require("node:crypto").randomBytes(32).toString("base64url");
  const sql = await ensureSchema();
  await sql`DELETE FROM survey_admin_sessions WHERE expires_at <= NOW()`;
  await sql`
    INSERT INTO survey_admin_sessions (token_hash, expires_at)
    VALUES (${hashToken(token)}, NOW() + (${SESSION_TTL_SECONDS} * INTERVAL '1 second'))
  `;
  return token;
}

async function validateSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length > 200) return false;
  const sql = await ensureSchema();
  const sessions = await sql`
    UPDATE survey_admin_sessions
    SET expires_at = NOW() + (${SESSION_TTL_SECONDS} * INTERVAL '1 second')
    WHERE token_hash = ${hashToken(token)} AND expires_at > NOW()
    RETURNING token_hash
  `;
  return sessions.length === 1;
}

async function deleteSession(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length > 200) return;
  const sql = await ensureSchema();
  await sql`DELETE FROM survey_admin_sessions WHERE token_hash = ${hashToken(token)}`;
}

module.exports = {
  createSession,
  deleteSession,
  getAdminCredentials,
  getResponses,
  saveResponse,
  validateResponse,
  validateSession
};
