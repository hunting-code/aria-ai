# ARIA AI — Adaptive Real-time Interview Assessor

An AI mock-interview platform that listens to you answer, scores what you said *and* how you said it, and adapts the next question to how you are doing.

---

## What This Project Does

ARIA AI runs realistic job interviews in your browser. You pick a role and a difficulty, ARIA asks a question, you answer out loud, and your speech is transcribed and analysed in real time — filler words, speaking pace and confidence appear on screen while you are still talking.

What makes it different from a static question list is that **ARIA adapts**. After every answer it re-reads your performance and pulls the next question from a harder or easier pool, never repeating one, so two interviews for the same role are never the same interview. A thin answer earns a targeted follow-up rather than a polite move to the next topic.

It is built for students and early-career candidates who want unlimited, honest practice without booking a human. Afterwards you get a scored breakdown per question, a shareable PDF report, and a history view that tracks whether you are actually improving.

---

## Tech Stack

### Frontend

| Technology | What it does in this project |
| --- | --- |
| **React 19** | Builds the entire user interface as components |
| **Vite 8** | Dev server with instant reload, and the production bundler |
| **Tailwind CSS 3** | All styling — the "Neural Dark" theme lives in `tailwind.config.js` |
| **React Router 7** | Client-side routing between the nine pages |
| **Zustand** | Global state for authentication and toast notifications |
| **Axios** | HTTP client; attaches the auth token and handles 401 logout |
| **Recharts** | Score-trend line chart, radar chart, and the weekly bar chart |
| **Framer Motion** | Slide transitions between the role-selection wizard steps |
| **Lucide React** | Icon set used across the whole UI |
| **jsPDF + html2canvas** | Client-side "Download PDF" — captures the report and slices it into A4 pages |
| **Web Audio API + MediaRecorder** | Captures the microphone and drives the live waveform meter |

### Backend

| Technology | What it does in this project |
| --- | --- |
| **Python 3.13** | Language runtime (3.10+ works) |
| **FastAPI** | The web framework — all REST routes and the WebSocket endpoint |
| **Uvicorn** | ASGI server that actually runs FastAPI |
| **SQLAlchemy 2** | ORM mapping the `users`, `interview_sessions` and `answers` tables |
| **PostgreSQL 15** | Stores users, sessions, answers and scores |
| **psycopg2-binary** | PostgreSQL driver used by SQLAlchemy |
| **Pydantic 2 + pydantic-settings** | Request/response validation and typed environment config |
| **python-jose** | Creates and verifies the JWT access tokens |
| **passlib + bcrypt** | Hashes passwords (bcrypt pinned below 5.x — see Common Errors) |
| **OpenAI SDK** | Chat Completions for feedback and scoring |
| **groq** | Groq-hosted Whisper for speech-to-text (free tier) |
| **WebSockets** | Streams the interview: questions out, transcript in, feedback token by token |
| **fpdf2** | Server-side PDF report generation (the fallback for the browser export) |
| **slowapi** | Rate limiting per user and per IP |

---

## Prerequisites

Install these **before** you start. After each install, run the verify command in a terminal — if it prints a version number, you are good.

| Tool | Minimum | Download | Verify with |
| --- | --- | --- | --- |
| **Node.js** | 18+ (20 recommended) | https://nodejs.org/en/download | `node --version` |
| **Python** | 3.10+ (3.13 recommended) | https://www.python.org/downloads/ | `python --version` |
| **PostgreSQL** | 15 | https://www.postgresql.org/download/ | `psql --version` |
| **Git** | any recent | https://git-scm.com/downloads | `git --version` |
| **Docker Desktop** | optional, recommended | https://www.docker.com/products/docker-desktop/ | `docker --version` |

```bash
node --version      # v20.11.0
python --version    # Python 3.13.9   (try python3 --version on Mac/Linux)
psql --version      # psql (PostgreSQL) 15.6
git --version       # git version 2.43.0
docker --version    # Docker version 25.0.3
```

> **On Windows**, tick **"Add Python to PATH"** in the Python installer. Without it, `python` will not be found in the terminal.
>
> **On Mac/Linux**, the command is often `python3` and `pip3` rather than `python` and `pip`.
>
> **If you install Docker Desktop, you can skip installing PostgreSQL** — Docker provides it.

---

## Project Structure

