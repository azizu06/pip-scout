import { expect, test, type Page } from "@playwright/test";
import { workspace } from "./helpers";

// External deterministic camera fixtures: shipped viewer code never creates images.
const frames = [
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABaAKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDySiiivzQ/tsKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD//Z",
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABaAKADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCWiiivij+SgooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKAP/9k=",
].map((value) => Buffer.from(value, "base64"));
async function camera(page: Page, origin = "http://camera.test", index = 0) {
  let frameId = 1;
  let ageMs = 0;
  let waiting = false;
  let stalled = false;
  const posts: string[] = [];
  const requests: number[] = [];
  await page.route(`${origin}/**`, async (route) => {
    requests.push(Date.now());
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() === "POST") {
      posts.push(path);
      return route.fulfill({ status: 403 });
    }
    if (stalled) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      return route.abort().catch(() => {});
    }
    if (path === "/capture/status")
      return route.fulfill({
        json: {
          version: 1,
          health: { phone: "ok" },
          received_frames: frameId,
          frame: waiting
            ? null
            : {
                capture_id: `fixture-${frameId}`,
                age_ms: ageMs,
                metadata: {
                  frame_id: frameId,
                  image: {
                    width: 160,
                    height: 90,
                    jpeg_len: frames[index].length,
                  },
                },
              },
        },
      });
    if (path === "/capture/frame.jpg")
      return route.fulfill({
        status: 200,
        contentType: "image/jpeg",
        body: frames[index],
        headers: {
          ETag: `"fixture-${frameId}"`,
          "X-Frame-Id": `${frameId}`,
          "Access-Control-Expose-Headers": "ETag, X-Frame-Id",
        },
      });
    return route.fulfill({ status: 404 });
  });
  return {
    posts,
    requests,
    next() {
      frameId++;
      index = 1 - index;
    },
    wait() {
      waiting = true;
    },
    stale() {
      ageMs = 3000;
    },
    stall() {
      stalled = true;
    },
  };
}
async function centerPixel(page: Page): Promise<number[]> {
  return page
    .locator("canvas[aria-label='Camera preview']")
    .evaluate((canvas) => {
      const element = canvas as HTMLCanvasElement;
      const gl = element.getContext("webgl2")!;
      return new Promise<number[]>((resolve) =>
        requestAnimationFrame(() => {
          const pixel = new Uint8Array(4);
          gl.readPixels(
            element.width / 2,
            element.height / 2,
            1,
            1,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixel,
          );
          resolve(Array.from(pixel));
        }),
      );
    });
}

test("VR preview waits for external imagery and never sends motion commands", async ({
  page,
}) => {
  const fixture = await camera(page);
  fixture.wait();
  await page.goto(
    "/?view=vr&live=ws://camera.test/live&api=http://camera.test&commands=true&roverKey=secret",
  );
  await expect(
    page.getByRole("heading", { name: "Camera viewer" }),
  ).toBeVisible();
  await expect(page.getByTestId("camera-state")).toHaveText("Waiting");
  await expect(
    page.getByRole("button", { name: "Enter VR", exact: true }),
  ).toBeDisabled();
  expect((await centerPixel(page)).slice(0, 3)).toEqual([16, 19, 24]);
  expect(fixture.posts).toHaveLength(0);
});

test("renders successive external JPEGs then clears stale and stalled imagery", async ({
  page,
}) => {
  const fixture = await camera(page);
  await page.goto(
    "/?view=vr&live=ws://camera.test/live&api=http://camera.test",
  );
  await expect(page.getByTestId("camera-state")).toHaveText("Live");
  await expect
    .poll(async () => (await centerPixel(page))[0])
    .toBeGreaterThan(180);
  fixture.next();
  await expect
    .poll(async () => (await centerPixel(page))[1])
    .toBeGreaterThan(150);
  fixture.stale();
  await expect(page.getByTestId("camera-state")).toHaveText("Stale");
  await expect
    .poll(async () => (await centerPixel(page)).slice(0, 3))
    .toEqual([16, 19, 24]);
  expect(fixture.posts).toHaveLength(0);
});

test("a pending read cannot keep a stopped camera image visible", async ({
  page,
}) => {
  const fixture = await camera(page);
  await page.goto(
    "/?view=vr&live=ws://camera.test/live&api=http://camera.test",
  );
  await expect
    .poll(async () => (await centerPixel(page))[0])
    .toBeGreaterThan(180);
  fixture.stall();
  await expect(page.getByTestId("camera-state")).not.toHaveText("Live", {
    timeout: 3500,
  });
  await expect
    .poll(async () => (await centerPixel(page)).slice(0, 3))
    .toEqual([16, 19, 24]);
});

