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
  ShadowGenerator,
  HDRCubeTexture
} from '@babylonjs/core';
import '@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader.js';

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
  private pointerDownClientX = 0;
  private pointerDownClientY = 0;

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

    // 8. AAA Aim System (Target beacon & dispersion ring)
    this.aimSystem = new AimSystem(this.scene, this.terrain);

    // 9. Interactive 3D Circular Brush Visualizer for Course Designer
    this.brushVisualizer = new DesignerBrushVisualizer(this.scene, this.terrain);

    // 10. Setup UI & Event Handlers (must be initialized before placeBallAtActiveTee)
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
    // 1. HDRI Dome Environment Lighting & 360 Sky (Misty Pines 4K)
    try {
      const hdrTexture = new HDRCubeTexture(
        '/misty_pines_4k.hdr',
        this.scene,
        512,
        false,
        true,
        false,
        true
      );
      this.scene.environmentTexture = hdrTexture;
      this.scene.environmentIntensity = 0.55;

      const skybox = this.scene.createDefaultSkybox(hdrTexture, true, 2200, 0.05);
      if (skybox) {
        skybox.name = 'MistyPinesSkybox';
        skybox.isPickable = false;
        skybox.position.set(110, 0, 230);
        skybox.infiniteDistance = true;
        skybox.receiveShadows = false;
      }
    } catch (e) {
      console.warn('HDRI environment fallback:', e);
    }

    // 2. Ambient Sky & Ground light
    const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 0.32;
    hemiLight.diffuse = new Color3(0.90, 0.95, 1.0);
    hemiLight.groundColor = new Color3(0.20, 0.28, 0.16);

    // 3. Warm Sun Directional Light with optimal casting angle across course
    const courseCenter = new Vector3(110, 8, 210);
    const lightDir = new Vector3(-0.35, -0.72, 0.59).normalize();
    const sun = new DirectionalLight('sunLight', lightDir, this.scene);
    sun.position = courseCenter.subtract(lightDir.scale(320));
    sun.intensity = 1.50; // Balanced sun lighting avoiding blowout
    sun.diffuse = new Color3(1.0, 0.97, 0.90); // Golden hour sun

    // Precise orthographic shadow bounds focused on active golf hole (220m x 460m)
    sun.autoCalcShadowZBounds = true;
    sun.autoUpdateExtends = false;
    sun.orthoLeft = -220;
    sun.orthoRight = 220;
    sun.orthoTop = 270;
    sun.orthoBottom = -270;
    sun.shadowMinZ = 20;
    sun.shadowMaxZ = 720;

    // High quality soft PCF shadows (optimized)
    try {
      this.shadowGenerator = new ShadowGenerator(2048, sun);
      this.shadowGenerator.usePercentageCloserFiltering = true;
      this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH;
      this.shadowGenerator.bias = 0.0004;
      this.shadowGenerator.normalBias = 0.008;
      this.shadowGenerator.darkness = 0.20; // Crisp, rich, visible soft shadows across the hole
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
        m.name !== 'MistyPinesSkybox' &&
        !m.name.startsWith('water_') &&
        m.name !== 'gridOverlay' &&
        m.name !== 'greenContourLineGrid' &&
        !m.name.startsWith('aim') &&
        !m.name.startsWith('trajectory') &&
        !m.name.startsWith('designerBrush') &&
        m.name !== 'ballContactShadow' &&
        !m.name.includes('_shadow_') &&
        m.getTotalVertices() > 0
      ) {
        try {
          this.shadowGenerator.addShadowCaster(m, true);
        } catch {
          // ignore mesh if unsupported
        }
      }
    }

    if (this.ball?.mesh) {
      try {
        this.shadowGenerator.addShadowCaster(this.ball.mesh, true);
      } catch {}
    }
  }

  private placeBallAtActiveTee() {
    const tee = this.courseManager.currentHole.teePosition;
    const groundY = this.terrain.getElevation(tee.x, tee.z);
    this.ball.setPosition(tee.x, groundY + GOLF_CONSTANTS.BALL_RADIUS + 0.05, tee.z);

    // Aim directly at pin & set target pin for ball cup detection
    const pin = this.courseManager.currentHole.pinPosition;
    this.ball.setTargetPin(pin);
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

    // Update AAA Aim System target beacon and flight prediction arc
    if (this.aimSystem) {
      this.aimSystem.targetDistanceMeters = Math.min(distToPin, this.activeClub.typicalCarryMeters);
      this.aimSystem.aimHeadingDeg = this.currentAimAzimuth;
      this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
      this.aimSystem.setVisible(this.activeMode === 'play');
    }
    if (this.ui) {
      this.ui.setSwingEnabled(true);
    }

    // Refresh shadow casters whenever hole visuals or ball moves
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
          // Re-enable swing button and aim beacon after shot comes to complete rest
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

          // Hold TV broadcast follow angle for 1.8s so player can admire their shot without abrupt zooming
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
        this.ball.setPosition(this.ball.position.x, this.terrain.getElevation(this.ball.position.x, prevZ) + 0.1, prevZ);
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
          } else {
            this.brushVisualizer.setVisible(false);
          }

          if (this.isPointerDown && this.activeDesignerTool === 'sculpt') {
            this.handleDesignerClick(pointerInfo);
          }
        } else if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
          // Left-click (button 0): cleanly triggers placement or sculpting.
          // Right-click (button 2): camera drag/orbit without modifying terrain!
          if (pointerInfo.event.button === 0) {
            this.isPointerDown = true;
            this.handleDesignerClick(pointerInfo);
          }
        } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
          if (pointerInfo.event.button === 0) {
            this.isPointerDown = false;
          }
        }
      } else {
        // In Play Mode, hide the designer brush cursor
        if (this.brushVisualizer?.isVisible) {
          this.brushVisualizer.setVisible(false);
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

    // Update Aim System & flight prediction arc when player is aiming at rest
    if (this.aimSystem && this.activeMode === 'play' && this.ball.state === BallState.AT_REST) {
      this.aimSystem.update(
        this.ball.position,
        this.activeClub,
        this.swingEngine.windSpeedMps,
        this.swingEngine.windHeadingDeg
      );
    }

    // Strictly enforce terrain clearance so camera never penetrates underground
    this.cameraCtrl.enforceTerrainCollision((x, z) => this.terrain.getElevation(x, z));
  }
}

// Bootstrap application on page load
window.addEventListener('DOMContentLoaded', async () => {
  const app = new FairwayStudioApp();
  (window as any).app = app;
  (window as any).__GOLF_APP__ = app;
  await app.start();
});
