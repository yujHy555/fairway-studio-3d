import {
  Engine,
  Scene,
  Vector3,
  Color3,
  Color4,
  HemisphericLight,
  DirectionalLight,
  PointerEventTypes,
  Mesh,
  VertexData,
  StandardMaterial,
  ShadowGenerator,
  CascadedShadowGenerator,
  HDRCubeTexture
} from '@babylonjs/core';
import '@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';

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
import { AimSystem } from './game/AimSystem';
import { UIController } from './ui/UIController';
import { DesignerBrushVisualizer } from './terrain/DesignerBrushVisualizer';

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
  private aimSystem!: AimSystem;
  private brushVisualizer!: DesignerBrushVisualizer;
  private cameraCtrl!: CameraController;
  private ui!: UIController;
  private sunLight!: DirectionalLight;
  private shadowGenerator: ShadowGenerator | CascadedShadowGenerator | null = null;

  // Designer State
  private activeMode: 'designer' | 'play' = 'play';
  private activeDesignerTool: 'sculpt' | 'stamp' | 'set_tee' | 'set_pin' = 'stamp';
  private activeSculptMode: 'raise' | 'lower' | 'flatten' | 'smooth' = 'raise';
  private brushRadius = 12;
  private brushStrength = 0.5;
  private targetSurface: SurfaceType = SurfaceType.FAIRWAY;
  private activePreset: PresetFeature | null = null;
  private isPointerDownInDesigner = false;
  private pointerDownX = 0;
  private pointerDownY = 0;

  // 1m Grid mesh conforming to terrain surface
  private gridMesh: Mesh | null = null;
  private show1mGrid = false;

  // Play state
  private activeClub: ClubSpec = GOLF_CLUBS[0];
  private currentAimAzimuth = 0; // degrees

  constructor() {
    this.canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.45, 0.70, 0.88, 1.0);

    this.havok = new HavokManager(this.scene);
  }

  public async start() {
    // 1. Setup Camera first so CascadedShadowGenerator can bind to activeCamera
    this.cameraCtrl = new CameraController(this.scene, this.canvas);
    this.scene.activeCamera = this.cameraCtrl.camera;

    // 2. Setup Sun & HDRI Environment Lighting with Real AAA Soft Shadows
    this.setupLighting();

    // 3. Initialize Havok Physics
    await this.havok.initialize();

    // 4. Initialize Smooth Shared-Vertex Terrain & Backdrop
    this.terrain = new TerrainGrid(this.scene);
    this.terrain.buildMesh();
    this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
    this.backdrop = new ProceduralBackdrop(this.scene);

    if (this.terrain.terrainMesh) {
      this.terrain.terrainMesh.receiveShadows = true;
    }

    // 5. Initialize Realistic Scenery & Course
    this.scenery = new SceneryFactory(this.scene);
    this.courseManager = new CourseManager(this.terrain, this.scenery);

    // 6. Green Contours
    this.greenVisualizer = new GreenContourVisualizer(this.scene, this.terrain);

    // 7. Dimpled Regulation Golf Ball & Swing Engine
    this.ball = new Ball(this.scene, this.terrain);
    this.swingEngine = new SwingEngine(this.activeClub);

    // 8. Clean Aim State Tracker (zero artificial blue target rings)
    this.aimSystem = new AimSystem(this.scene, this.terrain);

    // 9. Interactive 3D Circular Brush Visualizer for Course Designer
    this.brushVisualizer = new DesignerBrushVisualizer(this.scene, this.terrain);

    // 10. Setup UI & Event Handlers
    this.setupUI();

    // Register all course scenery & golf ball to cast real lighting shadows
    this.registerSceneryShadows();

    // Place ball flush on Hole 1 Tee
    this.placeBallAtActiveTee();

    // 11. Input & Pointer Interactions
    this.setupPointerInteractions();

    // Enforce zero-lag terrain collision right before camera matrix evaluation on every frame
    this.scene.onBeforeCameraRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this.cameraCtrl.enforceTerrainCollision((x, z) => this.getWorldElevation(x, z), dt);
    });

    // 12. Start Render Loop
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
    // 1. HDRI Dome Environment Lighting & 360 Sky (Approaching Storm 4K)
    try {
      const hdrTexture = new HDRCubeTexture(
        '/approaching_storm_4k.hdr',
        this.scene,
        512,
        false,
        true,
        false,
        true
      );
      this.scene.environmentTexture = hdrTexture;
      this.scene.environmentIntensity = 0.62;

      const skybox = this.scene.createDefaultSkybox(hdrTexture, true, 2200, 0.03);
      if (skybox) {
        skybox.name = 'ApproachingStormSkybox';
        skybox.isPickable = false;
        skybox.position.set(110, 0, 230);
        skybox.infiniteDistance = true;
        skybox.receiveShadows = false;
      }
    } catch (e) {
      console.warn('HDRI environment fallback:', e);
    }

    // 2. Natural Ambient Sky & Turf Bounce Light
    const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 0.34;
    hemiLight.diffuse = new Color3(0.90, 0.95, 1.0);
    hemiLight.groundColor = new Color3(0.22, 0.30, 0.18);

    // 3. Golden-Hour Directional Sun Light
    const courseCenter = new Vector3(110, 4, 200);
    const lightDir = new Vector3(-0.42, -0.68, 0.60).normalize();
    const sun = new DirectionalLight('sunLight', lightDir, this.scene);
    sun.position = courseCenter.subtract(lightDir.scale(300));
    sun.intensity = 1.50;
    sun.diffuse = new Color3(1.0, 0.97, 0.90);
    this.sunLight = sun;

    // 4. Real Lighting-Generated AAA Soft-Edged Cascaded Shadows
    // Covers millimeter-scale close-ups (golf ball & tee markers) and 400m distant pine trees simultaneously!
    try {
      if (CascadedShadowGenerator.IsSupported) {
        const csm = new CascadedShadowGenerator(2048, sun);
        csm.numCascades = 4;
        csm.lambda = 0.88; // Concentrates Cascade 0 tightly around the camera/ball for millimeter precision
        csm.shadowMaxZ = 420;
        csm.stabilizeCascades = true;
        csm.autoCalcDepthBounds = false;
        csm.cascadeBlendPercentage = 0.10;
        csm.filteringQuality = CascadedShadowGenerator.QUALITY_HIGH;
        csm.penumbraDarkness = 0.20;
        csm.darkness = 0.20;
        csm.bias = 0.00004;
        csm.normalBias = 0.0; // Zero normal offset so the 4.27cm golf ball & tee markers cast crisp real shadows!
        this.shadowGenerator = csm;
      } else {
        sun.autoCalcShadowZBounds = false;
        sun.autoUpdateExtends = false;
        sun.orthoLeft = -180;
        sun.orthoRight = 180;
        sun.orthoTop = 240;
        sun.orthoBottom = -240;
        sun.shadowMinZ = 10;
        sun.shadowMaxZ = 650;

        const sg = new ShadowGenerator(4096, sun);
        sg.usePercentageCloserFiltering = true;
        sg.filteringQuality = ShadowGenerator.QUALITY_HIGH;
        sg.bias = 0.00008;
        sg.normalBias = 0.0001;
        sg.darkness = 0.22;
        this.shadowGenerator = sg;
      }
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
        m.name !== 'BunkerSandPhotoOverlay' &&
        m.name !== 'TeeBoxPhotoOverlay' &&
        m.name !== 'ProceduralBackdropMesh' &&
        m.name !== 'ApproachingStormSkybox' &&
        !m.name.startsWith('water_') &&
        m.name !== 'gridOverlay' &&
        m.name !== 'greenContourLineGrid' &&
        !m.name.startsWith('aim') &&
        !m.name.startsWith('ballToptracer') &&
        !m.name.startsWith('designerBrush') &&
        !m.name.startsWith('cup_') &&
        !m.name.startsWith('slopeBead') &&
        m.getTotalVertices() > 0
      ) {
        try {
          this.shadowGenerator.addShadowCaster(m, true);
        } catch {
          // ignore if already registered or unsupported
        }
      }
    }

    if (this.ball?.mesh) {
      try {
        this.shadowGenerator.addShadowCaster(this.ball.mesh, true);
      } catch {}
    }
  }

  public getWorldElevation(x: number, z: number): number {
    if (x >= 2 && x <= this.terrain.width - 2 && z >= 2 && z <= this.terrain.length - 2) {
      return this.terrain.getElevation(x, z);
    }
    const tElev = this.terrain.getElevation(x, z);
    const bElev = this.backdrop ? this.backdrop.getElevation(x, z) : 0;
    return Math.max(tElev, bElev);
  }

  private placeBallAtActiveTee() {
    const hole = this.courseManager.currentHole;
    const tee = hole.teePosition;
    const groundY = this.terrain.getElevation(tee.x, tee.z);
    // Seat ball directly on the exact terrain surface at BALL_RENDER_RADIUS (zero floating!)
    this.ball.setPosition(tee.x, groundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS, tee.z);

    const pin = hole.pinPosition;
    this.ball.setTargetPin(pin);

    // On dogleg holes, aim initial tee shot down the fairway toward the first dogleg landing waypoint
    const initialTarget = (hole.waypoints && hole.waypoints.length > 0) ? hole.waypoints[0] : pin;
    const aimDx = initialTarget.x - tee.x;
    const aimDz = initialTarget.z - tee.z;
    this.currentAimAzimuth = (Math.atan2(aimDx, aimDz) * 180) / Math.PI;
    this.swingEngine.aimAzimuthDeg = this.currentAimAzimuth;

    this.cameraCtrl.setMode('aim');
    this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);

    const dx = pin.x - tee.x;
    const dz = pin.z - tee.z;
    const distToPin = Math.sqrt(dx * dx + dz * dz);
    this.activeClub = getRecommendedClub(distToPin, false);
    this.swingEngine.setClub(this.activeClub);

    if (this.aimSystem) {
      this.aimSystem.targetDistanceMeters = Math.min(distToPin, this.activeClub.typicalCarryMeters);
      this.aimSystem.aimHeadingDeg = this.currentAimAzimuth;
      this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
      this.aimSystem.setVisible(this.activeMode === 'play');
    }
    if (this.ui) {
      this.ui.setSwingEnabled(true);
    }

    this.registerSceneryShadows();
    this.updateHUDDisplay();
  }

  private setupUI() {
    this.ui = new UIController({
      onModeToggle: (mode) => {
        this.activeMode = mode;
        if (mode === 'designer') {
          this.cameraCtrl.setMode('designer');
          if (this.aimSystem) this.aimSystem.setVisible(false);
          this.brushVisualizer.setVisible(true);
          this.updateBrushVisualizerConfig();
        } else {
          this.cameraCtrl.setMode('aim');
          this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
          this.brushVisualizer.setVisible(false);
          if (this.aimSystem) {
            this.aimSystem.setVisible(true);
            this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
          }
        }
      },
      onToolSelect: (tool) => {
        this.activeDesignerTool = tool;
        this.updateBrushVisualizerConfig();
      },
      onSculptModeSelect: (mode) => {
        this.activeSculptMode = mode;
        this.updateBrushVisualizerConfig();
      },
      onPresetSelect: (preset) => {
        this.activePreset = preset;
        this.activeDesignerTool = 'stamp';
        this.updateBrushVisualizerConfig();
      },
      onBrushRadiusChange: (radius) => {
        this.brushRadius = radius;
        this.updateBrushVisualizerConfig();
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
        if (h) {
          this.ui.updateHolesList(this.courseManager.courseData.holes, this.courseManager.currentHoleIndex);
          this.ui.showToast(`Hole ${h.number} (Par ${h.par}) created!`, 'success');
        } else {
          this.ui.showToast('Maximum of 9 holes reached for this course.', 'warning');
        }
      },
      onHoleParChange: (par) => {
        this.courseManager.currentHole.par = par;
        this.ui.updateHolesList(this.courseManager.courseData.holes, this.courseManager.currentHoleIndex);
        this.updateHUDDisplay();
      },
      onToggleGrid: () => {
        return this.toggle1mGrid();
      },
      onToggleGreenGrid: () => {
        return this.greenVisualizer.toggleGrid();
      },
      onToggleGreenDots: () => {
        return this.greenVisualizer.toggleDots();
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
          this.update1mGridMesh();
          this.placeBallAtActiveTee();
          this.ui.updateHolesList(this.courseManager.courseData.holes, this.courseManager.currentHoleIndex);
          this.updateHUDDisplay();
          this.registerSceneryShadows();
          this.ui.showToast('Course successfully imported!', 'success');
        } else {
          this.ui.showToast('Failed to import course. Invalid format.', 'penalty');
        }
      },
      onClubSelect: (club) => {
        this.activeClub = club;
        this.swingEngine.setClub(club);
        if (this.aimSystem) {
          const pin = this.courseManager.currentHole.pinPosition;
          const dx = pin.x - this.ball.position.x;
          const dz = pin.z - this.ball.position.z;
          const distToPin = Math.sqrt(dx * dx + dz * dz);
          this.aimSystem.targetDistanceMeters = Math.min(distToPin, club.typicalCarryMeters);
          this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
        }
        this.updateHUDDisplay();
      },
      onSwingAction: () => {
        if (this.activeMode !== 'play') return;
        if (this.ball.state === BallState.IN_FLIGHT || this.ball.state === BallState.ROLLING) return;
        this.swingEngine.handleActionClick();
      },
      onAimAdjust: (deltaDeg) => {
        if (this.activeMode !== 'play' || this.ball.state === BallState.IN_FLIGHT || this.ball.state === BallState.ROLLING) return;
        this.currentAimAzimuth += deltaDeg;
        this.swingEngine.aimAzimuthDeg = this.currentAimAzimuth;
        if (this.aimSystem) {
          this.aimSystem.aimHeadingDeg = this.currentAimAzimuth;
          this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
        }
        this.cameraCtrl.setAimHeading(this.ball.position, this.currentAimAzimuth);
        this.updateHUDDisplay();
      },
      onTargetDistanceAdjust: (deltaMeters) => {
        if (this.activeMode !== 'play' || this.ball.state === BallState.IN_FLIGHT || this.ball.state === BallState.ROLLING) return;
        if (this.aimSystem) {
          this.aimSystem.adjustDistance(deltaMeters);
          this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
          this.updateHUDDisplay();
        }
      },
      onCameraModeToggle: () => {
        const current = this.cameraCtrl.mode;
        if (current === 'aim') {
          this.cameraCtrl.setMode('scout');
          this.cameraCtrl.setScoutView(this.ball.position, this.courseManager.currentHole.pinPosition);
        } else if (current === 'scout') {
          this.cameraCtrl.setMode('green');
          this.cameraCtrl.focusOnPin(this.courseManager.currentHole.pinPosition);
        } else if (current === 'green') {
          this.cameraCtrl.setMode('designer');
        } else {
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
        if (this.aimSystem) {
          const pin = this.courseManager.currentHole.pinPosition;
          const dx = pin.x - this.ball.position.x;
          const dz = pin.z - this.ball.position.z;
          const distToPin = Math.sqrt(dx * dx + dz * dz);
          this.aimSystem.targetDistanceMeters = Math.min(distToPin, this.activeClub.typicalCarryMeters);
          this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
        }
        this.updateHUDDisplay();
      }
    });

    document.getElementById('btn-next-club')?.addEventListener('click', () => {
      const idx = GOLF_CLUBS.findIndex(c => c.id === this.activeClub.id);
      if (idx < GOLF_CLUBS.length - 1) {
        this.activeClub = GOLF_CLUBS[idx + 1];
        this.swingEngine.setClub(this.activeClub);
        if (this.aimSystem) {
          const pin = this.courseManager.currentHole.pinPosition;
          const dx = pin.x - this.ball.position.x;
          const dz = pin.z - this.ball.position.z;
          const distToPin = Math.sqrt(dx * dx + dz * dz);
          this.aimSystem.targetDistanceMeters = Math.min(distToPin, this.activeClub.typicalCarryMeters);
          this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
        }
        this.updateHUDDisplay();
      }
    });

    // Swing Engine hooks
    this.swingEngine.onUpdate = (progress, phase, lockedPower) => {
      this.ui.updateSwingMeter(progress, phase, lockedPower);
    };

    this.swingEngine.onSwingCancelled = (reason) => {
      this.ui.setSwingFeedbackText(reason, 'miss');
    };

    this.swingEngine.onShotExecute = (shot) => {
      this.courseManager.recordStroke(this.activeClub.category === 'putter');
      this.cameraCtrl.setMode('flight');
      if (this.aimSystem) {
        this.aimSystem.setVisible(false);
      }
      this.ui.setSwingEnabled(false);
      this.ball.launch(shot, this.courseManager.currentHole.pinPosition);

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
          this.ui.setSwingEnabled(true);
          if (this.aimSystem && this.activeMode === 'play') {
            const pin = this.courseManager.currentHole.pinPosition;
            const dx = pin.x - this.ball.position.x;
            const dz = pin.z - this.ball.position.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            this.currentAimAzimuth = (Math.atan2(dx, dz) * 180) / Math.PI;
            this.swingEngine.aimAzimuthDeg = this.currentAimAzimuth;
            this.activeClub = getRecommendedClub(dist, lie === SurfaceType.GREEN);
            this.swingEngine.setClub(this.activeClub);
            this.swingEngine.setLie(lie);
            this.aimSystem.targetDistanceMeters = Math.min(dist, this.activeClub.typicalCarryMeters);
            this.aimSystem.aimHeadingDeg = this.currentAimAzimuth;
            this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
            this.aimSystem.setVisible(true);
          }

          setTimeout(() => {
            if (this.ball.state !== BallState.AT_REST) return;

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

            this.updateHUDDisplay();
          }, 1800);
        }
      } else if (state === BallState.IN_WATER) {
        this.ui.showToast('Splash! Water hazard. 1 penalty stroke.', 'penalty');
        this.courseManager.recordStroke();
        const prevZ = Math.max(40, this.ball.position.z - 15);
        const dropY = this.terrain.getElevation(this.ball.position.x, prevZ) + GOLF_CONSTANTS.BALL_RENDER_RADIUS;
        this.ball.setPosition(this.ball.position.x, dropY, prevZ);
        this.cameraCtrl.setMode('aim');
        this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
        this.ui.setSwingEnabled(true);
        if (this.aimSystem) {
          this.aimSystem.setVisible(true);
          this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
        }
        this.updateHUDDisplay();
      }
    };

    this.ball.onHoleComplete = () => {
      if (this.aimSystem) {
        this.aimSystem.setVisible(false);
      }
      this.ui.setSwingEnabled(false);
      const score = this.courseManager.completeHole();
      const isLastHole = this.courseManager.currentHoleIndex >= this.courseManager.courseData.holes.length - 1;

      this.ui.showHoleCompleteModal(
        score,
        isLastHole,
        () => {
          if (!isLastHole) {
            this.courseManager.selectHole(this.courseManager.currentHoleIndex + 1);
            this.placeBallAtActiveTee();
          } else {
            this.courseManager.selectHole(0);
            this.placeBallAtActiveTee();
          }
        },
        () => {
          this.placeBallAtActiveTee();
        }
      );
      this.updateHUDDisplay();
    };

    this.ball.onOutOfBounds = () => {
      this.ui.showToast('⚠️ OUT OF BOUNDS! 1 penalty stroke. Ball returned to previous lie.', 'warning');
      this.courseManager.recordStroke();
      this.ball.setPosition(this.ball.shotOrigin.x, this.ball.shotOrigin.y, this.ball.shotOrigin.z);
      this.cameraCtrl.setMode('aim');
      this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
      this.ui.setSwingEnabled(true);
      if (this.aimSystem) {
        this.aimSystem.setVisible(true);
        this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
      }
      this.updateHUDDisplay();
    };

    this.ui.updateHolesList(this.courseManager.courseData.holes, this.courseManager.currentHoleIndex);
    this.updateHUDDisplay();
  }

  /**
   * 1m Grid Overlay that conforms to the sculpted terrain surface so it never cuts flat through bunkers
   */
  private update1mGridMesh() {
    if (!this.show1mGrid) return;
    if (!this.gridMesh) {
      this.gridMesh = new Mesh('gridOverlay', this.scene);
      this.gridMesh.isPickable = false;
      const mat = new StandardMaterial('gridMat', this.scene);
      mat.wireframe = true;
      mat.emissiveColor = new Color3(0.85, 0.95, 1.0);
      mat.disableLighting = true;
      mat.alpha = 0.16;
      this.gridMesh.material = mat;
    }

    const cols = this.terrain.cols;
    const rows = this.terrain.rows;
    const totalVerts = cols * rows;
    const positions = new Float32Array(totalVerts * 3);
    const indices = new Uint32Array(this.terrain.width * this.terrain.length * 6);

    for (let z = 0; z < rows; z++) {
      for (let x = 0; x < cols; x++) {
        const idx = z * cols + x;
        positions[idx * 3] = x;
        positions[idx * 3 + 1] = this.terrain.heights[idx] + 0.025;
        positions[idx * 3 + 2] = z;
      }
    }

    let iIdx = 0;
    for (let z = 0; z < this.terrain.length; z++) {
      for (let x = 0; x < this.terrain.width; x++) {
        const idx00 = z * cols + x;
        const idx10 = z * cols + (x + 1);
        const idx01 = (z + 1) * cols + x;
        const idx11 = (z + 1) * cols + (x + 1);
        indices[iIdx++] = idx00;
        indices[iIdx++] = idx01;
        indices[iIdx++] = idx10;
        indices[iIdx++] = idx10;
        indices[iIdx++] = idx01;
        indices[iIdx++] = idx11;
      }
    }

    const vd = new VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.applyToMesh(this.gridMesh, true);
  }

  private toggle1mGrid(): boolean {
    this.show1mGrid = !this.show1mGrid;
    if (this.show1mGrid) {
      this.update1mGridMesh();
      this.gridMesh?.setEnabled(true);
    } else {
      this.gridMesh?.setEnabled(false);
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

    if (this.aimSystem) {
      const targetPos = this.aimSystem.targetPosition;
      const elevDiff = targetPos.y - this.ball.position.y;
      this.ui.updateAimStats(this.aimSystem.targetDistanceMeters, elevDiff);
    }
  }

  private updateBrushVisualizerConfig() {
    if (!this.brushVisualizer) return;
    const presetDims = this.activePreset ? { width: this.activePreset.width, length: this.activePreset.length } : undefined;
    this.brushVisualizer.setConfig(
      this.activeDesignerTool,
      this.activeSculptMode,
      this.brushRadius,
      presetDims
    );
  }

  private setupPointerInteractions() {
    this.scene.onPointerObservable.add((pointerInfo) => {
      if (this.activeMode === 'designer') {
        if (pointerInfo.type === PointerEventTypes.POINTERMOVE) {
          const pick = this.scene.pick(
            this.scene.pointerX,
            this.scene.pointerY,
            (m) => m.name === 'GolfTerrain'
          );
          if (pick && pick.hit && pick.pickedPoint) {
            this.brushVisualizer.setVisible(true);
            this.brushVisualizer.updatePosition(pick.pickedPoint);

            // Continuous brush sculpting when holding Shift + dragging on terrain
            if (this.isPointerDownInDesigner && pointerInfo.event.shiftKey && this.activeDesignerTool === 'sculpt') {
              this.handleDesignerActionAtPoint(pick.pickedPoint);
            }
          } else {
            this.brushVisualizer.setVisible(false);
          }
        } else if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
          // Holding down LMB (0) orbits, MMB (1) pans, and RMB (2) pans & zooms.
          // A clean click without dragging (< 5px) on the terrain places/sculpts at the brush cursor!
          if (pointerInfo.event.button === 0 || pointerInfo.event.button === 2) {
            this.isPointerDownInDesigner = true;
            this.pointerDownX = pointerInfo.event.clientX;
            this.pointerDownY = pointerInfo.event.clientY;
          }
        } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
          if (this.isPointerDownInDesigner && (pointerInfo.event.button === 0 || pointerInfo.event.button === 2)) {
            this.isPointerDownInDesigner = false;
            const dragDist = Math.hypot(
              pointerInfo.event.clientX - this.pointerDownX,
              pointerInfo.event.clientY - this.pointerDownY
            );
            if (dragDist < 5.0) {
              const pick = this.scene.pick(
                this.scene.pointerX,
                this.scene.pointerY,
                (m) => m.name === 'GolfTerrain'
              );
              if (pick && pick.hit && pick.pickedPoint) {
                this.handleDesignerActionAtPoint(pick.pickedPoint);
              }
            }
          }
        }
      } else {
        if (this.brushVisualizer?.isVisible) {
          this.brushVisualizer.setVisible(false);
        }
      }
    });
  }

  private handleDesignerActionAtPoint(pickedPoint: Vector3) {
    const gx = Math.round(pickedPoint.x);
    const gz = Math.round(pickedPoint.z);

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
      this.update1mGridMesh();

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
        if (p.surfaceType === SurfaceType.WATER) {
          const rimElevation = this.terrain.getElevation(gx, gz);
          this.terrain.stampFeature(
            gx,
            gz,
            p.width,
            p.length,
            0,
            p.surfaceType,
            p.depthProfile ?? -2.2,
            p.lipHeight ?? 0
          );
          const waterMesh = this.scenery.createWaterPlane(gx, rimElevation, gz, p.width, p.length);
          if (waterMesh && this.shadowGenerator) {
            this.shadowGenerator.addShadowCaster(waterMesh, true);
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
        }

        this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
        if (p.surfaceType === SurfaceType.GREEN) {
          this.greenVisualizer.rebuildSlopeGrid();
        }
        this.update1mGridMesh();
        this.registerSceneryShadows();
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
      this.ball.setTargetPin(hole.pinPosition);
      this.registerSceneryShadows();
      this.updateHUDDisplay();
    }
  }

  private update(dt: number) {
    this.swingEngine.update(dt);

    if (this.ball.state === BallState.IN_FLIGHT || this.ball.state === BallState.ROLLING) {
      this.ui.updateShotStats(this.ball.carryDistance, this.ball.totalDistance, false);
    }

    if (this.cameraCtrl.mode === 'flight') {
      this.cameraCtrl.updateFlightCamera(this.ball.position, this.ball.curVelocity);
    }

    if (this.aimSystem && this.activeMode === 'play' && this.ball.state === BallState.AT_REST) {
      this.aimSystem.update(
        this.ball.position,
        this.activeClub,
        this.swingEngine.windSpeedMps,
        this.swingEngine.windHeadingDeg
      );
    }

    // Smooth camera navigation & ground clearance at all zoom levels
    this.cameraCtrl.enforceTerrainCollision((x, z) => this.getWorldElevation(x, z), dt);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const app = new FairwayStudioApp();
  (window as any).app = app;
  (window as any).__GOLF_APP__ = app;
  await app.start();
});
