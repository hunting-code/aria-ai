# ARIA AI

AI-powered mock interview platform. ARIA asks role-specific questions, listens
to spoken answers, scores content *and* delivery, and returns a report you can
share.

| Layer | Stack |
| --- | --- |
| Frontend | React 19 + Vite 8 + Tailwind CSS 3 |
| Backend | Python 3.13 + FastAPI |
| Database | PostgreSQL 17 via SQLAlchemy 2 |
| Real-time | FastAPI WebSockets |
| AI | OpenAI Chat Completions + Whisper |

## Try it without signing up

Log in with **`demo` / `demo123`**. The account comes pre-populated with five
sessions spanning a weak start to a strong finish. Interviews you start in demo
mode run normally, but the account is **reset on every demo sign-in** — nothing
you do there persists or leaks to the next visitor.

## Features

**Interview**
- Four roles (Data Analyst, Software Engineer, HR, AI Engineer) × three difficulties
- 96 hand-written questions, each tagged Behavioral / Technical / Situational / Culture Fit
- **Adaptive difficulty** — after each answer ARIA re-reads your performance and
  pulls the next question from a harder or easier pool, never repeating one. Two
  interviews for the same role are not the same interview.
- **Follow-ups** — a thin answer earns one targeted probe that shares its
  question number, so it never inflates the question count
- **Coach mode ↔ Interviewer mode** — coach explains what a stronger answer
  would contain; interviewer stays terse. Defaults by difficulty.
- Live transcription with filler words highlighted as you speak
- Type-instead fallback when a microphone is unavailable

**Scoring**
- Answer quality judged by LLM on four axes (relevance, accuracy, structure, specificity)
- Communication scored from the text alone (vocabulary richness, sentence
  variety, clarity)
- Confidence and filler scores derived from delivery — pace and filler density
- Weighted overall: answer 40%, confidence 25%, communication 20%, fillers 15%

**After the interview**
- Analysis screen: five animated score rings, strengths/weaknesses, per-question
  breakdown, per-question-type performance, and a filler-word attention card
  with history
- Report: print-ready document, client-side PDF export, and a server-rendered
  PDF fallback
- Chat-bubble replay of the whole conversation
- History with filters, search, pairwise session comparison, and progress charts
- Streaks counting consecutive days with a completed interview

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │             Browser (React)              │
                    │                                          │
                    │  Login → RoleSelect → Interview          │
                    │            ↓                             │
                    │       Analysis → Report → History        │
                    └───────┬──────────────────────┬───────────┘
                            │ REST (axios)         │ WebSocket
                            │ Bearer token         │ ?token=…
                            ▼                      ▼
            ┌───────────────────────────────────────────────────┐
            │                  FastAPI  (:8000)                 │
            │                                                   │
            │  /api/auth       register · login · me            │
            │  /api/sessions   create · list · stats · complete │
            │  /api/interview  transcribe                       │
            │  /api/report     pdf                              │
            │  /ws/{id}        live interview channel           │
            │                                                   │
            │  rate limiting (slowapi) · JWT · CORS             │
            └───────┬───────────────────────────────┬───────────┘
                    │                               │
        ┌───────────▼───────────┐       ┌───────────▼───────────┐
        │      Services         │       │     PostgreSQL        │
        │                       │       │                       │
        │  llm_service   ────────────────▶  users               │
        │  stt_service   (Whisper)      │  interview_sessions   │
        │  filler_service│              │  answers              │
        │  score_service │              │                       │
        │  report_service│ (fpdf2)      └───────────────────────┘
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │  OpenAI API   │  chat completions (feedback, scoring)
        │               │  whisper-1      (transcription)
        └───────────────┘
```

The interview itself runs over the WebSocket: the server sends a question, the
client streams back a transcript, and feedback returns token by token while the
answer is scored and persisted.

## Setup

### Prerequisites
Node.js 20+, Python 3.13, and Docker (or a local PostgreSQL 17).

### 1. Database
```bash
docker compose up -d db
```
Postgres listens on `localhost:5432`, database `aria_ai`, user `postgres`.

### 2. Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # then fill in SECRET_KEY and OPENAI_API_KEY
python -m scripts.create_tables   # create the schema
uvicorn app.main:app --reload --port 8000
```
Interactive API docs: http://localhost:8000/docs

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```
http://localhost:5173 — Vite proxies `/api` and `/ws` to port 8000.

### Running without an OpenAI key
The app is fully navigable without one. Questions come from the local bank, and
feedback and scoring fall back to a documented heuristic that is always tagged
`source: "heuristic"` so it cannot be mistaken for a model judgement.
**Transcription is the exception** — there is no offline substitute for speech,
so `/interview/transcribe` returns 503 and you should use "Type instead".

## Environment variables

Copy `backend/.env.example` to `backend/.env`.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | e.g. `postgresql://postgres:password@localhost:5432/aria_ai` |
| `SECRET_KEY` | yes | — | JWT signing key. Generate with `openssl rand -hex 32` |
| `OPENAI_API_KEY` | yes | — | Without a real key the app runs in offline/heuristic mode |
| `ALGORITHM` | no | `HS256` | JWT algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | `1440` | Token lifetime |
| `WHISPER_MODEL` | no | `whisper-1` | Transcription model |
| `OPENAI_MODEL` | no | `gpt-4o-mini` | Feedback and scoring model |
| `ENVIRONMENT` | no | `development` | `production` hides `/docs` and hard-fails on unsafe config |
| `DEBUG` | no | `false` | Includes exception detail in 500 responses |
| `CORS_ORIGINS` | no | `http://localhost:5173` | Comma-separated |
| `DISABLE_RATE_LIMITS` | no | `false` | Turn limits off for tests and local runs |

