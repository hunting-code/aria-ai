// Authentication store (zustand) - user, token, and the login/register/logout
// actions. The token lives in localStorage via services/api.js, which is also
// what attaches it to outgoing requests.

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

import {
  authApi,
  clearToken,
  extractErrorMessage,
  getToken,
  setToken,
  setUnauthorizedHandler,
} from '../services/api'

const useAuth = create(
  persist(
    (set, get) => ({
      user: null,
      token: getToken(),
      isAuthenticated: Boolean(getToken()),
      isLoading: false,
      // True until the stored token has been checked against the server, so
      // guarded routes can wait instead of flashing the login page.
      isInitialised: false,
      error: null,

      /** Store the credentials returned by register/login. */
      _applySession: (data) => {
        setToken(data.access_token)
        set({
          user: data.user,
          token: data.access_token,
          isAuthenticated: true,
          isLoading: false,
          isInitialised: true,
          error: null,
        })
        return data.user
      },

      /** POST /auth/login. Resolves with the user, rejects with a message. */
      login: async ({ username, password }) => {
        set({ isLoading: true, error: null })
        try {
          const data = await authApi.login({ username, password })
          return get()._applySession(data)
        } catch (error) {
          const message = extractErrorMessage(error, 'Login failed')
          set({ isLoading: false, error: message })
          throw new Error(message)
        }
      },

      /** POST /auth/register. The backend logs the new user straight in. */
      register: async ({ username, email, password, fullName }) => {
        set({ isLoading: true, error: null })
        try {
          const data = await authApi.register({
            username,
            email,
            password,
            full_name: fullName,
          })
          return get()._applySession(data)
        } catch (error) {
          const message = extractErrorMessage(error, 'Registration failed')
          set({ isLoading: false, error: message })
          throw new Error(message)
        }
      },

      /** Clear the session locally. Tokens are stateless, so there is nothing to revoke. */
      logout: () => {
        clearToken()
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialised: true,
          error: null,
        })
      },

      /**
       * Called by the api 401 interceptor. Same as logout(), but keeps a
       * message explaining why the user was signed out.
       */
      handleUnauthorized: () => {
        if (!get().isAuthenticated && !get().token) return
        clearToken()
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
          isInitialised: true,
          error: 'Your session has expired. Please sign in again.',
        })
      },

      /**
       * Validate the stored token on app start. A token that the server
       * rejects is discarded, so a stale localStorage entry can't leave the UI
       * believing it is signed in.
       */
      loadUser: async () => {
        const token = getToken()
        if (!token) {
          set({ user: null, token: null, isAuthenticated: false, isInitialised: true })
          return null
        }
        set({ isLoading: true })
        try {
          const user = await authApi.me()
          set({
            user,
            token,
            isAuthenticated: true,
            isLoading: false,
            isInitialised: true,
            error: null,
          })
          return user
        } catch (error) {
          // The interceptor already cleared the token on a 401; anything else
          // (network down) should not sign the user out.
          const status = error?.response?.status
          if (status === 401 || status === 403) {
            get().logout()
          } else {
            set({ isLoading: false, isInitialised: true })
          }
          return null
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'aria-auth',
      storage: createJSONStorage(() => localStorage),
      // The token is owned by services/api.js; persisting it here as well
      // would give two copies that can drift apart. Only the user profile is
      // cached, so the UI can render immediately on reload.
      partialize: (state) => ({ user: state.user }),
      onRehydrateStorage: () => (state) => {
        if (!state) return
        // Reconcile the cached profile with the token that actually exists.
        const token = getToken()
        state.token = token
        state.isAuthenticated = Boolean(token && state.user)
        if (!token) state.user = null
      },
    },
  ),
)

// Wire the 401 interceptor to this store. Done at module load so any import of
// the hook installs it exactly once.
setUnauthorizedHandler(() => useAuth.getState().handleUnauthorized())

export default useAuth

// Selectors - components should subscribe narrowly to avoid needless re-renders.
export const selectUser = (s) => s.user
export const selectIsAuthenticated = (s) => s.isAuthenticated
export const selectAuthError = (s) => s.error
