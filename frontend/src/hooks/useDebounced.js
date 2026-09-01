import { useEffect, useState } from 'react'

/**
 * Value that trails `value` by `delay`, so a search box filters on a pause
 * rather than on every keystroke.
 */
export default function useDebounced(value, delay = 250) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
