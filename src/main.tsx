import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const rootElement = document.getElementById('root')

function renderStartupError(error: unknown) {
  if (!rootElement) return

  const message = error instanceof Error ? error.message : 'Error desconocido al iniciar ALFA-Admin.'
  const isConfigError = /Missing Supabase Environment Variables|VITE_SUPABASE_ANON_KEY|Missing required environment/i.test(message)

  rootElement.textContent = ''

  const wrapper = document.createElement('div')
  wrapper.setAttribute('role', 'alert')
  wrapper.style.cssText = 'min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#0f172a;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;'

  const card = document.createElement('div')
  card.style.cssText = 'width:100%;max-width:560px;background:#ffffff;color:#0f172a;border-radius:16px;padding:28px;box-shadow:0 20px 45px rgba(2,6,23,.35);'

  const title = document.createElement('h1')
  title.textContent = isConfigError ? 'Falta configuración de Supabase' : 'No se pudo iniciar ALFA-Admin'
  title.style.cssText = 'margin:0 0 8px;font-size:20px;font-weight:800;'

  const description = document.createElement('p')
  description.textContent = isConfigError
    ? 'Este despliegue no recibió las variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Configúralas en Vercel (Production, Preview y Development) y vuelve a desplegar.'
    : 'Ocurrió un error inesperado al cargar la aplicación. Recarga la página o contacta al equipo de plataforma.'
  description.style.cssText = 'margin:0 0 16px;font-size:14px;line-height:1.5;color:#475569;'

  const detail = document.createElement('pre')
  detail.textContent = message
  detail.style.cssText = 'margin:0;padding:12px;border-radius:10px;background:#f1f5f9;color:#334155;font-size:12px;white-space:pre-wrap;word-break:break-word;'

  card.append(title, description, detail)
  wrapper.append(card)
  rootElement.append(wrapper)
}

async function bootstrap() {
  if (!rootElement) return

  try {
    const { default: App } = await import('./App.tsx')
    createRoot(rootElement).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  } catch (error) {
    console.error('[ALFA-Admin] Error al iniciar la aplicación', error)
    renderStartupError(error)
  }
}

void bootstrap()
