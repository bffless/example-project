import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BffStateProvider } from '@bffless/use-bff-state'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BffStateProvider>
      <App />
    </BffStateProvider>
  </StrictMode>,
)
