import { afterEach, expect, test, vi } from "vitest";
import { JPEG } from "../tests/captureFixture";
import { CameraVideoFeed } from "./vrVideoFeed";

const signal = () => new AbortController().signal;
const source = (token = "capture-1", frameId = 7, age = 20) => ({
  version: 1,
  health: {
    version: 1,
    type: "health",
    phone: "ok",
    car: "down",
    detector: "ok",
  },
  frame: {
    capture_id: token,
    age_ms: age,
    metadata: {
      version: 1,
      type: "frame",
      session_id: "camera-room",
      map_epoch: 1,
      frame_id: frameId,
      t_capture: frameId / 2,
      t_wall_ms: 1000,
      tracking: "normal",
      transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1],
      image: {
        width: 80,
        height: 60,
        jpeg_len: JPEG.length,
        intrinsics: [40, 0, 0, 0, 40, 0, 40, 30, 1],
        orientation: "landscape_right",
      },
      depth: { width: 20, height: 15, format: "float32_m", len: 1200 },
      confidence: { width: 20, height: 15, format: "uint8_0_2", len: 300 },
    },
  },
  received_frames: 99,
  frame_hz: 2,
  rich: { packets: {} },
  mapping: {},
  tracking: "normal",
  position: [0, 1, 0],
});
const image = (token = "capture-1", frameId = 7) =>
  new Response(JPEG, {
    headers: {
      "Content-Type": "image/jpeg",
      ETag: `"${token}"`,
      "X-Frame-Id": String(frameId),
    },
  });

function fixture(
  responses: (Response | (() => Response))[],
  clock = () => 1000,
) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const request: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    const response = responses.shift();
    if (!response) throw Error("Unexpected camera request");
    return typeof response === "function" ? response() : response;
  };
  return {
    feed: new CameraVideoFeed("https://camera.test/", request, clock),
    calls,
  };
}

afterEach(() => vi.useRealTimers());

test("delivers the matching JPEG using only read-only camera routes", async () => {
  const { feed, calls } = fixture([Response.json(source()), image()]);
  const frame = await feed.read(signal());
  expect(frame).toMatchObject({ frameId: 7, ageMs: 20 });
  expect(frame!.blob.type).toBe("image/jpeg");
  expect(new Uint8Array(await frame!.blob.arrayBuffer())).toEqual(
    new Uint8Array(JPEG),
  );
  expect(feed.snapshot()).toMatchObject({
    state: "live",
    frameId: 7,
    ageMs: 20,
    receivedFrames: 1,
  });
  expect(calls.map((call) => call.url)).toEqual([
    "https://camera.test/capture/status",
    "https://camera.test/capture/frame.jpg",
  ]);
  expect(
    calls.every(({ init }) => !init?.method || init.method === "GET"),
  ).toBe(true);
  expect(calls.every(({ init }) => init?.cache === "no-store")).toBe(true);
});

test("unchanged 304 responses never renew the accepted frame's source age", async () => {
  let now = 1000;
  const { feed, calls } = fixture(
    [
      Response.json(source()),
      image(),
      Response.json(source()),
      new Response(null, { status: 304, headers: { ETag: '"capture-1"' } }),
    ],
    () => now,
  );
  await feed.read(signal());
  now = 2000;
  expect(await feed.read(signal())).toBeNull();
  expect(new Headers(calls[3].init?.headers).get("If-None-Match")).toBe(
    '"capture-1"',
  );
  expect(feed.snapshot()).toMatchObject({
    state: "live",
    ageMs: 1020,
    receivedFrames: 1,
  });
  now = 3001;
  expect(feed.snapshot()).toMatchObject({
    state: "stale",
    frameId: 7,
    ageMs: 2021,
  });
});

test("a stale snapshot during an unchanged request preserves the stale result", async () => {
  let now = 1000;
  let release!: (response: Response) => void;
  let announce!: () => void;
  const imageStarted = new Promise<void>((resolve) => {
    announce = resolve;
  });
  let requests = 0;
  const feed = new CameraVideoFeed(
    "",
    async () => {
      requests += 1;
      if (requests % 2 === 1) return Response.json(source());
      if (requests === 2) return image();
      announce();
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    },
    () => now,
  );
  await feed.read(signal());
  now = 2980;
  const pending = feed.read(signal());
  await imageStarted;
  now = 3001;
  expect(feed.snapshot().state).toBe("stale");
  release(
    new Response(null, { status: 304, headers: { ETag: '"capture-1"' } }),
  );
  expect(await pending).toBeNull();
  expect(feed.snapshot()).toMatchObject({
    state: "stale",
    frameId: 7,
    ageMs: 2021,
  });
});

