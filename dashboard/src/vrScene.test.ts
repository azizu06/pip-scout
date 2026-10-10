import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { boundedImageSize, placeScreen } from "./vrScene";
describe("camera image and world screen", () => {
  it("bounds landscape and portrait images without stretching their aspect", () => {
    expect(boundedImageSize(4096, 2048)).toEqual({ width: 1920, height: 960 });
    expect(boundedImageSize(2048, 4096)).toEqual({ width: 960, height: 1920 });
    expect(boundedImageSize(640, 480)).toEqual({ width: 640, height: 480 });
    expect(() => boundedImageSize(0, 480)).toThrow();
  });
  it("places a screen in front of the initial head pose and keeps it fixed until recenter", () => {
    const screen = new Object3D();
    const head = new Vector3(1, 1.6, 2);
    const orientation = new Quaternion();
    placeScreen(screen, head, orientation);
    expect(screen.position.x).toBe(1);
    expect(screen.position.y).toBe(1.6);
    expect(screen.position.z).toBeCloseTo(-0.6);
    head.set(4, 1.7, 5);
    expect(screen.position.x).toBe(1);
    orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    placeScreen(screen, head, orientation);
    expect(screen.position.x).toBeCloseTo(1.4);
    expect(screen.position.z).toBeCloseTo(5);
    expect(screen.quaternion.equals(orientation)).toBe(true);
  });
});
