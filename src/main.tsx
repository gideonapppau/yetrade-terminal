import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from 'buffer'

if (typeof window !== 'undefined') {
  window.Buffer = Buffer;
  const bufferAny = Buffer as any;
  const originalIsBuffer = bufferAny.isBuffer;
  bufferAny.isBuffer = (obj: any) => {
    return originalIsBuffer(obj) || (obj != null && obj.constructor != null && obj.constructor.name === 'Buffer');
  };
}

import './index.css'
import App from './App.tsx'

// Apply the saved theme before first paint so screens shown before the
// dashboard layout mounts (e.g. Telegram login) match it too.
{
  const saved = localStorage.getItem('yettrade_theme')
  const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', dark)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
