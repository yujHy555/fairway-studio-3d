import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  DynamicTexture,
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

  // Visual trajectory Toptracer ribbon (active only during shot)
  private tracerPoints: Vector3[] = [];
  private tracerMesh: Mesh | null = null;
  private tracerMaterial: StandardMaterial;
  private contactShadowMesh: Mesh;

  // Callbacks
  public onStateChange?: (state: BallState, lie: SurfaceType, shotStats?: { carry: number; total: number }) => void;
  public onHoleComplete?: () => void;
  public onOutOfBounds?: () => void;

  constructor(scene: Scene, terrain: TerrainGrid) {
    this.scene = scene;
    this.terrain = terrain;

    // Smooth high-tessellation regulation golf ball mesh (32 segments) with dimple normal map
    this.mesh = MeshBuilder.CreateSphere('golfBall', {
      diameter: GOLF_CONSTANTS.BALL_RENDER_RADIUS * 2,
      segments: 32
    }, this.scene);

    const dimpleNormal = RealisticTextures.createGolfBallDimpleNormalTexture(this.scene);
    dimpleNormal.uScale = 3;
    dimpleNormal.vScale = 2;
    dimpleNormal.level = 0.55;

    const mat = new StandardMaterial('ballMat', this.scene);
    mat.diffuseColor = new Color3(0.98, 0.98, 0.99);
    mat.specularColor = new Color3(0.85, 0.85, 0.88);
    mat.specularPower = 112;
    mat.bumpTexture = dimpleNormal;
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
    this.tracerMaterial.diffuseColor = new Color3(1.0, 0.45, 0.05);
    this.tracerMaterial.emissiveColor = new Color3(1.0, 0.35, 0.05);
    this.tracerMaterial.specularColor = new Color3(0, 0, 0);
    this.tracerMaterial.disableLighting = true;
    this.tracerMaterial.alpha = 0.92;

    // Register frame loop for flight aerodynamics & exact ground seating
    this.scene.onBeforeRenderObservable.add(() => {
      this.update(this.scene.getEngine().getDeltaTime() / 1000);
    });
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
      soundFx.playClubImpact(shot.club.category, shot.powerPercent);
      this.onStateChange?.(this.state, this.currentLie);
      return;
    }

    this.state = BallState.IN_FLIGHT;
    this.hasLanded = false;
    this.curVelocity = initial.velocity;
    this.curSpin = initial.spinVec;

    this.addTracerPoint(this.mesh.position.clone());

    soundFx.playSwingWhoosh(shot.powerPercent);
    soundFx.playClubImpact(shot.club.category, shot.powerPercent);

    this.onStateChange?.(this.state, this.currentLie);
  }

  private update(dt: number) {
    if (dt <= 0 || dt > 0.1) dt = 0.016;

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
      const slopeForceX = -normal.x * 9.81;
      const slopeForceZ = -normal.z * 9.81;

      const speed = Math.sqrt(this.curVelocity.x * this.curVelocity.x + this.curVelocity.z * this.curVelocity.z);
      const decel = (props.rollingResistance * 9.81 + 0.14) * dt;
      const newSpeed = Math.max(0, speed - decel);
      const speedFactor = speed > 0.001 ? newSpeed / speed : 0;

      this.curVelocity.x = (this.curVelocity.x + slopeForceX * dt) * speedFactor;
      this.curVelocity.z = (this.curVelocity.z + slopeForceZ * dt) * speedFactor;

      this.mesh.position.x += this.curVelocity.x * dt;
      this.mesh.position.z += this.curVelocity.z * dt;

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
          if (speed <= 4.8) {
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
          } else if (speed < 6.8) {
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

      // 4. Decisive settling
      if (newSpeed < 0.18) {
        this.atRestCounter += dt;
        if (this.atRestCounter > 0.10) {
          this.state = BallState.AT_REST;
          this.curVelocity = { x: 0, y: 0, z: 0 };
          this.clearTracer();
          this.onStateChange?.(this.state, this.currentLie, { carry: this.carryDistance, total: this.totalDistance });
        }
      } else {
        this.atRestCounter = 0;
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

    const bounceVy = -vNormY * props.restitution;

    // Record exact ground impact point in the Toptracer ribbon so bounce cusps are clearly visible
    this.tracerPoints.push(this.mesh.position.clone());

    if (Math.abs(bounceVy) > 0.62 && surface !== SurfaceType.BUNKER) {
      this.curVelocity.x = vTangX * (1 - props.friction * 0.38) - vNormX * props.restitution;
      this.curVelocity.y = bounceVy;
      this.curVelocity.z = vTangZ * (1 - props.friction * 0.38) - vNormZ * props.restitution;
    } else {
      this.state = BallState.ROLLING;
      this.curVelocity.y = 0;
      this.curVelocity.x = vTangX * (1 - props.friction * 0.35);
      this.curVelocity.z = vTangZ * (1 - props.friction * 0.35);
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

  private addTracerPoint(pt: Vector3) {
    if (this.tracerPoints.length > 0) {
      const last = this.tracerPoints[this.tracerPoints.length - 1];
      if (Vector3.Distance(last, pt) < 0.45) return;
    }
    this.tracerPoints.push(pt.clone());

    if (this.tracerPoints.length >= 2) {
      if (this.tracerMesh) {
        this.tracerMesh.dispose();
      }
      this.tracerMesh = MeshBuilder.CreateTube('ballToptracer', {
        path: this.tracerPoints,
        radius: 0.065,
        tessellation: 16,
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
