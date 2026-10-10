import {
  Color,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";

export function boundedImageSize(width: number, height: number) {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error("Camera image has invalid dimensions.");
  const scale = Math.min(1, 1920 / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
export async function decodeCameraImage(blob: Blob): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(blob, {
    imageOrientation: "flipY",
    premultiplyAlpha: "none",
  });
  try {
    const size = boundedImageSize(bitmap.width, bitmap.height);
    if (size.width === bitmap.width && size.height === bitmap.height)
      return bitmap;
    return await createImageBitmap(bitmap, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: "high",
    });
  } catch (error) {
    bitmap.close();
    throw error;
  } finally {
    if (Math.max(bitmap.width, bitmap.height) > 1920) bitmap.close();
  }
}
export function placeScreen(
  screen: Object3D,
  head: Vector3,
  orientation: Quaternion,
) {
  screen.position
    .copy(head)
    .add(new Vector3(0, 0, -2.6).applyQuaternion(orientation));
  screen.quaternion.copy(orientation);
}

/** A single monoscopic texture on a fixed world-space screen. Owns all GPU resources. */
export class VRCameraScene {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(50, 1, 0.05, 50);
  private material = new MeshBasicMaterial({
    color: 0xffffff,
    toneMapped: false,
  });
  private screen = new Mesh(new PlaneGeometry(1, 1), this.material);
  private image: ImageBitmap | null = null;
  private texture: Texture | null = null;
  private resizeObserver: ResizeObserver;
  private session: XRSession | null = null;
  private recenterPending = true;
  private disposed = false;
  private failed = false;
  constructor(
    private canvas: HTMLCanvasElement,
    private onError: (error: unknown) => void,
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType("local");
    this.renderer.xr.addEventListener("sessionend", this.restorePreview);
    this.scene.background = new Color("#101318");
    this.screen.visible = false;
    placeScreen(this.screen, new Vector3(), new Quaternion());
    this.scene.add(this.screen);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    canvas.addEventListener("webglcontextlost", this.contextLost);
    this.resize();
    this.renderer.setAnimationLoop((_time, frame) => {
      if (this.disposed || this.failed) return;
      try {
        if (this.renderer.xr.isPresenting && frame && this.recenterPending) {
          const space = this.renderer.xr.getReferenceSpace();
          const pose = space && frame.getViewerPose(space);
          if (pose) {
            const { position, orientation } = pose.transform;
            placeScreen(
              this.screen,
              new Vector3(position.x, position.y, position.z),
              new Quaternion(
                orientation.x,
                orientation.y,
                orientation.z,
                orientation.w,
              ),
            );
            this.recenterPending = false;
          }
        }
        this.renderer.render(this.scene, this.camera);
      } catch (error) {
        this.fail(error);
      }
    });
  }
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.fail(
      new Error("Graphics context was lost. Reload to restore the preview."),
    );
  };
  private fail(error: unknown) {
    if (this.disposed || this.failed) return;
    this.failed = true;
    this.renderer.setAnimationLoop(null);
    this.clearImage();
    this.onError(error);
  }
  private resize() {
    if (this.disposed || this.renderer.xr.isPresenting) return;
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  setImage(bitmap: ImageBitmap) {
    if (this.disposed || this.failed) {
      bitmap.close();
      return;
    }
    this.clearImage();
    this.image = bitmap;
    this.texture = new Texture(bitmap);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;
    this.material.map = this.texture;
    this.material.needsUpdate = true;
    const aspect = bitmap.width / bitmap.height;
    const width = Math.min(2.6, 1.8 * aspect);
    this.screen.scale.set(width, width / aspect, 1);
    this.screen.visible = true;
  }
  clearImage() {
    this.screen.visible = false;
    this.material.map = null;
    this.material.needsUpdate = true;
    this.texture?.dispose();
    this.texture = null;
    this.image?.close();
    this.image = null;
  }
  recenter = () => {
    this.recenterPending = true;
  };
  private ended = () => {
    this.session?.removeEventListener("select", this.recenter);
    this.session?.removeEventListener("end", this.ended);
    this.session = null;
  };
  private restorePreview = () => {
    if (this.disposed) return;
    // Three updates this camera for XR. Restore it after the manager has
    // reset its presentation state, so resize can rebuild the desktop view.
    this.camera.fov = 50;
    this.camera.zoom = 1;
    this.camera.position.set(0, 0, 0);
    this.camera.quaternion.identity();
    this.camera.updateMatrixWorld(true);
    placeScreen(this.screen, new Vector3(), new Quaternion());
    this.resize();
  };
  async enter(session: XRSession) {
    if (this.disposed || this.failed)
      throw new Error("Graphics preview is unavailable.");
    this.session = session;
    session.addEventListener("select", this.recenter);
    session.addEventListener("end", this.ended);
    this.recenterPending = true;
    await this.renderer.xr.setSession(session);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("webglcontextlost", this.contextLost);
    this.renderer.xr.removeEventListener("sessionend", this.restorePreview);
    this.ended();
    this.clearImage();
    this.screen.geometry.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}