test("duplicate HTTP 200 JPEGs do not count or refresh unchanged frames", async () => {
  let now = 1000;
  const { feed } = fixture(
    [Response.json(source()), image(), Response.json(source()), image()],
    () => now,
  );
  await feed.read(signal());
  now = 1800;
  expect(await feed.read(signal())).toBeNull();
  expect(feed.snapshot()).toMatchObject({ ageMs: 820, receivedFrames: 1 });
});

test("a fresh capture token can reuse a frame id after a map reset", async () => {
  const { feed } = fixture([
    Response.json(source()),
    image(),
    Response.json(source("capture-2")),
    image("capture-2"),
  ]);
  await feed.read(signal());
  expect(await feed.read(signal())).toMatchObject({ frameId: 7 });
  expect(feed.snapshot().receivedFrames).toBe(2);
});

test.each([2001, 10_000])(
  "refuses source captures already %i ms old",
  async (age) => {
    const { feed, calls } = fixture([
      Response.json(source("capture-1", 7, age)),
    ]);
    expect(await feed.read(signal())).toBeNull();
    expect(feed.snapshot()).toMatchObject({ state: "stale", ageMs: age });
    expect(calls).toHaveLength(1);
  },
);

test("status and body transfer time contribute to source age", async () => {
  let now = 1000;
  const { feed } = fixture(
    [
      () => {
        now = 1700;
        return Response.json(source("capture-1", 7, 1500));
      },
      image(),
    ],
    () => now,
  );
  expect(await feed.read(signal())).toBeNull();
  expect(feed.snapshot()).toMatchObject({ state: "stale", ageMs: 2200 });
});

test.each([-1, NaN, Infinity, "20", null])(
  "rejects invalid source age %s",
  async (age) => {
    const current = { ...source(), frame: { ...source().frame, age_ms: age } };
    const { feed } = fixture([Response.json(current)]);
    expect(await feed.read(signal())).toBeNull();
    expect(feed.snapshot().state).toBe("error");
  },
);

test.each(["down", "unknown", undefined])(
  "missing or unavailable phone health (%s) clears the live image",
  async (phone) => {
    const { feed } = fixture([
      Response.json(source()),
      image(),
      Response.json({ ...source(), health: { phone } }),
    ]);
    await feed.read(signal());
    expect(await feed.read(signal())).toBeNull();
    expect(feed.snapshot()).toMatchObject({
      state: "offline",
      frameId: null,
      ageMs: null,
    });
  },
);

test("fresh camera imagery is usable when the separate pose heartbeat is stale", async () => {
  const { feed } = fixture([
    Response.json({ ...source(), health: { phone: "stale" } }),
    image(),
  ]);
  expect(await feed.read(signal())).not.toBeNull();
  expect(feed.snapshot().state).toBe("live");
});

test.each([204, "missing"])(
  "a %s camera observation clears the previous image",
  async (kind) => {
    const responses =
      kind === 204
        ? [
            Response.json(source()),
            image(),
            Response.json(source("capture-2", 8)),
            new Response(null, { status: 204 }),
          ]
        : [
            Response.json(source()),
            image(),
            Response.json({ ...source(), frame: null }),
          ];
    const { feed } = fixture(responses);
    await feed.read(signal());
    expect(await feed.read(signal())).toBeNull();
    expect(feed.snapshot()).toMatchObject({
      state: "waiting",
      frameId: null,
      ageMs: null,
    });
  },
);

test.each(["capture-2", "missing", "wrong-frame-id"])(
  "rejects the %s JPEG identity without displaying another capture",
  async (kind) => {
    const jpeg = image(
      kind === "capture-2" ? kind : "capture-1",
      kind === "wrong-frame-id" ? 8 : 7,
    );
    if (kind === "missing") jpeg.headers.delete("ETag");
    const { feed } = fixture([
      Response.json(source()),
      image(),
      Response.json(source()),
      jpeg,
    ]);
    await feed.read(signal());
    expect(await feed.read(signal())).toBeNull();
    expect(feed.snapshot().state).not.toBe("live");
    expect(feed.snapshot().frameId).toBeNull();
    if (kind === "missing")
      expect(feed.snapshot().message).toMatch(/same-origin.*relay/i);
  },
);

test("304 cannot establish a camera frame that has not been received", async () => {
  const { feed } = fixture([
    Response.json(source()),
    new Response(null, { status: 304, headers: { ETag: '"capture-1"' } }),
  ]);
  expect(await feed.read(signal())).toBeNull();
  expect(feed.snapshot().state).toBe("error");
});

