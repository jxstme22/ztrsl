import { ControlApp } from "./ControlApp";
import { OverlayApp } from "./OverlayApp";

export function App() {
  const windowKind = new URLSearchParams(window.location.search).get("window");
  return windowKind === "overlay" ? <OverlayApp /> : <ControlApp />;
}
