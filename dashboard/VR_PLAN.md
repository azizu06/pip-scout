# PIP Quest camera viewer implementation plan

> **For agentic workers:** Use test-driven development for each functional increment and independent review before delivery.

**Goal:** Deliver the existing backend's camera frames to a desktop-previewable WebXR screen.

**Architecture:** A bounded read-only camera feed consumes existing HTTP capture endpoints. A separate Three.js viewer renders a texture and owns explicit immersive session lifecycle. Vite can terminate explicitly configured TLS and relay requests to the current backend.

**Tech stack:** Existing React, TypeScript, Three.js, Vite, Vitest and Playwright; no XR framework dependency.

**Spec:** `dashboard/VR_SPEC.md`.

## Global constraints

- Preserve `docs/INTERFACES.md` and backend/phone ownership.
- Receive camera imagery only; generate no scene observations.
- This VR increment never arms or sends motion commands.
- Unchanged images never renew capture freshness; stale images are cleared.
- HTTPS must use an explicit certificate/key pair; commit neither.
- Preserve configured backend URLs but exclude control permission and keys from links.
- Report desktop evidence separately from unavailable headset tests.

## Review focus

- A capture update between status and image requests must not be displayed as the wrong frame.
- A stopped camera that still returns HTTP 200/304 must become stale.
- A previous backend's delayed response must not appear after source change or unmount.
- Failed WebXR entry and session end must leave a functioning preview and release resources.
- HTTPS hosting must relay to the same configured backend without exposing arbitrary proxy routes.

## Task 1: bounded camera feed

Files: `src/vrVideoFeed.ts`, `src/vrVideoFeed.test.ts`.

Interface: export `CameraVideoFeed`; constructor `(base: string, request?: typeof fetch, clock?: () => number)`; `read(signal: AbortSignal): Promise<CameraVideoFrame | null>`; `snapshot(): CameraVideoStatus`. `CameraVideoFrame` contains `blob: Blob`, `frameId: number`, `ageMs: number`. Status contains `state: waiting | live | stale | offline | error`, `message`, `frameId`, `ageMs`, `receivedFrames`.

- [x] Write failing tests for unchanged freshness, source age, identity mismatch, errors, bounded body, abort and duplicate/inflight reads.
- [x] Implement against `/capture/status` plus conditional `/capture/frame.jpg`, using capture token/ETag and source age.
- [x] Run focused tests and self-review.

## Task 2: viewer and entry flow

Files: `src/VRViewer.tsx`, `src/vrScene.ts`, `src/vrSession.ts`, their focused tests, `src/vr.css`, `tests/vr.spec.ts`; modify `src/main.tsx` and the desktop workspace link in `src/App.tsx`.

- [x] Write failing browser tests for empty preview, received imagery, staleness, source change and no motion commands; focused tests for XR entry/lifecycle as appropriate.
- [x] Implement polling with Task 1's interface, texture presentation, stable screen/recenter, explicit WebXR capability/entry/exit and desktop fallback.
- [x] Preserve URLs in viewer/workspace links without commands or credentials.
- [x] Verify resource cleanup and browser tests.

## Task 3: HTTPS hosting and operator instructions

Files: `httpsConfig.ts`, `src/httpsConfig.test.ts`, `vite.config.ts`, `.env.example`, `VR.md`, README link.

- [x] Write failing configuration tests for paired TLS paths, invalid/missing files and enabled TLS options.
- [x] Apply TLS to dev and preview while preserving current backend proxy.
- [x] Document same-origin LAN setup, trusted certificates, USB localhost fallback, source/video limits and pending headset checks.
- [x] Test actual HTTPS startup and source relay without a headset.

## Delivery

- [x] Review each increment and full diff; fix material findings.
- [x] Run dashboard unit suite/build/format and relevant browser regressions; record baseline failures below.
- [x] Commit and push the increment, create [draft PR #109](https://github.com/azizu06/pip-scout/pull/109) referencing parent #5, attach it to this chat, and record remaining physical validation.

## Verification record

- Focused feed, scene, session, TLS, relay and operator-proxy checks: 63 unit tests passed. Production build and formatting passed; the build retains the existing large Three.js chunk warning.
- Eight desktop VR browser tests passed with external JPEG fixtures and actual WebGL pixel assertions. An additional real-Three/simulated-XR regression failed before the session-end fix and passed afterward, verifying the complete desktop projection, translated/turned head-pose reset, screen placement and rendered pixels after exit.
- Temporary-certificate HTTPS smoke passed for both Vite development and preview: page HTML, capture status JSON, unchanged JPEG bytes and a WSS `/live` upgrade returning 101. This establishes laptop hosting/relay behavior, not Quest certificate trust.
- Full dashboard tests are not a clean pass: an initial run passed 293 assertions across 46 files before a worker RPC timeout; a later run hit the existing `persistentSurfaceMap.capacity.test.ts` 8-second timing threshold (9,931 ms) and another worker timeout. The existing `pointCloud.test.ts` two-million-sample check also exceeded its 5-second timeout under concurrent load. These tests are unmodified by this increment; focused VR/TLS checks passed.
- A backend/source rehearsal reported about 10.025 incoming captures per second. Viewing that backend through the implemented viewer has not yet been rehearsed; browser rendering evidence uses external fixtures.

## Remaining physical validation

- [ ] Rehearse the viewer against the actual backend and uploading phone.
- [ ] Validate Quest trusted LAN access or USB localhost reversal, browser/headset support and versions.
- [ ] Measure camera image rate/latency and verify binocular placement, head movement, controller recentering, session entry/exit, tracking/visibility loss and comfort on the headset.
