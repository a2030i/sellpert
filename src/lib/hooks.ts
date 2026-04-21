import { useState, useEffect } from 'react'

export function useMobile(bp = 768) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < bp)
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < bp)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [bp])
  return isMobile
}
