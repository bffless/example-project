import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { BffStateProvider } from '@bffless/use-bff-state'
import './index.css'
import App from './App.tsx'

async function enableMocks() {
  if (!import.meta.env.DEV) return
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
}

enableMocks().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BffStateProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </BffStateProvider>
    </StrictMode>,
  )
})
