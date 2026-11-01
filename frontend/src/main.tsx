import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { installFrontendRuntimeLogging } from './runtime-logs'
import { ThemeProvider } from './theme-context'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles.css'
import './sql-workbench.css'
// Mirror profile material layer — must load AFTER styles.css so its
// [data-base-profile=mirror] rules cascade-override the base palette.
import './mirror-theme.css'
import './mirror/mirror-extras.css'

installFrontendRuntimeLogging()

const queryClient = new QueryClient()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
