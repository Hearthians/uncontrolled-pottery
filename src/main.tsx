import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const DepositionLab = lazy(() => import("./DepositionLabPage"));
const showLab = new URLSearchParams(location.search).get("lab") === "deposition";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<p role="status">Loading deposition lab…</p>}>
      {showLab ? <DepositionLab /> : <App />}
    </Suspense>
  </React.StrictMode>,
);
