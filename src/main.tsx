import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const DepositionLab = lazy(() => import("./DepositionLabPage"));
const MemoryRegions = lazy(() => import("./MemoryRegionsPage"));
const MemoryTopography = lazy(() => import("./MemoryTopographyPage"));
const lab = new URLSearchParams(location.search).get("lab") ?? import.meta.env.VITE_DEFAULT_LAB;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Suspense fallback={<p role="status">Loading studio…</p>}>
      {lab === "memory-regions" || lab === "memory-topography" ? <MemoryTopography />
        : lab === "memory-comparison" ? <MemoryRegions /> : lab === "deposition" ? <DepositionLab /> : <App />}
    </Suspense>
  </React.StrictMode>,
);
