import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Texture,
  Material,
  Color3,
  Vector3,
  VertexBuffer,
  VertexData
} from '@babylonjs/core';
import { GOLF_CONSTANTS, SurfaceType, SURFACE_PROPERTIES } from '../core/Constants';
import { Vector3D, ShotResult } from '../core/Types';
import { Aerodynamics } from '../physics/Aerodynamics';
import { TerrainGrid } from '../terrain/TerrainGrid';
import { RealisticTextures } from '../terrain/RealisticTextures';
import { soundFx } from '../core/Audio';
import { TreeCollider } from '../terrain/Scenery';

export enum BallState {
  AIMING = 'AIMING',
  IN_FLIGHT = 'IN_FLIGHT',
  ROLLING = 'ROLLING',
  AT_REST = 'AT_REST',
  IN_HOLE = 'IN_HOLE',
  IN_WATER = 'IN_WATER'
}

export class Ball {
  public mesh: Mesh;
  public state: BallState = BallState.AT_REST;

  private scene: Scene;
  private terrain: TerrainGrid;

  // Ball flight tracking
  public curVelocity: Vector3D = { x: 0, y: 0, z: 0 };
  public curSpin: Vector3D = { x: 0, y: 0, z: 0 };
  private windVec: Vector3D = { x: 0, y: 0, z: 0 };
  private flightTime = 0;
  private atRestCounter = 0;
  private currentLie: SurfaceType = SurfaceType.TEE;

  // Shot Distance Tracking
  public shotOrigin: Vector3D = { x: 0, y: 0, z: 0 };
  public carryDistance = 0;
  public totalDistance = 0;
  public hasLanded = false;

  // Water hazard entry tracking & relief
  public lastLandPosition: Vector3D = { x: 110, y: 0, z: 42 };
  public waterEntryPoint: Vector3D = { x: 110, y: 0, z: 42 };
  public isPutting: boolean = false;

  // Active Pin Target for Dynamic Cup Entry
  public activePinPosition: Vector3D | null = null;

  // Active Tree Colliders for realistic tree deflections
  public treeColliders: TreeCollider[] = [];

  // Visual trajectory Toptracer ribbon (single persistent updatable camera-billboarded mesh)
  private static readonly MAX_TRACER_POINTS = 1024;
  private tracerPoints: Vector3[] = [];
  private tracerLiveTip: Vector3 | null = null;
  private tracerMesh: Mesh | null = null;
  private tracerMaterial: StandardMaterial;
  private tracerPositions: Float32Array;
  private tracerColors: Float32Array;
  private contactShadowMesh: Mesh;

  // 'B' Key Ready-for-Next-Shot 3-Flash Indicator positioned just above the ball
  private readyIndicatorMesh: Mesh;
  private readyIndicatorMat: StandardMaterial;
  private readyIndicatorTex: DynamicTexture;
  private readyFlashActive = false;
  private readyFlashElapsed = 0;
  private creepingTimer = 0;

  // Callbacks
  public onStateChange?: (state: BallState, lie: SurfaceType, shotStats?: { carry: number; total: number }) => void;
  public onHoleComplete?: () => void;
  public onOutOfBounds?: () => void;

