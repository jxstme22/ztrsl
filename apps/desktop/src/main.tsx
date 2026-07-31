import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { RootErrorBoundary } from "./components/RootErrorBoundary";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Missing root element");
}

createRoot(rootElement).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
