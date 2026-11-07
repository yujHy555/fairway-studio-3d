import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  LinesMesh
} from '@babylonjs/core';
import { GOLF_CONSTANTS, SurfaceType, SURFACE_PROPERTIES } from '../core/Constants';
import { Vector3D, ShotResult } from '../core/Types';
import { Aerodynamics } from '../physics/Aerodynamics';
import { TerrainGrid } from '../terrain/TerrainGrid';
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
  private hasLanded = false;

  // Visual trajectory Toptracer ribbon (active only during shot)
  private tracerPoints: Vector3[] = [];
  private tracerMesh: LinesMesh | null = null;

  // Callbacks
  public onStateChange?: (state: BallState, lie: SurfaceType, shotStats?: { carry: number; total: number }) => void;
  public onHoleComplete?: () => void;

  constructor(scene: Scene, terrain: TerrainGrid) {
    this.scene = scene;
    this.terrain = terrain;

    // Create 3D Golf Ball Mesh with prominent visibility
    this.mesh = MeshBuilder.CreateSphere('golfBall', {
      diameter: GOLF_CONSTANTS.BALL_RENDER_RADIUS * 2,
      segments: 10
    }, this.scene);

    const mat = new StandardMaterial('ballMat', this.scene);
    mat.diffuseColor = new Color3(1.0, 1.0, 1.0);
    mat.specularColor = new Color3(0.8, 0.8, 0.8);
    mat.specularPower = 64;
    mat.emissiveColor = new Color3(0.08, 0.08, 0.08); // Subtle glow for visibility against dark grass
    this.mesh.material = mat;

    // Register frame loop for flight aerodynamics & state transitions
    this.scene.onBeforeRenderObservable.add(() => {
      this.update(this.scene.getEngine().getDeltaTime() / 1000);
    });
  }

  public get position(): Vector3 {
    return this.mesh.position;
  }

  public get currentSurface(): SurfaceType {
    return this.currentLie;
  }

  public setPosition(x: number, y: number, z: number) {
    const minGroundY = this.terrain.getElevation(x, z) + GOLF_CONSTANTS.BALL_RENDER_RADIUS;
    const finalY = Math.max(minGroundY, y);

    this.mesh.position.set(x, finalY, z);
    this.curVelocity = { x: 0, y: 0, z: 0 };
    this.curSpin = { x: 0, y: 0, z: 0 };
    this.currentLie = this.terrain.getSurfaceAt(x, z);
    this.state = BallState.AIMING;
    this.clearTracer();
  }

  /**
   * Striked by club - initiates flight trajectory
   */
  public launch(shot: ShotResult, _pinPosition?: Vector3D) {
    this.clearTracer();
    this.flightTime = 0;
    this.atRestCounter = 0;
    this.hasLanded = false;
    this.carryDistance = 0;
    this.totalDistance = 0;
    this.state = BallState.IN_FLIGHT;

    // Record shot start position for distance calculation
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
    this.curVelocity = initial.velocity;
    this.curSpin = initial.spinVec;

    // Ensure ball starts above ground
    const groundY = this.terrain.getElevation(this.mesh.position.x, this.mesh.position.z);
    this.mesh.position.y = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS + 0.05;

    // Add first tracer point
    this.addTracerPoint(this.mesh.position.clone());

    // Play swing whoosh and impact sound
    soundFx.playSwingWhoosh(shot.powerPercent);
    soundFx.playClubImpact(shot.club.category, shot.powerPercent);

    this.onStateChange?.(this.state, this.currentLie);
  }

  private update(dt: number) {
    if (dt <= 0 || dt > 0.1) dt = 0.016;

    if (this.state === BallState.IN_FLIGHT) {
      this.flightTime += dt;

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
        dt
      );

      this.curVelocity = step.nextVel;
      this.curSpin = step.nextSpin;

      this.mesh.position.set(step.nextPos.x, step.nextPos.y, step.nextPos.z);
      this.addTracerPoint(this.mesh.position.clone());

      // Update live total distance
      const dx = this.mesh.position.x - this.shotOrigin.x;
      const dz = this.mesh.position.z - this.shotOrigin.z;
      this.totalDistance = Math.sqrt(dx * dx + dz * dz);

      // Ground collision detection
      const groundY = this.terrain.getElevation(this.mesh.position.x, this.mesh.position.z);
      if (this.mesh.position.y <= groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS) {
        this.mesh.position.y = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;

        if (!this.hasLanded) {
          this.hasLanded = true;
          this.carryDistance = this.totalDistance;
        }

        this.handleGroundImpact(groundY);
      }

    } else if (this.state === BallState.ROLLING) {
      const groundY = this.terrain.getElevation(this.mesh.position.x, this.mesh.position.z);
      this.mesh.position.y = groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;

      const surface = this.terrain.getSurfaceAt(this.mesh.position.x, this.mesh.position.z);
      this.currentLie = surface;
      const props = SURFACE_PROPERTIES[surface];

      // Slope gravity acceleration
      const normal = this.terrain.getNormal(this.mesh.position.x, this.mesh.position.z);
      const slopeForceX = -normal.x * 9.81;
      const slopeForceZ = -normal.z * 9.81;

      // Realistic rolling friction with clean settling
      const speed = Math.sqrt(this.curVelocity.x * this.curVelocity.x + this.curVelocity.z * this.curVelocity.z);
      const frictionDecay = Math.max(0, 1.0 - (props.rollingResistance * 6.5 + 0.55) * dt);

      this.curVelocity.x = (this.curVelocity.x + slopeForceX * dt) * frictionDecay;
      this.curVelocity.z = (this.curVelocity.z + slopeForceZ * dt) * frictionDecay;

      this.mesh.position.x += this.curVelocity.x * dt;
      this.mesh.position.z += this.curVelocity.z * dt;

      // Update distance
      const dx = this.mesh.position.x - this.shotOrigin.x;
      const dz = this.mesh.position.z - this.shotOrigin.z;
      this.totalDistance = Math.sqrt(dx * dx + dz * dz);

      this.addTracerPoint(this.mesh.position.clone());

      // Check water hazard
      if (surface === SurfaceType.WATER) {
        this.state = BallState.IN_WATER;
        this.clearTracer();
        soundFx.playWaterSplash();
        this.onStateChange?.(this.state, this.currentLie, { carry: this.carryDistance, total: this.totalDistance });
        return;
      }

      // Decisive ball settling: stop creeping when speed drops below 0.45 m/s
      if (speed < 0.45) {
        this.atRestCounter += dt;
        if (this.atRestCounter > 0.12) {
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

    const surfKey = surface === SurfaceType.GREEN ? 'green' :
                    surface === SurfaceType.BUNKER ? 'sand' :
                    surface === SurfaceType.ROUGH ? 'rough' : 'fairway';
    soundFx.playBounce(surfKey, impactSpeed / 35.0);

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

    if (Math.abs(bounceVy) > 1.4 && surface !== SurfaceType.BUNKER) {
      this.curVelocity.x = vTangX * (1 - props.friction * 0.5) - vNormX * props.restitution;
      this.curVelocity.y = bounceVy;
      this.curVelocity.z = vTangZ * (1 - props.friction * 0.5) - vNormZ * props.restitution;
    } else {
      this.state = BallState.ROLLING;
      this.curVelocity.y = 0;
      this.curVelocity.x = vTangX * (1 - props.friction * 0.4);
      this.curVelocity.z = vTangZ * (1 - props.friction * 0.4);
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

  // PGA Tour / Toptracer live flight ribbon (active strictly while ball is moving)
  private addTracerPoint(pt: Vector3) {
    this.tracerPoints.push(pt);
    if (this.tracerPoints.length > 2) {
      if (this.tracerMesh) {
        this.tracerMesh.dispose();
      }
      this.tracerMesh = MeshBuilder.CreateLines('ballToptracer', {
        points: this.tracerPoints,
        updatable: false
      }, this.scene);
      this.tracerMesh.color = new Color3(1.0, 0.28, 0.05); // PGA broadcast red-orange tracer
    }
  }

  public clearTracer() {
    this.tracerPoints = [];
    if (this.tracerMesh) {
      this.tracerMesh.dispose();
      this.tracerMesh = null;
    }
  }
}
