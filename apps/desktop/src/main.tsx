import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { isTauri } from "@tauri-apps/api/core";

import { App } from "./App";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import { applyLiquidGlass } from "./windowEffects";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing root element");
}

// In the Tauri webview the window surface is transparent; let the CSS keep
// the solid fallback everywhere else (browser preview, jsdom).
if (isTauri()) {
  document.documentElement.setAttribute("data-tauri", "");
}

createRoot(rootElement).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);

void applyLiquidGlass();
