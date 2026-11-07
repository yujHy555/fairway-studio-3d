import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3
} from '@babylonjs/core';
import { ClubSpec, Vector3D } from '../core/Types';
import { TerrainGrid } from '../terrain/TerrainGrid';
import { Aerodynamics } from '../physics/Aerodynamics';

export class AimSystem {
  private scene: Scene;
  private terrain: TerrainGrid;

  // Aiming parameters
  public aimHeadingDeg: number = 0;
  public targetDistanceMeters: number = 220; // Default target distance
  public targetPosition: Vector3 = new Vector3(110, 0, 260);

  // 3D Visual Meshes
  private targetGroup: Mesh;
  private poleMesh: Mesh;
  private flagMesh: Mesh;
  private outerRingMesh: Mesh;
  private innerRingMesh: Mesh;
  private trajectoryTube: Mesh | null = null;
  private dispersionMesh: Mesh;

  // Materials
  private poleMat: StandardMaterial;
  private ringMat: StandardMaterial;
  private dispersionMat: StandardMaterial;
  private trajectoryMat: StandardMaterial;

  private isVisible: boolean = true;
  private pulseTime: number = 0;

  constructor(scene: Scene, terrain: TerrainGrid) {
    this.scene = scene;
    this.terrain = terrain;

    this.targetGroup = new Mesh('aimTargetGroup', this.scene);

    // 1. Vertical luminous aim pole (4.5m tall, visible over mounds and hills)
    this.poleMesh = MeshBuilder.CreateCylinder('aimPole', {
      height: 4.5,
      diameter: 0.08,
      tessellation: 8
    }, this.scene);
    this.poleMesh.parent = this.targetGroup;
    this.poleMesh.position.y = 2.25;

    this.poleMat = new StandardMaterial('aimPoleMat', this.scene);
    this.poleMat.emissiveColor = new Color3(1.0, 0.85, 0.2); // Vibrant glowing gold
    this.poleMat.disableLighting = true;
    this.poleMesh.material = this.poleMat;

    // 2. Prism Flag Banner on top of pole
    this.flagMesh = MeshBuilder.CreateBox('aimFlag', {
      width: 0.65,
      height: 0.35,
      depth: 0.04
    }, this.scene);
    this.flagMesh.parent = this.targetGroup;
    this.flagMesh.position.set(0.35, 4.25, 0);

    const flagMat = new StandardMaterial('aimFlagMat', this.scene);
    flagMat.emissiveColor = new Color3(1.0, 0.25, 0.15); // Neon crimson beacon
    flagMat.disableLighting = true;
    this.flagMesh.material = flagMat;

    // 3. Ground target rings draped over terrain
    this.outerRingMesh = MeshBuilder.CreateTorus('aimOuterRing', {
      diameter: 6.0,
      thickness: 0.14,
      tessellation: 32
    }, this.scene);
    this.outerRingMesh.parent = this.targetGroup;
    this.outerRingMesh.position.y = 0.06;

    this.ringMat = new StandardMaterial('aimRingMat', this.scene);
    this.ringMat.emissiveColor = new Color3(0.2, 0.85, 1.0); // Electric cyan
    this.ringMat.disableLighting = true;
    this.outerRingMesh.material = this.ringMat;

    this.innerRingMesh = MeshBuilder.CreateTorus('aimInnerRing', {
      diameter: 2.2,
      thickness: 0.12,
      tessellation: 24
    }, this.scene);
    this.innerRingMesh.parent = this.targetGroup;
    this.innerRingMesh.position.y = 0.06;
    this.innerRingMesh.material = this.ringMat;

    // 4. Landing dispersion ellipse
    this.dispersionMesh = MeshBuilder.CreateDisc('aimDispersion', {
      radius: 4.5,
      tessellation: 32
    }, this.scene);
    this.dispersionMesh.parent = this.targetGroup;
    this.dispersionMesh.rotation.x = Math.PI / 2;
    this.dispersionMesh.position.y = 0.04;

    this.dispersionMat = new StandardMaterial('aimDispersionMat', this.scene);
    this.dispersionMat.diffuseColor = new Color3(0.2, 0.85, 1.0);
    this.dispersionMat.emissiveColor = new Color3(0.1, 0.45, 0.65);
    this.dispersionMat.alpha = 0.22;
    this.dispersionMat.disableLighting = true;
    this.dispersionMesh.material = this.dispersionMat;

    // 5. Predicted Trajectory Ribbon Material
    this.trajectoryMat = new StandardMaterial('aimTrajectoryMat', this.scene);
    this.trajectoryMat.emissiveColor = new Color3(0.35, 0.90, 1.0); // Translucent luminous cyan aim arc
    this.trajectoryMat.diffuseColor = new Color3(0.2, 0.8, 1.0);
    this.trajectoryMat.alpha = 0.65;
    this.trajectoryMat.disableLighting = true;

    // Pulse animation
    this.scene.onBeforeRenderObservable.add(() => {
      if (!this.isVisible) return;
      this.pulseTime += 0.04;
      const s = 1.0 + Math.sin(this.pulseTime * 2.5) * 0.08;
      this.outerRingMesh.scaling.set(s, 1, s);
      this.flagMesh.rotation.y = Math.sin(this.pulseTime * 1.5) * 0.25;
    });
  }

