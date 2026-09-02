// Axios instance for the ARIA AI backend, plus the auth token plumbing.
//
// This module is the single source of truth for the stored token. It must not
// import the auth store: the store imports this file, and the 401 handler is
// registered by callback so the dependency only ever points one way.

import axios from 'axios'

export const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
export const API_PREFIX = '/api'
const TOKEN_STORAGE_KEY = 'aria_token'
const LOGIN_ROUTE = '/login'

// Endpoints that are allowed to answer 401 without triggering a logout: a
// failed sign-in must show "wrong password", not bounce the page.
const AUTH_ENDPOINTS = [`${API_PREFIX}/auth/login`, `${API_PREFIX}/auth/register`]

/* -------------------------------------------------------------------------- */
/* Token storage                                                              */
/* -------------------------------------------------------------------------- */
// localStorage throws in private-mode Safari and when cookies are blocked, so
// every access is guarded; the app then degrades to an in-memory token instead
// of crashing on load.
let memoryToken = null

export function getToken() {
  // Read through to localStorage every time rather than trusting a cache:
  // otherwise a sign-out in another tab would go unnoticed here. memoryToken is
  // only a fallback for when storage is unavailable.
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY)
  } catch {
    return memoryToken
  }
}

export function setToken(token) {
  memoryToken = token ?? null
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY)
  } catch {
    /* storage unavailable - the in-memory copy carries this session */
  }
}

export function clearToken() {
  setToken(null)
  // Never leave one account's responses cached for whoever signs in next.
  cacheClear()
}

