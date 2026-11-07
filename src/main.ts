import {
  Engine,
  Scene,
  Vector3,
  Color3,
  Color4,
  HemisphericLight,
  DirectionalLight,
  PointerEventTypes,
  MeshBuilder,
  StandardMaterial,
  ShadowGenerator
} from '@babylonjs/core';

import './style.css';
import { GOLF_CONSTANTS, SurfaceType } from './core/Constants';
import { PresetFeature, ClubSpec } from './core/Types';
import { HavokManager } from './physics/HavokManager';
import { TerrainGrid } from './terrain/TerrainGrid';
import { ProceduralBackdrop } from './terrain/ProceduralBackdrop';
import { SceneryFactory } from './terrain/Scenery';
import { GreenContourVisualizer } from './terrain/GreenContourVisualizer';
import { Ball, BallState } from './game/Ball';
import { GOLF_CLUBS, getRecommendedClub } from './game/ClubBag';
import { SwingEngine } from './game/SwingEngine';
import { CameraController } from './game/CameraController';
import { CourseManager } from './game/CourseManager';
import { UIController } from './ui/UIController';

class FairwayStudioApp {
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;

  private havok: HavokManager;
  private terrain!: TerrainGrid;
  private backdrop!: ProceduralBackdrop;
  private scenery!: SceneryFactory;
  private courseManager!: CourseManager;
  private greenVisualizer!: GreenContourVisualizer;
  private ball!: Ball;
  private swingEngine!: SwingEngine;
  private cameraCtrl!: CameraController;
  private ui!: UIController;
  private shadowGenerator: ShadowGenerator | null = null;

  // Designer State
  private activeMode: 'designer' | 'play' = 'play';
  private activeDesignerTool: 'sculpt' | 'stamp' | 'set_tee' | 'set_pin' = 'stamp';
  private activeSculptMode: 'raise' | 'lower' | 'flatten' | 'smooth' = 'raise';
  private brushRadius = 12;
  private brushStrength = 0.5;
  private targetSurface: SurfaceType = SurfaceType.FAIRWAY;
  private activePreset: PresetFeature | null = null;
  private isPointerDown = false;

  // Grid mesh
  private gridMesh: ReturnType<typeof MeshBuilder.CreateGround> | null = null;
  private show1mGrid = false;

  // Play state
  private activeClub: ClubSpec = GOLF_CLUBS[0];
  private currentAimAzimuth = 0; // degrees

  constructor() {
    this.canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.45, 0.70, 0.88, 1.0); // Crisp blue sky

