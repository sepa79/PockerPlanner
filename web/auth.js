"use strict";

window.PockerAuth = (() => {
  const sessionKey = "PH_UI_V2_AUTH_SESSION";
  let session = null;
  let identity = {user: null, canEdit: false, configured: false};

  function headers() {
    return session ? {Authorization: `Bearer ${session.accessToken}`} : {};
  }

  async function initialize() {
    identity = {user: null, canEdit: false, configured: false};
    const stored = sessionStorage.getItem(sessionKey);
    session = stored ? JSON.parse(stored) : null;
    const response = await fetch("/api/session", {headers: headers(), cache: "no-store"});
    const result = await response.json();
    if (!response.ok) {
      identity = {user: null, canEdit: false, configured: true};
      if (response.status === 401) { sessionStorage.removeItem(sessionKey); session = null; }
      throw new Error(result.error);
    }
    identity = result;
    return identity;
  }

  async function login(username) {
    const response = await fetch("/api/session/login", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({username})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    sessionStorage.setItem(sessionKey, JSON.stringify(result));
    return initialize();
  }

  async function logout() {
    sessionStorage.removeItem(sessionKey);
    session = null;
    return initialize();
  }

  return {initialize, login, logout, headers, get canEdit() { return identity.canEdit; }, get identity() { return identity; }};
})();