The app refuses to start in production with a placeholder `SECRET_KEY`.

## API reference

All `/api` routes except register and login require `Authorization: Bearer <token>`.

### Auth
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/auth/register` | JSON `{username, email, password, full_name?}` → token + user |
| POST | `/api/auth/login` | **Form-encoded** (OAuth2). JSON returns 422 |
| GET | `/api/auth/me` | The signed-in user |

### Sessions
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/sessions/create` | `{job_role, difficulty}`. Max 10/day per user |
| GET | `/api/sessions/my-sessions` | `?limit=&offset=`. Total in `X-Total-Count` |
| GET | `/api/sessions/stats` | Totals, trends, streak, filler history, tag performance |
| GET | `/api/sessions/{id}` | One session with every answer |
| POST | `/api/sessions/{id}/complete` | Scores and writes the verdict. Idempotent |
| DELETE | `/api/sessions/{id}` | Soft delete |

### Interview and reports
| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/interview/transcribe` | multipart audio → transcript + metrics. Max 30/min |
| POST | `/api/report/{id}/pdf` | Server-rendered PDF download |
| WS | `/ws/{session_id}?token=…` | Live interview channel |

Every route is additionally capped at 100 requests/minute per user or IP.

### WebSocket protocol
```
server → client   question | feedback_token | feedback_complete
                  interview_complete | mode_changed | error | pong
client → server   answer_transcript | next_question | end_interview
                  set_mode | ping
```
The token travels as a query parameter because browsers cannot set headers on a
WebSocket handshake.

## Screenshots

Not committed to the repository — run the app to see them. What you would capture:

1. **Login** — split screen, twenty-bar waveform hero animating on the left,
   glass sign-in card on the right.
2. **Dashboard** — streak card with flame, four stat cards, score-trend area
   chart, recent sessions table, daily tip rail.
3. **Role select** — 2×2 accent-coloured role cards, step indicator, pre-flight
   checklist with the microphone status.
4. **Interview** — three columns: question with tag badge and streaming
   feedback, live waveform and mic button, live confidence/WPM/filler metrics.
5. **Analysis** — five score rings counting up, strengths and weaknesses,
   expandable per-question breakdown with filler words marked.
6. **Report** — white printable sheet, score table with letter grades, and the
   chat-bubble replay.

## Project layout

```
aria-ai/
├── frontend/src/
│   ├── components/{ui,interview,dashboard}/
│   ├── pages/          Login Register Home RoleSelect Interview Analysis Report Sessions Settings
│   ├── hooks/          useAudio useWebSocket useAuth useDebounced
│   ├── services/       api.js websocket.js
│   ├── store/          interviewStore.js toastStore.js
│   └── utils/          fillerDetector.js scoreCalculator.js
├── backend/app/
│   ├── api/routes/     auth interview session report
│   ├── api/websocket.py
│   ├── core/           config security database limiter
│   ├── models/         user session answer
│   └── services/       llm stt filler score report demo
├── docker-compose.yml
└── README.md
```

## Schema changes

`scripts/create_tables.py` creates missing **tables** but cannot add columns to
tables that already exist. After pulling changes:

```bash
cd backend && python -m scripts.create_tables --check
```

It names any missing column so you can apply the `ALTER TABLE` by hand. This
project has accumulated several such changes — adopting Alembic is the right
next step.

## Known limitations

- **Advanced interviews serve 8 questions**, not the 10 the UI advertises; the
  question pools hold 8 per difficulty.
- **Filler-word list and grade bands are duplicated** between Python and
  JavaScript and must be changed together.
- **No refresh tokens.** Access tokens are valid for their full lifetime and
  logout only clears the client.
- **Real microphone capture is unverified in CI** — the recording path is
  covered by stubs; the typed path is tested end to end.
