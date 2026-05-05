import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, BusyIndicator } from '@ui5/webcomponents-react';
import AppShell from './components/AppShell';

// Lazy-loaded screens — each module is only fetched when the user navigates to it
const Dashboard         = lazy(() => import('./screens/Dashboard'));
const ShipmentWorkspace = lazy(() => import('./screens/ShipmentWorkspace'));
const PriceLedger       = lazy(() => import('./screens/PriceLedger'));
const AuditLogs         = lazy(() => import('./screens/AuditLogs'));
const Contacts          = lazy(() => import('./screens/Contacts'));

function ScreenLoader() {
  return (
    <BusyIndicator active size="Large" style={{ marginTop: '6rem', width: '100%' }} />
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30000, retry: 1 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <BrowserRouter>
          <AppShell>
            <Suspense fallback={<ScreenLoader />}>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard"    element={<Dashboard />} />
                <Route path="/shipments"    element={<ShipmentWorkspace />} />
                <Route path="/price-ledger" element={<PriceLedger />} />
                <Route path="/audit-logs"   element={<AuditLogs />} />
                <Route path="/contacts"     element={<Contacts />} />
              </Routes>
            </Suspense>
          </AppShell>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
