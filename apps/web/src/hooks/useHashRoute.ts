import { useCallback, useEffect, useRef, useState } from "react";
import { parseHash, toHash, type Route } from "../lib/route.js";

let savedProjectsScrollY: number | null = null;
let shouldRestoreProjectsScroll = false;

export function rememberProjectsScroll() {
  savedProjectsScrollY = window.scrollY;
  shouldRestoreProjectsScroll = true;
}

export function peekProjectsScroll(): number | null {
  return shouldRestoreProjectsScroll ? savedProjectsScrollY : null;
}

export function clearProjectsScroll() {
  shouldRestoreProjectsScroll = false;
  savedProjectsScrollY = null;
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  const prevRouteRef = useRef<Route>(route);

  useEffect(() => {
    const handleHashChange = () => {
      const nextRoute = parseHash(window.location.hash);
      const prevRoute = prevRouteRef.current;
      prevRouteRef.current = nextRoute;
      setRoute(nextRoute);
      const returningToProjects = nextRoute.name === "projects" && prevRoute.name === "project" && shouldRestoreProjectsScroll;
      if (!returningToProjects && nextRoute.name !== "project") {
        clearProjectsScroll();
      }
      window.scrollTo(0, 0);
    };
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
