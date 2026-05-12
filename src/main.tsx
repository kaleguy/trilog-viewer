import ReactDOM from "react-dom/client";
import App from "./App";

// StrictMode double-invokes every render in dev. With a 1y chart
// that's heavy enough to cause WebKit to choke, so disable it for now.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
