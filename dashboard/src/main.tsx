import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/dm-sans";
import "@fontsource/ibm-plex-mono/400.css";
import App from "./App";
import VRViewer from "./VRViewer";
import { useEffect, useState } from "react";
import "./styles.css";
import "./theme.css";
function RootView() {
  const [vr, setVr] = useState(
    () => new URLSearchParams(window.location.search).get("view") === "vr",
  );
  useEffect(() => {
    const change = () =>
      setVr(new URLSearchParams(window.location.search).get("view") === "vr");
    window.addEventListener("popstate", change);
    return () => window.removeEventListener("popstate", change);
  }, []);
  return vr ? <VRViewer /> : <App />;
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootView />
  </React.StrictMode>,
);
