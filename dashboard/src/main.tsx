import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/nunito";
import "./styles.css";
import { App } from "./App";
import { realBackend, type Backend } from "./net/backend";

const params = new URLSearchParams(location.search);
const hash = new URLSearchParams(location.hash.slice(1));
const viewerToken = params.get("viewer") ?? hash.get("viewer");

async function boot() {
  let backend: Backend = realBackend;
  // Dev-only mock hub: `npm run dev` + `?mock=1`. `import.meta.env.DEV` is false in
  // production builds, so this branch and the mock module are removed from the bundle.
  if (import.meta.env.DEV && params.has("mock")) {
    backend = (await import("./mock/mockHub")).mockBackend;
  } else if (import.meta.env.PROD) {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App backend={backend} viewerToken={viewerToken} />
    </StrictMode>,
  );
}

void boot();
