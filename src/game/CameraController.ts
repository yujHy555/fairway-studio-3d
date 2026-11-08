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

  private targetPosition: Vector3 = Vector3.Zero();
  public isUserDragging: boolean = false;
  private keysPressed: Set<string> = new Set();

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;

    this.camera = new ArcRotateCamera(
      'pgaCamera',
      -Math.PI / 2,
      Math.PI / 2.5,
      6.5,
      new Vector3(110, 1.0, 40),
      this.scene
    );
    this.camera.attachControl(canvas, true);

    // Near/Far planes tuned for both millimeter close-ups of the golf ball and 1km mountain vistas
    this.camera.minZ = 0.08;
    this.camera.maxZ = 2400;

    // Remove default keyboard rotation on ArcRotateCamera so we can provide smooth WASD ground-gliding in Designer/Scout
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];

    // Prevent browser right-click context menu on canvas so Right-Click places items cleanly in Designer Mode
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 || (this.mode !== 'designer' && e.button === 2)) {
        this.isUserDragging = true;
      }
    });
    window.addEventListener('pointerup', () => {
      this.isUserDragging = false;
    });

    window.addEventListener('keydown', (e) => {
      this.keysPressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keysPressed.delete(e.code);
    });

    // Unrestricted, silky-smooth view angles and proportional zoom/pan
    this.camera.lowerBetaLimit = 0.05;
    this.camera.upperBetaLimit = Math.PI / 2.08;
    this.camera.lowerRadiusLimit = 1.2;
    this.camera.upperRadiusLimit = 360;
    this.camera.wheelDeltaPercentage = 0.05; // Proportional 5% zoom per scroll notch at any distance!
    this.camera.wheelPrecision = 15;
    this.camera.inertia = 0.84;
    this.camera.angularSensibilityX = 950;
    this.camera.angularSensibilityY = 950;
    this.camera.panningSensibility = 80;
    this.camera.panningAxis = new Vector3(1, 0.2, 1); // Smooth horizontal course-plane panning
  }

  public setMode(mode: CameraMode) {
    this.mode = mode;

    const pointersInput = (this.camera.inputs?.attached?.pointers as any);

    if (mode === 'designer') {
      this.camera.radius = 85;
      this.camera.beta = Math.PI / 3.2;
      // Left-Click (0) = Orbit/Rotate scene view; Middle-Click (1) = Pan view;
      // Right-Click (2) = Exclusively places items & sculpts on terrain!
      if (pointersInput) {
        pointersInput.buttons = [0, 1];
      }
    } else {
      if (pointersInput) {
        pointersInput.buttons = [0, 1, 2];
      }
      if (mode === 'aim') {
        this.camera.radius = 2.4;
        this.camera.beta = Math.PI / 2.42;
      } else if (mode === 'green') {
        this.camera.radius = 3.6;
        this.camera.beta = Math.PI / 2.9;
      } else if (mode === 'flight') {
        this.camera.radius = 16.0;
        this.camera.beta = Math.PI / 2.85;
      }
    }
  }

  public snapAimBehindBall(ballPos: Vector3, aimAzimuthDeg: number) {
    this.targetPosition.set(ballPos.x, ballPos.y + 0.32, ballPos.z);
    this.camera.target.copyFrom(this.targetPosition);

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    this.camera.alpha = -aimRad - Math.PI / 2;
    this.camera.beta = Math.PI / 2.42;
    this.camera.radius = 2.4;
  }

  public setAimHeading(ballPos: Vector3, aimAzimuthDeg: number) {
    this.targetPosition.set(ballPos.x, ballPos.y + 0.32, ballPos.z);
    this.camera.target.copyFrom(this.targetPosition);

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    const targetAlpha = -aimRad - Math.PI / 2;
    this.camera.alpha += (targetAlpha - this.camera.alpha) * 0.35;
  }

  public updateFlightCamera(ballPos: Vector3, ballVelocity: Vector3D) {
    if (this.mode !== 'flight') return;

    const safeTarget = new Vector3(ballPos.x, Math.max(0.5, ballPos.y), ballPos.z);
    this.camera.target = Vector3.Lerp(this.camera.target, safeTarget, 0.24);

    if (this.isUserDragging) return;

    const horizontalSpeed = Math.sqrt(ballVelocity.x * ballVelocity.x + ballVelocity.z * ballVelocity.z);
    if (horizontalSpeed > 1.2) {
      const headingRad = Math.atan2(ballVelocity.x, ballVelocity.z);
      const targetAlpha = -headingRad - Math.PI / 2;

      let alphaDiff = targetAlpha - this.camera.alpha;
      while (alphaDiff < -Math.PI) alphaDiff += Math.PI * 2;
      while (alphaDiff > Math.PI) alphaDiff -= Math.PI * 2;
      this.camera.alpha += alphaDiff * 0.04;
    }
  }

  /**
   * Keeps camera navigation effortless at all zoom distances:
   * - Dynamically scales panning and zoom speed with camera radius
   * - Supports smooth WASD / Arrow ground gliding in Designer & Scout modes
   * - Smoothly prevents camera from clipping underground without locking rotation when zoomed out
   */
  public enforceTerrainCollision(getTerrainElevation: (x: number, z: number) => number, dt = 0.016) {
    const r = Math.max(1.2, this.camera.radius);

    // 1. Scale panning and wheel sensitivity dynamically with zoom distance
    // When zoomed out 150m, panning & zooming move fast and effortlessly; when zoomed in 2m, ultra-precise!
    this.camera.panningSensibility = Math.max(5, 850 / r);
    this.camera.wheelPrecision = Math.max(0.8, 36 / Math.pow(r, 0.65));

    // 2. Smooth WASD / Arrow key course gliding in Designer and Scout modes
    if (this.mode === 'designer' || this.mode === 'scout') {
      const moveSpeed = Math.max(18, r * 0.75) * dt;
      // Forward vector in XZ plane from camera.alpha
      const forwardX = -Math.cos(this.camera.alpha);
      const forwardZ = -Math.sin(this.camera.alpha);
      const rightX = Math.sin(this.camera.alpha);
      const rightZ = -Math.cos(this.camera.alpha);

      let moveX = 0;
      let moveZ = 0;
      if (this.keysPressed.has('KeyW') || this.keysPressed.has('ArrowUp')) {
        moveX += forwardX;
        moveZ += forwardZ;
      }
      if (this.keysPressed.has('KeyS') || this.keysPressed.has('ArrowDown')) {
        moveX -= forwardX;
        moveZ -= forwardZ;
      }
      if (this.keysPressed.has('KeyD') || this.keysPressed.has('ArrowRight')) {
        moveX += rightX;
        moveZ += rightZ;
      }
      if (this.keysPressed.has('KeyA') || this.keysPressed.has('ArrowLeft')) {
        moveX -= rightX;
        moveZ -= rightZ;
      }

      if (moveX !== 0 || moveZ !== 0) {
        const len = Math.sqrt(moveX * moveX + moveZ * moveZ) || 1;
        this.camera.target.x = Math.max(-20, Math.min(240, this.camera.target.x + (moveX / len) * moveSpeed));
        this.camera.target.z = Math.max(-20, Math.min(480, this.camera.target.z + (moveZ / len) * moveSpeed));
      }

      // Gently keep target height tracking terrain surface so rotating at any distance pivots naturally on the course
      const targetGround = getTerrainElevation(this.camera.target.x, this.camera.target.z);
      this.camera.target.y = this.camera.target.y * 0.88 + (targetGround + 0.5) * 0.12;
    }

    // 3. Smooth Ground Clearance without locking rotation when zoomed out
    const camPos = this.camera.position;
    const groundY = getTerrainElevation(camPos.x, camPos.z);
    const minSafeCamY = groundY + 0.45;

    const targetY = this.camera.target.y;
    const dy = minSafeCamY - targetY;
    const cosBetaReq = dy / r;

    let maxAllowedBeta = Math.PI / 2.04; // ~88 degrees
    if (cosBetaReq >= -0.98 && cosBetaReq <= 0.98) {
      maxAllowedBeta = Math.acos(cosBetaReq) - 0.015;
    }

    const clampedUpperBeta = Math.max(0.25, Math.min(Math.PI / 2.04, maxAllowedBeta));
    this.camera.upperBetaLimit = this.camera.upperBetaLimit * 0.8 + clampedUpperBeta * 0.2;

    if (this.camera.beta > this.camera.upperBetaLimit) {
      this.camera.beta = this.camera.upperBetaLimit;
    }

    const targetGroundY = getTerrainElevation(this.camera.target.x, this.camera.target.z);
    if (this.camera.target.y < targetGroundY + 0.15) {
      this.camera.target.y = targetGroundY + 0.15;
    }
  }

  public setScoutView(ballPos: Vector3, pinPos: Vector3D) {
    const midX = (ballPos.x + pinPos.x) * 0.5;
    const midZ = (ballPos.z + pinPos.z) * 0.5;
    const dist = Math.sqrt(Math.pow(pinPos.x - ballPos.x, 2) + Math.pow(pinPos.z - ballPos.z, 2));

    this.camera.target.set(midX, 2.0, midZ);
    this.camera.radius = Math.min(220, dist * 0.85);
    this.camera.beta = Math.PI / 3.5;

    const heading = Math.atan2(pinPos.x - ballPos.x, pinPos.z - ballPos.z);
    this.camera.alpha = -heading - Math.PI / 2;
  }

  public focusOnPin(pinPos: Vector3D) {
    this.camera.target.set(pinPos.x, Math.max(0.3, pinPos.y + 0.2), pinPos.z);
    this.camera.radius = 12;
    this.camera.beta = Math.PI / 2.9;
  }

  public setTopDownView(centerX: number, centerZ: number) {
    this.camera.target.set(centerX, 0, centerZ);
    this.camera.alpha = -Math.PI / 2;
    this.camera.beta = 0.05;
    this.camera.radius = 160;
  }
}