  constructor(scene: Scene, terrain: TerrainGrid) {
    this.scene = scene;
    this.terrain = terrain;

    // Smooth high-tessellation regulation golf ball mesh (32 segments) textured with golf_ball_texture_01.jpg
    this.mesh = MeshBuilder.CreateSphere('golfBall', {
      diameter: GOLF_CONSTANTS.BALL_RENDER_RADIUS * 2,
      segments: 32
    }, this.scene);

    const ballTex = new Texture('/textures/golf_ball_texture_01.jpg', this.scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
    ballTex.anisotropicFilteringLevel = 16;
    ballTex.wrapU = Texture.WRAP_ADDRESSMODE;
    ballTex.wrapV = Texture.WRAP_ADDRESSMODE;
    // Tiled small so dimples are clearly visible and realistic
    ballTex.uScale = 8.0;
    ballTex.vScale = 4.0;

    const mat = new StandardMaterial('ballMat', this.scene);
    mat.diffuseTexture = ballTex;
    mat.diffuseColor = new Color3(1.0, 1.0, 1.0);
    mat.ambientColor = new Color3(0.35, 0.35, 0.35);
    // Non-glossy matte tour urethane elastomer cover
    mat.specularColor = new Color3(0.08, 0.08, 0.08);
    mat.specularPower = 20;
    // Zero bump distortion to prevent black normal/pole artifacts
    this.mesh.material = mat;
    this.mesh.receiveShadows = true;
    this.mesh.renderingGroupId = 0; // Standard scene depth testing so scenery and trees occlude the ball naturally

    // Subtle radial turf-contact shadow disc directly under the ball so it sits crisply on the surface
    this.contactShadowMesh = MeshBuilder.CreateGround('cup_ballContactShadow', {
      width: GOLF_CONSTANTS.BALL_RENDER_RADIUS * 2.5,
      height: GOLF_CONSTANTS.BALL_RENDER_RADIUS * 2.5
    }, this.scene);
    this.contactShadowMesh.isPickable = false;
    const csTex = new DynamicTexture('ballContactShadowTex', 64, this.scene, false);
    const csCtx = csTex.getContext() as CanvasRenderingContext2D;
    const grad = csCtx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(8, 22, 6, 0.62)');
    grad.addColorStop(0.55, 'rgba(8, 22, 6, 0.28)');
    grad.addColorStop(1, 'rgba(8, 22, 6, 0.0)');
    csCtx.fillStyle = grad;
    csCtx.fillRect(0, 0, 64, 64);
    csTex.hasAlpha = true;
    csTex.update(false);

    const csMat = new StandardMaterial('ballContactShadowMat', this.scene);
    csMat.diffuseTexture = csTex;
    csMat.opacityTexture = csTex;
    csMat.disableLighting = true;
    csMat.emissiveColor = new Color3(0.03, 0.08, 0.02);
    csMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    csMat.zOffset = -1;
    this.contactShadowMesh.material = csMat;

    // Toptracer luminous billboarded ribbon material (uses RGBA vertex colors for smooth fade & zero clipping)
    this.tracerMaterial = new StandardMaterial('toptracerMat', this.scene);
    this.tracerMaterial.diffuseColor = new Color3(1.0, 1.0, 1.0);
    this.tracerMaterial.emissiveColor = new Color3(1.0, 1.0, 1.0);
    this.tracerMaterial.specularColor = new Color3(0, 0, 0);
    this.tracerMaterial.disableLighting = true;
    this.tracerMaterial.alpha = 1.0;
    this.tracerMaterial.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.tracerMaterial.backFaceCulling = false;

    const maxVerts = Ball.MAX_TRACER_POINTS * 2;
    this.tracerPositions = new Float32Array(maxVerts * 3);
    this.tracerColors = new Float32Array(maxVerts * 4);
    this.initTracerMesh();

    // 'B' Key Ready-for-Next-Shot 3-Flash Indicator positioned just above the stationary ball
    this.readyIndicatorMesh = MeshBuilder.CreatePlane('cup_ballReadyIndicator', {
      width: 0.65,
      height: 0.52
    }, this.scene);
    this.readyIndicatorMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.readyIndicatorMesh.isPickable = false;
    this.readyIndicatorMesh.setEnabled(false);

    this.readyIndicatorTex = new DynamicTexture('ballReadyIndicatorTex', 256, this.scene, false);
    this.readyIndicatorTex.hasAlpha = true;
    this.drawReadyIndicatorTexture('');

    this.readyIndicatorMat = new StandardMaterial('ballReadyIndicatorMat', this.scene);
    this.readyIndicatorMat.diffuseTexture = this.readyIndicatorTex;
    this.readyIndicatorMat.opacityTexture = this.readyIndicatorTex;
    this.readyIndicatorMat.emissiveColor = new Color3(1.0, 1.0, 1.0);
    this.readyIndicatorMat.disableLighting = true;
    this.readyIndicatorMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.readyIndicatorMat.backFaceCulling = false;
    this.readyIndicatorMesh.material = this.readyIndicatorMat;
  }

  private initTracerMesh() {
    const maxPts = Ball.MAX_TRACER_POINTS;
    const indices = new Uint16Array((maxPts - 1) * 6);
    for (let i = 0; i < maxPts - 1; i++) {
      const base = i * 2;
      const off = i * 6;
      indices[off + 0] = base + 0;
      indices[off + 1] = base + 2;
      indices[off + 2] = base + 1;
      indices[off + 3] = base + 1;
      indices[off + 4] = base + 2;
      indices[off + 5] = base + 3;
    }
    const vd = new VertexData();
    vd.positions = this.tracerPositions;
    vd.colors = this.tracerColors;
    vd.indices = indices;

    const mesh = new Mesh('ballToptracer', this.scene);
    vd.applyToMesh(mesh, true);
    mesh.material = this.tracerMaterial;
    mesh.hasVertexAlpha = true;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.renderingGroupId = 0;
    mesh.isVisible = false;
    this.tracerMesh = mesh;
  }

  private drawReadyIndicatorTexture(distText: string) {
    const size = 256;
    const ctx = this.readyIndicatorTex.getContext() as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, size, size);

    // 1. Distance Badge on top of the icon
    if (distText) {
      const badgeW = 216;
      const badgeH = 46;
      const bx = (size - badgeW) / 2;
      const by = 8;
      const r = 14;

      // Dark glass pill background
      ctx.fillStyle = 'rgba(10, 24, 18, 0.94)';
      ctx.beginPath();
      ctx.roundRect(bx, by, badgeW, badgeH, r);
      ctx.fill();

      // Glowing emerald border
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 3;
      ctx.stroke();

      // Crisp distance text
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 23px "Inter", "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(distText, size / 2, by + badgeH / 2 + 1);
    }

    // 2. Outer soft glow ring
    const cy = distText ? 155 : 128;
    const rGrad = ctx.createRadialGradient(size / 2, cy, 14, size / 2, cy, 75);
    rGrad.addColorStop(0, 'rgba(16, 255, 165, 0.35)');
    rGrad.addColorStop(0.65, 'rgba(16, 225, 145, 0.18)');
    rGrad.addColorStop(1, 'rgba(16, 225, 145, 0.0)');
    ctx.fillStyle = rGrad;
    ctx.beginPath();
    ctx.arc(size / 2, cy, 75, 0, Math.PI * 2);
    ctx.fill();

    // 3. Crisp modern downward chevron + ring pointing down at the ball
    ctx.strokeStyle = '#38ffae';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.arc(size / 2, cy - 14, 34, Math.PI * 0.85, Math.PI * 2.15);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(size / 2 - 28, cy);
    ctx.lineTo(size / 2, cy + 38);
    ctx.lineTo(size / 2 + 28, cy);
    ctx.lineTo(size / 2 + 14, cy);
    ctx.lineTo(size / 2, cy + 18);
    ctx.lineTo(size / 2 - 14, cy);
    ctx.closePath();
    ctx.fill();

    this.readyIndicatorTex.update(true);
  }

  /**
   * Triggered when the player presses 'B' while the ball is settled/stationary:
   * Holds the distance text and chevron rock-still for easy reading, then smoothly fades out.
   */
  public triggerReadyFlashIndicator() {
    if (this.state !== BallState.AIMING && this.state !== BallState.AT_REST) return;

    let distText = '';
    if (this.activePinPosition) {
      const pinDx = this.mesh.position.x - this.activePinPosition.x;
      const pinDz = this.mesh.position.z - this.activePinPosition.z;
      const dMeters = Math.hypot(pinDx, pinDz);
      const dYards = dMeters * 1.09361;
      distText = `${Math.round(dYards)}yd • ${Math.round(dMeters)}m`;
    }
    this.drawReadyIndicatorTexture(distText);

    this.readyFlashActive = true;
    this.readyFlashElapsed = 0;
    this.readyIndicatorMesh.setEnabled(true);
    this.readyIndicatorMesh.position.set(
      this.mesh.position.x,
      this.mesh.position.y + 0.42,
      this.mesh.position.z
    );
    this.readyIndicatorMesh.scaling.set(1.0, 1.0, 1.0);
    this.readyIndicatorMat.alpha = 1.0;
  }

