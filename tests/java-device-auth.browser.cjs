const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {spawn} = require("node:child_process");
const {once} = require("node:events");
const assert = require("node:assert/strict");

const modulePath = process.env.POCKETPLANNER_TEST_PLAYWRIGHT;
if (!modulePath) throw new Error("Set POCKETPLANNER_TEST_PLAYWRIGHT to the installed Playwright module.");
const {chromium} = require(modulePath);
const auth = process.env.POCKETPLANNER_TEST_PH_AUTH;
if (!auth || !/^http:\/\/localhost:\d+\/auth-service$/.test(auth)) {
  throw new Error("Use an explicit local PH ingress in POCKETPLANNER_TEST_PH_AUTH.");
}
const jar = path.resolve(__dirname, "../backend/target/pocketplanner.jar");
const fixture = JSON.parse(fs.readFileSync(path.resolve(__dirname, "contracts/workspace.json"), "utf8"));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "pocketplanner-device-smoke-"));
const packaged = path.join(temporary, "pocketplanner.jar");
fs.copyFileSync(jar, packaged);
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function startServer(name) {
  const log = fs.createWriteStream(path.join(temporary, name + ".log"));
  const child = spawn("java", ["-jar", packaged, "--server.port=0", "--server.address=127.0.0.1",
    "--TESTPLANNER_DB=" + path.join(temporary, "planner.sqlite3"), "--POCKETHIVE_AUTH_BASE_URL=" + auth],
  {cwd: temporary, stdio: ["ignore", "pipe", "pipe"]});
  let output = "";
  let spawnFailed = false;
  child.on("error", () => { spawnFailed = true; });
  child.stdout.on("data", bytes => { output = (output + bytes.toString()).slice(-16384); log.write(bytes); });
  child.stderr.on("data", bytes => log.write(bytes));
  async function stop() {
    if (child.exitCode === null && child.signalCode === null && !spawnFailed) {
      const stopped = once(child, "exit");
      child.kill("SIGTERM");
      const forced = setTimeout(() => child.kill("SIGKILL"), 10000);
      try { await stopped; } finally { clearTimeout(forced); }
    }
    log.end();
  }
  try {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (spawnFailed || child.exitCode !== null) throw new Error("Isolated Java application failed startup.");
      const match = output.match(/Tomcat started on port ([0-9]+)/);
      if (match) return {origin: "http://localhost:" + match[1], stop};
      await pause(50);
    }
    throw new Error("Isolated Java startup timed out.");
  } catch (failure) { await stop(); throw failure; }
}

async function api(context, origin, method, endpoint, body, token) {
  try {
    return await context.request.fetch(origin + endpoint, {
      method, data: body, timeout: 10000,
      headers: token ? {Authorization: "Bearer " + token} : {},
    });
  } catch {
    throw new Error("Planner API request failed: " + endpoint);
  }
}

async function login(context, origin, username, expectReuse) {
  const startedAt = Date.now();
  const start = await api(context, origin, "POST", "/api/session/device/start", {});
  assert.equal(start.status(), 200, "Device authorization did not start.");
  const authorization = await start.json();
  const page = await context.newPage();
  try {
    await page.goto(authorization.verification_uri_complete);
    const confirm = page.getByRole("button", {name: "Confirm sign in", exact: true});
    const complete = page.getByRole("heading", {name: "Confirmation complete", exact: true});
    await page.locator("#username").or(confirm).or(complete).waitFor();
    if (await page.locator("#username").isVisible()) {
      assert.equal(expectReuse, false, "PH browser session was not reused.");
      await page.locator("#username").fill(username);
      await page.getByRole("button", {name: "Sign in", exact: true}).click();
    }
    await confirm.or(complete).waitFor();
    if (await confirm.isVisible()) await confirm.click();
    await complete.waitFor();
    let interval = (authorization.interval || 5) * 1000;
    await pause(Math.max(0, startedAt + interval - Date.now()));
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const result = await api(context, origin, "POST", "/api/session/device/poll", {deviceCode: authorization.device_code});
      const body = await result.json();
      if (result.status() === 200) {
        assert.ok(body.access_token.startsWith("phweb_"), "No PH browser token returned.");
        return body.access_token;
      }
      assert.equal(result.status(), 400, "Device polling failed.");
      assert.ok(["authorization_pending", "slow_down"].includes(body.error), "Device grant was rejected.");
      if (body.error === "slow_down") interval += 5000;
      await pause(interval);
    }
    throw new Error("Device confirmation timed out.");
  } finally { await page.close(); }
}

