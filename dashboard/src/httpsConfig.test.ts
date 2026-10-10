import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import dashboardConfig from "../vite.config";

let folder: string;

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "godseye-https-test-"));
  vi.stubEnv("GODSEYE_TLS_CERT_FILE", "");
  vi.stubEnv("GODSEYE_TLS_KEY_FILE", "");
  vi.stubEnv("GODSEYE_BACKEND_URL", "");
  vi.stubEnv("GODSEYE_ROVER_KEY_FILE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(folder, { recursive: true, force: true });
});

async function config() {
  if (typeof dashboardConfig !== "function")
    throw Error("Expected a Vite configuration function");
  return dashboardConfig({ mode: "test", command: "serve" });
}

function certificateFiles() {
  const cert = join(folder, "certificate.pem");
  const key = join(folder, "private-key.pem");
  writeFileSync(cert, "certificate-file-bytes\n");
  writeFileSync(key, "private-key-file-bytes\n", { mode: 0o600 });
  vi.stubEnv("GODSEYE_TLS_CERT_FILE", cert);
  vi.stubEnv("GODSEYE_TLS_KEY_FILE", key);
  return { cert, key };
}

describe("explicit HTTPS hosting", () => {
  it("leaves dev and preview HTTP when neither TLS file is configured", async () => {
    const value = await config();
    expect(value.server?.https).toBeUndefined();
    expect(value.preview?.https).toBeUndefined();
  });

  it.each(["GODSEYE_TLS_CERT_FILE", "GODSEYE_TLS_KEY_FILE"])(
    "rejects a lone %s before starting either server",
    async (name) => {
      vi.stubEnv(name, join(folder, "unpaired.pem"));
      await expect(config()).rejects.toThrow(/both.*GODSEYE_TLS_/i);
    },
  );

  it("reads the configured certificate and key for both dev and preview", async () => {
    certificateFiles();
    const value = await config();
    for (const server of [value.server, value.preview]) {
      expect(server?.https).toMatchObject({
        cert: Buffer.from("certificate-file-bytes\n"),
        key: Buffer.from("private-key-file-bytes\n"),
      });
    }
  });

  it.each(["GODSEYE_TLS_CERT_FILE", "GODSEYE_TLS_KEY_FILE"])(
    "fails clearly when %s points to a missing file",
    async (name) => {
      certificateFiles();
      vi.stubEnv(name, join(folder, "missing.pem"));
      await expect(config()).rejects.toThrow(new RegExp(name));
    },
  );

  it.each(["GODSEYE_TLS_CERT_FILE", "GODSEYE_TLS_KEY_FILE"])(
    "rejects a directory in %s without exposing file contents",
    async (name) => {
      certificateFiles();
      vi.stubEnv(name, folder);
      let message = "";
      try {
        await config();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain(name);
      expect(message).not.toContain("private-key-file-bytes");
      expect(message).not.toContain("certificate-file-bytes");
    },
  );

  it("keeps camera and WebSocket relay on the configured backend in both modes", async () => {
    certificateFiles();
    vi.stubEnv("GODSEYE_BACKEND_URL", "http://127.0.0.1:9876");
    const value = await config();
    for (const server of [value.server, value.preview]) {
      const routes = Object.entries(server?.proxy ?? {});
      for (const path of ["/capture/status", "/capture/frame.jpg?frame=8"]) {
        const route = routes.find(([pattern]) =>
          new RegExp(pattern).test(path),
        );
        expect(route?.[1]).toMatchObject({ target: "http://127.0.0.1:9876" });
      }
      const live = routes.find(([pattern]) =>
        new RegExp(pattern).test("/live"),
      );
      expect(live?.[1]).toMatchObject({
        target: "http://127.0.0.1:9876",
        ws: true,
      });
      expect(
        routes.some(([pattern]) => new RegExp(pattern).test("/phone")),
      ).toBe(false);
    }
  });
});