```
aria-ai/
├── backend/                          # FastAPI application
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes/
│   │   │   │   ├── auth.py           # register, login, /me
│   │   │   │   ├── interview.py      # audio upload → transcript + speech metrics
│   │   │   │   ├── session.py        # create, list, stats, get one, complete, delete
│   │   │   │   └── report.py         # server-rendered PDF download
│   │   │   ├── schemas.py            # Pydantic request/response models (the API contract)
│   │   │   └── websocket.py          # live interview state machine
│   │   ├── core/
│   │   │   ├── config.py             # reads .env into a typed Settings object
│   │   │   ├── database.py           # SQLAlchemy engine, session factory, get_db()
│   │   │   ├── security.py           # password hashing, JWT, get_current_user
│   │   │   └── limiter.py            # rate-limit rules
│   │   ├── models/
│   │   │   ├── user.py               # users table
│   │   │   ├── session.py            # interview_sessions table
│   │   │   └── answer.py             # answers table
│   │   ├── services/
│   │   │   ├── llm_service.py        # prompts, 96-question bank, adaptive selection
│   │   │   ├── stt_service.py        # Whisper transcription
│   │   │   ├── filler_service.py     # filler-word detection, WPM, confidence
│   │   │   ├── score_service.py      # scoring rubric and session aggregation
│   │   │   ├── report_service.py     # fpdf2 PDF builder
│   │   │   └── demo_service.py       # demo account and its sample data
│   │   └── main.py                   # app entry: middleware, routers, /health, /ws
│   ├── scripts/
│   │   └── create_tables.py          # creates tables; --check reports schema drift
│   ├── requirements.txt              # Python dependencies (pinned)
│   ├── .env.example                  # template for your .env — copy, do not edit in place
│   └── venv/                         # your virtual environment (git-ignored)
│
├── frontend/                         # React application
│   ├── src/
│   │   ├── components/
│   │   │   ├── ui/                   # design system: Button, Card, Input, ScoreRing, Toast…
│   │   │   ├── interview/            # live waveform, question display, replay bubbles
│   │   │   └── dashboard/            # progress charts, streak card, filler attention
│   │   ├── pages/
│   │   │   ├── Login.jsx             # sign in (and the demo entry point)
│   │   │   ├── Register.jsx          # account creation with live validation
│   │   │   ├── Home.jsx              # dashboard: streak, stats, progress, recent sessions
│   │   │   ├── RoleSelect.jsx        # 3-step wizard: role → difficulty → pre-flight checks
│   │   │   ├── Interview.jsx         # the live interview screen
│   │   │   ├── Analysis.jsx          # post-interview deep dive
│   │   │   ├── Report.jsx            # printable report + PDF export + replay
│   │   │   ├── Sessions.jsx          # history, filters, comparison
│   │   │   └── Settings.jsx          # placeholder
│   │   ├── hooks/
│   │   │   ├── useAudio.js           # microphone capture and rolling transcription
│   │   │   ├── useWebSocket.js       # interview socket with reconnect backoff
│   │   │   ├── useAuth.js            # auth store (zustand)
│   │   │   └── useDebounced.js       # debounce helper for the search box
│   │   ├── services/
│   │   │   ├── api.js                # axios instance, token handling, response cache
│   │   │   └── websocket.js          # builds the authenticated ws:// URL
│   │   ├── store/
│   │   │   ├── interviewStore.js     # (placeholder)
│   │   │   └── toastStore.js         # toast queue
│   │   ├── utils/
│   │   │   ├── fillerDetector.js     # client-side filler detection + highlighting
│   │   │   └── scoreCalculator.js    # instant local scores and letter grades
│   │   ├── App.jsx                   # router, auth guards, page layouts
│   │   ├── main.jsx                  # React entry point
│   │   └── index.css                 # Tailwind directives + global styles
│   ├── index.html                    # HTML shell, loads Google Fonts
│   ├── tailwind.config.js            # the Neural Dark palette, fonts, animations
│   ├── vite.config.js                # dev server + /api and /ws proxy to port 8000
│   └── package.json                  # npm dependencies and scripts
│
├── docker-compose.yml                # PostgreSQL 15 container
├── .gitignore
└── README.md                         # this file
```

---

## Step-by-Step Setup Guide

### Step 1 — Clone the Repository

> Replace the URL below with your team's actual repository URL. If you already have the folder on disk, skip to Step 2.

```bash
git clone https://github.com/<your-team>/aria-ai.git
cd aria-ai
```

