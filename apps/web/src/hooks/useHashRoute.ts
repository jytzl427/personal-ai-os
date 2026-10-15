import { useCallback, useEffect, useState } from "react";
import { parseHash, toHash, type Route } from "../lib/route.js";

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const handleHashChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", handleHashChange);
    if (!window.location.hash || window.location.hash === "#/today") {
      window.location.hash = "#/tasks";
    }
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = useCallback((nextRoute: Route) => {
    const nextHash = toHash(nextRoute);
    if (window.location.hash === nextHash) {
      setRoute(nextRoute);
      return;
    }
    window.location.hash = nextHash;
  }, []);

  return { route, navigate };
}
