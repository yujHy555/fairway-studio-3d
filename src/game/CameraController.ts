import {
  Scene,
  ArcRotateCamera,
  Vector3
} from '@babylonjs/core';
import { Vector3D } from '../core/Types';

export type CameraMode = 'designer' | 'aim' | 'flight' | 'green';

export class CameraController {
  private scene: Scene;
  public camera: ArcRotateCamera;
  public mode: CameraMode = 'designer';

  // Flight follow target smoothing
  private targetPos: Vector3 = Vector3.Zero();
  private curAimAzimuth = 0;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;

    // ArcRotateCamera is the most versatile camera in Babylon.js
    this.camera = new ArcRotateCamera(
      'mainCamera',
      -Math.PI / 2,
      Math.PI / 3,
      80,
      new Vector3(110, 5, 230),
      this.scene
    );
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 2;
    this.camera.upperRadiusLimit = 400;
    this.camera.wheelPrecision = 15;
  }

  public setMode(mode: CameraMode) {
    this.mode = mode;

    if (mode === 'designer') {
      this.camera.useAutoRotationBehavior = false;
      this.camera.beta = Math.PI / 3.5;
      this.camera.radius = 90;
    } else if (mode === 'aim') {
      this.camera.radius = 4.5;
      this.camera.beta = Math.PI / 2.3; // low behind ball
    } else if (mode === 'green') {
      this.camera.radius = 6.0;
      this.camera.beta = Math.PI / 4.0; // elevated putting view
    } else if (mode === 'flight') {
      this.camera.radius = 12.0;
      this.camera.beta = Math.PI / 2.6;
    }
  }

  /**
   * Updates camera position behind ball pointing along aim direction
   */
  public updateAimCamera(ballPos: Vector3, aimAzimuthDeg: number) {
    if (this.mode !== 'aim') return;

    this.curAimAzimuth = aimAzimuthDeg;
    this.targetPos.copyFrom(ballPos);
    this.camera.target.copyFrom(ballPos);

    // Alpha angle corresponds to aimAzimuthDeg
    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    this.camera.alpha = -aimRad - Math.PI / 2;
  }

  /**
   * Smoothly chases the ball during flight
   */
  public updateFlightCamera(ballPos: Vector3, ballVelocity: Vector3D) {
    if (this.mode !== 'flight') return;

    // Smooth lerp camera target towards ball
    this.camera.target = Vector3.Lerp(this.camera.target, ballPos, 0.2);

    // Calculate heading from velocity
    const speed = Math.sqrt(ballVelocity.x * ballVelocity.x + ballVelocity.z * ballVelocity.z);
    if (speed > 2.0) {
      const headingRad = Math.atan2(ballVelocity.x, ballVelocity.z);
      const targetAlpha = -headingRad - Math.PI / 2;
      // Soft angle interpolation
      this.camera.alpha += (targetAlpha - this.camera.alpha) * 0.08;
    }
  }

  /**
   * Focuses on the green / pin
   */
  public focusOnPin(pinPos: Vector3D) {
    this.camera.target.set(pinPos.x, pinPos.y, pinPos.z);
    this.camera.radius = 28;
    this.camera.beta = Math.PI / 4;
  }

  /**
   * Top-down designer blueprint view
   */
  public setTopDownView(centerX: number, centerZ: number) {
    this.camera.target.set(centerX, 0, centerZ);
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.01; // almost 90 deg straight down
    this.camera.radius = 160;
  }
}
