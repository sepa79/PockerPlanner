import { useEffect, useState } from 'react'

export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function useToday(locked: boolean) {
  const [day, setDay] = useState(localDay)
  useEffect(() => {
    const refresh = () => { if (!locked && !document.hidden) setDay(localDay()) }
    refresh()
    const timer = setInterval(refresh, 60000)
    document.addEventListener('visibilitychange', refresh)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [locked])
  return day
}
