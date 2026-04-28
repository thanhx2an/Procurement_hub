import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Button,
  ShellBar,
  ShellBarItem,
  SideNavigation,
  SideNavigationItem,
} from "@ui5/webcomponents-react";

export default function AppShell({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarVisible, setSidebarVisible] = useState(true);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        minHeight: "100svh",
      }}
    >
      <ShellBar
        primaryTitle="Procurement Hub"
        secondaryTitle="POC 2 – Multi-Vendor"
      >
        <ShellBarItem icon="bell" text="Notifications" />
        <ShellBarItem icon="settings" text="Settings" />
      </ShellBar>

      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          background: "var(--sapBackgroundColor)",
        }}
      >
        <aside
          style={{
            width: sidebarVisible ? 260 : 52,
            flexShrink: 0,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--sapBackgroundColor)",
            borderRight: "1px solid var(--sapList_BorderColor)",
            transition: "width 0.2s ease",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              padding: "0.5rem",
            }}
          >
            <Button
              design="Transparent"
              icon={sidebarVisible ? "decline" : "menu2"}
              onClick={() => setSidebarVisible((current) => !current)}
              tooltip={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
            />
          </div>

          {sidebarVisible && (
            <SideNavigation
              style={{
                width: "100%",
                flex: 1,
                minHeight: 0,
                background: "var(--sapBackgroundColor)",
              }}
              onSelectionChange={(e) => {
                const path = e.detail.item.dataset.path;
                if (path) navigate(path);
              }}
            >
              <SideNavigationItem
                text="Executive Dashboard"
                icon="home"
                data-path="/dashboard"
                selected={location.pathname === "/dashboard"}
              />
              <SideNavigationItem
                text="Shipment Workspace"
                icon="shipping-status"
                data-path="/shipments"
                selected={location.pathname === "/shipments"}
              />
              <SideNavigationItem
                text="Price Negotiation Ledger"
                icon="activity-individual"
                data-path="/price-ledger"
                selected={location.pathname === "/price-ledger"}
              />
            </SideNavigation>
          )}
        </aside>

        <main
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            overflow: "auto",
            padding: "1.5rem",
            background: "var(--sapBackgroundColor)",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
