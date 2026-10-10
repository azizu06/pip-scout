# PIP Quest camera viewer

Requested on 2026-10-10: work on Mehdi's dashboard issue #5 and start the VR flow, especially delivering camera video before the Quest headset is available.

## First increment

Add a dedicated `?view=vr` browser viewer to the existing dashboard. Connect to the configured backend's existing `/capture/status` and `/capture/frame.jpg`; no phone, backend or frozen wire-contract changes. Deliver successive JPEG observations, not a claimed 30-fps encoded stream. Use a stable virtual screen with the actual image aspect ratio, identical monoscopic camera content in both eyes, and natural head movement around the screen. Keep the desktop preview functional when immersive WebXR is unavailable.

Show waiting, current, stale, offline and error states. Never substitute generated imagery. Validate the source capture's age and identity; unchanged responses do not refresh freshness. Bound image size and request time, permit only one read at a time, cancel reads on source changes/unmount, and release replaced image/graphics resources. Clear the displayed image when it becomes stale or the source fails. Camera delivery has no motion-control permission and sends no motion requests.

Entry flow: configure the backend, preview its received image, check browser WebXR support, then explicitly enter immersive VR. Handle rejected entry, session end, page visibility loss and graphics failure. A controller select gesture may recenter the viewing screen; controller motor control is out of scope for this increment. Exiting returns to preview. Link to the viewer from the desktop workspace, preserving non-secret source URLs and revoking held desktop input through its existing unmount behavior. Do not carry pairing keys or permission in links.

## Hosting

Support an explicitly configured TLS certificate/key for Vite development and preview. Preserve the existing same-origin backend relay so an HTTPS page can fetch camera frames without mixed-content requests. Require both TLS paths together and fail clearly for invalid configuration. Commit no certificates, secrets or private footage. Document trusted-certificate hosting on the LAN and a USB/ADB localhost alternative; a browser certificate bypass is not verified WebXR trust.

## Verification and limitations

Tests use external deterministic camera fixtures, never production synthetic content. Verify source freshness/identity, bad responses, cancellation, resource disposal, actual browser rendering, source switching and absence of arm/manual calls. Run the dashboard unit suite, build, formatting and relevant Playwright regressions. Test HTTPS server behavior independently of headset hardware.

Quest frame rate, Wi-Fi latency, stereoscopic screen placement, controller events and comfort remain unverified until physical headset testing. A successful desktop preview is not a successful Quest test. A real backend/phone rehearsal is separate from fixture coverage.