  public setVisible(visible: boolean) {
    this.isVisible = visible;
    this.targetGroup.setEnabled(visible);
    if (this.trajectoryTube) {
      this.trajectoryTube.setEnabled(visible);
    }
  }

  /**
   * Adjusts aim azimuth angle (left/right)
   */
  public adjustHeading(deltaDeg: number) {
    this.aimHeadingDeg = (this.aimHeadingDeg + deltaDeg) % 360;
  }

  /**
   * Adjusts target distance (closer/farther)
   */
  public adjustDistance(deltaMeters: number) {
    this.targetDistanceMeters = Math.max(15, Math.min(340, this.targetDistanceMeters + deltaMeters));
  }

  /**
   * Sets target location directly to a 3D ground point (e.g. from mouse click)
   */
  public setTargetPosition(ballPos: Vector3, clickX: number, clickZ: number) {
    const dx = clickX - ballPos.x;
    const dz = clickZ - ballPos.z;
    this.targetDistanceMeters = Math.max(15, Math.min(340, Math.sqrt(dx * dx + dz * dz)));
    this.aimHeadingDeg = (Math.atan2(dx, dz) * 180) / Math.PI;
  }

  /**
   * Recalculates target position and aerodynamic trajectory aim arc
   */
  public update(
    ballPos: Vector3,
    club: ClubSpec,
    windSpeedMps: number,
    windHeadingDeg: number
  ) {
    if (!this.isVisible) return;

    // Calculate Target coordinates from ball position and aim heading
    const rad = (this.aimHeadingDeg * Math.PI) / 180.0;
    const targetX = ballPos.x + Math.sin(rad) * this.targetDistanceMeters;
    const targetZ = ballPos.z + Math.cos(rad) * this.targetDistanceMeters;
    const groundY = this.terrain.getElevation(targetX, targetZ);

    this.targetPosition.set(targetX, groundY, targetZ);
    this.targetGroup.position.set(targetX, groundY, targetZ);

    // Scale dispersion ellipse based on club category
    const dispersionRadius = club.category === 'wood' ? 6.5 :
                             club.category === 'iron' ? 4.2 :
                             club.category === 'wedge' ? 2.5 : 1.2;
    this.dispersionMesh.scaling.set(dispersionRadius / 4.5, dispersionRadius / 4.5, 1);

    // Compute Aerodynamic Flight Trajectory Arc
    this.rebuildTrajectoryArc(ballPos, club, windSpeedMps, windHeadingDeg);
  }

  private rebuildTrajectoryArc(
    ballPos: Vector3,
    club: ClubSpec,
    windSpeedMps: number,
    windHeadingDeg: number
  ) {
    if (this.trajectoryTube) {
      this.trajectoryTube.dispose();
      this.trajectoryTube = null;
    }

    if (club.category === 'putter') return; // Putts don't have aerial arcs

    // Simulate flight curve points using Aerodynamics RK4
    const startPos: Vector3D = { x: ballPos.x, y: ballPos.y + 0.05, z: ballPos.z };
    const shot = {
      club,
      powerPercent: 0.95,
      accuracyOffset: 0,
      launchAngleDeg: club.loftDegrees,
      launchSpeedMps: club.baseBallSpeedMps * 0.95,
      backspinRPM: club.baseBackspinRPM * 0.95,
      sidespinRPM: 0,
      azimuthDeg: this.aimHeadingDeg,
      windSpeedMps,
      windHeadingDeg
    };

    const initial = Aerodynamics.calculateInitialVectors(shot);
    let curVel = initial.velocity;
    let curSpin = initial.spinVec;
    let curPos = { ...startPos };

    const windRad = (windHeadingDeg * Math.PI) / 180.0;
    const windVec: Vector3D = {
      x: windSpeedMps * Math.sin(windRad),
      y: 0,
      z: windSpeedMps * Math.cos(windRad)
    };

    const points: Vector3[] = [new Vector3(startPos.x, startPos.y, startPos.z)];
    const dt = 0.05;

    for (let t = 0; t < 8.0; t += dt) {
      const step = Aerodynamics.stepRK4(curPos, curVel, curSpin, windVec, dt);
      curPos = step.nextPos;
      curVel = step.nextVel;
      curSpin = step.nextSpin;

      const groundY = this.terrain.getElevation(curPos.x, curPos.z);
      if (curPos.y <= groundY + 0.1) {
        points.push(new Vector3(curPos.x, groundY + 0.1, curPos.z));
        break;
      }

      points.push(new Vector3(curPos.x, curPos.y, curPos.z));
    }

    if (points.length >= 3) {
      this.trajectoryTube = MeshBuilder.CreateTube('aimTrajectoryArc', {
        path: points,
        radius: 0.045, // 9cm smooth luminous preview arc
        tessellation: 6,
        updatable: false
      }, this.scene);
      this.trajectoryTube.material = this.trajectoryMat;
      this.trajectoryTube.isPickable = false;
      this.trajectoryTube.setEnabled(this.isVisible);
    }
  }

  public dispose() {
    if (this.trajectoryTube) {
      this.trajectoryTube.dispose();
      this.trajectoryTube = null;
    }
    this.targetGroup.dispose();
    this.poleMat.dispose();
    this.ringMat.dispose();
    this.dispersionMat.dispose();
    this.trajectoryMat.dispose();
  }
}