test("switching source clears the previous image and paints the new source", async ({
  page,
}) => {
  const first = await camera(page);
  const second = await camera(page, "http://second.test", 1);
  await page.goto(
    "/?view=vr&live=ws://camera.test/live&api=http://camera.test",
  );
  await expect
    .poll(async () => (await centerPixel(page))[0])
    .toBeGreaterThan(180);
  await page.getByLabel("Backend API base").fill("http://second.test");
  await page
    .getByRole("button", { name: "Connect camera", exact: true })
    .click();
  await expect
    .poll(async () => (await centerPixel(page))[1])
    .toBeGreaterThan(150);
  const count = first.requests.length;
  await page.waitForTimeout(400);
  expect(first.requests).toHaveLength(count);
  expect(first.posts.concat(second.posts)).toHaveLength(0);
  expect(new URL(page.url()).searchParams.get("api")).toBe(
    "http://second.test/",
  );
});

test("workspace launch preserves source addresses and revokes URL permissions", async ({
  page,
}) => {
  const fixture = await camera(page);
  await page.routeWebSocket("ws://camera.test/live", (socket) =>
    socket.close(),
  );
  await page.goto(
    "/?live=ws://camera.test/live&api=http://camera.test&commands=true&roverKey=secret",
  );
  await workspace(page);
  await page.getByRole("button", { name: "Launch VR", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Camera viewer" }),
  ).toBeVisible();
  const params = new URL(page.url()).searchParams;
  expect(params.get("live")).toBe("ws://camera.test/live");
  expect(params.get("api")).toBe("http://camera.test/");
  expect(params.get("view")).toBe("vr");
  expect(params.has("commands")).toBe(false);
  expect(page.url()).not.toContain("secret");
  expect(fixture.posts).toHaveLength(0);
});

test("a delayed decode from an old source is discarded and its bitmap is released", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const stats = { decodes: 0, closed: 0 };
    (window as unknown as { cameraBitmaps: typeof stats }).cameraBitmaps =
      stats;
    const decode = window.createImageBitmap.bind(window);
    const close = ImageBitmap.prototype.close;
    ImageBitmap.prototype.close = function () {
      stats.closed++;
      close.call(this);
    };
    window.createImageBitmap = (async (...args: Parameters<typeof decode>) => {
      const bitmap = (await (decode as Function)(...args)) as ImageBitmap;
      if (++stats.decodes === 1)
        await new Promise((resolve) => setTimeout(resolve, 1200));
      return bitmap;
    }) as typeof window.createImageBitmap;
  });
  await camera(page);
  await camera(page, "http://second.test", 1);
  await page.goto(
    "/?view=vr&live=ws://camera.test/live&api=http://camera.test",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { cameraBitmaps: { decodes: number } })
            .cameraBitmaps.decodes,
      ),
    )
    .toBe(1);
  await page.getByLabel("Backend API base").fill("http://second.test");
  await page
    .getByRole("button", { name: "Connect camera", exact: true })
    .click();
  await expect
    .poll(async () => (await centerPixel(page))[1])
    .toBeGreaterThan(150);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { cameraBitmaps: { closed: number } })
            .cameraBitmaps.closed,
      ),
    )
    .toBeGreaterThan(0);
  expect((await centerPixel(page))[0]).toBeLessThan(80);
  await page.getByRole("button", { name: "Workspace", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { cameraBitmaps: { closed: number } })
            .cameraBitmaps.closed,
      ),
    )
    .toBeGreaterThanOrEqual(2);
});

test("a hidden viewer stops reads and clears the camera before resuming", async ({
  page,
}) => {
  const fixture = await camera(page);
  await page.goto(
    "/?view=vr&live=ws://camera.test/live&api=http://camera.test",
  );
  await expect
    .poll(async () => (await centerPixel(page))[0])
    .toBeGreaterThan(180);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByText("No current image", { exact: true }),
  ).toBeVisible();
  const count = fixture.requests.length;
  await page.waitForTimeout(350);
  expect(fixture.requests).toHaveLength(count);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(async () => (await centerPixel(page))[0])
    .toBeGreaterThan(180);
});