Confirm you are in the right place — you should see `backend`, `frontend` and `docker-compose.yml`:

```bash
ls
```

---

### Step 2 — Set Up the Database

Pick **one** of the two options.

#### Option A (Recommended) — Docker

Start Docker Desktop first, then from the `aria-ai/` folder:

```bash
docker compose up -d db
```

Verify it is running and healthy:

```bash
docker compose ps
```

You should see `aria-postgres` with state `running` and `(healthy)`. To watch the logs:

```bash
docker compose logs db
```

This creates database `aria_ai`, user `postgres`, password `password`, on port `5432` — which is exactly what the default `DATABASE_URL` expects.

To stop it later:

```bash
docker compose down
```

#### Option B — Manual PostgreSQL

If you installed PostgreSQL directly, create the database and user yourself.

Open the PostgreSQL shell:

```bash
psql -U postgres
```

Then run:

```sql
CREATE DATABASE aria_ai;
CREATE USER aria WITH PASSWORD 'aria_password';
GRANT ALL PRIVILEGES ON DATABASE aria_ai TO aria;
\c aria_ai
GRANT ALL ON SCHEMA public TO aria;
\q
```

If you use this option, your `DATABASE_URL` in Step 3 must match the user and password you just created:

```
DATABASE_URL=postgresql://aria:aria_password@localhost:5432/aria_ai
```

Verify the database exists:

```bash
psql -U postgres -l
```

---

### Step 3 — Backend Setup

**3.1 — Move into the backend folder**

```bash
cd backend
```

**3.2 — Create a virtual environment**

```bash
python -m venv venv
```

> On Mac/Linux use `python3 -m venv venv` if `python` is not found.

**3.3 — Activate it**

Windows (Command Prompt or PowerShell):

```bash
venv\Scripts\activate
```

Mac / Linux:

```bash
source venv/bin/activate
```

Your prompt should now start with `(venv)`. **Every backend command below assumes the venv is active.**

**3.4 — Install dependencies**

```bash
pip install -r requirements.txt
```

**3.5 — Create your .env file**

Windows:

```bash
copy .env.example .env
```

Mac / Linux:

```bash
cp .env.example .env
```

**3.6 — Fill in the three variables you must set**

Open `backend/.env` and edit these:

**`DATABASE_URL`** — where PostgreSQL is.
- If you used **Docker (Option A)**, leave the default exactly as it is:
  ```
  DATABASE_URL=postgresql://postgres:password@localhost:5432/aria_ai
  ```
- If you used **manual setup (Option B)**, use the user and password you created:
  ```
  DATABASE_URL=postgresql://aria:aria_password@localhost:5432/aria_ai
  ```

**`SECRET_KEY`** — signs the login tokens. Generate a real one:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Copy the 64-character output into your `.env`:

```
SECRET_KEY=3f8a1c...your-generated-value...9e2b
```

> The app **refuses to start in production** while this is still the placeholder value.

**`OPENAI_API_KEY`** — powers the AI feedback, scoring and transcription.

1. Go to **https://platform.openai.com/api-keys**
2. Sign in (or create an account)
3. Click **"Create new secret key"**, name it `aria-ai`, and click Create
4. Copy the key immediately — it is shown only once
5. Paste it into `.env`:

```
OPENAI_API_KEY=sk-proj-...your-key...
```

> Transcription does **not** use this key - that runs on Groq's free tier.
> A valid OpenAI key is still not enough on its own for feedback and scoring:
> the account also needs **credit**.
> A key with a zero balance authenticates fine, then fails every billable call
> with `429 insufficient_quota`. Check
> https://platform.openai.com/settings/organization/billing.

> **You can run ARIA without an OpenAI key.** Questions come from a local bank of 96 questions, and feedback and scoring fall back to a documented heuristic that is always labelled as such in the UI. **Transcription is the one exception** — there is no offline substitute for speech, so the microphone path returns an error and you should use the **"Type instead"** button on the interview screen. Note that using a real key costs money against your OpenAI account.

**3.7 — Create the database tables**

```bash
python -m scripts.create_tables
```

You should see `Created: answers, interview_sessions, users`. To check the schema later:

```bash
python -m scripts.create_tables --check
```

**3.8 — Start the backend server**

```bash
uvicorn app.main:app --reload
```

Leave this terminal running.

**3.9 — Verify the backend**

