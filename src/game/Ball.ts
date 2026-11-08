import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
  Texture,
  Material,
  Color3,
  Vector3
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

  // Active Pin Target for Dynamic Cup Entry
  public activePinPosition: Vector3D | null = null;

  // Active Tree Colliders for realistic tree deflections
  public treeColliders: TreeCollider[] = [];

  // Visual trajectory Toptracer ribbon (active only during shot)
  private tracerPoints: Vector3[] = [];
  private tracerMesh: Mesh | null = null;
  private tracerMaterial: StandardMaterial;
  private contactShadowMesh: Mesh;

  // 'B' Key Ready-for-Next-Shot 3-Flash Indicator positioned just above the ball
  private readyIndicatorMesh: Mesh;
  private readyIndicatorMat: StandardMaterial;
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

    // Toptracer luminous ribbon material
    this.tracerMaterial = new StandardMaterial('toptracerMat', this.scene);
    this.tracerMaterial.diffuseColor = new Color3(1.0, 0.48, 0.06);
    this.tracerMaterial.emissiveColor = new Color3(1.0, 0.38, 0.04);
    this.tracerMaterial.specularColor = new Color3(0, 0, 0);
    this.tracerMaterial.disableLighting = true;
    this.tracerMaterial.alpha = 0.94;
    this.tracerMaterial.backFaceCulling = false;

    // 'B' Key Ready-for-Next-Shot 3-Flash Indicator positioned just above the stationary ball
    this.readyIndicatorMesh = MeshBuilder.CreatePlane('cup_ballReadyIndicator', {
      width: 0.34,
      height: 0.34
    }, this.scene);
    this.readyIndicatorMesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
    this.readyIndicatorMesh.isPickable = false;
    this.readyIndicatorMesh.setEnabled(false);

    const indTex = new DynamicTexture('ballReadyIndicatorTex', 128, this.scene, false);
    const indCtx = indTex.getContext() as CanvasRenderingContext2D;
    indCtx.clearRect(0, 0, 128, 128);
    // Outer soft glow ring
    const rGrad = indCtx.createRadialGradient(64, 64, 10, 64, 64, 60);
    rGrad.addColorStop(0, 'rgba(16, 255, 165, 0.35)');
    rGrad.addColorStop(0.65, 'rgba(16, 225, 145, 0.18)');
    rGrad.addColorStop(1, 'rgba(16, 225, 145, 0.0)');
    indCtx.fillStyle = rGrad;
    indCtx.fillRect(0, 0, 128, 128);

    // Crisp modern downward chevron + ring pointing down at the ball
    indCtx.strokeStyle = '#38ffae';
    indCtx.lineWidth = 6;
    indCtx.lineCap = 'round';
    indCtx.lineJoin = 'round';
    indCtx.beginPath();
    indCtx.arc(64, 52, 26, Math.PI * 0.85, Math.PI * 2.15);
    indCtx.stroke();

    indCtx.fillStyle = '#ffffff';
    indCtx.beginPath();
    indCtx.moveTo(42, 64);
    indCtx.lineTo(64, 92);
    indCtx.lineTo(86, 64);
    indCtx.lineTo(75, 64);
    indCtx.lineTo(64, 78);
    indCtx.lineTo(53, 64);
    indCtx.closePath();
    indCtx.fill();
    indTex.hasAlpha = true;
    indTex.update(false);

    this.readyIndicatorMat = new StandardMaterial('ballReadyIndicatorMat', this.scene);
    this.readyIndicatorMat.diffuseTexture = indTex;
    this.readyIndicatorMat.opacityTexture = indTex;
    this.readyIndicatorMat.emissiveColor = new Color3(0.22, 1.0, 0.68);
    this.readyIndicatorMat.disableLighting = true;
    this.readyIndicatorMat.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.readyIndicatorMat.backFaceCulling = false;
    this.readyIndicatorMesh.material = this.readyIndicatorMat;

    // Register frame loop for flight aerodynamics & exact ground seating
    this.scene.onBeforeRenderObservable.add(() => {
      this.update(this.scene.getEngine().getDeltaTime() / 1000);
    });
  }

  /**
   * Triggered when the player presses 'B' while the ball is settled/stationary:
   * Flashes 3 times positioned just above the ball and then smoothly fades out.
   */
  public triggerReadyFlashIndicator() {
    if (this.state !== BallState.AIMING && this.state !== BallState.AT_REST) return;
    this.readyFlashActive = true;
    this.readyFlashElapsed = 0;
    this.readyIndicatorMesh.setEnabled(true);
    this.readyIndicatorMesh.position.set(
      this.mesh.position.x,
      this.mesh.position.y + 0.28,
      this.mesh.position.z
    );
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
    const flashDuration = 1.05; // 3 crisp flashes (0.35s each)
    const fadeDuration = 0.40;  // Smooth fade-out after the 3rd flash
    const totalDuration = flashDuration + fadeDuration;

    if (this.readyFlashElapsed >= totalDuration) {
      this.readyFlashActive = false;
      this.readyIndicatorMesh.setEnabled(false);
      return;
    }

    this.readyIndicatorMesh.position.set(
      this.mesh.position.x,
      this.mesh.position.y + 0.28 + Math.sin(this.readyFlashElapsed * 9.0) * 0.02,
      this.mesh.position.z
    );

    if (this.readyFlashElapsed < flashDuration) {
      // 3 distinct pulses using sin^2 over 3 full half-cycles
      const phase = (this.readyFlashElapsed / flashDuration) * Math.PI * 3.0;
      const pulse = Math.pow(Math.sin(phase), 2);
      this.readyIndicatorMat.alpha = 0.12 + 0.88 * pulse;
      const s = 0.90 + 0.18 * pulse;
      this.readyIndicatorMesh.scaling.set(s, s, s);
    } else {
      // Smooth fade-out after the 3rd flash
      const fadeT = (this.readyFlashElapsed - flashDuration) / fadeDuration;
      this.readyIndicatorMat.alpha = Math.max(0, 1.0 - fadeT);
      const s = 1.0 - fadeT * 0.15;
      this.readyIndicatorMesh.scaling.set(s, s, s);
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
      const maxDist = tree.canopyRadius + 1.2;
      if (distSq > maxDist * maxDist) continue;

      const horizDist = Math.sqrt(distSq) || 0.001;

      // 1. Solid Trunk cylinder collision
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

      // 2. Foliage Canopy / Branch deflection
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

    const groundY = this.terrain.getElevation(this.mesh.position.x, this.mesh.position.z);
    this.mesh.position.y = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;

    this.shotOrigin = {
      x: this.mesh.position.x,
      y: this.mesh.position.y,
      z: this.mesh.position.z
    };

    const windRad = (shot.windHeadingDeg * Math.PI) / 180.0;
    this.windVec = {
      x: shot.windSpeedMps * Math.sin(windRad),
      y: 0,
      z: shot.windSpeedMps * Math.cos(windRad)
    };

    const initial = Aerodynamics.calculateInitialVectors(shot);

    // Putter initiates pure ground rolling flush with the putting surface
    if (shot.club.category === 'putter') {
      this.state = BallState.ROLLING;
      this.hasLanded = true;
      this.curVelocity = {
        x: initial.velocity.x,
        y: 0,
        z: initial.velocity.z
      };
      this.curSpin = { x: 0, y: 0, z: 0 };

      this.addTracerPoint(this.mesh.position.clone());
      soundFx.playClubImpact('putter', shot.powerPercent, false);
      this.onStateChange?.(this.state, this.currentLie);
      return;
    }

    this.state = BallState.IN_FLIGHT;
    this.hasLanded = false;
    this.curVelocity = initial.velocity;
    this.curSpin = initial.spinVec;

    this.addTracerPoint(this.mesh.position.clone());

    const isDriver = shot.club.id === 'driver';
    soundFx.playSwingWhoosh(shot.powerPercent);
    soundFx.playClubImpact(shot.club.category, shot.powerPercent, isDriver);

    this.onStateChange?.(this.state, this.currentLie);
  }

  private update(dt: number) {
    if (dt <= 0 || dt > 0.1) dt = 0.016;

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

      // Sub-step flight integration (2 substeps) to prevent fast balls from tunneling through slopes
      const subSteps = 2;
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

      // 2. Course boundary containment (Out of bounds)
      if (
        this.mesh.position.x < 3 ||
        this.mesh.position.x > this.terrain.width - 3 ||
        this.mesh.position.z < 3 ||
        this.mesh.position.z > this.terrain.length - 3
      ) {
        this.state = BallState.AT_REST;
        this.curVelocity = { x: 0, y: 0, z: 0 };
        this.clearTracer();
        this.onOutOfBounds?.();
        return;
      }

      // 3. Water hazard check
      if (surface === SurfaceType.WATER) {
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

      // Universal creeping timeout failsafe: if speed < 0.18 for > 1.0s on any terrain (such as far rough slopes),
      // decisively settle and advance to the next shot so the flight visualizer never gets stuck!
      if (newSpeed < 0.18) {
        this.creepingTimer = (this.creepingTimer || 0) + dt;
        if (this.creepingTimer > 1.0) {
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
        this.tracerPoints.push(this.mesh.position.clone());
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

    // Record exact ground impact point in the Toptracer ribbon so bounce cusps are clearly visible
    this.tracerPoints.push(this.mesh.position.clone());

    let effTangX = vTangX;
    let effTangZ = vTangZ;
    let effBounceVy = bounceVy;

    // Greens & Fringe: approach shot backspin bite / check-up effect
    if (surface === SurfaceType.GREEN || surface === SurfaceType.FRINGE) {
      const backspinRpm = (this.curSpin.x * 60) / (2 * Math.PI);
      if (backspinRpm > 1200) {
        const bite = Math.min(0.85, backspinRpm / 7000);
        effTangX *= (1.0 - bite * 0.80);
        effTangZ *= (1.0 - bite * 0.80);
        effBounceVy *= 0.55;
        this.curSpin.x *= 0.15;
      }
    }

    if (Math.abs(effBounceVy) > 0.52) {
      this.curVelocity.x = effTangX * (1 - props.friction * 0.35) - vNormX * props.restitution;
      this.curVelocity.y = effBounceVy;
      this.curVelocity.z = effTangZ * (1 - props.friction * 0.35) - vNormZ * props.restitution;
    } else {
      this.state = BallState.ROLLING;
      this.curVelocity.y = 0;
      const slopeSin = Math.hypot(normal.x, normal.z);
      const frictionLoss = props.friction * 0.32;
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
   * Updates the orange Toptracer flight ribbon on every single rendered frame
   * with the live tip continuously anchored to the exact ball center (zero 0.45m discrete step/push jerk).
   */
  private addTracerPoint(pt: Vector3) {
    if (this.tracerPoints.length === 0) {
      this.tracerPoints.push(pt.clone());
      return;
    }

    const lastAnchor = this.tracerPoints[this.tracerPoints.length - 1];
    const distFromLast = Vector3.Distance(lastAnchor, pt);

    // Commit a permanent trail anchor every 0.32m, while ALWAYS extending the live tip smoothly to `pt` every frame
    if (distFromLast >= 0.32) {
      this.tracerPoints.push(pt.clone());
    }

    // Build continuous frame-accurate path whose tip is 100% locked to `pt`
    const livePath: Vector3[] = [];
    for (let i = 0; i < this.tracerPoints.length; i++) {
      livePath.push(this.tracerPoints[i]);
    }

    const tipDist = Vector3.Distance(livePath[livePath.length - 1], pt);
    if (tipDist > 0.005) {
      if (tipDist < 0.10 && livePath.length >= 2) {
        // Move the final point smoothly instead of inserting a tiny segment that twists Frenet frames
        livePath[livePath.length - 1] = pt.clone();
      } else {
        livePath.push(pt.clone());
      }
    }

    // Ensure the tracer tube never clips into the active camera frustum near plane
    const camPos = this.scene.activeCamera ? this.scene.activeCamera.globalPosition : null;
    const finalPath: Vector3[] = [];
    for (let i = 0; i < livePath.length; i++) {
      const p = livePath[i];
      // Keep the live tip at the ball, but exclude any interior point within 1.5m of the camera lens
      if (camPos && i < livePath.length - 1 && Vector3.Distance(p, camPos) < 1.5) {
        continue;
      }
      finalPath.push(p);
    }

    if (finalPath.length >= 2) {
      if (this.tracerMesh) {
        this.tracerMesh.dispose();
      }
      this.tracerMesh = MeshBuilder.CreateTube('ballToptracer', {
        path: finalPath,
        radius: 0.048,
        tessellation: 12,
        cap: Mesh.CAP_ALL,
        updatable: false
      }, this.scene);
      this.tracerMesh.material = this.tracerMaterial;
      this.tracerMesh.isPickable = false;
    }
  }

  public clearTracer() {
    this.tracerPoints = [];
    if (this.tracerMesh) {
      this.tracerMesh.dispose();
      this.tracerMesh = null;
    }
  }

  public dispose() {
    this.clearTracer();
    this.mesh.dispose();
  }
}
