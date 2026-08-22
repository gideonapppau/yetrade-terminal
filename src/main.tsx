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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
