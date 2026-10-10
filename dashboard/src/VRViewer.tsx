import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Glasses,
  Radio,
  ScanLine,
} from "lucide-react";
import { initialConfig } from "./transport";
import { CameraVideoFeed, type CameraVideoStatus } from "./vrVideoFeed";
import { decodeCameraImage, VRCameraScene } from "./vrScene";
import {
  checkVRCapability,
  navigateViewer,
  viewerUrl,
  VRSessionController,
  type VRSessionStatus,
} from "./vrSession";
import "./vr.css";

const emptyStatus: CameraVideoStatus = {
  state: "waiting",
  message: "Waiting for camera imagery",
  frameId: null,
  ageMs: null,
  receivedFrames: 0,
};
const stateLabels = {
  waiting: "Waiting",
  live: "Live",
  stale: "Stale",
  offline: "Offline",
  error: "Error",
};
function sourceAddress(value: string) {
  const url = new URL(value, window.location.href);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Enter an HTTP(S) backend base without credentials or query parameters.",
    );
  if (window.location.protocol === "https:" && url.protocol === "http:")
    throw new Error(
      "Use the HTTPS page's same-origin backend relay to avoid mixed content.",
    );
  return url.href.replace(/\/$/, "");
}

export default function VRViewer() {
  const [source] = useState(() => {
    const config = initialConfig();
    const params = new URLSearchParams(window.location.search);
    const apiUrl =
      params.get("api") ??
      (params.has("live") || import.meta.env.VITE_LIVE_URL
        ? config.apiUrl
        : window.location.origin);
    return { ...config, apiUrl };
  });
  const [base, setBase] = useState(source.apiUrl);
  const [draft, setDraft] = useState(source.apiUrl);
  const [formError, setFormError] = useState("");
  const [status, setStatus] = useState<CameraVideoStatus>(emptyStatus);
  const [displayed, setDisplayed] = useState<{
    frameId: number;
    width: number;
    height: number;
  } | null>(null);
  const [graphicsError, setGraphicsError] = useState("");
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const [capability, setCapability] = useState({
    available: false,
    message: "Checking VR support…",
  });
  const [sessionStatus, setSessionStatus] = useState<VRSessionStatus>({
    phase: "preview",
    message: "Desktop preview",
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<VRCameraScene | null>(null);
  const sessionRef = useRef<VRSessionController | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    window.history.replaceState(
      null,
      "",
      viewerUrl(window.location.href, { ...source, apiUrl: base }, true),
    );
  }, [base, source]);
  useEffect(() => {
    let cancelled = false;
    void checkVRCapability(window.isSecureContext, navigator.xr).then(
      (result) => {
        if (!cancelled) setCapability(result);
      },
    );
    const visibility = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", visibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    setStatus(emptyStatus);
    setDisplayed(null);
    setGraphicsError("");
    setSessionStatus({ phase: "preview", message: "Desktop preview" });
    if (!visible || !canvas.current) return;
    const abort = new AbortController();
    let scene: VRCameraScene;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let refreshTimer: ReturnType<typeof setInterval> | undefined;
    let decodeError = "";
    let hasImage = false;
    let imageCapturedAt: number | null = null;
    const active = () =>
      !abort.signal.aborted && current === generation.current;
    const clearImage = () => {
      if (!hasImage) return;
      scene.clearImage();
      hasImage = false;
      imageCapturedAt = null;
      setDisplayed(null);
    };
    const failGraphics = (error: unknown) => {
      if (!active()) return;
      const message =
        error instanceof Error ? error.message : "Graphics preview failed.";
      setGraphicsError(message);
      setStatus({ ...emptyStatus, state: "error", message });
      abort.abort();
      clearTimeout(pollTimer);
      clearInterval(refreshTimer);
      void sessionRef.current?.exit();
      setDisplayed(null);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    try {
      scene = new VRCameraScene(canvas.current, failGraphics);
    } catch (error) {
      failGraphics(error);
      return () => abort.abort();
    }
    sceneRef.current = scene;
    const session = navigator.xr
      ? new VRSessionController(
          navigator.xr,
          (accepted) => scene.enter(accepted),
          setSessionStatus,
        )
      : null;
    sessionRef.current = session;
    let feed: CameraVideoFeed;
    try {
      feed = new CameraVideoFeed(sourceAddress(base));
    } catch (error) {
      setStatus({
        ...emptyStatus,
        state: "error",
        message:
          error instanceof Error ? error.message : "Invalid backend address.",
      });
      return () => {
        abort.abort();
        session?.dispose();
        scene.dispose();
        sceneRef.current = null;
        sessionRef.current = null;
      };
    }
    const refresh = () => {
      if (!active()) return;
      let next = feed.snapshot();
      if (decodeError) next = { ...next, state: "error", message: decodeError };
      if (
        hasImage &&
        imageCapturedAt !== null &&
        performance.now() - imageCapturedAt > 2000 &&
        next.state === "live"
      )
        next = {
          ...next,
          state: "stale",
          message: "Camera image is stale; waiting for a fresh capture",
        };
      if (next.state !== "live") clearImage();
      setStatus(next);
    };
    const poll = async () => {
      if (!active()) return;
      const started = performance.now();
      const frame = await feed.read(abort.signal);
      if (!active()) return;
      if (frame) {
        const capturedAt = performance.now() - frame.ageMs;
        let bitmap: ImageBitmap | null = null;
        try {
          bitmap = await decodeCameraImage(frame.blob);
          if (
            !active() ||
            performance.now() - capturedAt > 2000 ||
            feed.snapshot().state !== "live"
          ) {
            bitmap.close();
            bitmap = null;
          } else {
            const { width, height } = bitmap;
            scene.setImage(bitmap);
            bitmap = null;
            hasImage = true;
            imageCapturedAt = capturedAt;
            decodeError = "";
            setDisplayed({ frameId: frame.frameId, width, height });
          }
        } catch (error) {
          bitmap?.close();
          if (active())
            decodeError =
              error instanceof Error
                ? `Camera image could not be decoded: ${error.message}`
                : "Camera image could not be decoded.";
        }
      }
      if (!active()) return;
      refresh();
      // One awaited read/decode at a time, targeting at most ten capture reads per second.
      pollTimer = setTimeout(
        () => void poll(),
        Math.max(0, 100 - (performance.now() - started)),
      );
    };
    refreshTimer = setInterval(refresh, 100);
    void poll();
    return () => {
      generation.current++;
      abort.abort();
      clearTimeout(pollTimer);
      clearInterval(refreshTimer);
      session?.dispose();
      scene.dispose();
      if (sceneRef.current === scene) sceneRef.current = null;
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [base, visible]);

  const connect = (event: FormEvent) => {
    event.preventDefault();
    try {
      const address = sourceAddress(draft.trim());
      setFormError("");
      setBase(address);
      setDraft(address);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Invalid backend address.",
      );
    }
  };
  const immersive = sessionStatus.phase === "immersive";
  return (
    <main className="vr-viewer">
      <header className="vr-header">
        <div className="vr-brand">
          <ScanLine size={22} />
          <span>
            PIP<small>CAMERA VIEWER</small>
          </span>
        </div>
        <button
          className="vr-back"
          onClick={() =>
            navigateViewer(
              viewerUrl(
                window.location.href,
                { ...source, apiUrl: base },
                false,
              ),
            )
          }
        >
          <ArrowLeft size={15} /> Workspace
        </button>
      </header>
      <div className="vr-content">
        <section className="vr-intro">
          <div>
            <span className="vr-eyebrow">PHONE CAMERA · DESKTOP + VR</span>
            <h1>Camera viewer</h1>
            <p>A live view from your phone, on a screen you can look around.</p>
          </div>
          <span className={`vr-state vr-state-${status.state}`}>
            <Radio size={13} />
            <span data-testid="camera-state">{stateLabels[status.state]}</span>
          </span>
        </section>
        <section className="vr-preview" aria-label="Camera screen">
          <canvas
            ref={canvas}
            aria-label="Camera preview"
            style={{ visibility: graphicsError ? "hidden" : "visible" }}
          />
          {(!displayed || graphicsError) && (
            <div className="vr-empty">
              <Camera size={28} />
              <strong>
                {graphicsError
                  ? "Preview unavailable"
                  : status.state === "stale"
                    ? "Waiting for a fresh image"
                    : status.state === "error" || status.state === "offline"
                      ? "Camera unavailable"
                      : "Waiting for your camera"}
              </strong>
              <p>{graphicsError || status.message}</p>
            </div>
          )}
          <div className="vr-preview-caption">
            <span>MONOSCOPIC CAMERA · FLAT SCREEN</span>
            <span>
              {displayed
                ? `Frame ${displayed.frameId} · ${displayed.width} × ${displayed.height}`
                : "No current image"}
            </span>
          </div>
        </section>
        <div className="vr-lower">
          <section className="vr-source">
            <span className="vr-eyebrow">01 / CAMERA SOURCE</span>
            <h2>Connect your backend</h2>
            <form onSubmit={connect}>
              <label htmlFor="vr-api">Backend API base</label>
              <div className="vr-source-input">
                <input
                  id="vr-api"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder={window.location.origin}
                  spellCheck={false}
                />
                <button type="submit" aria-label="Connect camera">
                  Connect <ArrowRight size={15} />
                </button>
              </div>
            </form>
            <p className={formError ? "vr-error" : "vr-detail"}>
              {formError || status.message}
            </p>
            <p className="vr-note">
              For HTTPS, use the page's origin with its configured backend
              relay. Frames arrive as successive camera captures.
            </p>
          </section>
          <section className="vr-entry">
            <span className="vr-eyebrow">02 / HEADSET VIEW</span>
            <h2>Take the camera into VR</h2>
            <p className="vr-detail" role="status">
              {sessionStatus.phase === "preview" &&
              sessionStatus.message === "Desktop preview"
                ? capability.message
                : sessionStatus.message}
            </p>
            <div className="vr-entry-actions">
              <button
                className="vr-enter"
                disabled={
                  !visible ||
                  !!graphicsError ||
                  (!immersive && (!capability.available || !displayed)) ||
                  sessionStatus.phase === "entering"
                }
                onClick={() => {
                  if (immersive) void sessionRef.current?.exit();
                  else void sessionRef.current?.enter();
                }}
              >
                <Glasses size={17} />
                {immersive
                  ? "Exit VR"
                  : sessionStatus.phase === "entering"
                    ? "Entering VR…"
                    : "Enter VR"}
              </button>
              {immersive && (
                <button
                  className="vr-recenter"
                  onClick={() => sceneRef.current?.recenter()}
                >
                  Recenter screen
                </button>
              )}
            </div>
            <p className="vr-note">
              The same camera image appears in both eyes. In VR, select with a
              controller to recenter the screen.
            </p>
          </section>
        </div>
        <footer className="vr-footer">
          <span>Camera viewing only · no rover controls</span>
          <span>Headset performance awaits physical testing</span>
        </footer>
      </div>
    </main>
  );
}
