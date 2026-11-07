import {
  Scene,
  ArcRotateCamera,
  Vector3
} from '@babylonjs/core';
import { Vector3D } from '../core/Types';

export type CameraMode = 'designer' | 'aim' | 'flight' | 'green';

export class CameraController {
  public camera: ArcRotateCamera;
  public mode: CameraMode = 'designer';

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.camera = new ArcRotateCamera(
      'mainCamera',
      -Math.PI / 2,
      Math.PI / 3,
      80,
      new Vector3(110, 5, 230),
      scene
    );
    this.camera.attachControl(canvas, true);

    // Strictly prevent the camera from going below ground level (beta must stay < pi/2)
    this.camera.lowerBetaLimit = 0.05;
    this.camera.upperBetaLimit = Math.PI / 2.12; // ~85 degrees max: ALWAYS above ground looking down
    this.camera.lowerRadiusLimit = 2.0;
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
      this.camera.beta = Math.PI / 2.35; // slightly elevated behind the ball
    } else if (mode === 'green') {
      this.camera.radius = 8.0;
      this.camera.beta = Math.PI / 3.8; // elevated putting view
    } else if (mode === 'flight') {
      this.camera.radius = 16.0;
      this.camera.beta = Math.PI / 2.8; // 64 degree high follow view
    }
  }

  public updateAimCamera(ballPos: Vector3, aimAzimuthDeg: number) {
    if (this.mode !== 'aim') return;

    // Ensure camera target is strictly at or above the ground
    this.camera.target.set(ballPos.x, Math.max(0.5, ballPos.y), ballPos.z);
    this.camera.radius = 4.5;
    this.camera.beta = Math.PI / 2.35;

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    this.camera.alpha = -aimRad - Math.PI / 2;
  }

  public updateFlightCamera(ballPos: Vector3, ballVelocity: Vector3D) {
    if (this.mode !== 'flight') return;

    // Smoothly follow ball target, keeping camera elevated
    const targetY = Math.max(1.0, ballPos.y);
    const safeTarget = new Vector3(ballPos.x, targetY, ballPos.z);
    this.camera.target = Vector3.Lerp(this.camera.target, safeTarget, 0.25);

    this.camera.radius = 16.0;
    this.camera.beta = Math.PI / 2.8; // always above ground

    const speed = Math.sqrt(ballVelocity.x * ballVelocity.x + ballVelocity.z * ballVelocity.z);
    if (speed > 1.5) {
      const headingRad = Math.atan2(ballVelocity.x, ballVelocity.z);
      const targetAlpha = -headingRad - Math.PI / 2;
      this.camera.alpha += (targetAlpha - this.camera.alpha) * 0.1;
    }
  }

  public focusOnPin(pinPos: Vector3D) {
    this.camera.target.set(pinPos.x, Math.max(0.5, pinPos.y), pinPos.z);
    this.camera.radius = 18;
    this.camera.beta = Math.PI / 3.2;
  }

  public setTopDownView(centerX: number, centerZ: number) {
    this.camera.target.set(centerX, 0, centerZ);
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.05;
    this.camera.radius = 160;
  }
}
