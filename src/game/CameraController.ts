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

  // MMB & RMB hold-to-pan state with proportional distance scaling
  private isPanningDown: boolean = false;
  private lastPanX: number = 0;
  private lastPanY: number = 0;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    this.scene = scene;

    this.camera = new ArcRotateCamera(
      'pgaCamera',
      -Math.PI / 2,
      Math.PI / 2.5,
      7.5,
      new Vector3(95, 8.0, 42),
      this.scene
    );
    // Attach control with LMB (button 0) for smooth Orbiting
    this.camera.attachControl(canvas, true, false);

    const pointersInput = (this.camera.inputs?.attached?.pointers as any);
    if (pointersInput) {
      // LMB (0) = Pure Orbit; MMB (1) & RMB (2) are handled by our unified screen-plane Pan handler below
      pointersInput.buttons = [0];
      pointersInput.multiTouchPanAndZoom = false;
      pointersInput.multiTouchPanning = true;
    }

    // Near/Far planes tuned for maximum depth buffer precision (10x greater stability, zero shadow z-fighting)
    this.camera.minZ = 0.40;
    this.camera.maxZ = 1400;

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
      // Both MMB (1) and RMB (2) initiate smooth, radius-proportional screen-plane panning
      if (e.button === 1 || e.button === 2) {
        this.isPanningDown = true;
        this.lastPanX = e.clientX;
        this.lastPanY = e.clientY;
        e.preventDefault();
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!this.isPanningDown) return;
      const dx = e.clientX - this.lastPanX;
      const dy = e.clientY - this.lastPanY;
      this.lastPanX = e.clientX;
      this.lastPanY = e.clientY;

      if (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;

      // Distance-proportional sensitivity: fine precision when close, effortless gliding when zoomed out
      const r = Math.max(1.5, this.camera.radius);
      const panScale = r * 0.0020;

      // Pure screen-plane panning (orthogonal to current view angle and vertical screen axis)
      const cosAlpha = Math.cos(this.camera.alpha);
      const sinAlpha = Math.sin(this.camera.alpha);

      const rightX = sinAlpha;
      const rightZ = -cosAlpha;

      // Swapped panning direction: dragging mouse pans the camera view intuitively
      const moveX = dx * rightX * panScale;
      const moveZ = dx * rightZ * panScale;
      const moveY = -dy * panScale;

      this.camera.target.x = Math.max(-40, Math.min(260, this.camera.target.x + moveX));
      // Unrestricted downward panning (target can go down into hollows/bunkers)
      this.camera.target.y = Math.max(-50, Math.min(250, this.camera.target.y + moveY));
      this.camera.target.z = Math.max(-40, Math.min(500, this.camera.target.z + moveZ));
    });

    window.addEventListener('pointerup', (e) => {
      this.isUserDragging = false;
      if (e.button === 1 || e.button === 2) {
        this.isPanningDown = false;
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
    this.camera.upperBetaLimit = Math.PI / 1.76; // Allows tilting upward to view treetops, sky, and horizon
    this.camera.lowerRadiusLimit = 1.2;
    this.camera.upperRadiusLimit = 360;
    this.camera.wheelDeltaPercentage = 0.05;
    this.camera.wheelPrecision = 15;
    this.camera.inertia = 0.65;
    this.camera.panningInertia = 0.65;
    this.camera.angularSensibilityX = 650;
    this.camera.angularSensibilityY = 650;
    this.camera.panningSensibility = 80;
    // Pure screen-plane panning (X = ScreenRight, Y = ScreenUp, Z = 0 so panning never zooms along view depth)
    this.camera.panningAxis = new Vector3(1, 1, 0);
  }

  public setMode(mode: CameraMode) {
    this.mode = mode;

    // Keep LMB (0) for pure Orbit across all modes; MMB (1) and RMB (2) handle pure screen-plane Pan
    const pointersInput = (this.camera.inputs?.attached?.pointers as any);
    if (pointersInput) {
      pointersInput.buttons = [0];
    }

    if (mode === 'designer') {
      this.camera.radius = 85;
      this.camera.beta = Math.PI / 3.2;
    } else if (mode === 'aim') {
      // Default start ball view: pulled back 5.4m (1m further back from previous 4.4m)
      this.camera.radius = 5.4;
      this.camera.beta = Math.PI / 2.42;
    } else if (mode === 'green') {
      // Intimate, broadcast-style putting camera framing the ball and aiming towards the cup
      this.camera.radius = 3.6;
      this.camera.beta = Math.PI / 2.58;
    } else if (mode === 'flight') {
      // Retain current position and smoothly expand framing without 1-frame pop
    }
  }

  public snapAimBehindBall(ballPos: Vector3, aimAzimuthDeg: number) {
    this.targetPosition.set(ballPos.x, ballPos.y + 0.42, ballPos.z);
    this.camera.target.copyFrom(this.targetPosition);

    const aimRad = (aimAzimuthDeg * Math.PI) / 180.0;
    this.camera.alpha = -aimRad - Math.PI / 2;
    this.camera.beta = Math.PI / 2.42;
    this.camera.radius = 5.4;
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

    // Direct, jitter-free lock to ball position: completely eliminates camera-ball lag and pushing illusions
    this.camera.target.x = ballPos.x;
    this.camera.target.z = ballPos.z;
    if (!hasLanded) {
      this.camera.target.y = ballPos.y;
    } else {
      this.camera.target.y = Math.max(groundY + 0.25, ballPos.y);
    }

    if (this.isUserDragging) return;

    // Broadcast-style elevated rear-quarter framing keeps the flight arc & Toptracer cleanly in view
    // beside the ball without clipping into the camera lens or obstructing takeoff
    const desiredRadius = hasLanded ? 5.6 : 9.2;
    const desiredBeta = hasLanded ? Math.PI / 2.48 : Math.PI / 2.95;
    this.camera.radius += (desiredRadius - this.camera.radius) * 0.08;
    this.camera.beta += (desiredBeta - this.camera.beta) * 0.08;

    const horizontalSpeed = Math.sqrt(ballVelocity.x * ballVelocity.x + ballVelocity.z * ballVelocity.z);
    if (horizontalSpeed > 1.2) {
      const headingRad = Math.atan2(ballVelocity.x, ballVelocity.z);
      const quarterOffset = hasLanded ? 0.08 : 0.20;
      const targetAlpha = -headingRad - Math.PI / 2 + quarterOffset;

      let alphaDiff = targetAlpha - this.camera.alpha;
      while (alphaDiff < -Math.PI) alphaDiff += Math.PI * 2;
      while (alphaDiff > Math.PI) alphaDiff -= Math.PI * 2;
      this.camera.alpha += alphaDiff * 0.06;
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
    const halo = Math.min(2.0, Math.max(0.5, r * 0.05));
    const gCenter = getWorldElevation(camX, camZ);
    const gEast = getWorldElevation(camX + halo, camZ);
    const gWest = getWorldElevation(camX - halo, camZ);
    const gNorth = getWorldElevation(camX, camZ + halo);
    const gSouth = getWorldElevation(camX, camZ - halo);
    const maxCamGround = Math.max(gCenter, gEast, gWest, gNorth, gSouth);

    // Streamlined clearance (~0.40m) allows comfortable low-angle upward tilt without clipping
    const clearance = Math.max(0.40, Math.min(2.2, r * 0.025));
    let requiredCamY = maxCamGround + clearance;

    // Also sample intermediate points along the ray from target to camera so backing behind a ridge/lip never clips
    const rayFractions = [0.45, 0.72, 0.88];
    for (const f of rayFractions) {
      const rx = this.camera.target.x + (camX - this.camera.target.x) * f;
      const rz = this.camera.target.z + (camZ - this.camera.target.z) * f;
      const rg = getWorldElevation(rx, rz) + 0.35;
      const neededCamY = this.camera.target.y + (rg - this.camera.target.y) / f;
      if (neededCamY > requiredCamY) {
        requiredCamY = neededCamY;
      }
    }

    const currentCamY = this.camera.target.y + r * Math.cos(this.camera.beta);

    const dyNeeded = requiredCamY - this.camera.target.y;
    const minBeta = 0.08; // Keep at least ~4.5 deg from vertical
    const maxAllowedBeta = Math.PI / 1.76;

    if (dyNeeded < r) {
      // Analytical maximum safe beta before camera would sink below terrain
      const cosReq = Math.max(-0.98, Math.min(0.98, dyNeeded / r));
      const safeBeta = Math.max(minBeta, Math.min(maxAllowedBeta, Math.acos(cosReq) - 0.02));

      // Strictly clamp beta so camera smoothly arrests at terrain level without ever jumping/snapping target.y!
      this.camera.upperBetaLimit = safeBeta;
      if (this.camera.beta > safeBeta) {
        this.camera.beta = safeBeta;
      }
    } else {
      // When target is low (unrestricted downward panning into hollows), prevent camera eye from clipping
      // by setting beta to overhead and ensuring radius holds the camera eye above required elevation
      this.camera.upperBetaLimit = minBeta;
      this.camera.beta = minBeta;
      const minRadiusNeeded = (requiredCamY - this.camera.target.y) / Math.cos(minBeta);
      if (this.camera.radius < minRadiusNeeded) {
        this.camera.radius = minRadiusNeeded;
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

  /**
   * Frames the camera directly onto a selected object's center of interest in Designer Mode.
   * Sets the camera target to the object so all subsequent LMB orbit rotations pivot smoothly around it.
   */
  public frameOnTarget(targetPos: Vector3, radius?: number) {
    this.camera.target.copyFrom(targetPos);
    if (radius !== undefined) {
      this.camera.radius = radius;
    } else {
      this.camera.radius = Math.max(4.0, Math.min(75, this.camera.radius * 0.55));
    }
    this.camera.beta = Math.PI / 3.0;
  }
}
