export interface CameraVideoFrame {
  blob: Blob;
  frameId: number;
  ageMs: number;
}

export interface CameraVideoStatus {
  state: "waiting" | "live" | "stale" | "offline" | "error";
  message: string;
  frameId: number | null;
  ageMs: number | null;
  receivedFrames: number;
}

const MAX_AGE_MS = 2000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_STATUS_BYTES = 256 * 1024;
const READ_TIMEOUT_MS = 3000;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const integer = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= minimum &&
  value <= maximum;

function discard(response: Response) {
  void response.body?.cancel().catch(() => {});
}

/** Also settles when an injected request or stream ignores AbortSignal. */
function cancellable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(signal.reason);
        else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

async function boundedBody(
  response: Response,
  signal: AbortSignal,
  maximum: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("Content-Length");
  if (
    declared !== null &&
    (!/^\d+$/.test(declared) || Number(declared) > maximum)
  ) {
    discard(response);
    throw Error("Camera response exceeds the size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) throw Error("Camera response is empty");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await cancellable(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > maximum)
        throw Error("Camera response exceeds the size limit");
      chunks.push(value);
    }
  } finally {
    // Do not allow a broken stream's cancellation promise to block the deadline.
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Read encoded dimensions before a browser decoder allocates the image. */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[bytes.length - 2] !== 0xff ||
    bytes[bytes.length - 1] !== 0xd9
  )
    throw Error("Camera response is not a complete JPEG");
  let offset = 2;
  while (offset < bytes.length - 1) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      if (length < 8) break;
      return {
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
      };
    }
    offset += length;
  }
  throw Error("Camera JPEG dimensions are unavailable");
}

interface CaptureIdentity {
  token: string;
  frameId: number;
  capturedAt: number;
}

/** Read-only camera observations; no drive permissions or motion endpoints. */
export class CameraVideoFeed {
  private base: string;
  private state: CameraVideoStatus["state"] = "waiting";
  private message = "Waiting for camera imagery";
  private receivedFrames = 0;
  private reading = false;
  private observed: CaptureIdentity | null = null;
  private displayed: CaptureIdentity | null = null;
  private etag = "";
  private lastDeliveredToken = "";

  constructor(
    base: string,
    private request: typeof fetch = (input, init) => fetch(input, init),
    private clock: () => number = () => performance.now(),
  ) {
    this.base = base.replace(/\/+$/, "");
  }

  private clear(state: CameraVideoStatus["state"], message: string) {
    this.state = state;
    this.message = message;
    this.displayed = null;
    this.etag = "";
  }

  private stale(capture: CaptureIdentity) {
    this.clear("stale", "Camera image is stale; waiting for a fresh capture");
    this.displayed = capture;
  }

  private async response(path: string, signal: AbortSignal, etag = "") {
    signal.throwIfAborted();
    const pending = this.request(`${this.base}${path}`, {
      signal,
      cache: "no-store",
      headers: etag ? { "If-None-Match": etag } : {},
    }).then((response) => {
      if (signal.aborted) {
        discard(response);
        signal.throwIfAborted();
      }
      return response;
    });
    return cancellable(pending, signal);
  }

