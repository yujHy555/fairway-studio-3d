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

  // RMB hold-to-pan-and-zoom state
  private isRmbDown: boolean = false;
  private lastRmbX: number = 0;
  private lastRmbY: number = 0;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;

    this.camera = new ArcRotateCamera(
      'pgaCamera',
      -Math.PI / 2,
      Math.PI / 2.5,
      6.5,
      new Vector3(95, 8.0, 42),
      this.scene
    );
    // Attach control with MMB (button 1) as Babylon's native panning button and LMB (button 0) as orbit
    this.camera.attachControl(canvas, true, false);
    this.camera._panningMouseButton = 1;

    const pointersInput = (this.camera.inputs?.attached?.pointers as any);
    if (pointersInput) {
      // LMB (0) = Orbit, MMB (1) = Pan; RMB (2) is handled below for pure orthogonal screen-plane Pan ONLY
      pointersInput.buttons = [0, 1];
      pointersInput.multiTouchPanAndZoom = false;
      pointersInput.multiTouchPanning = true;
    }

    // Near/Far planes tuned for both millimeter close-ups of the golf ball and course vistas
    this.camera.minZ = 0.10;
    this.camera.maxZ = 2400;

    // Remove default keyboard rotation on ArcRotateCamera so we can provide smooth WASD ground-gliding
    this.camera.keysUp = [];
    this.camera.keysDown = [];
    this.camera.keysLeft = [];
    this.camera.keysRight = [];

    // Prevent browser right-click context menu on canvas
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 || e.button === 1 || e.button === 2) {
        this.isUserDragging = true;
      }
      if (e.button === 2) {
        this.isRmbDown = true;
        this.lastRmbX = e.clientX;
        this.lastRmbY = e.clientY;
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isRmbDown) return;
      const dx = e.clientX - this.lastRmbX;
      const dy = e.clientY - this.lastRmbY;
      this.lastRmbX = e.clientX;
      this.lastRmbY = e.clientY;

      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

      const r = Math.max(1.5, this.camera.radius);
      const panScale = r * 0.0018;

      // Pure Screen-Plane Orthogonal Basis Vectors (strictly perpendicular to the camera's view ray so RMB NEVER zooms/dollies)
      const cosAlpha = Math.cos(this.camera.alpha);
      const sinAlpha = Math.sin(this.camera.alpha);
      const cosBeta = Math.cos(this.camera.beta);
      const sinBeta = Math.sin(this.camera.beta);

      // Camera Screen Right vector in world space: (sinAlpha, 0, -cosAlpha)
      const rightX = sinAlpha;
      const rightZ = -cosAlpha;

      // Camera Screen Up vector in world space (orthogonal to both ViewForward and ScreenRight): (-cosBeta * cosAlpha, sinBeta, -cosBeta * sinAlpha)
      const upX = -cosBeta * cosAlpha;
      const upY = sinBeta;
      const upZ = -cosBeta * sinAlpha;

      // Dragging left/right pans along ScreenRight; dragging up/down pans along ScreenUp (0% motion along ViewForward)
      const moveX = (-dx * rightX + dy * upX) * panScale;
      const moveY = (dy * upY) * panScale;
      const moveZ = (-dx * rightZ + dy * upZ) * panScale;

      this.camera.target.x = Math.max(-20, Math.min(240, this.camera.target.x + moveX));
      this.camera.target.y = Math.max(0.25, Math.min(180, this.camera.target.y + moveY));
      this.camera.target.z = Math.max(-20, Math.min(480, this.camera.target.z + moveZ));
    });

    window.addEventListener('pointerup', (e) => {
      this.isUserDragging = false;
      if (e.button === 2) {
        this.isRmbDown = false;
      }
    });

    window.addEventListener('keydown', (e) => {
      this.keysPressed.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keysPressed.delete(e.code);
    });

    // Unrestricted, silky-smooth view angles and proportional zoom/pan
    this.camera.lowerBetaLimit = 0.05;
    this.camera.upperBetaLimit = Math.PI / 2.06;
    this.camera.lowerRadiusLimit = 1.2;
    this.camera.upperRadiusLimit = 360;
    this.camera.wheelDeltaPercentage = 0.05;
    this.camera.wheelPrecision = 15;
    this.camera.inertia = 0.82;
    this.camera.angularSensibilityX = 950;
    this.camera.angularSensibilityY = 950;
    this.camera.panningSensibility = 80;
    // Pure screen-plane panning (X = ScreenRight, Y = ScreenUp, Z = 0 so panning never zooms along view depth)
    this.camera.panningAxis = new Vector3(1, 1, 0);
  }

  public setMode(mode: CameraMode) {
    this.mode = mode;

    // Keep LMB (0) for Orbit and MMB (1) for Pan across all modes; RMB (2) is handled by our pure screen-plane Pan handler
    const pointersInput = (this.camera.inputs?.attached?.pointers as any);
    if (pointersInput) {
      pointersInput.buttons = [0, 1];
    }

    if (mode === 'designer') {
      this.camera.radius = 85;
      this.camera.beta = Math.PI / 3.2;
    } else if (mode === 'aim') {
      // Pulled 2m further back from the previous 2.4m default ball position -> 4.4m
      this.camera.radius = 4.4;
      this.camera.beta = Math.PI / 2.42;
    } else if (mode === 'green') {
      this.camera.radius = 5.6;
      this.camera.beta = Math.PI / 2.85;
    } else if (mode === 'flight') {
      this.camera.radius = 9.5;
      this.camera.beta = Math.PI / 2.65;
    }
  }

  public snapAimBehindBall(ballPos: Vector3, aimAzimuthDeg: number) {
    this.targetPosition.set(ballPos.x, ballPos.y + 0.42, ballPos.z);
    this.camera.target.copyFrom(this.targetPosition);

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    this.camera.alpha = -aimRad - Math.PI / 2;
    this.camera.beta = Math.PI / 2.42;
    this.camera.radius = 4.4;
  }

  public setAimHeading(ballPos: Vector3, aimAzimuthDeg: number) {
    this.targetPosition.set(ballPos.x, ballPos.y + 0.42, ballPos.z);
    this.camera.target.copyFrom(this.targetPosition);

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    const targetAlpha = -aimRad - Math.PI / 2;
    this.camera.alpha += (targetAlpha - this.camera.alpha) * 0.35;
  }

  public updateFlightCamera(ballPos: Vector3, ballVelocity: Vector3D, groundY = 0, hasLanded = false) {
    if (this.mode !== 'flight') return;

    const heightAboveGround = Math.max(0, ballPos.y - groundY);
    const isNearGroundOrBouncing = hasLanded || (heightAboveGround < 3.8 && ballVelocity.y <= 0);

    // Anchor target Y to the turf plane when landing/bouncing so the camera stays steady while the ball visibly hops up and down!
    const targetY = isNearGroundOrBouncing
      ? Math.max(0.35, groundY + 0.42)
      : Math.max(0.5, ballPos.y);

    const horizontalLerp = isNearGroundOrBouncing ? 0.55 : 0.35;
    const verticalLerp = isNearGroundOrBouncing ? 0.30 : 0.25;

    this.camera.target.x += (ballPos.x - this.camera.target.x) * horizontalLerp;
    this.camera.target.z += (ballPos.z - this.camera.target.z) * horizontalLerp;
    this.camera.target.y += (targetY - this.camera.target.y) * verticalLerp;

    if (this.isUserDragging) return;

    // Frame the landing & bounce clearly at a close broadcast angle (~5.4m) when the ball hits the turf
    const desiredRadius = isNearGroundOrBouncing ? 5.4 : 9.5;
    const desiredBeta = isNearGroundOrBouncing ? Math.PI / 2.38 : Math.PI / 2.65;
    this.camera.radius += (desiredRadius - this.camera.radius) * 0.12;
    this.camera.beta += (desiredBeta - this.camera.beta) * 0.10;

    const horizontalSpeed = Math.sqrt(ballVelocity.x * ballVelocity.x + ballVelocity.z * ballVelocity.z);
    if (horizontalSpeed > 1.2) {
      const headingRad = Math.atan2(ballVelocity.x, ballVelocity.z);
      const targetAlpha = -headingRad - Math.PI / 2;

      let alphaDiff = targetAlpha - this.camera.alpha;
      while (alphaDiff < -Math.PI) alphaDiff += Math.PI * 2;
      while (alphaDiff > Math.PI) alphaDiff -= Math.PI * 2;
      this.camera.alpha += alphaDiff * 0.05;
    }
  }

  /**
   * Prevents the camera from ever clipping through the terrain or backdrop hills
   * when zooming/pulling backwards, orbiting low, or panning across valleys and bluffs.
   * Called right before camera rendering so there is zero 1-frame or lerp lag.
   */
  public enforceTerrainCollision(getWorldElevation: (x: number, z: number) => number, dt = 0.016) {
    const r = Math.max(1.2, this.camera.radius);

    // 1. Dynamically scale MMB panning and wheel sensitivity with zoom distance
    this.camera.panningSensibility = Math.max(5, 850 / r);
    this.camera.wheelPrecision = Math.max(0.8, 36 / Math.pow(r, 0.65));

    // 2. Smooth WASD / Arrow key course gliding in Designer and Scout modes
    if (this.mode === 'designer' || this.mode === 'scout') {
      const moveSpeed = Math.max(18, r * 0.75) * dt;
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
        const targetGround = getWorldElevation(this.camera.target.x, this.camera.target.z);
        this.camera.target.y = Math.max(
          targetGround + 0.35,
          this.camera.target.y * 0.85 + (targetGround + 0.6) * 0.15
        );
      }
    }

    // 3. Ensure target itself never sinks below local terrain
    const targetGroundY = getWorldElevation(this.camera.target.x, this.camera.target.z);
    if (this.camera.target.y < targetGroundY + 0.25) {
      this.camera.target.y = targetGroundY + 0.25;
    }

    // 4. Exact, zero-lag frustum & ray terrain collision check
    const sinBeta = Math.sin(this.camera.beta);
    const cosAlpha = Math.cos(this.camera.alpha);
    const sinAlpha = Math.sin(this.camera.alpha);

    const camX = this.camera.target.x + r * sinBeta * cosAlpha;
    const camZ = this.camera.target.z + r * sinBeta * sinAlpha;

    // Sample a 5-point safety halo around the camera to protect the near clipping plane on slopes
    const halo = Math.min(2.6, Math.max(0.8, r * 0.08));
    const gCenter = getWorldElevation(camX, camZ);
    const gEast = getWorldElevation(camX + halo, camZ);
    const gWest = getWorldElevation(camX - halo, camZ);
    const gNorth = getWorldElevation(camX, camZ + halo);
    const gSouth = getWorldElevation(camX, camZ - halo);
    const maxCamGround = Math.max(gCenter, gEast, gWest, gNorth, gSouth);

    const clearance = Math.max(1.15, Math.min(3.2, r * 0.035));
    let requiredCamY = maxCamGround + clearance;

    // Also sample intermediate points along the ray from target to camera so backing behind a ridge/lip never clips
    const rayFractions = [0.45, 0.72, 0.88];
    for (const f of rayFractions) {
      const rx = this.camera.target.x + (camX - this.camera.target.x) * f;
      const rz = this.camera.target.z + (camZ - this.camera.target.z) * f;
      const rg = getWorldElevation(rx, rz) + 0.65;
      // For ray height at fraction f to be >= rg: target.y + f * (camY - target.y) >= rg
      const neededCamY = this.camera.target.y + (rg - this.camera.target.y) / f;
      if (neededCamY > requiredCamY) {
        requiredCamY = neededCamY;
      }
    }

    const currentCamY = this.camera.target.y + r * Math.cos(this.camera.beta);

    if (currentCamY < requiredCamY) {
      const dyNeeded = requiredCamY - this.camera.target.y;
      const minBeta = 0.22; // Keep at least ~12.5 deg angle from vertical so view never flips
      const maxRiseFromBeta = r * Math.cos(minBeta);

      if (dyNeeded <= maxRiseFromBeta) {
        const cosReq = Math.max(-0.99, Math.min(0.99, dyNeeded / r));
        const safeBeta = Math.max(minBeta, Math.acos(cosReq));
        if (this.camera.beta > safeBeta) {
          this.camera.beta = safeBeta;
        }
        this.camera.upperBetaLimit = Math.max(minBeta, Math.min(Math.PI / 2.04, safeBeta));
      } else {
        // Camera is close to a taller hill behind it: tilt up to minBeta and lift target.y so camera stays above hill
        this.camera.beta = minBeta;
        this.camera.upperBetaLimit = minBeta;
        this.camera.target.y = requiredCamY - maxRiseFromBeta;
      }
    } else {
      // Smoothly relax upperBetaLimit when high above ground
      const dySafe = requiredCamY - this.camera.target.y;
      let maxAllowedBeta = Math.PI / 2.04;
      if (dySafe / r >= -0.98 && dySafe / r <= 0.98) {
        maxAllowedBeta = Math.max(0.25, Math.min(Math.PI / 2.04, Math.acos(dySafe / r)));
      }
      this.camera.upperBetaLimit = this.camera.upperBetaLimit * 0.85 + maxAllowedBeta * 0.15;
      if (this.camera.beta > this.camera.upperBetaLimit) {
        this.camera.beta = this.camera.upperBetaLimit;
      }
    }
  }

  public setScoutView(ballPos: Vector3, pinPos: Vector3D) {
    const midX = (ballPos.x + pinPos.x) * 0.5;
    const midZ = (ballPos.z + pinPos.z) * 0.5;
    const dist = Math.sqrt(Math.pow(pinPos.x - ballPos.x, 2) + Math.pow(pinPos.z - ballPos.z, 2));

    this.camera.target.set(midX, 3.0, midZ);
    this.camera.radius = Math.min(220, dist * 0.85);
    this.camera.beta = Math.PI / 3.4;

    const heading = Math.atan2(pinPos.x - ballPos.x, pinPos.z - ballPos.z);
    this.camera.alpha = -heading - Math.PI / 2;
  }

  public focusOnPin(pinPos: Vector3D) {
    this.camera.target.set(pinPos.x, Math.max(0.3, pinPos.y + 0.25), pinPos.z);
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
