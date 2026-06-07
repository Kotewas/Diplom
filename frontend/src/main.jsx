import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider, createTheme } from '@mantine/core'
import '@mantine/core/styles.css'
import './index.css'
import App from './App.jsx'
import { AppErrorBoundary } from './shared/ui/AppErrorBoundary.jsx'
import { ToastProvider } from './shared/ui/ToastProvider.jsx'

const theme = createTheme({
  fontFamily: '"Manrope", "IBM Plex Sans", "Segoe UI", sans-serif',
  primaryColor: 'blue',
  primaryShade: 6,
  defaultRadius: 'md',
  headings: {
    fontFamily: '"Manrope", "IBM Plex Sans", "Segoe UI", sans-serif',
    fontWeight: '700',
  },
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MantineProvider
      theme={theme}
      defaultColorScheme="light"
    >
      <AppErrorBoundary>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AppErrorBoundary>
    </MantineProvider>
  </StrictMode>,
)