  async read(signal: AbortSignal): Promise<CameraVideoFrame | null> {
    if (this.reading || signal.aborted) return null;
    this.reading = true;
    const active = new AbortController();
    const cancel = () => active.abort(signal.reason);
    signal.addEventListener("abort", cancel, { once: true });
    const deadline = setTimeout(
      () =>
        active.abort(
          Error("Camera request timed out; check the backend connection"),
        ),
      READ_TIMEOUT_MS,
    );
    // Starting before the status request conservatively includes network delay.
    const started = this.clock();
    try {
      const statusResponse = await this.response(
        "/capture/status",
        active.signal,
      );
      if (statusResponse.status === 204) {
        discard(statusResponse);
        this.clear("waiting", "Waiting for camera imagery");
        return null;
      }
      if (statusResponse.status !== 200) {
        discard(statusResponse);
        throw Error("Camera status unavailable; check the backend API base");
      }
      const statusBytes = await boundedBody(
        statusResponse,
        active.signal,
        MAX_STATUS_BYTES,
      );
      let status: Record<string, unknown>;
      try {
        status = record(JSON.parse(new TextDecoder().decode(statusBytes)));
      } catch {
        throw Error("Camera status is invalid JSON");
      }
      active.signal.throwIfAborted();
      if (status.version !== 1)
        throw Error("Camera status protocol is unsupported");
      const phone = record(status.health).phone;
      if (phone !== "ok" && phone !== "stale") {
        this.clear(
          "offline",
          "Phone camera is offline or its health is unavailable",
        );
        return null;
      }
      if (status.frame === null) {
        this.clear("waiting", "Waiting for camera imagery");
        return null;
      }
      const frame = record(status.frame);
      const metadata = record(frame.metadata);
      const image = record(metadata.image);
      const token = frame.capture_id;
      const frameId = metadata.frame_id;
      const sourceAge = frame.age_ms;
      if (
        typeof token !== "string" ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(token) ||
        !integer(frameId, 0, Number.MAX_SAFE_INTEGER) ||
        typeof sourceAge !== "number" ||
        !Number.isFinite(sourceAge) ||
        sourceAge < 0 ||
        !integer(image.width, 1, 4096) ||
        !integer(image.height, 1, 4096) ||
        (image.width as number) * (image.height as number) > 16_000_000 ||
        !integer(image.jpeg_len, 1, MAX_IMAGE_BYTES)
      )
        throw Error(
          "Camera capture metadata is invalid or exceeds image limits",
        );

      let capturedAt = started - sourceAge;
      if (this.observed?.token === token) {
        if (this.observed.frameId !== frameId)
          throw Error("Camera capture identity changed unexpectedly");
        // An unchanged source cannot get younger even if the server reports zero.
        capturedAt = Math.min(capturedAt, this.observed.capturedAt);
      }
      const capture = { token, frameId: frameId as number, capturedAt };
      this.observed = capture;
      if (this.clock() - capturedAt > MAX_AGE_MS) {
        this.stale(capture);
        return null;
      }

      const jpeg = await this.response(
        "/capture/frame.jpg",
        active.signal,
        this.etag,
      );
      if (jpeg.status === 204) {
        discard(jpeg);
        this.clear("waiting", "Waiting for camera imagery");
        return null;
      }
      if (jpeg.status !== 200 && jpeg.status !== 304) {
        discard(jpeg);
        throw Error("Camera image unavailable; check the backend connection");
      }
      const tag = jpeg.headers.get("ETag");
      const imageFrameId = jpeg.headers.get("X-Frame-Id");
      if (!tag) {
        discard(jpeg);
        throw Error(
          "Camera identity header unavailable; use the same-origin backend relay",
        );
      }
      if (
        tag !== `"${token}"` ||
        (imageFrameId !== null && imageFrameId !== String(frameId))
      ) {
        discard(jpeg);
        this.clear(
          "waiting",
          "Camera capture changed while reading; waiting for the next frame",
        );
        return null;
      }
      if (jpeg.status === 304) {
        discard(jpeg);
        if (!this.etag || this.etag !== tag || this.displayed?.token !== token)
          throw Error(
            "Camera returned an unchanged image before an image was received",
          );
        if (this.clock() - capturedAt > MAX_AGE_MS) this.stale(capture);
        else this.displayed = capture;
        return null;
      }
      if (
        jpeg.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !==
        "image/jpeg"
      ) {
        discard(jpeg);
        throw Error("Camera response must be image/jpeg");
      }
      const bytes = await boundedBody(jpeg, active.signal, MAX_IMAGE_BYTES);
      if (bytes.length !== image.jpeg_len)
        throw Error("Camera JPEG length does not match its capture metadata");
      const dimensions = jpegDimensions(bytes);
      if (
        dimensions.width !== image.width ||
        dimensions.height !== image.height
      )
        throw Error("Camera JPEG dimensions do not match its capture metadata");
      const ageMs = this.clock() - capturedAt;
      if (ageMs > MAX_AGE_MS) {
        this.stale(capture);
        return null;
      }
      active.signal.throwIfAborted();
      const duplicate = this.etag === tag && this.displayed?.token === token;
      this.displayed = capture;
      this.etag = tag;
      this.state = "live";
      this.message = "Camera image received";
      if (duplicate) return null;
      if (this.lastDeliveredToken !== token) this.receivedFrames += 1;
      this.lastDeliveredToken = token;
      return {
        blob: new Blob([bytes], { type: "image/jpeg" }),
        frameId: capture.frameId,
        ageMs,
      };
    } catch (error: unknown) {
      if (signal.aborted) this.clear("waiting", "Camera request cancelled");
      else
        this.clear(
          "error",
          error instanceof Error
            ? error.message
            : "Camera request failed; check the backend connection",
        );
      return null;
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", cancel);
      this.reading = false;
    }
  }

  snapshot(): CameraVideoStatus {
    const ageMs = this.displayed
      ? Math.max(0, this.clock() - this.displayed.capturedAt)
      : null;
    const expired =
      this.state === "live" && ageMs !== null && ageMs > MAX_AGE_MS;
    return {
      state: expired ? "stale" : this.state,
      message: expired
        ? "Camera image is stale; waiting for a fresh capture"
        : this.message,
      frameId: this.displayed?.frameId ?? null,
      ageMs,
      receivedFrames: this.receivedFrames,
    };
  }
}