Open **http://localhost:8000/health** in your browser. You should see JSON beginning with:

```json
{"status": "ok", "version": "1.0.0", "environment": "development", "database": "connected", "active_ws_connections": 0}
```

The important parts are `"status": "ok"` and `"database": "connected"`. If you see `"status": "degraded"` and `"database": "unavailable"`, the API is running but cannot reach PostgreSQL — go back to Step 2.

**3.10 — Explore the API docs**

Open **http://localhost:8000/docs** for interactive Swagger documentation of every endpoint. You can log in and call endpoints directly from that page.

---

### Step 4 — Frontend Setup

**4.1 — Open a NEW terminal tab.** Leave the backend running in the first one.

In VS Code: **Terminal → New Terminal**, or press `` Ctrl+Shift+` ``.

**4.2 — Move into the frontend folder** (from the `aria-ai/` root):

```bash
cd frontend
```

**4.3 — Install dependencies**

```bash
npm install
```

This takes a minute or two the first time.

**4.4 — Start the dev server**

```bash
npm run dev
```

**4.5 — Verify the frontend**

Open **http://localhost:5173**. You should see the ARIA login page with an animated waveform on the left. If you are not signed in, any other URL redirects here.

---

### Step 5 — Open in VS Code

From the `aria-ai/` root folder:

```bash
code .
```

> If `code` is not recognised, open VS Code, press `Ctrl+Shift+P` (Mac: `Cmd+Shift+P`), type **"Shell Command: Install 'code' command in PATH"**, and press Enter. Then reopen your terminal.

**Recommended extensions.** Install each by pressing `Ctrl+Shift+X`, pasting the ID into the search box, and clicking Install.

| Extension | ID | Why it helps here |
| --- | --- | --- |
| Python | `ms-python.python` | Runs and debugs the FastAPI backend, and detects your `venv` interpreter |
| Pylance | `ms-python.vscode-pylance` | Type hints and autocomplete for SQLAlchemy models and Pydantic schemas |
| ES7+ React snippets | `dsznajder.es7-react-js-snippets` | Scaffolds React components quickly while building new pages |
| Tailwind CSS IntelliSense | `bradlc.vscode-tailwindcss` | Autocompletes the custom `aria-*` colour classes and shows the swatch |
| Prettier | `esbenp.prettier-vscode` | Formats the `.jsx` files consistently on save |
| GitLens | `eamodio.gitlens` | Shows who changed each line — useful with four people on one repo |
| Thunder Client | `rangav.vscode-thunder-client` | Test API endpoints inside VS Code without installing Postman |

> **After installing the Python extension**, press `Ctrl+Shift+P` → **"Python: Select Interpreter"** → choose the one inside `backend/venv`. Otherwise imports will show as unresolved.

---

### Step 6 — Verify Everything Works

Work down this list. Every box should tick.

- [ ] **PostgreSQL is running** — `docker compose ps` shows `aria-postgres (healthy)`, or `psql -U postgres -l` lists `aria_ai`
- [ ] **Backend server running** — http://localhost:8000/health returns `"status": "ok"` and `"database": "connected"`
- [ ] **API docs accessible** — http://localhost:8000/docs loads the Swagger page
- [ ] **Frontend running** — http://localhost:5173 loads
- [ ] **Login page loads without errors** — open DevTools (`F12`) → Console tab shows no red errors
- [ ] **Can register a new account** — click "Create free account", fill the form, and land on the dashboard
- [ ] **Can navigate to Role Selection** — click "Start Interview" and see the four role cards
- [ ] **Microphone permission works** — on step 3 of the wizard click "Check microphone" and Allow; the status turns green

> **Quickest smoke test:** log in as **`demo` / `demo123`** — see [Demo Mode](#demo-mode). If the dashboard fills with charts and five sessions, your whole stack is wired correctly.

---

## Running the Project Daily (After First Setup)

Three terminals, four commands.

**Terminal 1 — Database** (skip if you use a locally installed PostgreSQL that starts with your machine):

```bash
docker compose up -d db
```

**Terminal 2 — Backend:**

```bash
cd backend && source venv/bin/activate    # Windows: cd backend && venv\Scripts\activate
uvicorn app.main:app --reload
```

**Terminal 3 — Frontend:**

```bash
cd frontend && npm run dev
```

Then open **http://localhost:5173**.

---

## Environment Variables Reference

All of these live in `backend/.env`. The first six are in `.env.example`; the rest are optional overrides that already have sensible defaults.

| Variable Name | What It Is | Example Value |
| --- | --- | --- |
| `DATABASE_URL` | **Required.** PostgreSQL connection string | `postgresql://postgres:password@localhost:5432/aria_ai` |
| `SECRET_KEY` | **Required.** Signs JWT login tokens. Generate with `secrets.token_hex(32)` | `3f8a1c9d...9e2b` (64 hex chars) |
| `OPENAI_API_KEY` | **Required for AI features.** From platform.openai.com/api-keys | `sk-proj-abc123...` |
| `ALGORITHM` | JWT signing algorithm | `HS256` |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | How long a login lasts, in minutes | `1440` (24 hours) |
| `GROQ_API_KEY` | **Required for transcription.** Free from console.groq.com/keys | `gsk_...` |
| `WHISPER_MODEL` | Groq speech-to-text model | `whisper-large-v3-turbo` |
| `OPENAI_MODEL` | Model used for feedback and scoring | `gpt-4o-mini` |
| `ENVIRONMENT` | `development`, `staging` or `production` | `development` |
| `DEBUG` | Include exception detail in 500 responses | `false` |
| `PROJECT_NAME` | Name shown in API docs and logs | `ARIA AI` |
| `VERSION` | Version reported by `/health` | `1.0.0` |
| `API_PREFIX` | Path prefix for all REST routes | `/api` |
| `CORS_ORIGINS` | Comma-separated origins allowed to call the API | `http://localhost:5173` |
| `DISABLE_RATE_LIMITS` | Turn rate limiting off for local testing | `false` |
| `DB_POOL_SIZE` | Pooled database connections | `5` |
| `DB_MAX_OVERFLOW` | Extra connections allowed above the pool | `10` |
| `DB_POOL_RECYCLE` | Seconds before a pooled connection is recycled | `1800` |
| `SQL_ECHO` | Log every SQL statement (noisy; debugging only) | `false` |

