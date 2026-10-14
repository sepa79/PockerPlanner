"use strict";

window.PocketLive = ({revision, blocked, apply, status}) => {
  let source;
  let wanted = -1;
  let fetching = false;
  let stopped = false;
  let retry;
  let available = false;

  async function flush() {
    if (stopped || fetching) return;
    if (wanted <= revision()) { status(available ? "live" : "unavailable"); return; }
    if (blocked()) { status(available ? "pending" : "unavailable"); return; }
    fetching = true;
    const requested = wanted;
    let success = false;
    try {
      const response = await fetch("/api/state", {cache: "no-store"});
      if (!response.ok) throw new Error("Live refresh failed");
      const document = await response.json();
      if (stopped) return;
      if (!Number.isInteger(document.revision) || document.revision < requested || !Array.isArray(document.plans)) throw new Error("Invalid live snapshot");
      if (blocked()) { status(available ? "pending" : "unavailable"); return; }
      if (document.revision > revision()) apply(document);
      status(available ? "live" : "unavailable");
      success = true;
    } catch (error) {
      status("unavailable");
    } finally {
      fetching = false;
      if (wanted > revision() && !blocked() && !stopped) {
        clearTimeout(retry);
        retry = setTimeout(flush, success ? 0 : 1500);
      }
    }
  }

  function connect() {
    source?.close();
    stopped = false;
    available = false;
    status("connecting");
    source = new EventSource("/api/events");
    source.addEventListener("revision", event => {
      try {
        const value = JSON.parse(event.data).revision;
        if (!Number.isInteger(value) || value < 0) throw new Error("Invalid revision");
        wanted = Math.max(wanted, value);
        available = true;
        status(wanted > revision() && blocked() ? "pending" : "live");
        flush();
      } catch (error) {
        available = false;
        status("unavailable");
      }
    });
    source.addEventListener("unavailable", () => { available = false; status("unavailable"); });
    source.onerror = () => { available = false; status("unavailable"); };
  }

  function stop() {
    stopped = true;
    clearTimeout(retry);
    source?.close();
  }

  connect();
  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", event => { if (event.persisted) connect(); });
  window.addEventListener("offline", () => { available = false; source?.close(); status("unavailable"); });
  window.addEventListener("online", () => { if (!stopped) connect(); });
  return {flush, stop};
};
