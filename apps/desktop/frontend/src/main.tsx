import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./ui/tokens.css";
import "./ui/ui.css";
import "./styles.css";

async function bootstrap() {
  if (import.meta.env.VITE_E2E === "1") await import("@wdio/tauri-plugin");
  let content: React.ReactNode = <App />;
  if (
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).has("ui-preview")
  ) {
    const { UiPreview } = await import("./ui/UiPreview");
    content = <UiPreview />;
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>{content}</React.StrictMode>,
  );
}

void bootstrap();
