import {
  Scene,
  ArcRotateCamera,
  Vector3
} from '@babylonjs/core';
import { Vector3D } from '../core/Types';

export type CameraMode = 'designer' | 'aim' | 'flight' | 'green' | 'scout';

export class CameraController {
  public camera: ArcRotateCamera;
  public mode: CameraMode = 'aim';
  private scene: Scene;

  // Smoothing states
  private targetPosition: Vector3 = Vector3.Zero();
  private flightCameraOffset: Vector3 = new Vector3(0, 4, -12);

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;

    this.camera = new ArcRotateCamera(
      'pgaCamera',
      -Math.PI / 2,
      Math.PI / 2.7, // ~66 degree natural PGA address view
      6.5,
      new Vector3(110, 1.0, 40),
      this.scene
    );
    this.camera.attachControl(canvas, true);

    // Generous, unrestricted view angles while strictly keeping camera above ground
    this.camera.lowerBetaLimit = 0.08;              // Can look straight down from high overhead
    this.camera.upperBetaLimit = Math.PI / 2.04;     // ~88 degrees: can look all the way up to mountains/sky, never subterranean
    this.camera.lowerRadiusLimit = 2.5;             // Close address view
    this.camera.upperRadiusLimit = 250;             // Can zoom far out to survey entire fairway
    this.camera.wheelPrecision = 20;
    this.camera.inertia = 0.85;                     // Silky AAA broadcast camera momentum
  }

  public setMode(mode: CameraMode) {
    this.mode = mode;

    if (mode === 'designer') {
      this.camera.radius = 90;
      this.camera.beta = Math.PI / 3.4;
    } else if (mode === 'aim') {
      this.camera.radius = 6.0;
      this.camera.beta = Math.PI / 2.6; // ~69 degrees: can see ball, club, fairway, and horizon
    } else if (mode === 'green') {
      this.camera.radius = 9.0;
      this.camera.beta = Math.PI / 3.5;
    } else if (mode === 'flight') {
      this.camera.radius = 14.0;
      this.camera.beta = Math.PI / 2.8;
    }
  }

  /**
   * Aligns camera behind the ball pointing down the target line.
   * Only overrides alpha/beta when explicitly called on aim change, preserving player mouse look!
   */
  public snapAimBehindBall(ballPos: Vector3, aimAzimuthDeg: number) {
    this.targetPosition.set(ballPos.x, Math.max(0.4, ballPos.y), ballPos.z);
    this.camera.target.copyFrom(this.targetPosition);

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    this.camera.alpha = -aimRad - Math.PI / 2;
    this.camera.beta = Math.PI / 2.6;
    this.camera.radius = 6.0;
  }

  /**
   * Soft aim tracking when player presses A/D or arrows
   */
  public setAimHeading(ballPos: Vector3, aimAzimuthDeg: number) {
    this.targetPosition.set(ballPos.x, Math.max(0.4, ballPos.y), ballPos.z);
    this.camera.target.copyFrom(this.targetPosition);

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    const targetAlpha = -aimRad - Math.PI / 2;
    // Smoothly turn camera towards aim line
    this.camera.alpha += (targetAlpha - this.camera.alpha) * 0.25;
  }

  /**
   * AAA Broadcast Flight Follow-Cam (Toptracer TV Angle)
   * Dynamically tracks the ball in flight with smooth interpolation,
   * framing both the ball and the distant green.
   */
  public updateFlightCamera(ballPos: Vector3, ballVelocity: Vector3D) {
    if (this.mode !== 'flight') return;

    // Target smoothly interpolates to ball position
    const safeTarget = new Vector3(ballPos.x, Math.max(0.8, ballPos.y), ballPos.z);
    this.camera.target = Vector3.Lerp(this.camera.target, safeTarget, 0.22);

    const horizontalSpeed = Math.sqrt(ballVelocity.x * ballVelocity.x + ballVelocity.z * ballVelocity.z);

    if (horizontalSpeed > 1.0) {
      const headingRad = Math.atan2(ballVelocity.x, ballVelocity.z);
      const targetAlpha = -headingRad - Math.PI / 2;

      // Softly follow flight azimuth
      let alphaDiff = targetAlpha - this.camera.alpha;
      while (alphaDiff < -Math.PI) alphaDiff += Math.PI * 2;
      while (alphaDiff > Math.PI) alphaDiff -= Math.PI * 2;
      this.camera.alpha += alphaDiff * 0.08;

      // Distance and angle scale with ball altitude
      const altitude = Math.max(0, ballPos.y);
      this.camera.radius = 12.0 + Math.min(18.0, altitude * 0.4);
      this.camera.beta = Math.max(Math.PI / 3.2, Math.PI / 2.7 - altitude * 0.008);
    } else {
      // Ball is settling / rolling on ground: smooth close-up
      this.camera.radius = Math.max(5.5, this.camera.radius * 0.96);
      this.camera.beta = Math.PI / 2.7;
    }
  }

  /**
   * PGA Scout / Flyover View: Focuses down the hole from 35m up
   */
  public setScoutView(ballPos: Vector3, pinPos: Vector3D) {
    const midX = (ballPos.x + pinPos.x) * 0.5;
    const midZ = (ballPos.z + pinPos.z) * 0.5;
    const dist = Math.sqrt(Math.pow(pinPos.x - ballPos.x, 2) + Math.pow(pinPos.z - ballPos.z, 2));

    this.camera.target.set(midX, 2.0, midZ);
    this.camera.radius = Math.min(220, dist * 0.85);
    this.camera.beta = Math.PI / 3.6;

    const heading = Math.atan2(pinPos.x - ballPos.x, pinPos.z - ballPos.z);
    this.camera.alpha = -heading - Math.PI / 2;
  }

  public focusOnPin(pinPos: Vector3D) {
    this.camera.target.set(pinPos.x, Math.max(0.5, pinPos.y), pinPos.z);
    this.camera.radius = 14;
    this.camera.beta = Math.PI / 3.0;
  }

  public setTopDownView(centerX: number, centerZ: number) {
    this.camera.target.set(centerX, 0, centerZ);
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.05;
    this.camera.radius = 160;
  }
}
