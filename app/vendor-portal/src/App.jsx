import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from '@ui5/webcomponents-react';
import AppShell from './components/AppShell';
import Dashboard from './screens/Dashboard';
import ShipmentWorkspace from './screens/ShipmentWorkspace';
import PriceLedger from './screens/PriceLedger';
import AuditLogs from './screens/AuditLogs';

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
            <Routes>
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/shipments" element={<ShipmentWorkspace />} />
              <Route path="/price-ledger" element={<PriceLedger />} />
              <Route path="/audit-logs" element={<AuditLogs />} />
            </Routes>
          </AppShell>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