(async () => {
  let browser;
  let server;
  const credentials = [];
  try {
    browser = await chromium.launch({headless: true, executablePath: process.env.POCKETPLANNER_TEST_BROWSER});
    const admin = await browser.newContext();
    const viewer = await browser.newContext();
    server = await startServer("first");
    const firstOrigin = server.origin;
    const initial = await api(admin, server.origin, "GET", "/api/state");
    assert.deepEqual((await initial.json()).plans, [], "Refusing to mutate a nonempty workspace.");
    const token = await login(admin, server.origin, "local-admin", false);
    credentials.push({context: admin, token});
    const session = await api(admin, server.origin, "GET", "/api/session", undefined, token);
    assert.equal((await session.json()).canEdit, true);
    const imported = await api(admin, server.origin, "PUT", "/api/state", fixture, token);
    assert.equal(imported.status(), 200, "Admin could not import synthetic data.");
    const saved = await imported.json();
    await server.stop();
    server = await startServer("second");
    assert.notEqual(server.origin, firstOrigin, "Second server did not demonstrate a changed local port.");
    const restored = await api(admin, server.origin, "GET", "/api/state");
    assert.deepEqual(await restored.json(), saved, "Restart lost the synthetic plan.");
    const sameToken = await api(admin, server.origin, "GET", "/api/session", undefined, token);
    assert.equal((await sameToken.json()).canEdit, true, "PH token did not survive an application-port change.");
    const secondToken = await login(admin, server.origin, "local-admin", true);
    credentials.push({context: admin, token: secondToken});
    assert.notEqual(secondToken, token, "Independent sign-ins reused a token.");
    const viewerToken = await login(viewer, server.origin, "local-viewer", false);
    credentials.push({context: viewer, token: viewerToken});
    const denied = await api(viewer, server.origin, "PUT", "/api/state", saved, viewerToken);
    assert.equal(denied.status(), 403, "Viewer was not denied.");
    const loggedOut = await api(admin, server.origin, "POST", "/api/session/logout", {}, token);
    assert.equal(loggedOut.status(), 200);
    const {logoutUrl} = await loggedOut.json();
    const logout = await admin.newPage();
    await logout.goto(logoutUrl);
    await logout.getByRole("button", {name: "Sign out of shared login", exact: true}).click();
    await logout.close();
    const revoked = await api(admin, server.origin, "GET", "/api/session", undefined, token);
    assert.equal(revoked.status(), 401, "Revoked token still has access.");
    console.log(JSON.stringify({firstOrigin, restartedOrigin: server.origin, actualPhDeviceConfirmation: true,
      centralSessionReused: true, independentTokens: true, adminWrite: true, viewerDenied: true,
      restartPersistence: true, changedPortWithoutAuthReconfiguration: true, logoutRevoked: true,
      operationalMutations: false, plannerFrontendVerified: false, desktopForwardingVerified: false}, null, 2));
  } finally {
    if (server) {
      for (const credential of credentials) {
        try { await api(credential.context, server.origin, "POST", "/api/session/logout", {}, credential.token); } catch {}
      }
      await server.stop();
    }
    if (browser) await browser.close();
    fs.rmSync(temporary, {recursive: true, force: true});
  }
})().catch(() => { console.error("Planner Java/PH device-auth smoke failed; no credentials were printed."); process.exitCode = 1; });
