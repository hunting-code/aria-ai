# Deploying ARIA AI

Three pieces: a PostgreSQL database on Neon, the FastAPI backend on Render,
and the React frontend on Vercel. All three are free and none asks for a card. Do them in that order — the frontend needs the
backend's URL, and the backend needs the database's.

---

## 1. Database (Neon — free, no card)

Neon rather than Render's own PostgreSQL: **Render deletes free databases after
30 days**, which would take your project down mid-semester. Neon's free tier
does not expire.

1. neon.tech → sign in with GitHub → **Create project**.
2. Name it `aria-ai`, pick the region nearest you, accept the defaults.
3. On the dashboard, copy the **connection string** (Pooled connection).

It looks like:
`postgresql://user:PASSWORD@ep-xxx-pooler.region.aws.neon.tech/neondb?sslmode=require`

Two things to check before moving on:

- It must start `postgresql://`, not `postgres://` — SQLAlchemy 2 rejects the
  short scheme. Edit it if needed.
- Keep `?sslmode=require` on the end. Neon refuses unencrypted connections.

---

## 2. Backend (Render — free, no card)

1. render.com → sign in with GitHub → **New** → **Web Service**.
2. Connect your `aria-ai` repository.
3. Settings:

   | Field | Value |
   |---|---|
   | Root Directory | `backend` |
   | Runtime | Python 3 |
   | Build Command | `pip install -r requirements.txt` |
   | Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
   | Instance Type | **Free** |

   (Or use **New → Blueprint** and let Render read `render.yaml`, which sets all
   of this for you.)

4. **Environment** → add:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | the Neon string from step 1 |
   | `SECRET_KEY` | your freshly generated key |
   | `GROQ_API_KEY` | your Groq key |
   | `LLM_PROVIDER` | `groq` |
   | `GROQ_LLM_MODEL` | `openai/gpt-oss-120b` |
   | `WHISPER_MODEL` | `whisper-large-v3-turbo` |
   | `ALGORITHM` | `HS256` |
   | `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` |
   | `ENVIRONMENT` | `production` |
   | `CORS_ORIGINS` | your Vercel URL — fill in after step 3 |
   | `ELEVENLABS_API_KEY` | optional — see the note below |

   **On ElevenLabs:** the free tier is 10,000 characters a month, and one
   complete AI Meet speaks about 4,100 — roughly **two interviews**. Leave the
   key unset and ARIA uses the browser's own voice, which is robotic but free
   and unlimited. If you do set it, the app falls back to the browser voice
   automatically the moment the quota runs out, so a demo cannot be derailed
   mid-answer.

   Generate the secret key yourself:

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

   **Do not reuse the `SECRET_KEY` from `backend/.env`** — every token issued
   in development was signed with it.

   `OPENAI_API_KEY` is not needed while `LLM_PROVIDER=groq`.

5. Deploy. The first build takes 3-5 minutes.
6. Check `https://YOUR-SERVICE.onrender.com/health` — it must report
   `"database": "connected"`.

Tables are created automatically on first boot.

### The free tier sleeps

A free Render service **spins down after 15 minutes of inactivity**, and the
next request takes **about 50 seconds** while it wakes. That is fine for a demo
as long as you know: open `/health` a minute before you present, and it will be
warm.

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
| `VITE_API_URL` | `https://YOUR-SERVICE.onrender.com` |

Redeploy after adding it — Vite inlines env vars at build time, so a variable
added after the build has no effect until you rebuild:

```bash
vercel --prod --force
```

---

## 4. Close the loop

Go back to Render and set `CORS_ORIGINS` to your Vercel URL, with no trailing
slash:

```
CORS_ORIGINS=https://your-app.vercel.app
```

Render redeploys automatically. Without this, every browser request fails on a
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

- **HTTPS is required** for camera and microphone. Vercel and Render both
  serve HTTPS, so this works — but it will not work over plain `http://`.
- **WebSockets** must use `wss://`. The frontend derives this from
  `VITE_API_URL`, so an `https://` value is all that is needed.
- **Free-tier cold starts.** Render sleeps the service after 15 minutes idle;
  the next request takes ~50 seconds. Open `/health` before a demo.
- **Database size.** Neon's free tier is 0.5 GB — ample for a demo, not for a
  cohort uploading resumes.