test("graphics failure clears the camera and disables immersive entry", async ({
  page,
}) => {
  await camera(page);
  await page.goto(
    "/?view=vr&live=ws://camera.test/live&api=http://camera.test",
  );
  await expect
    .poll(async () => (await centerPixel(page))[0])
    .toBeGreaterThan(180);
  await page
    .locator("canvas[aria-label='Camera preview']")
    .evaluate((element) =>
      element.dispatchEvent(
        new Event("webglcontextlost", { cancelable: true }),
      ),
    );
  await expect(page.getByTestId("camera-state")).toHaveText("Error");
  await expect(
    page.getByText("Preview unavailable", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enter VR", exact: true }),
  ).toBeDisabled();
  await expect(
    page.locator("canvas[aria-label='Camera preview']"),
  ).toBeHidden();
});

test("ending XR restores the desktop projection and rendered camera screen", async ({
  page,
}) => {
  await page.route("**/__vr-scene-regression", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<canvas style="width:800px;height:400px"></canvas>',
    }),
  );
  await page.goto("/__vr-scene-regression");
  const result = await page.evaluate(async () => {
    const modulePath = "/src/vrScene.ts";
    const { VRCameraScene } = await import(/* @vite-ignore */ modulePath);
    // Simulate the headset API boundary while keeping Three's real renderer,
    // camera updates and session-end listener ordering.
    Object.defineProperty(
      WebGL2RenderingContext.prototype,
      "makeXRCompatible",
      {
        configurable: true,
        value: async () => {},
      },
    );
    Object.defineProperty(window, "XRWebGLBinding", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "XRWebGLLayer", {
      configurable: true,
      value: class {
        framebuffer = null;
        framebufferWidth = 800;
        framebufferHeight = 400;
        fixedFoveation = 0;
        ignoreDepthValues = false;
        getViewport() {
          return { x: 0, y: 0, width: 800, height: 400 };
        }
      },
    });
    const near = 0.05;
    const far = 50;
    const scale = 1 / Math.tan((100 * Math.PI) / 360);
    const pose = {
      transform: {
        position: { x: 1, y: 1.6, z: 2 },
        orientation: { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 },
      },
      views: [
        {
          transform: {
            matrix: [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 1.6, 2, 1],
          },
          projectionMatrix: [
            scale,
            0,
            0,
            0,
            0,
            scale,
            0,
            0,
            0,
            0,
            -(far + near) / (far - near),
            -1,
            0,
            0,
            (-2 * far * near) / (far - near),
            0,
          ],
        },
      ],
    };
    class Session extends EventTarget {
      renderState = {};
      inputSources = [];
      enabledFeatures = [];
      environmentBlendMode = "opaque";
      pending = new Set<number>();
      updateRenderState(next: object) {
        Object.assign(this.renderState, next);
      }
      async requestReferenceSpace() {
        return new EventTarget();
      }
      requestAnimationFrame(
        callback: (
          time: number,
          frame: { getViewerPose: () => typeof pose },
        ) => void,
      ) {
        const id = requestAnimationFrame((time) => {
          this.pending.delete(id);
          callback(time, { getViewerPose: () => pose });
        });
        this.pending.add(id);
        return id;
      }
      cancelAnimationFrame(id: number) {
        cancelAnimationFrame(id);
        this.pending.delete(id);
      }
      async end() {
        this.dispatchEvent(new Event("end"));
        for (const id of this.pending) cancelAnimationFrame(id);
        this.pending.clear();
      }
    }
    const canvas = document.querySelector("canvas")!;
    const failures: string[] = [];
    const scene = new VRCameraScene(canvas, (error: unknown) =>
      failures.push(String(error)),
    );
    const pixel = () =>
      new Promise<number[]>((resolve) =>
        requestAnimationFrame(() => {
          const gl = canvas.getContext("webgl2")!;
          const rgba = new Uint8Array(4);
          // This point is inside the original screen, outside the retained XR
          // projection's smaller screen, and away from either screen's edge.
          gl.readPixels(400, 300, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
          resolve(Array.from(rgba));
        }),
      );
    try {
      const image = document.createElement("canvas");
      image.width = 160;
      image.height = 90;
      const context = image.getContext("2d")!;
      context.fillStyle = "#ff0000";
      context.fillRect(0, 0, image.width, image.height);
      scene.setImage(await createImageBitmap(image));
      const before = {
        projection: [...scene.camera.projectionMatrix.elements],
        pixel: await pixel(),
      };
      const session = new Session();
      await scene.enter(session);
      await pixel();
      const immersive = {
        fov: scene.camera.fov,
        position: scene.camera.position.toArray(),
        orientation: scene.camera.quaternion.toArray(),
      };
      await session.end();
      const after = {
        pixel: await pixel(),
        projection: [...scene.camera.projectionMatrix.elements],
        position: scene.camera.position.toArray(),
        orientation: scene.camera.quaternion.toArray(),
        screen: scene.screen.position.toArray(),
        zoom: scene.camera.zoom,
        presenting: scene.renderer.xr.isPresenting,
      };
      return { before, immersive, after, failures };
    } finally {
      scene.dispose();
    }
  });
  expect(result.failures).toEqual([]);
  expect(result.before.pixel).toEqual([255, 0, 0, 255]);
  expect(result.immersive.fov).toBe(100);
  expect(result.immersive.position).toEqual([1, 1.6, 2]);
  expect(result.immersive.orientation[1]).toBeCloseTo(Math.SQRT1_2);
  expect(result.immersive.orientation[3]).toBeCloseTo(Math.SQRT1_2);
  expect(result.after.presenting).toBe(false);
  expect(result.after.projection).toEqual(result.before.projection);
  expect(result.after.pixel).toEqual(result.before.pixel);
  expect(result.after.position).toEqual([0, 0, 0]);
  expect(result.after.orientation).toEqual([0, 0, 0, 1]);
  expect(result.after.screen).toEqual([0, 0, -2.6]);
  expect(result.after.zoom).toBe(1);
});
