export function readLocal<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem('mums.' + key)
    return value === null ? fallback : JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function writeLocal<T>(key: string, value: T) {
  try {
    localStorage.setItem('mums.' + key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}