/* -------------------------------------------------------------------------- */
/* Instance                                                                   */
/* -------------------------------------------------------------------------- */
const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// Attaches the bearer token to every outgoing request.
api.interceptors.request.use(
  (config) => {
    const token = getToken()
    if (token) {
      config.headers = config.headers ?? {}
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

// Called on an expired/invalid token so the auth store can reset itself.
let onUnauthorized = null
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

function isAuthEndpoint(url = '') {
  return AUTH_ENDPOINTS.some((path) => url.includes(path))
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status
    const url = error.config?.url ?? ''

    if (status === 401 && !isAuthEndpoint(url)) {
      clearToken()
      onUnauthorized?.()
      // Guard against a redirect loop when the 401 arrives while already on
      // the login page.
      if (
        typeof window !== 'undefined' &&
        window.location.pathname !== LOGIN_ROUTE
      ) {
        window.location.assign(LOGIN_ROUTE)
      }
    }
    return Promise.reject(error)
  },
)

/* -------------------------------------------------------------------------- */
/* Error helper                                                               */
/* -------------------------------------------------------------------------- */
/** Turn an axios failure into a single human-readable string. */
export function extractErrorMessage(error, fallback = 'Something went wrong') {
  if (error?.response) {
    const { data, status } = error.response
    if (Array.isArray(data?.errors) && data.errors.length > 0) {
      // FastAPI validation errors: {loc, msg, type}
      return data.errors
        .map((e) => {
          const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : null
          return field ? `${field}: ${e.msg}` : e.msg
        })
        .join('\n')
    }
    if (typeof data?.detail === 'string') return data.detail
    if (status === 401) return 'Incorrect username or password'
    if (status >= 500) return 'The server is unavailable. Please try again.'
    return `Request failed (${status})`
  }
  if (error?.code === 'ECONNABORTED') return 'The request timed out.'
  if (error?.request) return 'Cannot reach the server. Is the backend running?'
  return error?.message || fallback
}

/* -------------------------------------------------------------------------- */
/* Auth endpoints                                                             */
/* -------------------------------------------------------------------------- */
export const authApi = {
  /** POST /api/auth/register - JSON body. Returns {access_token, user, ...}. */
  register: ({ username, email, password, full_name }) =>
    api
      .post(`${API_PREFIX}/auth/register`, {
        username,
        email,
        password,
        full_name: full_name || null,
      })
      .then((r) => r.data),

  /**
   * POST /api/auth/login - the backend uses OAuth2PasswordRequestForm, which
   * requires form encoding; sending JSON here returns a 422.
   */
  login: ({ username, password }) =>
    api
      .post(
        `${API_PREFIX}/auth/login`,
        new URLSearchParams({ username, password }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      )
      .then((r) => r.data),

  /** GET /api/auth/me - the user behind the current token. */
  me: () => api.get(`${API_PREFIX}/auth/me`).then((r) => r.data),
}

/* -------------------------------------------------------------------------- */
/* Response cache                                                             */
/* -------------------------------------------------------------------------- */
// A deliberately small in-memory cache for GETs that are read repeatedly while
// navigating (stats, session lists). Five-minute TTL, cleared on any mutation
// so a delete or a new session is never served from a stale entry.
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map()

export function cacheGet(key) {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key)
    return undefined
  }
  return entry.value
}

export function cacheSet(key, value) {
  cache.set(key, { value, at: Date.now() })
}

/** Drop everything, or every key containing `prefix`. */
export function cacheClear(prefix) {
  if (!prefix) {
    cache.clear()
    return
  }
  for (const key of cache.keys()) {
    if (key.includes(prefix)) cache.delete(key)
  }
}

/** Run `loader`, returning a cached value when one is still fresh. */
async function cached(key, loader, { force = false } = {}) {
  if (!force) {
    const hit = cacheGet(key)
    if (hit !== undefined) return hit
  }
  const value = await loader()
  cacheSet(key, value)
  return value
}

/* -------------------------------------------------------------------------- */
/* Interview sessions                                                         */
/* -------------------------------------------------------------------------- */
export const sessionsApi = {
  /** GET /api/sessions/my-sessions - the caller's sessions, newest first. */
  mySessions: ({ force = false, ...config } = {}) =>
    cached(
      'sessions:list',
      () => api.get(`${API_PREFIX}/sessions/my-sessions`, config).then((r) => r.data),
      { force },
    ),

  /** POST /api/sessions/create - opens a session and returns it. */
  create: ({ job_role, difficulty }) =>
    api.post(`${API_PREFIX}/sessions/create`, { job_role, difficulty }).then((r) => {
      cacheClear('sessions:')
      return r.data
    }),

  /** GET /api/sessions/stats - dashboard aggregates and trends. Cached. */
  stats: ({ force = false, ...config } = {}) =>
    cached(
      'sessions:stats',
      () => api.get(`${API_PREFIX}/sessions/stats`, config).then((r) => r.data),
      { force },
    ),

  /** DELETE /api/sessions/:id - soft delete. Resolves with nothing (204). */
  remove: (sessionId) =>
    api.delete(`${API_PREFIX}/sessions/${sessionId}`).then(() => {
      cacheClear('sessions:')
      return true
    }),

  /**
   * GET /api/sessions/my-sessions - one page of sessions.
   * Returns the rows plus the total from X-Total-Count, which the server
   * exposes through CORS so "load more" knows when to stop.
   */
  page: ({ limit = 12, offset = 0, signal } = {}) =>
    api
      .get(`${API_PREFIX}/sessions/my-sessions`, { params: { limit, offset }, signal })
      .then((r) => ({
        items: Array.isArray(r.data) ? r.data : [],
        total: Number(r.headers['x-total-count'] ?? 0),
      })),

  /** GET /api/sessions/:id - one session with its answers and feedback. */
  get: (sessionId, config = {}) =>
    api.get(`${API_PREFIX}/sessions/${sessionId}`, config).then((r) => r.data),

  /**
   * POST /api/sessions/:id/complete - scores the session and writes its
   * verdict. Idempotent: returns the stored feedback unless regenerate is set.
   */
  complete: (sessionId, { regenerate = false, signal } = {}) =>
    api
      .post(`${API_PREFIX}/sessions/${sessionId}/complete`, null, {
        params: regenerate ? { regenerate: true } : undefined,
        signal,
        timeout: 90000,
      })
      .then((r) => r.data),
}

/* -------------------------------------------------------------------------- */
/* Interview                                                                  */
/* -------------------------------------------------------------------------- */
export const interviewApi = {
  /**
   * POST /api/interview/transcribe - multipart upload of recorded audio.
   *
   * Content-Type is set to null so axios drops the instance's JSON default and
   * lets the browser write `multipart/form-data; boundary=...` itself. Setting
   * it manually would omit the boundary and the server could not parse it.
   */
  transcribe: ({ blob, durationSeconds, filename = 'answer.webm', signal }) => {
    const form = new FormData()
    form.append('file', blob, filename)
    if (durationSeconds != null) form.append('duration_seconds', String(durationSeconds))
    return api
      .post(`${API_PREFIX}/interview/transcribe`, form, {
        headers: { 'Content-Type': null },
        signal,
        timeout: 60000,
      })
      .then((r) => r.data)
  },
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */
export const reportApi = {
  /**
   * POST /api/report/:id/pdf - server-rendered PDF.
   *
   * responseType 'blob' is required: without it axios would decode the binary
   * body as text and corrupt the file.
   */
  pdf: (sessionId, { signal } = {}) =>
    api
      .post(`${API_PREFIX}/report/${sessionId}/pdf`, null, {
        responseType: 'blob',
        signal,
        timeout: 90000,
      })
      .then((r) => ({
        blob: r.data,
        filename:
          /filename="([^"]+)"/.exec(r.headers['content-disposition'] ?? '')?.[1] ??
          'ARIA_Report.pdf',
      })),
}

export default api
