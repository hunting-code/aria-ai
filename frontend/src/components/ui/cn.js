// Tiny class-name joiner: filters out false/null/undefined so conditional
// classes can be written inline without a `clsx` dependency.
export default function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}
