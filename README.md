# Reading, in Every Form

An anonymous student research questionnaire with a server-backed response store and a password-protected administrator dashboard.

## Run locally

1. Install Node.js 20 or newer.
2. Keep the private `.env` file out of source control. `.env.example` shows the required settings; set a private `ADMIN_PASSWORD` of at least 12 characters.
3. From this folder, run `node server.js`.
4. Open <http://localhost:3000> to take the questionnaire or <http://localhost:3000/admin> to sign in to the dashboard.

The administrator username is configured with `ADMIN_USERNAME` (defaults to `fasiha`). The private password is read from `ADMIN_PASSWORD`; it is never included in the browser page. Change the initial password before sharing the site.

## Vercel

`vercel.json` maps `/admin` to `admin.html`. The files under `api/` provide Vercel serverless functions for anonymous response submissions and administrator sign-in, session management, reporting, and sign-out. Responses and revocable administrator sessions are stored in Neon Postgres.

To enable survey submission and administrator sign-in on Vercel:

1. Create a Neon Postgres database and copy its pooled connection string (`DATABASE_URL`).
2. In Vercel, open **Project → Settings → Environment Variables** and add `DATABASE_URL`, `ADMIN_USERNAME`, and `ADMIN_PASSWORD` for the **Production** environment. Set `ADMIN_PASSWORD` to a new, private password of at least 12 characters; do not reuse the example or commit it to Git.
3. Redeploy after saving the environment variables. The API creates the required database tables automatically on first use.
4. Open `/admin` on the deployed site and sign in with those environment variables. If they are missing, the API reports a configuration error rather than accepting an insecure default.

Use the same database URL in **Preview** or **Development** only if you intend those deployments to share the same response data. Do not expose the database connection string in client-side environment variables (for example, `NEXT_PUBLIC_*`).

## Responses and deployment

Responses are anonymous and stored in `data/responses.json` on the server. Keep that file and any CSV exports confidential, restrict server access, and follow your institution's research-data retention and ethics requirements. The dashboard shows response counts, answer distributions, and optional written answers; it can download a CSV or print a report.

The default server listens on `127.0.0.1`, which is suitable for local testing only. The standalone `server.js` development server stores responses in `data/responses.json`; Vercel functions use the Neon database configured by `DATABASE_URL`. Deploy the site over HTTPS and keep the `.env` file, database credentials, response data, and CSV exports private. Back up and retain research data according to your institution's requirements.
