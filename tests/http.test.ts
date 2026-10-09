import { afterEach, describe, expect, it } from "vitest";
import { fake } from "../src/ai/llm.js";
import { createServer } from "../src/web/server.js";
import { hmacSha256Hex } from "../src/util/index.js";
import { igMessageWebhook, makeApp, type TestApp } from "./helpers.js";

let app: TestApp | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

describe("serveur HTTP", () => {
  it("valide l'URL de webhook auprès de Meta", async () => {
    app = await makeApp(() => [], { IG_VERIFY_TOKEN: "verif-123" });
    const web = createServer(app, { workerRunning: false });
    const ok = await web.request("/webhooks/instagram?hub.mode=subscribe&hub.verify_token=verif-123&hub.challenge=42");
    expect(await ok.text()).toBe("42");
    const ko = await web.request("/webhooks/instagram?hub.mode=subscribe&hub.verify_token=faux&hub.challenge=42");
    expect(ko.status).toBe(403);
  });

  it("refuse un webhook mal signé et traite un webhook signé", async () => {
    app = await makeApp(() => [fake.json({ messages: ["Moi c'est Nova, l'IA de YD Studio. Ton projet ?"], boutons: [], relance_utile: false, note_equipe: "" })], { NODE_ENV: "production", COCKPIT_PASSWORD: "x", SESSION_SECRET: "y".repeat(32) });
    const web = createServer(app, { workerRunning: false });
    const body = JSON.stringify(igMessageWebhook("U9", "mid.9", "Bonjour", app.fakeClock.now().getTime()));
    const bad = await web.request("/webhooks/instagram", { method: "POST", body, headers: { "x-hub-signature-256": "sha256=00" } });
    expect(bad.status).toBe(401);
    const good = await web.request("/webhooks/instagram", { method: "POST", body, headers: { "x-hub-signature-256": `sha256=${hmacSha256Hex("secret", body)}` } });
    expect(await good.text()).toBe("EVENT_RECEIVED");
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    expect(app.ig.sent.map((s) => s.text)).toEqual(["Moi c'est Nova, l'IA de YD Studio. Ton projet ?"]);
  });

  it("protège le cockpit par mot de passe en production", async () => {
    app = await makeApp(() => [], { NODE_ENV: "production", COCKPIT_PASSWORD: "motdepasse", SESSION_SECRET: "z".repeat(32) });
    const web = createServer(app, { workerRunning: false });
    const anon = await web.request("/cockpit", { headers: { accept: "text/html" } });
    expect(anon.status).toBe(302);
    const login = await web.request("/cockpit/connexion", { method: "POST", body: new URLSearchParams({ motdepasse: "motdepasse", retour: "/cockpit" }) });
    expect(login.status).toBe(302);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const page = await web.request("/cockpit", { headers: { cookie, accept: "text/html" } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("Tableau de bord");
    const wrong = await web.request("/cockpit/connexion", { method: "POST", body: new URLSearchParams({ motdepasse: "non" }) });
    expect(wrong.status).toBe(401);
  });

  it("refuse le MCP HTTP sans jeton", async () => {
    app = await makeApp(() => [], { MCP_TOKEN: "jeton" });
    const web = createServer(app, { workerRunning: false });
    const res = await web.request("/mcp", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("sert les pages du cockpit sans erreur", async () => {
    app = await makeApp(() => [fake.json({ messages: ["Moi c'est Nova, l'IA de YD Studio."], boutons: ["Oui"], relance_utile: false, note_equipe: "" })]);
    const web = createServer(app, { workerRunning: false });
    await app.engine.handleEvents((await import("../src/instagram/webhook.js")).parseWebhook(igMessageWebhook("U10", "m10", "Hello", app.fakeClock.now().getTime())));
    app.fakeClock.advance(9_000);
    await app.worker.drain();
    const list = await (await web.request("/cockpit/conversations")).text();
    const id = /\/cockpit\/conversations\/([0-9a-f-]{36})/.exec(list)?.[1];
    expect(id).toBeTruthy();
    for (const path of ["/cockpit", "/cockpit/conversations", `/cockpit/conversations/${id}`, "/cockpit/prospects", "/cockpit/ebauches", "/cockpit/bac-a-sable", "/cockpit/reglages", "/health"]) {
      const res = await web.request(path);
      expect(res.status, path).toBe(200);
    }
  });
});
