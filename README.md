# ARIA-AI

AI-powered mock interview platform — full-stack scaffold.

| Layer | Stack |
| --- | --- |
| Frontend | React 19 + Vite 8 + Tailwind CSS 3 |
| Backend | Python 3.13 + FastAPI |
| Database | PostgreSQL 17 via SQLAlchemy 2 ORM |
| Real-time | FastAPI WebSockets |
| Package managers | npm (frontend), pip (backend) |

> **Status:** structure only. Every module under `frontend/src` and `backend/app`
> is an intentional placeholder — no application logic has been written yet.

## Project structure

```
aria-ai/
├── frontend/
│   ├── src/
│   │   ├── components/{ui,interview,dashboard}/
│   │   ├── pages/          Login, Home, RoleSelect, Interview, Analysis, Report
│   │   ├── hooks/          useAudio, useWebSocket, useAuth
│   │   ├── services/       api.js, websocket.js
│   │   ├── store/          interviewStore.js (zustand)
│   │   ├── utils/          fillerDetector.js, scoreCalculator.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes/     auth.py, interview.py, session.py, report.py
│   │   │   └── websocket.py
│   │   ├── core/           config.py, security.py, database.py
│   │   ├── models/         user.py, session.py, answer.py
│   │   ├── services/       llm, stt, filler, score, report
│   │   └── main.py
│   ├── requirements.txt
│   └── .env.example
├── docker-compose.yml
└── README.md
```

## Prerequisites

- Node.js 20+ and npm
- Python 3.13
- Docker (for the PostgreSQL container), or a local PostgreSQL 17 install

## Getting started

### 1. Database

```bash
docker compose up -d db
```

Postgres listens on `localhost:5432` with database `aria_db` (user `aria`).

### 2. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then fill in SECRET_KEY and OPENAI_API_KEY
uvicorn app.main:app --reload --port 8000
```

API docs are served at http://localhost:8000/docs once `app/main.py` defines an `app`.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Dev server runs at http://localhost:5173. Vite proxies `/api` and `/ws` to
`http://localhost:8000`, so no CORS setup is needed in development.

## Frontend dependencies

`react-router-dom` (routing) · `axios` (HTTP) · `zustand` (state) ·
`recharts` (charts) · `lucide-react` (icons) · `framer-motion` (animation) ·
`tailwindcss` + `postcss` + `autoprefixer` (styling)

## Backend dependencies

`fastapi` · `uvicorn[standard]` · `sqlalchemy` · `psycopg2-binary` ·
`python-jose[cryptography]` · `passlib` + `bcrypt` · `openai` · `websockets` ·
`pydantic` + `pydantic-settings` · `python-dotenv` · `fpdf2` · `python-multipart`

## Notes on pinned versions

- `bcrypt` is pinned to `<5`. passlib 1.7.4 raises
  `ValueError: password cannot be longer than 72 bytes` with bcrypt 5.x.
- `pydantic-settings` and `python-multipart` are not in the original dependency
  list but are required in practice: `BaseSettings` moved out of pydantic in v2,
  and FastAPI's OAuth2 form login needs multipart parsing.

## Environment variables

See [`backend/.env.example`](backend/.env.example). `.env` is git-ignored — never commit real keys.
