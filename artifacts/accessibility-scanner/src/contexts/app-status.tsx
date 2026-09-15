import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type AppStatus = "checking" | "online" | "offline";
export type HealthFailureReason = "timeout" | "network" | "http";

export interface AppStatusContextValue {
  status: AppStatus;
  lastChecked: Date | null;
  failureReason: HealthFailureReason | null;
  retryNow: () => void;
}

const AppStatusContext = createContext<AppStatusContextValue>({
  status: "checking",
  lastChecked: null,
  failureReason: null,
  retryNow: () => {},
});

const HEALTH_URL = `${import.meta.env.BASE_URL}api/healthz`.replace("//", "/");
const POLL_INTERVAL_ONLINE = 30_000;
const POLL_INTERVAL_OFFLINE = 10_000;
const TIMEOUT_MS = 8_000;
const REQUIRED_CONSECUTIVE_FAILURES = 3;
// A slow/intermittent connection should not accumulate failures indefinitely.
const FAILURE_WINDOW_MS = 60_000;

type HealthCheckResult =
  | { ok: true }
  | { ok: false; reason: HealthFailureReason };

async function checkHealth(): Promise<HealthCheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, {
      signal: controller.signal,
      cache: "no-store",
    });
    return res.ok ? { ok: true } : { ok: false, reason: "http" };
  } catch (error) {
    const isAbortError =
      (typeof DOMException !== "undefined" &&
        error instanceof DOMException &&
        error.name === "AbortError") ||
      (typeof error === "object" &&
        error !== null &&
        "name" in error &&
        error.name === "AbortError");
    return {
      ok: false,
      reason: isAbortError ? "timeout" : "network",
    };
  } finally {
    clearTimeout(timer);
  }
}

export function AppStatusProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AppStatus>("checking");
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [failureReason, setFailureReason] = useState<HealthFailureReason | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const connectedRef = useRef(false);
  const consecutiveFailuresRef = useRef(0);
  const lastFailureAtRef = useRef<number | null>(null);

  const clearScheduledPoll = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const scheduleNextPoll = (delay: number, probe: () => void) => {
    // There is only ever one owner for the next scheduled probe. This also
    // protects against a completion racing with an event-triggered probe.
    clearScheduledPoll();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      probe();
    }, delay);
  };

  const run = useCallback(async (immediate = false) => {
    // A manual retry can happen while a scheduled request is still pending.
    // Do not create a second probe (or let an older result overwrite a newer one).
    if (immediate) clearScheduledPoll();
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const result = await checkHealth();
    if (!mountedRef.current) return;

    const checkedAt = new Date();
    const checkedAtMs = checkedAt.getTime();
    setLastChecked(checkedAt);

    if (result.ok) {
      connectedRef.current = true;
      consecutiveFailuresRef.current = 0;
      lastFailureAtRef.current = null;
      setFailureReason(null);
      setStatus("online");
    } else {
      const lastFailureAt = lastFailureAtRef.current;
      const withinFailureWindow =
        lastFailureAt !== null && checkedAtMs - lastFailureAt <= FAILURE_WINDOW_MS;
      consecutiveFailuresRef.current = withinFailureWindow
        ? consecutiveFailuresRef.current + 1
        : 1;
      lastFailureAtRef.current = checkedAtMs;
      setFailureReason(result.reason);

      // Before the first successful probe, stay in the initial checking state
      // until the same failure threshold is met. Once online, tolerate the
      // first two failures without replacing the application UI.
      if (consecutiveFailuresRef.current >= REQUIRED_CONSECUTIVE_FAILURES) {
        setStatus("offline");
      } else if (!connectedRef.current) {
        setStatus("checking");
      }
    }

    inFlightRef.current = false;
    scheduleNextPoll(result.ok ? POLL_INTERVAL_ONLINE : POLL_INTERVAL_OFFLINE, () => {
      void run();
    });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    run();
    const handleOnline = () => {
      // Browser connectivity is only a hint; always verify with the endpoint.
      void run(true);
    };
    const handleOffline = () => {
      // Do not mark the service offline based solely on navigator.onLine.
      // A probe still provides the authoritative answer.
      void run(true);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      mountedRef.current = false;
      clearScheduledPoll();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [run]);

  const retryNow = useCallback(() => {
    void run(true);
  }, [run]);

  return (
    <AppStatusContext.Provider value={{ status, lastChecked, failureReason, retryNow }}>
      {children}
    </AppStatusContext.Provider>
  );
}

export function useAppStatus() {
  return useContext(AppStatusContext);
}