    this.havok = new HavokManager(this.scene);
  }

  public async start() {
    // 1. Setup Sun & HDRI Environment Lighting with Soft Shadows
    this.setupLighting();

    // 2. Initialize Havok Physics
    await this.havok.initialize();

    // 3. Initialize Terrain & Procedural Backdrop
    this.terrain = new TerrainGrid(this.scene);
    this.terrain.buildMesh();
    this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
    this.backdrop = new ProceduralBackdrop(this.scene);

    // Terrain receives soft shadows
    if (this.terrain.terrainMesh) {
      this.terrain.terrainMesh.receiveShadows = true;
    }

    // 4. Initialize Scenery & Course
    this.scenery = new SceneryFactory(this.scene);
    this.courseManager = new CourseManager(this.terrain, this.scenery);

    // 5. Green Contours
    this.greenVisualizer = new GreenContourVisualizer(this.scene, this.terrain);

    // 6. Camera & Controls (PGA Tour style)
    this.cameraCtrl = new CameraController(this.scene, this.canvas);

    // 7. Ball & Swing Engine
    this.ball = new Ball(this.scene, this.terrain);
    this.swingEngine = new SwingEngine(this.activeClub);

    // 8. Setup UI & Event Handlers (must be initialized before placeBallAtActiveTee)
    this.setupUI();

    // Ball casts shadows
    if (this.shadowGenerator && this.ball?.mesh && this.ball.mesh.getTotalVertices() > 0) {
      try {
        this.shadowGenerator.addShadowCaster(this.ball.mesh, false);
      } catch (e) {
        console.warn('Failed to add ball shadow caster:', e);
      }
    }

    // Register all course scenery to cast soft shadows
    this.registerSceneryShadows();

    // Place ball at Hole 1 Tee
    this.placeBallAtActiveTee();

    // 9. Input & Pointer Interactions
    this.setupPointerInteractions();

    // 10. Start Render Loop
    this.engine.runRenderLoop(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this.update(dt);
      this.scene.render();
    });

    window.addEventListener('resize', () => {
      this.engine.resize();
    });
  }

  private setupLighting() {
    // Ambient Sky & Ground light
    const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 0.72;
    hemiLight.diffuse = new Color3(0.92, 0.96, 1.0);
    hemiLight.groundColor = new Color3(0.24, 0.32, 0.18);

    // Warm Sun Directional Light
    const sun = new DirectionalLight('sunLight', new Vector3(-0.55, -0.85, -0.45).normalize(), this.scene);
    sun.position = new Vector3(110, 140, 200);
    sun.intensity = 1.35;
    sun.diffuse = new Color3(1.0, 0.96, 0.88); // Golden hour sun

    // High quality soft PCF shadows (optimized)
    try {
      this.shadowGenerator = new ShadowGenerator(2048, sun);
      this.shadowGenerator.usePercentageCloserFiltering = true;
      this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
      this.shadowGenerator.bias = 0.0015;
      this.shadowGenerator.normalBias = 0.025;
    } catch (e) {
      console.warn('ShadowGenerator initialization fallback:', e);
    }
  }

  private registerSceneryShadows() {
    if (!this.shadowGenerator) return;
    const meshes = this.scene.meshes;
    for (const m of meshes) {
      if (
        m.name !== 'GolfTerrain' &&
        m.name !== 'ProceduralBackdropMesh' &&
        !m.name.startsWith('water_') &&
        m.name !== 'gridOverlay' &&
        m.getTotalVertices() > 0
      ) {
        try {
          this.shadowGenerator.addShadowCaster(m, false);
        } catch {
          // ignore mesh if unsupported
        }
      }
    }
  }

  private placeBallAtActiveTee() {
    const tee = this.courseManager.currentHole.teePosition;
    const groundY = this.terrain.getElevation(tee.x, tee.z);
    this.ball.setPosition(tee.x, groundY + GOLF_CONSTANTS.BALL_RADIUS + 0.05, tee.z);

    // Aim directly at pin
    const pin = this.courseManager.currentHole.pinPosition;
    const dx = pin.x - tee.x;
    const dz = pin.z - tee.z;
    this.currentAimAzimuth = (Math.atan2(dx, dz) * 180) / Math.PI;
    this.swingEngine.aimAzimuthDeg = this.currentAimAzimuth;

    // Smoothly align camera behind the ball without locking player look
    this.cameraCtrl.setMode('aim');
    this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);

    // Auto-select recommended club
    const distToPin = Math.sqrt(dx * dx + dz * dz);
    this.activeClub = getRecommendedClub(distToPin, false);
    this.swingEngine.setClub(this.activeClub);

    this.updateHUDDisplay();
  }

  private setupUI() {
    this.ui = new UIController({
      onModeToggle: (mode) => {
        this.activeMode = mode;
        if (mode === 'designer') {
          this.cameraCtrl.setMode('designer');
        } else {
          this.cameraCtrl.setMode('aim');
          this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
        }
      },
      onToolSelect: (tool) => {
        this.activeDesignerTool = tool;
      },
      onSculptModeSelect: (mode) => {
        this.activeSculptMode = mode;
      },
      onPresetSelect: (preset) => {
        this.activePreset = preset;
        this.activeDesignerTool = 'stamp';
      },
      onBrushRadiusChange: (radius) => {
        this.brushRadius = radius;
      },
      onBrushStrengthChange: (strength) => {
        this.brushStrength = strength;
      },
      onTargetSurfaceSelect: (surf) => {
        this.targetSurface = surf;
      },
      onHoleSelect: (idx) => {
        this.courseManager.selectHole(idx);
        this.placeBallAtActiveTee();
        this.ui.updateHolesList(this.courseManager.courseData.holes, this.courseManager.currentHoleIndex);
        this.updateHUDDisplay();
      },
      onAddHole: () => {
        const h = this.courseManager.addHole(4);
        this.ui.updateHolesList(this.courseManager.courseData.holes, this.courseManager.currentHoleIndex);
        alert(`Hole ${h.number} (Par ${h.par}) created!`);
      },
      onHoleParChange: (par) => {
        this.courseManager.currentHole.par = par;
        this.ui.updateHolesList(this.courseManager.courseData.holes, this.courseManager.currentHoleIndex);
        this.updateHUDDisplay();
      },
      onToggleGrid: () => {
        return this.toggle1mGrid();
      },
      onToggleContours: () => {
        return this.greenVisualizer.toggleVisible();
      },
      onExportCourse: () => {
        const json = this.courseManager.exportCourseJSON();
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.courseManager.courseData.name.replace(/\s+/g, '_')}.json`;
        a.click();
        URL.revokeObjectURL(url);
      },
      onImportCourse: (json) => {
        const success = this.courseManager.importCourseJSON(json);
        if (success) {
          this.greenVisualizer.rebuildSlopeGrid();
          this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
          this.placeBallAtActiveTee();
          this.ui.updateHolesList(this.courseManager.courseData.holes, this.courseManager.currentHoleIndex);
          this.updateHUDDisplay();
          this.registerSceneryShadows();
          alert('Course successfully imported!');
        } else {
          alert('Failed to import course. Invalid format.');
        }
      },
      onClubSelect: (club) => {
        this.activeClub = club;
        this.swingEngine.setClub(club);
        this.updateHUDDisplay();
      },
      onSwingAction: () => {
        if (this.activeMode !== 'play') return;
        this.swingEngine.handleActionClick();
      },
      onAimAdjust: (deltaDeg) => {
        if (this.activeMode !== 'play' || this.ball.state === BallState.IN_FLIGHT) return;
        this.currentAimAzimuth += deltaDeg;
        this.swingEngine.aimAzimuthDeg = this.currentAimAzimuth;
        this.cameraCtrl.setAimHeading(this.ball.position, this.currentAimAzimuth);
        this.updateHUDDisplay();
      },
      onCameraModeToggle: () => {
        const current = this.cameraCtrl.mode;
        if (current === 'aim') {
          // Switch to Scout View (PGA Tour flyover view down the hole)
          this.cameraCtrl.setMode('scout');
          this.cameraCtrl.setScoutView(this.ball.position, this.courseManager.currentHole.pinPosition);
        } else if (current === 'scout') {
          // Switch to Green Putting View
          this.cameraCtrl.setMode('green');
          this.cameraCtrl.focusOnPin(this.courseManager.currentHole.pinPosition);
        } else if (current === 'green') {
          // Free Orbit View
          this.cameraCtrl.setMode('designer');
        } else {
          // Return to Aim Behind Ball
          this.cameraCtrl.setMode('aim');
          this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
        }
      },
      onResetShot: () => {
        this.placeBallAtActiveTee();
        this.updateHUDDisplay();
      }
    });

    // Club selector Prev / Next buttons
    document.getElementById('btn-prev-club')?.addEventListener('click', () => {
      const idx = GOLF_CLUBS.findIndex(c => c.id === this.activeClub.id);
      if (idx > 0) {
        this.activeClub = GOLF_CLUBS[idx - 1];
        this.swingEngine.setClub(this.activeClub);
        this.updateHUDDisplay();
      }
    });

    document.getElementById('btn-next-club')?.addEventListener('click', () => {
      const idx = GOLF_CLUBS.findIndex(c => c.id === this.activeClub.id);
      if (idx < GOLF_CLUBS.length - 1) {
        this.activeClub = GOLF_CLUBS[idx + 1];
        this.swingEngine.setClub(this.activeClub);
        this.updateHUDDisplay();
      }
    });

    // Swing Engine hooks
    this.swingEngine.onUpdate = (progress, phase) => {
      this.ui.updateSwingMeter(progress, phase);
    };

    this.swingEngine.onSwingCancelled = (reason) => {
      this.ui.setSwingFeedbackText(reason, 'miss');
    };

    this.swingEngine.onShotExecute = (shot) => {
      this.courseManager.recordStroke(this.activeClub.category === 'putter');
      this.cameraCtrl.setMode('flight');
      this.ball.launch(shot, this.courseManager.currentHole.pinPosition);

      // Feedback text based on accuracy
      if (Math.abs(shot.accuracyOffset) < 0.15) {
        this.ui.setSwingFeedbackText('PERFECT STRIKE! 🌟', 'perfect');
      } else if (shot.accuracyOffset > 0.45) {
        this.ui.setSwingFeedbackText('PUSH SLICE ➡️', 'slice');
      } else if (shot.accuracyOffset < -0.45) {
        this.ui.setSwingFeedbackText('SNAP HOOK ⬅️', 'hook');
      } else if (shot.accuracyOffset > 0) {
        this.ui.setSwingFeedbackText('BABY FADE ↗️', 'fade');
      } else {
        this.ui.setSwingFeedbackText('NICE DRAW ↖️', 'draw');
      }

      this.updateHUDDisplay();
    };

    // Ball state changes & Distance Tracking
    this.ball.onStateChange = (state, lie, shotStats) => {
      if (shotStats) {
        this.ui.updateShotStats(shotStats.carry, shotStats.total, state === BallState.AT_REST);
      }

      if (state === BallState.AT_REST) {
        const holed = this.ball.checkHoleIn(this.courseManager.currentHole.pinPosition);
        if (!holed) {
          // Switch camera back to address
          this.cameraCtrl.setMode(lie === SurfaceType.GREEN ? 'green' : 'aim');
          const pin = this.courseManager.currentHole.pinPosition;
          const dx = pin.x - this.ball.position.x;
          const dz = pin.z - this.ball.position.z;
          this.currentAimAzimuth = (Math.atan2(dx, dz) * 180) / Math.PI;
          this.swingEngine.aimAzimuthDeg = this.currentAimAzimuth;

          if (this.cameraCtrl.mode === 'aim') {
            this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
          } else {
            this.cameraCtrl.focusOnPin(pin);
          }

          // Update recommended club
          const distToPin = Math.sqrt(dx * dx + dz * dz);
          this.activeClub = getRecommendedClub(distToPin, lie === SurfaceType.GREEN);
          this.swingEngine.setClub(this.activeClub);
          this.swingEngine.setLie(lie);

          this.updateHUDDisplay();
        }
      } else if (state === BallState.IN_WATER) {
        alert('Splash! Water hazard. 1 penalty stroke. Drop ball near hazard.');
        this.courseManager.recordStroke();
        const prevZ = Math.max(40, this.ball.position.z - 15);
        this.ball.setPosition(this.ball.position.x, this.terrain.getElevation(this.ball.position.x, prevZ) + 0.1, prevZ);
        this.cameraCtrl.setMode('aim');
        this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
        this.updateHUDDisplay();
      }
    };

    this.ball.onHoleComplete = () => {
      const score = this.courseManager.completeHole();
      alert(`🎉 HOLE COMPLETED!\n${score.scoreText}\nStrokes: ${score.strokes} (Par ${score.par})`);
      if (this.courseManager.currentHoleIndex < this.courseManager.courseData.holes.length - 1) {
        this.courseManager.selectHole(this.courseManager.currentHoleIndex + 1);
        this.placeBallAtActiveTee();
      } else {
        alert('Course finished! Outstanding round.');
        this.placeBallAtActiveTee();
      }
      this.updateHUDDisplay();
    };

    this.ui.updateHolesList(this.courseManager.courseData.holes, this.courseManager.currentHoleIndex);
    this.updateHUDDisplay();
  }

  private toggle1mGrid(): boolean {
    this.show1mGrid = !this.show1mGrid;
    if (this.show1mGrid) {
      if (!this.gridMesh) {
        this.gridMesh = MeshBuilder.CreateGround('gridOverlay', {
          width: this.terrain.width,
          height: this.terrain.length,
          subdivisions: this.terrain.width
        }, this.scene);
        this.gridMesh.position.set(this.terrain.width * 0.5, 0.05, this.terrain.length * 0.5);

        const mat = new StandardMaterial('gridMat', this.scene);
        mat.wireframe = true;
        mat.diffuseColor = new Color3(1, 1, 1);
        mat.alpha = 0.18;
        this.gridMesh.material = mat;
      }
      this.gridMesh.setEnabled(true);
    } else {
      if (this.gridMesh) {
        this.gridMesh.setEnabled(false);
      }
    }
    return this.show1mGrid;
  }

  private updateHUDDisplay() {
    if (!this.ui) return;
    const pin = this.courseManager.currentHole.pinPosition;
    const dx = pin.x - this.ball.position.x;
    const dz = pin.z - this.ball.position.z;
    const distToPin = Math.sqrt(dx * dx + dz * dz);

    this.ui.updateHUD(
      distToPin,
      this.ball.currentSurface,
      this.activeClub,
      this.courseManager.currentStrokes,
      this.courseManager.currentHole,
      this.swingEngine.windSpeedMps,
      this.swingEngine.windHeadingDeg
    );
  }

  private setupPointerInteractions() {
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (this.activeMode !== 'designer') return;

      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        this.isPointerDown = true;
        this.handleDesignerClick(pointerInfo);
      } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
        this.isPointerDown = false;
      } else if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
        if (this.isPointerDown && this.activeDesignerTool === 'sculpt') {
          this.handleDesignerClick(pointerInfo);
        }
      }
    });
  }

  private handleDesignerClick(pointerInfo: any) {
    const pickInfo = pointerInfo.pickInfo;
    if (!pickInfo || !pickInfo.hit || !pickInfo.pickedPoint) return;

    const gx = Math.round(pickInfo.pickedPoint.x);
    const gz = Math.round(pickInfo.pickedPoint.z);

    if (this.activeDesignerTool === 'sculpt') {
      this.terrain.applySculptBrush(
        gx,
        gz,
        this.brushRadius,
        this.brushStrength,
        this.activeSculptMode,
        this.targetSurface
      );
      this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
      this.greenVisualizer.rebuildSlopeGrid();

    } else if (this.activeDesignerTool === 'stamp') {
      if (!this.activePreset) return;

      const p = this.activePreset;
      if (p.category === 'scenery') {
        const gy = this.terrain.getElevation(gx, gz);
        let createdMesh = null;
        if (p.sceneryType === 'pine') createdMesh = this.scenery.createPineTree(gx, gy, gz);
        else if (p.sceneryType === 'oak') createdMesh = this.scenery.createOakTree(gx, gy, gz);
        else if (p.sceneryType === 'rock_cluster') createdMesh = this.scenery.createRockCluster(gx, gy, gz);
        else if (p.sceneryType === 'dam_wall') createdMesh = this.scenery.createDamWall(gx, gy, gz, p.width, 4);

        if (createdMesh && this.shadowGenerator) {
          this.shadowGenerator.addShadowCaster(createdMesh, true);
        }
      } else {
        this.terrain.stampFeature(
          gx,
          gz,
          p.width,
          p.length,
          0,
          p.surfaceType,
          p.depthProfile ?? 0,
          p.lipHeight ?? 0
        );

        if (p.surfaceType === SurfaceType.WATER) {
          const gy = this.terrain.getElevation(gx, gz);
          this.scenery.createWaterPlane(gx, gy + 1.2, gz, p.width, p.length);
        }

        this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
        if (p.surfaceType === SurfaceType.GREEN) {
          this.greenVisualizer.rebuildSlopeGrid();
        }
      }

    } else if (this.activeDesignerTool === 'set_tee') {
      const hole = this.courseManager.currentHole;
      hole.teePosition.x = gx;
      hole.teePosition.z = gz;
      this.courseManager.setupHoleVisuals();
      this.registerSceneryShadows();
      this.placeBallAtActiveTee();
      this.updateHUDDisplay();

    } else if (this.activeDesignerTool === 'set_pin') {
      const hole = this.courseManager.currentHole;
      hole.pinPosition.x = gx;
      hole.pinPosition.z = gz;
      this.courseManager.setupHoleVisuals();
      this.registerSceneryShadows();
      this.updateHUDDisplay();
    }
  }

  private update(dt: number) {
    // Update Swing Engine
    this.swingEngine.update(dt);

    // Live shot distance update during flight
    if (this.ball.state === BallState.IN_FLIGHT || this.ball.state === BallState.ROLLING) {
      this.ui.updateShotStats(this.ball.carryDistance, this.ball.totalDistance, false);
    }

    // Dynamic Toptracer broadcast camera during flight
    if (this.cameraCtrl.mode === 'flight') {
      this.cameraCtrl.updateFlightCamera(this.ball.position, this.ball.curVelocity);
    }
  }
}

// Bootstrap application on page load
window.addEventListener('DOMContentLoaded', async () => {
  const app = new FairwayStudioApp();
  (window as any).app = app;
  await app.start();
});