> `.env` is git-ignored. **Never commit it** — it contains your OpenAI key.

The frontend needs no `.env`. It talks to `http://localhost:8000` by default; set `VITE_API_URL` only if your backend runs elsewhere.

---

## Common Errors and Fixes

### 1. "Cannot connect to database"

```
sqlalchemy.exc.OperationalError: (psycopg2.OperationalError) connection to server
at "localhost" (127.0.0.1), port 5432 failed: Connection refused
```

PostgreSQL is not running, or `DATABASE_URL` is wrong.

```bash
docker compose up -d db      # start it
docker compose ps            # confirm "healthy"
```

If you are not using Docker, start the PostgreSQL service (Windows: Services → postgresql-x64-15 → Start; Mac: `brew services start postgresql@15`). Then check that the user, password and database name in `DATABASE_URL` match what you actually created.

### 2. "Port 8000 already in use"

```
ERROR: [Errno 48] Address already in use
```

Another process holds the port. Either kill it or use a different one.

Mac / Linux:

```bash
lsof -ti:8000 | xargs kill -9
```

Windows:

```bash
netstat -ano | findstr :8000
taskkill /PID <the-number-from-the-last-column> /F
```

Or just run somewhere else:

```bash
uvicorn app.main:app --reload --port 8001
```

> If you change the port, also update `CORS_ORIGINS` and the frontend's `VITE_API_URL`.

### 3. "Port 5173 already in use"

```
Port 5173 is in use, trying another one...
```

Vite usually moves to 5174 by itself — read the terminal for the real URL. To free 5173:

Mac / Linux:

```bash
lsof -ti:5173 | xargs kill -9
```

Windows:

```bash
netstat -ano | findstr :5173
taskkill /PID <the-number> /F
```

> If the frontend ends up on a different port, add it to `CORS_ORIGINS` in `backend/.env` and restart the backend, or the browser will block the API calls.

### 4. "OpenAI API key invalid"

```
{"detail": "Speech-to-text is not configured correctly."}
openai.AuthenticationError: Error code: 401 - Incorrect API key provided
```

Your key is missing, mistyped, or has no credit.

1. Check `backend/.env` has no quotes and no trailing spaces: `OPENAI_API_KEY=sk-proj-...`
2. **Restart the backend** — `.env` is read once at startup
3. Confirm the key is active at https://platform.openai.com/api-keys
4. Check you have credit at https://platform.openai.com/settings/organization/billing