  private updateReadyFlashIndicator(dt: number) {
    if (!this.readyFlashActive) return;
    if (this.state !== BallState.AIMING && this.state !== BallState.AT_REST) {
      this.readyFlashActive = false;
      this.readyIndicatorMesh.setEnabled(false);
      return;
    }

    this.readyFlashElapsed += dt;
    const holdDuration = 2.40;  // Stays completely still and solid for 2.4s so it is effortless to read
    const fadeDuration = 0.75;  // Smooth, gradual fade-out
    const totalDuration = holdDuration + fadeDuration;

    if (this.readyFlashElapsed >= totalDuration) {
      this.readyFlashActive = false;
      this.readyIndicatorMesh.setEnabled(false);
      return;
    }

    // Keep position and scale rock-still above the ball: zero bobbing, zero pulsating
    this.readyIndicatorMesh.position.set(
      this.mesh.position.x,
      this.mesh.position.y + 0.42,
      this.mesh.position.z
    );
    this.readyIndicatorMesh.scaling.set(1.0, 1.0, 1.0);

    if (this.readyFlashElapsed < holdDuration) {
      // Solid, crystal-clear readability
      this.readyIndicatorMat.alpha = 1.0;
    } else {
      // Smooth cosine fade-out
      const fadeT = (this.readyFlashElapsed - holdDuration) / fadeDuration;
      this.readyIndicatorMat.alpha = Math.max(0, 0.5 * (1.0 + Math.cos(fadeT * Math.PI)));
    }
  }

  private syncContactShadow(groundY: number) {
    if (this.state === BallState.IN_HOLE || this.state === BallState.IN_WATER) {
      this.contactShadowMesh.setEnabled(false);
      return;
    }
    const heightAboveGround = Math.max(0, this.mesh.position.y - (groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS));
    if (heightAboveGround > 3.2) {
      this.contactShadowMesh.setEnabled(false);
      return;
    }
    this.contactShadowMesh.setEnabled(true);
    const scale = 1.0 + Math.min(1.4, heightAboveGround * 0.45);
    this.contactShadowMesh.scaling.set(scale, 1.0, scale);
    this.contactShadowMesh.position.set(this.mesh.position.x, groundY + 0.001, this.mesh.position.z);
  }

  public get position(): Vector3 {
    return this.mesh.position;
  }

  public get currentSurface(): SurfaceType {
    return this.currentLie;
  }

  public setTargetPin(pin: Vector3D | null) {
    this.activePinPosition = pin;
  }

  public setTreeColliders(colliders: TreeCollider[]) {
    this.treeColliders = colliders;
  }

