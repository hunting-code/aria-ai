# Deploying ARIA AI

Three pieces: a PostgreSQL database and the FastAPI backend on Railway, and the
React frontend on Vercel. Do them in that order — the frontend needs the
backend's URL, and the backend needs the database's.

---

## 1. Database (Railway PostgreSQL)

1. railway.app → **New Project** → **Provision PostgreSQL**.
2. Open the Postgres service → **Variables** → copy `DATABASE_URL`.

It looks like `postgresql://postgres:PASSWORD@HOST:PORT/railway`.

> If the value starts with `postgres://`, change it to `postgresql://`.
> SQLAlchemy 2 does not accept the shorter scheme.

---

## 2. Backend (Railway)

1. Same project → **New** → **GitHub Repo** → pick this repository.
2. Settings → **Root Directory**: `backend`
3. Variables → add these:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the one you copied in step 1 |
| `SECRET_KEY` | a fresh 32+ char random string (see below) |
| `GROQ_API_KEY` | your Groq key |
| `LLM_PROVIDER` | `groq` |
| `GROQ_LLM_MODEL` | `openai/gpt-oss-120b` |
| `WHISPER_MODEL` | `whisper-large-v3-turbo` |
| `ALGORITHM` | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` |
| `ENVIRONMENT` | `production` |
| `CORS_ORIGINS` | your Vercel URL — fill in after step 3 |

Generate a secret key:

```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

**Do not reuse the `SECRET_KEY` from `backend/.env`.** Every token ever issued
in development was signed with it.

`OPENAI_API_KEY` is not needed while `LLM_PROVIDER=groq`.

4. Deploy, then check `https://YOUR-BACKEND.up.railway.app/health`.
   It must report `"database": "connected"`.

Tables are created automatically on first boot.

---

## 3. Frontend (Vercel)

```bash
cd frontend
npm install -g vercel        # once
vercel login
vercel --prod
```

When prompted, set the project root to `frontend`.

Then add **one** environment variable in the Vercel dashboard
(Settings → Environment Variables), or it will try to call `localhost:8000`:

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://YOUR-BACKEND.up.railway.app` |

Redeploy after adding it — Vite inlines env vars at build time, so a variable
added after the build has no effect until you rebuild:

```bash
vercel --prod --force
```

---

## 4. Close the loop

Go back to Railway and set `CORS_ORIGINS` to your Vercel URL, with no trailing
slash:

```
CORS_ORIGINS=https://your-app.vercel.app
```

Railway redeploys automatically. Without this, every browser request fails on a
CORS preflight even though the API itself is healthy.

---

## 5. Verify the four journeys live

Replace `APP` with your Vercel URL.

1. **New user** — `APP/register` → onboarding appears → skip resume →
   start a quick practice → answer 5 questions → analysis → Download PDF.
2. **Resume** — `APP/resume` → upload a text-based PDF → score and role fit
   appear → Suggested Questions tab shows 8 resume-specific questions.
3. **AI Meet** — `APP/select-role` → AI Meet → lobby (allow camera and mic) →
   Begin → five phases → debrief → `APP/career/<id>` → paste a job description
   → Analyse Match.
4. **Returning** — sign in → dashboard stats and trend chart → `APP/sessions`
   filters → `APP/settings` save preferences.

### Things that behave differently in production

- **HTTPS is required** for camera and microphone. Vercel and Railway both
  serve HTTPS, so this works — but it will not work over plain `http://`.
- **WebSockets** must use `wss://`. The frontend derives this from
  `VITE_API_URL`, so an `https://` value is all that is needed.
- **Free-tier cold starts.** The first request after an idle period can take
  20-30 seconds while the backend wakes. Open `/health` once before a demo.
- **Database volume.** Railway's free Postgres is small; it is fine for a
  demo, not for a class of users uploading resumes.
