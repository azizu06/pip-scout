/// <reference types="webxr" />

export interface VRSessionStatus {
  phase: "preview" | "entering" | "immersive";
  message: string;
}
export async function checkVRCapability(
  secure: boolean,
  xr: Pick<XRSystem, "isSessionSupported"> | undefined,
): Promise<{ available: boolean; message: string }> {
  if (!secure)
    return {
      available: false,
      message: "VR requires a trusted HTTPS connection or localhost.",
    };
  if (!xr)
    return {
      available: false,
      message:
        "Immersive VR is unavailable in this browser. Desktop preview is ready.",
    };
  try {
    const available = await xr.isSessionSupported("immersive-vr");
    return {
      available,
      message: available
        ? "VR is available. Put on your headset, then enter VR."
        : "No immersive VR headset is available. Desktop preview is ready.",
    };
  } catch (error) {
    return {
      available: false,
      message: `VR support check failed: ${errorMessage(error)}`,
    };
  }
}
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Owns accepted sessions, including ones returned after entry was cancelled. */
export class VRSessionController {
  private status: VRSessionStatus = {
    phase: "preview",
    message: "Desktop preview",
  };
  private session: XRSession | null = null;
  private generation = 0;
  private disposed = false;
  constructor(
    private xr: Pick<XRSystem, "requestSession">,
    private attach: (session: XRSession) => Promise<void>,
    private changed: (status: VRSessionStatus) => void,
  ) {}
  snapshot() {
    return { ...this.status };
  }
  private publish(phase: VRSessionStatus["phase"], message: string) {
    this.status = { phase, message };
    if (!this.disposed) this.changed(this.snapshot());
  }
  private ended = () => {
    this.session?.removeEventListener("end", this.ended);
    this.session = null;
    this.generation++;
    this.publish("preview", "VR ended. Desktop preview is ready.");
  };
  async enter() {
    if (this.disposed || this.status.phase !== "preview") return;
    const generation = ++this.generation;
    this.publish("entering", "Waiting for headset permission…");
    let accepted: XRSession | null = null;
    try {
      // Called directly by the button gesture; no asynchronous support check here.
      accepted = await this.xr.requestSession("immersive-vr", {
        optionalFeatures: ["local-floor"],
      });
      if (this.disposed || generation !== this.generation) {
        await accepted.end();
        return;
      }
      this.session = accepted;
      accepted.addEventListener("end", this.ended);
      await this.attach(accepted);
      if (this.disposed || generation !== this.generation) {
        if (this.session === accepted) await accepted.end();
        return;
      }
      this.publish("immersive", "VR active · select to recenter the screen");
    } catch (error) {
      if (accepted) {
        accepted.removeEventListener("end", this.ended);
        if (this.session === accepted) this.session = null;
        await accepted.end().catch(() => {});
      }
      if (!this.disposed && generation === this.generation)
        this.publish("preview", `Could not enter VR: ${errorMessage(error)}`);
    }
  }
  async exit() {
    this.generation++;
    if (!this.session) {
      this.publish("preview", "Desktop preview");
      return;
    }
    try {
      await this.session.end();
    } catch (error) {
      this.publish("immersive", `Could not end VR: ${errorMessage(error)}`);
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    const session = this.session;
    this.session = null;
    if (session) {
      session.removeEventListener("end", this.ended);
      void session.end().catch(() => {});
    }
  }
}

/** Links carry source addresses only; URL credentials and embedded queries are omitted. */
export function viewerUrl(
  href: string,
  source: { wsUrl: string; apiUrl: string },
  vr: boolean,
): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  for (const [name, value, protocols] of [
    ["live", source.wsUrl, ["ws:", "wss:"]],
    ["api", source.apiUrl, ["http:", "https:"]],
  ] as const) {
    try {
      const address = new URL(value, url);
      if (!(protocols as readonly string[]).includes(address.protocol))
        continue;
      address.username = "";
      address.password = "";
      address.search = "";
      address.hash = "";
      url.searchParams.set(name, address.href);
    } catch {
      /* Invalid source addresses cannot become navigation links. */
    }
  }
  if (vr) url.searchParams.set("view", "vr");
  return url.href;
}
export function navigateViewer(url: string) {
  window.history.pushState(null, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
}