test.each(["status", "image", "network", "json"])(
  "a %s failure clears previously live imagery",
  async (kind) => {
    const responses = [Response.json(source()), image()];
    if (kind === "status") responses.push(new Response(null, { status: 503 }));
    if (kind === "image")
      responses.push(
        Response.json(source()),
        new Response(null, { status: 503 }),
      );
    if (kind === "json")
      responses.push(
        new Response("malformed", {
          headers: { "Content-Type": "application/json" },
        }),
      );
    const { feed } = fixture(responses);
    await feed.read(signal());
    expect(await feed.read(signal())).toBeNull();
    expect(feed.snapshot()).toMatchObject({
      state: "error",
      frameId: null,
      ageMs: null,
    });
  },
);

test.each(["type", "jpeg", "length", "dimensions", "decoded-dimensions"])(
  "rejects invalid camera image %s",
  async (kind) => {
    const current = source();
    const jpeg = image();
    if (kind === "type") jpeg.headers.set("Content-Type", "text/html");
    if (kind === "length") current.frame.metadata.image.jpeg_len += 1;
    if (kind === "dimensions") current.frame.metadata.image.width = 100_000;
    if (kind === "decoded-dimensions") current.frame.metadata.image.width = 81;
    const { feed } = fixture([
      Response.json(current),
      kind === "jpeg"
        ? new Response(new Uint8Array(JPEG.length), { headers: jpeg.headers })
        : jpeg,
    ]);
    expect(await feed.read(signal())).toBeNull();
    expect(feed.snapshot().state).toBe("error");
  },
);

test("bounds images by Content-Length before consuming a body", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const { feed } = fixture([
    Response.json(source()),
    new Response(body, {
      headers: {
        "Content-Type": "image/jpeg",
        ETag: '"capture-1"',
        "Content-Length": String(4 * 1024 * 1024 + 1),
      },
    }),
  ]);
  expect(await feed.read(signal())).toBeNull();
  expect(feed.snapshot().state).toBe("error");
  expect(cancelled).toBe(true);
});

test("streaming image bodies cannot exceed 4 MiB when Content-Length is absent", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() {
      cancelled = true;
    },
  });
  const current = source();
  current.frame.metadata.image.jpeg_len = 4 * 1024 * 1024;
  const { feed } = fixture([
    Response.json(current),
    new Response(body, {
      headers: { "Content-Type": "image/jpeg", ETag: '"capture-1"' },
    }),
  ]);
  expect(await feed.read(signal())).toBeNull();
  expect(feed.snapshot().state).toBe("error");
  expect(cancelled).toBe(true);
});

test("only one camera read can be in flight", async () => {
  let release!: (response: Response) => void;
  let requests = 0;
  const request: typeof fetch = async () => {
    requests += 1;
    return requests === 1
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : image();
  };
  const feed = new CameraVideoFeed("", request);
  const first = feed.read(signal());
  expect(await feed.read(signal())).toBeNull();
  expect(requests).toBe(1);
  release(Response.json(source()));
  expect(await first).not.toBeNull();
});

test("an already-aborted read sends no camera requests", async () => {
  const { feed, calls } = fixture([]);
  const controller = new AbortController();
  controller.abort();
  expect(await feed.read(controller.signal)).toBeNull();
  expect(calls).toHaveLength(0);
});

test("cancellation ignores delayed results even when the request ignores its signal", async () => {
  let release!: (response: Response) => void;
  let requests = 0;
  const request: typeof fetch = async () => {
    requests += 1;
    return requests === 1
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : image();
  };
  const feed = new CameraVideoFeed("", request);
  const controller = new AbortController();
  const pending = feed.read(controller.signal);
  controller.abort();
  expect(await pending).toBeNull();
  release(Response.json(source()));
  await Promise.resolve();
  expect(feed.snapshot().state).not.toBe("live");
  expect(requests).toBe(1);
});

test("a blocked request reaches its deadline and aborts the HTTP request", async () => {
  vi.useFakeTimers();
  let requestSignal: AbortSignal | null | undefined;
  const feed = new CameraVideoFeed("", async (_input, init) => {
    requestSignal = init?.signal;
    return new Promise<Response>(() => {});
  });
  const pending = feed.read(signal());
  await vi.advanceTimersByTimeAsync(4000);
  expect(await pending).toBeNull();
  expect(requestSignal?.aborted).toBe(true);
  expect(feed.snapshot()).toMatchObject({ state: "error", frameId: null });
});

test("a blocked JPEG stream also observes the deadline and cancels its reader", async () => {
  vi.useFakeTimers();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const { feed } = fixture([
    Response.json(source()),
    new Response(body, {
      headers: { "Content-Type": "image/jpeg", ETag: '"capture-1"' },
    }),
  ]);
  const pending = feed.read(signal());
  await vi.advanceTimersByTimeAsync(4000);
  expect(await pending).toBeNull();
  expect(feed.snapshot().state).toBe("error");
  expect(cancelled).toBe(true);
});
