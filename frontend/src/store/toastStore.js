// Toast queue. Kept out of the Toast component file so that module exports
// only components (Fast Refresh requirement) and so any module can raise a
// toast without importing UI.
import { create } from 'zustand'

let nextId = 0

const useToast = create((set, get) => ({
  toasts: [],

  push: ({ title, description, tone = 'info', duration = 4000 }) => {
    const id = ++nextId
    set((s) => ({ toasts: [...s.toasts, { id, title, description, tone, duration }] }))
    return id
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  success: (title, description) => get().push({ title, description, tone: 'success' }),
  // Errors linger a little longer: they usually carry an instruction.
  error: (title, description) =>
    get().push({ title, description, tone: 'error', duration: 7000 }),
  warning: (title, description) => get().push({ title, description, tone: 'warning' }),
  info: (title, description) => get().push({ title, description, tone: 'info' }),
}))

export default useToast