  /**
   * Realistic tree collisions: reflects ball off solid trunks with wood impact audio,
   * and deflects/tumbles downward through foliage canopies.
   */
  public checkTreeColliders(): boolean {
    if (!this.treeColliders || this.treeColliders.length === 0) return false;
    const bx = this.mesh.position.x;
    const by = this.mesh.position.y;
    const bz = this.mesh.position.z;
    const r = GOLF_CONSTANTS.BALL_RENDER_RADIUS;

    for (const tree of this.treeColliders) {
      const dx = bx - tree.x;
      const dz = bz - tree.z;
      const distSq = dx * dx + dz * dz;
      const effRadius = Math.max(tree.trunkRadius, tree.canopyRadius);
      const maxDist = effRadius + 1.6;
      if (distSq > maxDist * maxDist) continue;

      const horizDist = Math.sqrt(distSq) || 0.001;
      const isRockOrCliff = tree.canopyRadius === 0;

      // 1. Solid Rock / Cliff barrier collision (High-energy elastic ricochet)
      if (isRockOrCliff) {
        if (by >= tree.y - 0.5 && by <= tree.y + tree.trunkHeight + 0.6) {
          const minDist = tree.trunkRadius + r;
          if (horizDist < minDist) {
            const nx = dx / horizDist;
            const nz = dz / horizDist;
            this.mesh.position.x = tree.x + nx * (minDist + 0.06);
            this.mesh.position.z = tree.z + nz * (minDist + 0.06);

            const vDotN = this.curVelocity.x * nx + this.curVelocity.z * nz;
            if (vDotN < 0) {
              const rockRestitution = 0.88; // Realistic hard granite elastic rebound
              const horizSpeed = Math.hypot(this.curVelocity.x, this.curVelocity.z);
              this.curVelocity.x = (this.curVelocity.x - (1 + rockRestitution) * vDotN * nx) * 0.94;
              this.curVelocity.z = (this.curVelocity.z - (1 + rockRestitution) * vDotN * nz) * 0.94;
              // Major upward deflection kick off the angled rock face
              this.curVelocity.y = Math.max(5.2, Math.abs(this.curVelocity.y) * 0.86 + horizSpeed * 0.42);
              soundFx.playBounce('fairway', 1.0);
              return true;
            }
          }
        }
        continue;
      }

      // 2. Solid Tree Trunk cylinder collision
      if (by >= tree.y - 0.25 && by <= tree.y + tree.trunkHeight) {
        const minDist = tree.trunkRadius + r;
        if (horizDist < minDist) {
          const nx = dx / horizDist;
          const nz = dz / horizDist;
          this.mesh.position.x = tree.x + nx * (minDist + 0.02);
          this.mesh.position.z = tree.z + nz * (minDist + 0.02);

          const vDotN = this.curVelocity.x * nx + this.curVelocity.z * nz;
          if (vDotN < 0) {
            const restitution = 0.58;
            this.curVelocity.x = (this.curVelocity.x - (1 + restitution) * vDotN * nx) * 0.82;
            this.curVelocity.z = (this.curVelocity.z - (1 + restitution) * vDotN * nz) * 0.82;
            this.curVelocity.y *= 0.65;
            soundFx.playTreeHit(Math.hypot(this.curVelocity.x, this.curVelocity.z) / 22.0);
            return true;
          }
        }
      }

      // 3. Foliage Canopy / Branch deflection
      if (by >= tree.canopyBottomY && by <= tree.canopyTopY) {
        const t = (by - tree.canopyBottomY) / (tree.canopyTopY - tree.canopyBottomY);
        const radiusAtHeight = tree.canopyRadius * (tree.isHero ? Math.sin(t * Math.PI) * 0.95 + 0.15 : (1.0 - t * 0.72));
        if (horizDist < radiusAtHeight) {
          const speed = Math.hypot(this.curVelocity.x, this.curVelocity.y, this.curVelocity.z);
          if (speed > 1.2) {
            this.curVelocity.x *= 0.38 + (Math.random() - 0.5) * 0.15;
            this.curVelocity.z *= 0.38 + (Math.random() - 0.5) * 0.15;
            this.curVelocity.y = Math.min(-1.8, this.curVelocity.y * 0.3 - 2.2);
            soundFx.playBranchDeflection();
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Seats the ball flush onto the exact terrain surface at (x, z)
   * without any floating offset or ground penetration.
   */
  public setPosition(x: number, _y: number, z: number) {
    const groundY = this.terrain.getElevation(x, z);
    const exactSeatedY = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;

    this.mesh.position.set(x, exactSeatedY, z);
    this.curVelocity = { x: 0, y: 0, z: 0 };
    this.curSpin = { x: 0, y: 0, z: 0 };
    this.currentLie = this.terrain.getSurfaceAt(x, z);
    this.state = BallState.AIMING;
    this.syncContactShadow(groundY);
    this.clearTracer();
  }

  /**
   * Struck by club - initiates flight or putting trajectory
   */
  public launch(shot: ShotResult, pinPosition?: Vector3D) {
    if (pinPosition) {
      this.activePinPosition = pinPosition;
    }
    this.clearTracer();
    this.flightTime = 0;
    this.atRestCounter = 0;
    this.carryDistance = 0;
    this.totalDistance = 0;
    this.isPutting = shot.club.category === 'putter' || shot.club.name.toLowerCase().includes('putt');

    const groundY = this.terrain.getElevation(this.mesh.position.x, this.mesh.position.z);
    this.mesh.position.y = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;

    this.shotOrigin = {
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z
    };

    const windRad = (shot.windHeadingDeg * Math.PI) / 180.0;
    const windFactor = Aerodynamics.getWindFactorForShot(shot);
    this.windVec = {
      x: shot.windSpeedMps * windFactor * Math.sin(windRad),
      y: 0,
      z: shot.windSpeedMps * windFactor * Math.cos(windRad)
    };

    const initial = Aerodynamics.calculateInitialVectors(shot);

    // Putter initiates pure ground rolling flush with the putting surface (no intrusive airborne tracer on greens)
    if (shot.club.category === 'putter') {
      this.state = BallState.ROLLING;
      this.hasLanded = true;
      this.curVelocity = {
        x: initial.velocity.x,
        y: 0,
        z: initial.velocity.z
      };
      this.curSpin = { x: 0, y: 0, z: 0 };

      soundFx.playClubImpact('putter', shot.powerPercent, false);
      this.onStateChange?.(this.state, this.currentLie);
      return;
    }

    this.state = BallState.IN_FLIGHT;
    this.hasLanded = false;
    this.curVelocity = initial.velocity;
    this.curSpin = initial.spinVec;

    this.addTracerPoint(this.mesh.position.clone(), true);

    const isDriver = shot.club.id === 'driver';
    soundFx.playSwingWhoosh(shot.powerPercent);
    soundFx.playClubImpact(shot.club.category, shot.powerPercent, isDriver);

    this.onStateChange?.(this.state, this.currentLie);
  }

  /**
   * Advances ball aerodynamics, ground roll, and trajectory trail for the current frame.
   * Invoked before camera updates so ball, tracer, camera, and CSM shadows stay 100% synchronized.
   */
  public step(dt: number) {
    this.update(dt);
  }

  public update(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0) dt = 0.016;
    else if (dt > 0.05) dt = 0.05;

    this.updateReadyFlashIndicator(dt);

    // Keep resting / aiming ball strictly seated on exact triangle surface even if terrain is edited
    if (this.state === BallState.AIMING || this.state === BallState.AT_REST) {
      const groundY = this.terrain.getElevation(this.mesh.position.x, this.mesh.position.z);
      this.mesh.position.y = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;
      this.syncContactShadow(groundY);
      return;
    }

    if (this.state === BallState.IN_FLIGHT) {
      this.flightTime += dt;

      // Fine RK4 integration sub-steps (<= 6ms each) prevent fast drives from jittering or tunneling slopes
      const subSteps = Math.max(2, Math.ceil(dt / 0.006));
      const subDt = dt / subSteps;

      for (let s = 0; s < subSteps; s++) {
        const curPos = {
          x: this.mesh.position.x,
          y: this.mesh.position.y,
          z: this.mesh.position.z
        };

        const step = Aerodynamics.stepRK4(
          curPos,
          this.curVelocity,
          this.curSpin,
          this.windVec,
          subDt
        );

        this.curVelocity = step.nextVel;
        this.curSpin = step.nextSpin;
        this.mesh.position.set(step.nextPos.x, step.nextPos.y, step.nextPos.z);

        // Instant Out-Of-Bounds detection in flight as soon as ball exits the main hole land boundary
        if (
          this.mesh.position.x < 24 ||
          this.mesh.position.x > 196 ||
          this.mesh.position.z < 18 ||
          this.mesh.position.z > 418
        ) {
          this.state = BallState.AT_REST;
          this.curVelocity = { x: 0, y: 0, z: 0 };
          this.clearTracer();
          this.onOutOfBounds?.();
          return;
        }

        // Check tree trunk/canopy collisions in flight
        this.checkTreeColliders();

        // Visual spin rotation
        this.mesh.rotation.x += 18.0 * subDt;

        const dx = this.mesh.position.x - this.shotOrigin.x;
        const dz = this.mesh.position.z - this.shotOrigin.z;
        this.totalDistance = Math.sqrt(dx * dx + dz * dz);

        const groundY = this.terrain.getElevation(this.mesh.position.x, this.mesh.position.z);
        this.syncContactShadow(groundY);
        if (this.mesh.position.y <= groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS) {
          this.mesh.position.y = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;
          this.syncContactShadow(groundY);

          if (!this.hasLanded) {
            this.hasLanded = true;
            this.carryDistance = this.totalDistance;
          }

          this.handleGroundImpact(groundY);
          break;
        }
      }

      this.addTracerPoint(this.mesh.position.clone());

    } else if (this.state === BallState.ROLLING) {
      const surface = this.terrain.getSurfaceAt(this.mesh.position.x, this.mesh.position.z);
      this.currentLie = surface;
      const props = SURFACE_PROPERTIES[surface];

      const normal = this.terrain.getNormal(this.mesh.position.x, this.mesh.position.z);
      // Note: normal.x = (hL - hR) / (2 * eps) = -dh/dx already points DOWNHILL!
      // Tangential downhill gravitational acceleration is +g * normal.x * normal.y
      const slopeSin = Math.hypot(normal.x, normal.z);
      const gravityScale = 9.81 * 1.18; // Authentic 5/7 sphere rolling + turf slope responsiveness
      const slopeAccelX = normal.x * normal.y * gravityScale;
      const slopeAccelZ = normal.z * normal.y * gravityScale;

      // 1. Accelerate ball along the downhill slope vector first (so gravity is never zeroed out when speed is low)
      this.curVelocity.x += slopeAccelX * dt;
      this.curVelocity.z += slopeAccelZ * dt;

      // 2. Apply turf rolling resistance opposing current velocity, relieved on slopes so balls roll down banks into bunkers
      const speedAfterGravity = Math.hypot(this.curVelocity.x, this.curVelocity.z);
      const isSteepBunkerWall = surface === SurfaceType.BUNKER && slopeSin > 0.14;
      const baseResistance = isSteepBunkerWall ? 0.12 : props.rollingResistance;
      const slopeRelief = Math.max(0.16, 1.0 - slopeSin * 2.8);
      const decel = (baseResistance * 9.81 * slopeRelief + 0.06 * slopeRelief) * dt;
      const newSpeed = Math.max(0, speedAfterGravity - decel);
      const speedFactor = speedAfterGravity > 0.0001 ? newSpeed / speedAfterGravity : 0;

      this.curVelocity.x *= speedFactor;
      this.curVelocity.z *= speedFactor;

      // Bunker lip barrier: virtually impossible for balls inside a bunker to climb up and roll out
      if (surface === SurfaceType.BUNKER) {
        const nextX = this.mesh.position.x + this.curVelocity.x * dt;
        const nextZ = this.mesh.position.z + this.curVelocity.z * dt;
        const nextSurf = this.terrain.getSurfaceAt(nextX, nextZ);
        if (nextSurf !== SurfaceType.BUNKER) {
          // Lip bank catches ball and reflects it gently back down into the sand bed
          this.curVelocity.x *= -0.22;
          this.curVelocity.z *= -0.22;
        }
      }

      this.mesh.position.x += this.curVelocity.x * dt;
      this.mesh.position.z += this.curVelocity.z * dt;

      // Check tree collisions while rolling
      this.checkTreeColliders();

      // Compute exact triangle elevation AFTER moving x and z so ball never penetrates or floats on slopes!
      const groundY = this.terrain.getElevation(this.mesh.position.x, this.mesh.position.z);
      this.mesh.position.y = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;
      this.syncContactShadow(groundY);

      // Authentic physical rolling rotation of the dimpled ball mesh
      this.mesh.rotation.x += (this.curVelocity.z * dt) / GOLF_CONSTANTS.BALL_RENDER_RADIUS;
      this.mesh.rotation.z -= (this.curVelocity.x * dt) / GOLF_CONSTANTS.BALL_RENDER_RADIUS;

      const dx = this.mesh.position.x - this.shotOrigin.x;
      const dz = this.mesh.position.z - this.shotOrigin.z;
      this.totalDistance = Math.sqrt(dx * dx + dz * dz);

      this.addTracerPoint(this.mesh.position.clone());

      // 1. Dynamic Cup Entry
      if (this.activePinPosition) {
        const pinDx = this.mesh.position.x - this.activePinPosition.x;
        const pinDz = this.mesh.position.z - this.activePinPosition.z;
        const distToCup = Math.sqrt(pinDx * pinDx + pinDz * pinDz);

        if (distToCup <= GOLF_CONSTANTS.CUP_RADIUS * 1.4) {
          if (newSpeed <= 4.8) {
            this.state = BallState.IN_HOLE;
            this.curVelocity = { x: 0, y: 0, z: 0 };
            this.mesh.position.set(
              this.activePinPosition.x,
              this.activePinPosition.y - GOLF_CONSTANTS.CUP_DEPTH * 0.75,
              this.activePinPosition.z
            );
            this.clearTracer();
            soundFx.playCupDrop();
            this.onHoleComplete?.();
            this.onStateChange?.(this.state, SurfaceType.CUP_BOTTOM, { carry: this.carryDistance, total: this.totalDistance });
            return;
          } else if (newSpeed < 6.8) {
            this.curVelocity.x *= -0.35;
            this.curVelocity.z *= -0.35;
          }
        }
      }

      // 2. Early Course boundary containment (Out of bounds as soon as it exits main golf hole land)
      if (
        this.mesh.position.x < 24 ||
        this.mesh.position.x > 196 ||
        this.mesh.position.z < 18 ||
        this.mesh.position.z > 418
      ) {
        this.state = BallState.AT_REST;
        this.curVelocity = { x: 0, y: 0, z: 0 };
        this.clearTracer();
        this.onOutOfBounds?.();
        return;
      }

      // Track continuous land position before entering water hazard
      if (surface !== SurfaceType.WATER) {
        this.lastLandPosition = {
          x: this.mesh.position.x,
          y: this.mesh.position.y,
          z: this.mesh.position.z
        };
      }

      // 3. Water hazard check
      if (surface === SurfaceType.WATER) {
        this.waterEntryPoint = { ...this.lastLandPosition };
        this.state = BallState.IN_WATER;
        this.clearTracer();
        soundFx.playWaterSplash();
        this.onStateChange?.(this.state, this.currentLie, { carry: this.carryDistance, total: this.totalDistance });
        return;
      }

      // 4. Decisive settling logic by lie:
      // Rough grass or first cut securely holds balls even on slopes up to 22 deg (slopeSin < 0.38)
      // Sand traps hold balls on slopes up to 16 deg (slopeSin < 0.28)
      // Fairway holds balls on slopes up to 11 deg (slopeSin < 0.20)
      // Green / Fringe: steeper slopes (> 0.12) allow balls to roll down contours
      let maxSettleSlope = 0.12;
      if (surface === SurfaceType.ROUGH || surface === SurfaceType.FIRST_CUT) {
        maxSettleSlope = 0.38;
      } else if (surface === SurfaceType.BUNKER) {
        maxSettleSlope = 0.28;
      } else if (surface === SurfaceType.FAIRWAY || surface === SurfaceType.TEE) {
        maxSettleSlope = 0.20;
      }

      const canSettleOnSlope = slopeSin < maxSettleSlope;
      if (newSpeed < 0.16 && canSettleOnSlope) {
        this.atRestCounter += dt;
        if (this.atRestCounter > 0.14) {
          this.state = BallState.AT_REST;
          this.curVelocity = { x: 0, y: 0, z: 0 };
          this.clearTracer();
          this.onStateChange?.(this.state, this.currentLie, { carry: this.carryDistance, total: this.totalDistance });
        }
      } else {
        this.atRestCounter = 0;
      }

      // Universal creeping timeout failsafe: if speed < 0.10 for > 0.9s on any terrain (such as far rough slopes),
      // decisively settle and advance to the next shot so the flight visualizer never gets stuck!
      if (newSpeed < 0.10) {
        this.creepingTimer = (this.creepingTimer || 0) + dt;
        if (this.creepingTimer > 0.9) {
          this.state = BallState.AT_REST;
          this.curVelocity = { x: 0, y: 0, z: 0 };
          this.clearTracer();
          this.creepingTimer = 0;
          this.onStateChange?.(this.state, this.currentLie, { carry: this.carryDistance, total: this.totalDistance });
        }
      } else {
        this.creepingTimer = 0;
      }
    }
  }

  private handleGroundImpact(groundY: number) {
    this.mesh.position.y = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;
    const surface = this.terrain.getSurfaceAt(this.mesh.position.x, this.mesh.position.z);
    this.currentLie = surface;
    const props = SURFACE_PROPERTIES[surface];

    const normal = this.terrain.getNormal(this.mesh.position.x, this.mesh.position.z);

    const impactSpeed = Math.sqrt(
      this.curVelocity.x * this.curVelocity.x +
      this.curVelocity.y * this.curVelocity.y +
      this.curVelocity.z * this.curVelocity.z
    );

    const surfKey = (surface === SurfaceType.GREEN || surface === SurfaceType.FRINGE) ? 'green' :
                    surface === SurfaceType.BUNKER ? 'sand' :
                    (surface === SurfaceType.ROUGH || surface === SurfaceType.FIRST_CUT) ? 'rough' : 'fairway';
    soundFx.playBounce(surfKey, impactSpeed / 35.0);

    // Direct cup hole-in on landing
    if (this.activePinPosition) {
      const pinDx = this.mesh.position.x - this.activePinPosition.x;
      const pinDz = this.mesh.position.z - this.activePinPosition.z;
      const distToCup = Math.sqrt(pinDx * pinDx + pinDz * pinDz);
      if (distToCup <= GOLF_CONSTANTS.CUP_RADIUS * 1.25 && impactSpeed <= 5.5) {
        this.state = BallState.IN_HOLE;
        this.curVelocity = { x: 0, y: 0, z: 0 };
        this.mesh.position.set(
          this.activePinPosition.x,
          this.activePinPosition.y - GOLF_CONSTANTS.CUP_DEPTH * 0.75,
          this.activePinPosition.z
        );
        this.clearTracer();
        soundFx.playCupDrop();
        this.onHoleComplete?.();
        this.onStateChange?.(this.state, SurfaceType.CUP_BOTTOM, { carry: this.carryDistance, total: this.totalDistance });
        return;
      }
    }

    if (surface === SurfaceType.WATER) {
      this.state = BallState.IN_WATER;
      this.clearTracer();
      soundFx.playWaterSplash();
      this.onStateChange?.(this.state, this.currentLie, { carry: this.carryDistance, total: this.totalDistance });
      return;
    }

    const vDotN = this.curVelocity.x * normal.x + this.curVelocity.y * normal.y + this.curVelocity.z * normal.z;
    const vNormX = vDotN * normal.x;
    const vNormY = vDotN * normal.y;
    const vNormZ = vDotN * normal.z;

    const vTangX = this.curVelocity.x - vNormX;
    const vTangZ = this.curVelocity.z - vNormZ;

    // Bunker sand landing: soft sand cushion with small realistic bounce and roll so it does not stop dead
    if (surface === SurfaceType.BUNKER) {
      const sandBounceVy = -vNormY * 0.14;
      if (Math.abs(sandBounceVy) > 0.38 && impactSpeed > 6.0) {
        this.curVelocity.x = vTangX * 0.28;
        this.curVelocity.y = Math.min(1.0, Math.abs(sandBounceVy));
        this.curVelocity.z = vTangZ * 0.28;
        this.addTracerPoint(this.mesh.position.clone(), true);
        return;
      } else {
        this.state = BallState.ROLLING;
        this.curVelocity.x = vTangX * 0.24;
        this.curVelocity.y = 0;
        this.curVelocity.z = vTangZ * 0.24;
        this.curSpin = { x: 0, y: 0, z: 0 };
        this.onStateChange?.(this.state, this.currentLie, { carry: this.carryDistance, total: this.totalDistance });
        return;
      }
    }

    const bounceVy = -vNormY * props.restitution;

    // Record clean ground impact cusp without creating zero-length segments
    this.addTracerPoint(this.mesh.position.clone(), true);

    let effTangX = vTangX;
    let effTangZ = vTangZ;
    let effBounceVy = bounceVy;

    // Greens & Fringe: receptive turf compression, high approach shot check-up, and backspin bite
    if (surface === SurfaceType.GREEN || surface === SurfaceType.FRINGE) {
      const downwardVy = Math.max(0, -this.curVelocity.y);
      const horizSpeed = Math.hypot(this.curVelocity.x, this.curVelocity.z);
      const steepness = downwardVy / (horizSpeed + 0.001);
      const heightFactor = Math.min(1.0, Math.max(0, (downwardVy - 5.0) / 14.0));

      // Receptive tournament greens absorb steep aerial drops while allowing authentic forward release
      if (heightFactor > 0 || steepness > 0.65) {
        const heightBrake = Math.min(0.35, Math.max(steepness * 0.15, heightFactor * 0.28));
        effBounceVy *= (1.0 - heightBrake * 0.30); // Controlled bounce (~10% reduction)
        effTangX *= (1.0 - heightBrake * 0.25);    // Mild turf friction check (~8% reduction)
        effTangZ *= (1.0 - heightBrake * 0.25);
      }

      const backspinRpm = (this.curSpin.x * 60) / (2 * Math.PI);
      if (backspinRpm > 1500) {
        // High backspin creates realistic check without completely freezing the ball
        const bite = Math.min(0.35, (backspinRpm - 1500) / 10000);
        effTangX *= (1.0 - bite * 0.40);
        effTangZ *= (1.0 - bite * 0.40);
        effBounceVy *= (1.0 - bite * 0.20);
        this.curSpin.x *= 0.35;
      }
    }

    if (Math.abs(effBounceVy) > 0.32) {
      this.curVelocity.x = effTangX * (1 - props.friction * 0.25) - vNormX * props.restitution;
      this.curVelocity.y = effBounceVy;
      this.curVelocity.z = effTangZ * (1 - props.friction * 0.25) - vNormZ * props.restitution;
    } else {
      this.state = BallState.ROLLING;
      this.curVelocity.y = 0;
      const slopeSin = Math.hypot(normal.x, normal.z);
      const frictionLoss = props.friction * 0.18;
      this.curVelocity.x = effTangX * (1 - frictionLoss) + normal.x * normal.y * 0.45;
      this.curVelocity.z = effTangZ * (1 - frictionLoss) + normal.z * normal.y * 0.45;
      this.onStateChange?.(this.state, this.currentLie, { carry: this.carryDistance, total: this.totalDistance });
    }
  }

  public checkHoleIn(pinPos: Vector3D): boolean {
    const dx = this.mesh.position.x - pinPos.x;
    const dz = this.mesh.position.z - pinPos.z;
    const distToCup = Math.sqrt(dx * dx + dz * dz);
    const speed = Math.sqrt(this.curVelocity.x * this.curVelocity.x + this.curVelocity.z * this.curVelocity.z);

    if (distToCup <= GOLF_CONSTANTS.CUP_RADIUS) {
      if (speed <= 4.2) {
        this.state = BallState.IN_HOLE;
        this.curVelocity = { x: 0, y: 0, z: 0 };
        this.mesh.position.set(pinPos.x, pinPos.y - GOLF_CONSTANTS.CUP_DEPTH * 0.8, pinPos.z);
        this.clearTracer();
        soundFx.playCupDrop();
        this.onHoleComplete?.();
        this.onStateChange?.(this.state, SurfaceType.CUP_BOTTOM, { carry: this.carryDistance, total: this.totalDistance });
        return true;
      } else {
        this.curVelocity.x *= -0.4;
        this.curVelocity.z *= -0.4;
      }
    }
    return false;
  }

  /**
   * Commits smoothly spaced Toptracer path points without rebuilding or disposing GPU meshes per frame.
   */
  private addTracerPoint(pt: Vector3, forceImpact = false) {
    if (this.isPutting) return;

    if (this.tracerPoints.length === 0) {
      this.tracerPoints.push(pt.clone());
      this.tracerLiveTip = pt.clone();
      return;
    }

    const lastAnchor = this.tracerPoints[this.tracerPoints.length - 1];
    const distFromLast = Vector3.Distance(lastAnchor, pt);
    const minSpacing = forceImpact ? 0.14 : 0.42;

    if (distFromLast >= minSpacing && this.tracerPoints.length < Ball.MAX_TRACER_POINTS - 2) {
      this.tracerPoints.push(pt.clone());
    }
    this.tracerLiveTip = pt.clone();

    if (this.scene.activeCamera) {
      this.updateTracerForCamera(this.scene.activeCamera.position);
    }
  }

  /**
   * Re-orients the persistent Toptracer ribbon strip toward the active camera lens on the exact render frame,
   * eliminating Path3D twists, frame-lag shudders, takeoff clutter, and near-plane camera clipping.
   */
  public updateTracerForCamera(camPos: Vector3) {
    if (!this.tracerMesh) return;
    if (this.isPutting || (this.state !== BallState.IN_FLIGHT && this.state !== BallState.ROLLING)) {
      this.tracerMesh.isVisible = false;
      return;
    }

    const pts = this.tracerPoints;
    if (pts.length === 0) {
      this.tracerMesh.isVisible = false;
      return;
    }

    const path: Vector3[] = [];
    for (let i = 0; i < pts.length; i++) {
      path.push(pts[i]);
    }

    const tip = this.tracerLiveTip || this.mesh.position;
    const lastCommitted = path[path.length - 1];
    const tipDist = Vector3.Distance(lastCommitted, tip);
    if (tipDist > 0.04) {
      // Stop leading tip cleanly behind the golf ball surface so the ball renders crisp in front
      const gapBehindBall = Math.min(tipDist * 0.45, GOLF_CONSTANTS.BALL_RENDER_RADIUS * 1.65);
      const dir = tip.subtract(lastCommitted);
      const len = dir.length() || 1;
      path.push(tip.subtract(dir.scale(gapBehindBall / len)));
    }

    const count = Math.min(path.length, Ball.MAX_TRACER_POINTS);
    if (count < 2) {
      this.tracerMesh.isVisible = false;
      return;
    }

    // Cumulative arc length to keep takeoff area & short chips unobscured while full drives sweep boldly
    const arcLen = new Float32Array(count);
    for (let i = 1; i < count; i++) {
      arcLen[i] = arcLen[i - 1] + Vector3.Distance(path[i - 1], path[i]);
    }
    const totalArc = arcLen[count - 1];
    if (totalArc < 0.30) {
      this.tracerMesh.isVisible = false;
      return;
    }

    this.tracerMesh.isVisible = true;
    const horizSpeed = Math.hypot(this.curVelocity.x, this.curVelocity.z);
    const rollFade = this.hasLanded ? Math.min(1.0, Math.max(0.28, horizSpeed / 3.5)) : 1.0;

    for (let i = 0; i < count; i++) {
      const p = path[i];
      const pPrev = path[Math.max(0, i - 1)];
      const pNext = path[Math.min(count - 1, i + 1)];

      let tx = pNext.x - pPrev.x;
      let ty = pNext.y - pPrev.y;
      let tz = pNext.z - pPrev.z;
      const tLen = Math.hypot(tx, ty, tz);
      if (tLen > 1e-5) {
        tx /= tLen; ty /= tLen; tz /= tLen;
      } else {
        tx = 0; ty = 0; tz = 1;
      }

      const vx = camPos.x - p.x;
      const vy = camPos.y - p.y;
      const vz = camPos.z - p.z;
      const distToCam = Math.hypot(vx, vy, vz);

      // Cross product V x T -> billboard ribbon side vector
      let sx = vy * tz - vz * ty;
      let sy = vz * tx - vx * tz;
      let sz = vx * ty - vy * tx;
      let sLen = Math.hypot(sx, sy, sz);
      if (sLen < 1e-4) {
        // Fallback perpendicular vector using World Up when view ray is nearly collinear with tangent
        sx = 1 * tz - 0 * ty;
        sy = 0;
        sz = 0 * ty - 1 * tx;
        sLen = Math.hypot(sx, sy, sz);
        if (sLen < 1e-4) { sx = 1; sy = 0; sz = 0; sLen = 1; }
      }
      sx /= sLen; sy /= sLen; sz /= sLen;

      // Camera proximity fade prevents near-plane slicing or screen obstruction at ANY orbit angle
      const rawCamT = Math.max(0, Math.min(1, (distToCam - 1.5) / 1.5));
      const nearCamFade = rawCamT * rawCamT * (3 - 2 * rawCamT);

      // Tee takeoff clearance fade keeps clubhead, ball, and stance clean at launch
      const rawStartT = Math.max(0, Math.min(1, arcLen[i] / 0.85));
      const startFade = rawStartT * rawStartT * (3 - 2 * rawStartT);

      const progress = i / (count - 1);
      // Sleek tapered half-width: slimmer than golf ball (2.13cm radius), smooth tip taper
      const headTaper = i === count - 1 ? 0.72 : 1.0;
      const halfWidth = (0.007 + 0.011 * progress) * headTaper * nearCamFade;

      const vIdx = i * 2;
      this.tracerPositions[vIdx * 3 + 0] = p.x - sx * halfWidth;
      this.tracerPositions[vIdx * 3 + 1] = p.y - sy * halfWidth;
      this.tracerPositions[vIdx * 3 + 2] = p.z - sz * halfWidth;
      this.tracerPositions[(vIdx + 1) * 3 + 0] = p.x + sx * halfWidth;
      this.tracerPositions[(vIdx + 1) * 3 + 1] = p.y + sy * halfWidth;
      this.tracerPositions[(vIdx + 1) * 3 + 2] = p.z + sz * halfWidth;

      const rCol = 1.0;
      const gCol = 0.42 + 0.22 * progress;
      const bCol = 0.04 + 0.08 * progress;
      const aCol = 0.88 * nearCamFade * startFade * rollFade;

      this.tracerColors[vIdx * 4 + 0] = rCol;
      this.tracerColors[vIdx * 4 + 1] = gCol;
      this.tracerColors[vIdx * 4 + 2] = bCol;
      this.tracerColors[vIdx * 4 + 3] = aCol;
      this.tracerColors[(vIdx + 1) * 4 + 0] = rCol;
      this.tracerColors[(vIdx + 1) * 4 + 1] = gCol;
      this.tracerColors[(vIdx + 1) * 4 + 2] = bCol;
      this.tracerColors[(vIdx + 1) * 4 + 3] = aCol;
    }

    // Collapse unused tail vertices cleanly into degenerate zero-area triangles
    const endPos = path[count - 1];
    for (let i = count; i < Ball.MAX_TRACER_POINTS; i++) {
      const vIdx = i * 2;
      this.tracerPositions[vIdx * 3 + 0] = endPos.x;
      this.tracerPositions[vIdx * 3 + 1] = endPos.y;
      this.tracerPositions[vIdx * 3 + 2] = endPos.z;
      this.tracerPositions[(vIdx + 1) * 3 + 0] = endPos.x;
      this.tracerPositions[(vIdx + 1) * 3 + 1] = endPos.y;
      this.tracerPositions[(vIdx + 1) * 3 + 2] = endPos.z;

      this.tracerColors[vIdx * 4 + 3] = 0;
      this.tracerColors[(vIdx + 1) * 4 + 3] = 0;
    }

    this.tracerMesh.updateVerticesData(VertexBuffer.PositionKind, this.tracerPositions, false);
    this.tracerMesh.updateVerticesData(VertexBuffer.ColorKind, this.tracerColors, false);
  }

  public clearTracer() {
    this.tracerPoints = [];
    this.tracerLiveTip = null;
    if (this.tracerMesh) {
      this.tracerMesh.isVisible = false;
    }
  }

  public dispose() {
    this.clearTracer();
    if (this.tracerMesh) {
      this.tracerMesh.dispose();
      this.tracerMesh = null;
    }
    this.tracerMaterial.dispose();
    this.mesh.dispose();
  }
}