To keep working without a key, use **"Type instead"** on the interview screen.

### 5. "Module not found" errors in Python

```
ModuleNotFoundError: No module named 'fastapi'
ModuleNotFoundError: No module named 'app'
```

Two different causes:

**Virtual environment not active** — your prompt does not show `(venv)`:

```bash
# Windows
venv\Scripts\activate
# Mac/Linux
source venv/bin/activate
pip install -r requirements.txt
```

**Running from the wrong folder** — `No module named 'app'` means you are not inside `backend/`. `uvicorn app.main:app` must be run from `backend/`:

```bash
cd backend
uvicorn app.main:app --reload
```

**Related:** if login crashes with `AttributeError: module 'bcrypt' has no attribute '__about__'` followed by a `ValueError` about 72 bytes, your bcrypt is too new. `requirements.txt` pins `bcrypt==4.3.0` for exactly this reason:

```bash
pip install -r requirements.txt --force-reinstall
```

### 6. "npm install fails"

```
npm ERR! code ERESOLVE
npm ERR! ERESOLVE unable to resolve dependency tree
```

Clear the cache and reinstall from scratch:

```bash
# Mac/Linux
rm -rf node_modules package-lock.json
# Windows PowerShell
Remove-Item -Recurse -Force node_modules, package-lock.json

npm cache clean --force
npm install
```

If it still fails, check `node --version` is 18 or above — older versions cannot install Vite 8.

### 7. "Microphone not working in browser"

```
Microphone access was blocked. Allow it in your browser settings and try again.
```

- **Click Allow** on the browser permission popup. If you dismissed it, click the padlock/tune icon in the address bar → Site settings → Microphone → Allow, then reload.
- **Use `localhost`, not an IP.** Browsers only allow microphone access on `https://` or `http://localhost`. `http://192.168.x.x:5173` will be blocked.
- **Close other apps** using the mic (Zoom, Teams, Discord) — the error `Your microphone is in use by another application` means something else holds it.
- **On macOS**, allow your browser under System Settings → Privacy & Security → Microphone.
- Firefox does not support all recording formats used here; **Chrome or Edge is the safest choice**.

### 8. "WebSocket connection failed"

```
WebSocket connection to 'ws://localhost:8000/ws/...' failed
This interview could not be opened. It may have finished already.
```

The interview screen talks over a WebSocket which authenticates with your token.

- **Is the backend running?** Check http://localhost:8000/health.
- **Are you logged in?** The socket sends your token in the URL; if it expired, log out and back in.
- **Is the session already finished?** A completed session refuses new connections — start a new interview from Role Selection.
- **Is it someone else's session?** The URL contains a session ID that must belong to you.
- If you see **"Reconnecting…"**, the client retries three times with backoff. If it gives up, reload the page — an unfinished interview resumes at the first unanswered question.

---

## API Endpoints Quick Reference

Base URL: `http://localhost:8000`

| Method | Endpoint | What It Does | Auth Required? |
| --- | --- | --- | --- |
| `GET` | `/health` | Service and database health check | No |
| `POST` | `/api/auth/register` | Create an account, returns a token | No |
| `POST` | `/api/auth/login` | Sign in, returns a token (**form-encoded**, not JSON) | No |
| `GET` | `/api/auth/me` | The signed-in user's profile | Yes |
| `POST` | `/api/sessions/create` | Start an interview session (max 10/day) | Yes |
| `GET` | `/api/sessions/my-sessions` | Paginated session list (`?limit=&offset=`) | Yes |
| `GET` | `/api/sessions/stats` | Totals, trends, streak, filler history | Yes |
| `GET` | `/api/sessions/{id}` | One session with all its answers | Yes |
| `POST` | `/api/sessions/{id}/complete` | Score the session and write the verdict | Yes |
| `DELETE` | `/api/sessions/{id}` | Soft-delete a session | Yes |
| `POST` | `/api/interview/transcribe` | Upload audio → transcript + metrics (max 30/min) | Yes |
| `POST` | `/api/report/{id}/pdf` | Download the PDF report | Yes |
| `WS` | `/ws/{session_id}?token=…` | Live interview: questions, answers, streamed feedback | Yes (token in query) |

Authenticated requests need the header `Authorization: Bearer <token>`.

