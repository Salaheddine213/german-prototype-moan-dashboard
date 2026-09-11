import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './api/client'
import Layout from './components/layout/Layout'
import PageErrorBoundary from './components/common/PageErrorBoundary'

const CommoditiesPage = lazy(() => import('./pages/CommoditiesPage'))
const ElectricityPage = lazy(() => import('./pages/ElectricityPage'))
const MLPage = lazy(() => import('./pages/MLPage'))
const ScenariosPage = lazy(() => import('./pages/ScenariosPage'))
const ForecastPage = lazy(() => import('./pages/ForecastPage'))
const AncillaryPage = lazy(() => import('./pages/AncillaryPage'))

// Each route is wrapped in its own boundary so a render error on one page
// doesn't blank the whole app - the user can still navigate elsewhere.
function withBoundary(label: string, node: ReactNode) {
  return <PageErrorBoundary label={label}>{node}</PageErrorBoundary>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Suspense fallback={<div className="p-8 text-slate-400">Loading…</div>}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/commodities" element={withBoundary('Commodities page', <CommoditiesPage />)} />
              <Route path="/electricity" element={withBoundary('Electricity page', <ElectricityPage />)} />
              <Route path="/ml" element={withBoundary('ML Performance page', <MLPage />)} />
              <Route path="/scenarios" element={withBoundary('Scenarios page', <ScenariosPage />)} />
              <Route path="/forecast" element={withBoundary('Forecast page', <ForecastPage />)} />
              <Route path="/ancillary" element={withBoundary('Ancillary page', <AncillaryPage />)} />
              <Route path="/" element={<Navigate to="/commodities" replace />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
