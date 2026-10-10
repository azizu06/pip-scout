import { describe, expect, it, vi } from "vitest";
import { checkVRCapability, VRSessionController, viewerUrl } from "./vrSession";
class Session extends EventTarget {
  ended = false;
  async end() {
    this.ended = true;
    this.dispatchEvent(new Event("end"));
  }
}
const sessionAsXR = (session: Session) => session as unknown as XRSession;
describe("VR entry and lifecycle", () => {
  it("checks secure context before querying immersive support", async () => {
    const supported = vi.fn(async () => true);
    expect(
      (await checkVRCapability(false, { isSessionSupported: supported }))
        .available,
    ).toBe(false);
    expect(supported).not.toHaveBeenCalled();
    expect(
      (await checkVRCapability(true, { isSessionSupported: supported }))
        .available,
    ).toBe(true);
    expect(supported).toHaveBeenCalledWith("immersive-vr");
    expect((await checkVRCapability(true, undefined)).available).toBe(false);
  });
  it("returns to preview on external session end and permits another entry", async () => {
    const first = new Session();
    const second = new Session();
    const sessions = [first, second];
    const attached: XRSession[] = [];
    const control = new VRSessionController(
      { requestSession: async () => sessionAsXR(sessions.shift()!) },
      async (session) => {
        attached.push(session);
      },
      () => {},
    );
    await control.enter();
    expect(control.snapshot().phase).toBe("immersive");
    await first.end();
    expect(control.snapshot().phase).toBe("preview");
    await control.enter();
    expect(attached).toEqual([first, second]);
    await control.exit();
    expect(second.ended).toBe(true);
    expect(control.snapshot().phase).toBe("preview");
  });
  it("preserves preview and reports refused entry", async () => {
    const control = new VRSessionController(
      {
        requestSession: async () => {
          throw new Error("User refused permission");
        },
      },
      async () => {},
      () => {},
    );
    await control.enter();
    expect(control.snapshot().phase).toBe("preview");
    expect(control.snapshot().message).toContain("User refused permission");
  });
  it("ends the accepted session when graphics attachment fails", async () => {
    const session = new Session();
    const control = new VRSessionController(
      { requestSession: async () => sessionAsXR(session) },
      async () => {
        throw new Error("Graphics attachment failed");
      },
      () => {},
    );
    await control.enter();
    expect(session.ended).toBe(true);
    expect(control.snapshot().phase).toBe("preview");
    expect(control.snapshot().message).toContain("Graphics attachment failed");
  });
  it("ends a late accepted session after disposal without attaching it", async () => {
    const session = new Session();
    let accept!: (session: XRSession) => void;
    const attached: XRSession[] = [];
    const changes: string[] = [];
    const control = new VRSessionController(
      {
        requestSession: () =>
          new Promise((resolve) => {
            accept = resolve;
          }),
      },
      async (value) => {
        attached.push(value);
      },
      (status) => {
        changes.push(status.phase);
      },
    );
    const entry = control.enter();
    control.dispose();
    accept(sessionAsXR(session));
    await entry;
    expect(session.ended).toBe(true);
    expect(attached).toHaveLength(0);
    expect(changes).toEqual(["entering"]);
  });
});
describe("viewer navigation", () => {
  it("carries source URLs while discarding control permission and secrets", () => {
    const result = new URL(
      viewerUrl(
        "https://dashboard.test/?commands=true&roverKey=secret#secret",
        {
          wsUrl: "wss://phone.test/live",
          apiUrl: "https://phone.test/backend",
        },
        true,
      ),
    );
    expect(result.href).toBe(
      "https://dashboard.test/?live=wss%3A%2F%2Fphone.test%2Flive&api=https%3A%2F%2Fphone.test%2Fbackend&view=vr",
    );
    const unsafe = new URL(
      viewerUrl(
        "https://dashboard.test/?pair=secret",
        {
          wsUrl: "wss://user:password@phone.test/live?token=secret#secret",
          apiUrl: "https://phone.test/?key=secret",
        },
        false,
      ),
    );
    expect(unsafe.href).not.toMatch(/secret|password|user|view=/);
    expect(unsafe.searchParams.get("live")).toBe("wss://phone.test/live");
    expect(unsafe.searchParams.get("api")).toBe("https://phone.test/");
  });
});
