import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from './features/auth/AuthProvider'
import App from './App'
import './index.css'
const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } })
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={qc}><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></QueryClientProvider></React.StrictMode>)
