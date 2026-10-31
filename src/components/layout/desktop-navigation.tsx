import * as React from "react";
import { useNavigate } from "react-router-dom";

/** Receives navigation requests from the native Electron menu. */
export function DesktopNavigation() {
  const navigate = useNavigate();

  React.useEffect(() => {
    const bridge = window.masarDesktop;
    if (!bridge) return;
    return bridge.onNavigate((path) => navigate(path));
  }, [navigate]);

  return null;
}
