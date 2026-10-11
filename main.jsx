import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import TvWall from "./TvWall.jsx";

// ?tv=1 opens the wall-display view instead of the normal dashboard — point a TV/monitor's browser at
// http://<this-PC-IP>:5173/?tv=1 and leave it full-screen. Everything else is unaffected.
const isTv = new URLSearchParams(location.search).get("tv") === "1";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isTv ? <TvWall /> : <App />}
  </React.StrictMode>
);
