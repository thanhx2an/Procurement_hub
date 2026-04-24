import { useNavigate, useLocation } from 'react-router-dom';
import { ShellBar, ShellBarItem, SideNavigation, SideNavigationItem } from '@ui5/webcomponents-react';

export default function AppShell({ children }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <ShellBar
        primaryTitle="Procurement Hub"
        secondaryTitle="POC 2 – Multi-Vendor"
      >
        <ShellBarItem icon="bell" text="Notifications" />
        <ShellBarItem icon="settings" text="Settings" />
      </ShellBar>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <SideNavigation
          style={{ width: 260, borderRight: '1px solid var(--sapList_BorderColor)' }}
          onSelectionChange={(e) => {
            const path = e.detail.item.dataset.path;
            if (path) navigate(path);
          }}
        >
          <SideNavigationItem
            text="Executive Dashboard"
            icon="home"
            data-path="/dashboard"
            selected={location.pathname === '/dashboard'}
          />
          <SideNavigationItem
            text="Shipment Workspace"
            icon="shipping-status"
            data-path="/shipments"
            selected={location.pathname === '/shipments'}
          />
          <SideNavigationItem
            text="Price Negotiation Ledger"
            icon="activity-individual"
            data-path="/price-ledger"
            selected={location.pathname === '/price-ledger'}
          />
        </SideNavigation>

        <main style={{ flex: 1, overflow: 'auto', padding: '1.5rem', background: 'var(--sapBackgroundColor)' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
