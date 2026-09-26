import type { ReactNode } from "react";
import { platformLabels, type RuntimeState } from "../state/useAppController";

export function AppShell({
  collapsed,
  header,
  runtime,
  sidebar,
  children,
}: {
  children: ReactNode;
  collapsed: boolean;
  header: ReactNode;
  runtime: RuntimeState;
  sidebar: ReactNode;
}) {
  const version = runtime.status === "ready" ? runtime.info.version : "—";
  const platform =
    runtime.status === "ready"
      ? platformLabels[runtime.info.platform]
      : "Desktop";

  return (
    <div className={collapsed ? "app-shell is-collapsed" : "app-shell"}>
      <aside className="app-sidebar">{sidebar}</aside>
      <header className="app-header">{header}</header>
      <main className="app-workspace">{children}</main>
      <footer className="app-bottom-bar" aria-label="Нижняя панель приложения">
        <span>
          {platform} · {version}
        </span>
        <span>Локально. Без облачного хранилища.</span>
      </footer>
    </div>
  );
}