> **Answers are submitted over the WebSocket, not over REST.** During an interview the client sends an `answer_transcript` frame; the server scores it, saves it, and streams the feedback back token by token. `/api/interview/transcribe` only converts audio to text — it saves nothing.

Every route is additionally capped at 100 requests per minute.

---

## Demo Mode

Want to see the app without registering?

```
Username: demo
Password: demo123
```

The demo account comes pre-loaded with **five sample sessions** spanning a weak start (48%) to a strong finish (82%), across all four job roles — so the dashboard charts, the radar, the streak counter and the history comparison all have real data to show. The most recent session includes full answers, AI feedback, a follow-up question and a written verdict, so the Analysis and Report pages are worth opening.

You can start real interviews in demo mode. **They are cleared the next time anyone signs in as demo** — the account resets to its five samples on every demo login, so nothing you do carries over to the next person. A **"Demo Mode"** badge appears next to the logo so you always know which account you are in.

---

## Deployment (Optional)

### Frontend → Vercel

1. Push your code to GitHub.
2. Go to https://vercel.com/new and import the repository.
3. Set **Root Directory** to `frontend`.
4. Framework preset: **Vite**. Build command `npm run build`, output directory `dist`.
5. Add an environment variable **`VITE_API_URL`** = your deployed backend URL (e.g. `https://aria-backend.up.railway.app`).
6. Click **Deploy**.

Or from the terminal:

```bash
npm install -g vercel
cd frontend
vercel --prod
```

### Backend → Railway

1. Go to https://railway.app/new and choose **Deploy from GitHub repo**.
2. Set the **Root Directory** to `backend`.
3. Set the **Start Command**:
   ```bash
   uvicorn app.main:app --host 0.0.0.0 --port $PORT
   ```
4. Add the environment variables from the table below.
5. Deploy, then copy the generated public URL into Vercel's `VITE_API_URL`.

### Database → Railway PostgreSQL

1. In the same Railway project click **New → Database → PostgreSQL**.
2. Open the database → **Variables** → copy `DATABASE_URL`.
3. Paste it into your backend service's `DATABASE_URL` variable — Railway can reference it directly as `${{Postgres.DATABASE_URL}}`.
4. Create the tables once, from the Railway shell:
   ```bash
   python -m scripts.create_tables
   ```

### What must change for production

| Variable | Development | Production |
| --- | --- | --- |
| `ENVIRONMENT` | `development` | `production` |
| `DEBUG` | `false` | `false` (never `true`) |
| `SECRET_KEY` | anything | a **new** value from `secrets.token_hex(32)` — not the dev one |
| `DATABASE_URL` | `localhost` | the managed database URL |
| `CORS_ORIGINS` | `http://localhost:5173` | your Vercel domain, e.g. `https://aria-ai.vercel.app` |
| `VITE_API_URL` (frontend) | unset | your Railway backend URL |

> With `ENVIRONMENT=production` the app **refuses to start** if `SECRET_KEY` or `OPENAI_API_KEY` is still a placeholder, and it hides `/docs`. That is deliberate.
>
> **Note on `postgres://` URLs:** some providers hand out a URL starting `postgres://`. SQLAlchemy needs `postgresql://` — change the prefix if the app cannot connect.

---

## Contributing

This is a college project, so the workflow is deliberately simple.

1. Create a branch for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes and check them before committing:
   ```bash
   cd frontend && npm run lint && npm run build
   ```
3. Commit with a message that says what changed and why:
   ```bash
   git commit -m "Add filler-word trend chart to analysis page"
   ```
4. Push and open a pull request for another team member to review:
   ```bash
   git push origin feature/your-feature-name
   ```

**Conventions to keep:** the filler-word list and the letter-grade bands exist in both Python and JavaScript and **must be changed together**. If you add a column to a model, run `python -m scripts.create_tables --check` — it will tell you what the database is missing, because table creation cannot add columns to tables that already exist.

---

## Team

| Name | Roll Number |
| --- | --- |
| Abhishek Sali | 23107004 |
| Aahan Upadhye | 23107027 |
| Manomay Sawant | 23107122 |
| Durvesh Wagle | 23107019 |

**Project Guide:** Prof. Sarala Mary
**Institution:** A. P. Shah Institute of Technology, Mumbai University

---

## License

MIT License

Copyright (c) 2026 Abhishek Sali, Aahan Upadhye, Manomay Sawant, Durvesh Wagle

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
