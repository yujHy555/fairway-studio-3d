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
    this.camera.lowerBetaLimit = 0.05;              // Can look straight down from high overhead
    this.camera.upperBetaLimit = Math.PI / 2.12;     // ~85 degrees: prevents subterranean ground clipping
    this.camera.lowerRadiusLimit = 1.6;             // Close address view
    this.camera.upperRadiusLimit = 260;             // Can zoom far out to survey entire fairway
    this.camera.wheelPrecision = 20;
    this.camera.inertia = 0.85;                     // Silky AAA broadcast camera momentum
    this.camera.panningSensibility = 150;           // Smooth right-click pan support
  }

  public setMode(mode: CameraMode) {
    this.mode = mode;

    if (mode === 'designer') {
      this.camera.radius = 90;
      this.camera.beta = Math.PI / 3.4;
    } else if (mode === 'aim') {
      this.camera.radius = 2.4; // Authentic PGA Tour address view framed for regulation golf ball
      this.camera.beta = Math.PI / 2.45; // ~73.5 degrees: frames ball and target line down fairway
    } else if (mode === 'green') {
      this.camera.radius = 3.6; // Putting view
      this.camera.beta = Math.PI / 3.0;
    } else if (mode === 'flight') {
      this.camera.radius = 18.0; // Wide expansive TV broadcast follow distance
      this.camera.beta = Math.PI / 2.9;
    }
  }

  /**
   * Aligns camera behind the ball pointing down the target line.
   * Only overrides alpha/beta when explicitly called on aim change, preserving player mouse look!
   */
  public snapAimBehindBall(ballPos: Vector3, aimAzimuthDeg: number) {
    this.targetPosition.set(ballPos.x, Math.max(0.4, ballPos.y) + 0.35, ballPos.z);
    this.camera.target.copyFrom(this.targetPosition);

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    this.camera.alpha = -aimRad - Math.PI / 2;
    this.camera.beta = Math.PI / 2.45;
    this.camera.radius = 2.4;
  }

  /**
   * Soft aim tracking when player presses A/D or arrows
   */
  public setAimHeading(ballPos: Vector3, aimAzimuthDeg: number) {
    this.targetPosition.set(ballPos.x, Math.max(0.4, ballPos.y) + 0.35, ballPos.z);
    this.camera.target.copyFrom(this.targetPosition);

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    const targetAlpha = -aimRad - Math.PI / 2;
    // Smoothly turn camera towards aim line
    this.camera.alpha += (targetAlpha - this.camera.alpha) * 0.25;
  }

  /**
   * AAA Broadcast Flight Follow-Cam (Toptracer TV Angle)
   * Dynamically tracks the ball in flight with smooth interpolation,
   * framing both the ball and the distant green without zooming in close.
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
      this.camera.radius = 16.0 + Math.min(18.0, altitude * 0.35);
      this.camera.beta = Math.max(Math.PI / 3.2, Math.PI / 2.7 - altitude * 0.006);
    } else {
      // Ball is settling / rolling on ground: DO NOT zoom into the ball!
      // Maintain wide expansive TV broadcast distance so player can see the whole green / fairway
      this.camera.radius = Math.max(18.0, this.camera.radius);
      this.camera.beta = Math.PI / 2.9;
    }
  }

  /**
   * Prevents camera from ever penetrating terrain or clipping underground across all angles
   */
  public enforceTerrainCollision(getTerrainElevation: (x: number, z: number) => number) {
    const camPos = this.camera.position;
    const groundY = getTerrainElevation(camPos.x, camPos.z);
    const minSafeY = groundY + 0.75; // 0.75m minimum clearance above terrain

    if (camPos.y < minSafeY) {
      const targetY = this.camera.target.y;
      const dy = minSafeY - targetY;
      const cosBetaReq = dy / Math.max(0.2, this.camera.radius);
      if (cosBetaReq >= -0.99 && cosBetaReq <= 0.99) {
        const safeBeta = Math.acos(cosBetaReq);
        if (this.camera.beta > safeBeta) {
          this.camera.beta = Math.max(0.08, safeBeta - 0.03);
        }
      }
      if (this.camera.position.y < minSafeY) {
        this.camera.position.y = minSafeY;
      }
    }

    // Ensure target never dips underground
    const targetGroundY = getTerrainElevation(this.camera.target.x, this.camera.target.z);
    if (this.camera.target.y < targetGroundY + 0.1) {
      this.camera.target.y = targetGroundY + 0.1;
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
