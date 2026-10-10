# Quest camera viewer

Open the dashboard with `?view=vr` to preview received camera images on a virtual screen, then explicitly enter immersive VR when the browser supports it. The same monoscopic image is shown to both eyes at its original aspect ratio; head movement changes your view of the screen. The desktop preview works without a headset. A controller select gesture recenters the screen during VR.

This viewer reads the backend's existing `/capture/status` and `/capture/frame.jpg`. It never arms the rover or sends motion commands. Link parameters preserve source addresses only; do not put pairing keys or command permissions in links. Keep the phone uploading to the backend described in [iPhone setup](../ios/README.md) and [full sensor capture](../docs/CAPTURE.md).

## Camera delivery

The viewer polls for successive JPEG observations at no more than 10 reads per second, with only one read in flight. This is not an encoded 30 FPS video stream. The phone's actual incoming capture rate, backend processing, network and image decoding determine how often a new image appears. Repeated HTTP 200/304 responses do not make an unchanged capture fresh. Waiting, live, stale, offline and error states describe the received source; stale or failed images are cleared. No image is generated to fill a gap.

Use the configured dashboard relay for Quest: camera requests stay on the page's origin, and `/live` uses that origin's WebSocket scheme. An HTTPS page therefore reaches the camera over HTTPS and the live relay over WSS, even when `GODSEYE_BACKEND_URL` is HTTP on the laptop/network. Do not point an HTTPS viewer directly at the phone backend's HTTP URL. The existing Vite route allowlist and operator pairing behavior apply to development and preview; see [VIEWER.md](VIEWER.md).

## LAN with a trusted certificate

WebXR requires a secure context and an explicit user gesture to start immersive presentation. For a LAN address, serve HTTPS with a certificate that Quest Browser trusts and whose subject alternative names include the exact host/IP in the URL. Loading a page after dismissing a certificate warning is not evidence of WebXR trust. See [WebXR startup requirements](https://developer.mozilla.org/en-US/docs/Web/API/WebXR_Device_API/Startup_and_shutdown).

1. Put the dashboard laptop, backend and headset on a reachable network. Keep the phone's upload destination pointing to the same backend. Permit the dashboard's chosen port through the laptop firewall. If using WSL, ensure that port is reachable from the LAN or run Vite in the Windows environment reachable by the headset.
2. Install [mkcert](https://github.com/FiloSottile/mkcert) using its platform instructions. Store its generated files in a private directory outside the repository and Vite's served directories. Replace the example IP below with the laptop address the headset will open:

   ```sh
   mkcert -install
   mkcert -cert-file /absolute/private/certs/dashboard.pem -key-file /absolute/private/certs/dashboard-key.pem 192.168.1.50 localhost 127.0.0.1 ::1
   ```

   This installs trust on the laptop only. A mobile client needs the CA certificate from the directory printed by `mkcert -CAROOT`; share only `rootCA.pem`, never `rootCA-key.pem` or the dashboard private key. Android CA installation and browser acceptance depend on the device. Quest's available CA-install settings and acceptance of user-installed roots are **not verified by this project**. Do not assume laptop trust transfers to Quest; if headset trust cannot be established, use USB localhost below.

3. Copy [.env.example](.env.example) to `.env.local` in `dashboard/` and set:

   ```dotenv
   VITE_LIVE_URL=/live
   GODSEYE_BACKEND_URL=http://<backend-IP>:8765
   GODSEYE_TLS_CERT_FILE=/absolute/private/certs/dashboard.pem
   GODSEYE_TLS_KEY_FILE=/absolute/private/certs/dashboard-key.pem
   ```

   Both TLS settings are required together. Missing/unreadable files stop startup. Paths are read server-side and are never `VITE_` browser configuration. Vite does not create certificates. Use valid matching PEM files; the TLS server rejects malformed certificates/keys. Restart after configuration changes.

4. From `dashboard/`, run `npm run dev -- --port 5173 --strictPort`. Open the matching LAN HTTPS origin in Quest Browser. For the example address, the same-origin viewer URL is:

   ```text
   https://192.168.1.50:5173/?view=vr&live=/live&api=https%3A%2F%2F192.168.1.50%3A5173
   ```

   Replace both occurrences of the example address together. First check that current phone images arrive in preview, then use the viewer's immersive-entry button. With remote debugging, check `window.isSecureContext`, `navigator.xr` and `await navigator.xr?.isSessionSupported("immersive-vr")`; a secure page still needs WebXR browser/hardware support.

For a built local preview, run `npm run build` and `npm run preview -- --port 5173 --strictPort`; it reads the same TLS files and relays the same configured routes. Static deployment of `dist/` needs equivalent HTTPS and backend routing supplied by its host.

## USB localhost fallback

Meta documents [USB debugging and local port reversal for Quest Browser](https://developers.meta.com/vr/documentation/web/browser-remote-debugging/). Enable headset Developer Mode, install Android Platform Tools and connect/authorize the headset over USB using those instructions. When several devices are connected, select the headset with `adb -s <serial>` for each command.

Keep the same backend relay settings in `.env.local`. Start HTTP on the laptop with both TLS settings explicitly empty for this process:

```sh
GODSEYE_TLS_CERT_FILE= GODSEYE_TLS_KEY_FILE= npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
adb devices
adb reverse tcp:5173 tcp:5173
```

The shell syntax above is for bash; other shells must set both environment variables to empty before starting Vite. Check that the headset reports `device`, then open in Quest Browser:

```text
http://localhost:5173/?view=vr&live=/live&api=http%3A%2F%2Flocalhost%3A5173
```

Browsers can treat HTTP localhost as a secure context. Here `localhost` is on the headset and ADB carries its dashboard requests to the laptop; the existing relay carries camera/live traffic onward to the backend. No separate backend port reversal is needed. Confirm secure-context and immersive support on the actual headset. Remove the reversal after testing with `adb reverse --remove tcp:5173`. [Android's reverse-port documentation](https://developer.android.com/develop/ui/views/layout/webapps/access-local-server) explains the transport.

## Verification and remaining checks

From `dashboard/`, run `npm test -- src/httpsConfig.test.ts src/relay.test.ts src/operatorProxy.test.ts`, then the full unit suite, build, formatting and VR browser tests. A temporary self-signed certificate and `curl --cacert <temporary-cert.pem>` can prove HTTPS startup and relay behavior on a laptop. Such a test does not prove Quest Browser trusts that certificate.

Physical Quest validation remains pending: trusted LAN access or USB reversal, live phone imagery, observed image rate/latency, binocular screen placement, head movement, controller recentering, entry/exit, tracking/visibility loss and comfort. Record the headset/browser versions and the actual network/phone rate. A desktop fixture pass or TLS handshake cannot establish those results.
