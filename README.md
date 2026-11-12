# Reading, in Every Form

An anonymous student research questionnaire with a server-backed response store and a password-protected administrator dashboard.

## Run locally

1. Install Node.js 20 or newer.
2. Keep the private `.env` file out of source control. `.env.example` shows the required settings; set a private `ADMIN_PASSWORD` of at least 12 characters.
3. From this folder, run `node server.js`.
4. Open <http://localhost:3000> to take the questionnaire or <http://localhost:3000/admin> to sign in to the dashboard.

The administrator username is configured with `ADMIN_USERNAME` (defaults to `fasiha`). The private password is read from `ADMIN_PASSWORD`; it is never included in the browser page. Change the initial password before sharing the site.

## Responses and deployment

Responses are anonymous and stored in `data/responses.json` on the server. Keep that file and any CSV exports confidential, restrict server access, and follow your institution's research-data retention and ethics requirements. The dashboard shows response counts, answer distributions, and optional written answers; it can download a CSV or print a report.

The default server listens on `127.0.0.1`, which is suitable for local testing only. To collect responses from other people, deploy the app on a server with persistent disk storage, set `HOST=0.0.0.0` and `NODE_ENV=production`, expose it through HTTPS, and keep the `.env` file and `data` directory private. `NODE_ENV=production` enables the secure-only administrator cookie. Use a single application instance unless response storage is moved to a database designed for concurrent/multi-instance use. Back up the data securely.
