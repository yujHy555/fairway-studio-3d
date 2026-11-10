import {
  Engine,
  Scene,
  Camera,
  Vector3,
  Color3,
  Color4,
  HemisphericLight,
  DirectionalLight,
  PointerEventTypes,
  Mesh,
  AbstractMesh,
  Node,
  VertexData,
  StandardMaterial,
  ShadowGenerator,
  CascadedShadowGenerator,
  HDRCubeTexture,
  GizmoManager,
  HighlightLayer,
  MeshBuilder,
  Quaternion,
  Texture,
  BoundingInfo
} from '@babylonjs/core';
import '@babylonjs/core/Materials/Textures/Loaders/hdrTextureLoader.js';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent.js';

import './style.css';
import { GOLF_CONSTANTS, SurfaceType } from './core/Constants';
import { PresetFeature, ClubSpec } from './core/Types';
import { HavokManager } from './physics/HavokManager';
import { TerrainGrid, StampedFeatureRecord } from './terrain/TerrainGrid';
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
import { soundFx } from './core/Audio';

interface DesignerHistoryStep {
  description: string;
  stampedFeatures: StampedFeatureRecord[];
  selectedFeatureIndex: number;
  baseHeights: Float32Array;
  sceneryMeshes: {
    name: string;
    pos: [number, number, number];
    rot: [number, number, number];
    scale: [number, number, number];
  }[];
  holeState: {
    pinPos: [number, number, number];
    teePos: [number, number, number];
    teeRotY: number;
  };
}

class FairwayStudioApp {
  private canvas: HTMLCanvasElement;
  private engine: Engine;
  private scene: Scene;

  private havok: HavokManager;
  private terrain!: TerrainGrid;
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
  private activeDesignerTool: 'select' | 'sculpt' | 'stamp' | 'set_tee' | 'set_pin' | 'erase' = 'select';
  private activeSculptMode: 'raise' | 'lower' | 'flatten' | 'smooth' = 'raise';
  private brushRadius = 12;
  private brushStrength = 0.5;
  private targetSurface: SurfaceType = SurfaceType.FAIRWAY;
  private activePreset: PresetFeature | null = null;
  private isPointerDownInDesigner = false;
  private pointerDownX = 0;
  private pointerDownY = 0;

  // Gizmo & Developer Zone
  private gizmoManager!: GizmoManager;
  private selectedMesh: Mesh | null = null;
  private activeGizmoMode: 'none' | 'position' | 'rotation' | 'scale' = 'none';
  private selectionHighlightLayer!: HighlightLayer;
  private selectedFeatureIndex: number = -1;
  private featureGizmoProxy: Mesh | null = null;
  private featureDrapeMesh: Mesh | null = null;
  private featureDrapeMaterial: StandardMaterial | null = null;
  private featureSurfaceFillMesh: Mesh | null = null;
  private featureSurfaceFillMaterial: StandardMaterial | null = null;
  private physicsSyncTimeout: number | null = null;
  private isGizmoDragging = false;
  private hookedGizmoBehaviors = new WeakSet<any>();
  private gizmoRaf: number | null = null;

  // History & Undo/Redo System
  private historyUndoStack: DesignerHistoryStep[] = [];
  private historyRedoStack: DesignerHistoryStep[] = [];
  private isHistoryNavigating = false;
  private pendingHistorySnapshot: DesignerHistoryStep | null = null;
  public isInitialized = false;

  // 1m Grid mesh conforming to terrain surface
  private gridMesh: Mesh | null = null;
  private show1mGrid = false;
  private wasSettledOnGreen = false;
  private autoEnabledGreenOverlays = false;

  // Play state
  private activeClub: ClubSpec = GOLF_CLUBS[0];
  private currentAimAzimuth = 0; // degrees

  constructor() {
    this.canvas = document.getElementById('renderCanvas') as HTMLCanvasElement;
    this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    // Cap hardware scaling to 1.5x DPR so 1440p/4K high-DPI screens maintain locked 60 FPS
    const dpr = window.devicePixelRatio || 1;
    this.engine.setHardwareScalingLevel(1 / Math.min(1.5, dpr));
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.45, 0.70, 0.88, 1.0);
    // Skip redundant CPU picking on mouse move across 40k+ triangles
    this.scene.skipPointerMovePicking = true;

    this.havok = new HavokManager(this.scene);
  }

  public async start() {
    this.updatePreloader(10, 'Initializing Camera & Sun Lighting...');

    // 1. Setup Camera first so CascadedShadowGenerator can bind to activeCamera
    this.cameraCtrl = new CameraController(this.scene, this.canvas);
    this.scene.activeCamera = this.cameraCtrl.camera;

    // 2. Setup Sun & HDRI Environment Lighting with Real AAA Soft Shadows
    await this.setupLighting();

    this.updatePreloader(25, 'Loading Havok Physics Engine...');

    // 3. Initialize Havok Physics
    await this.havok.initialize();

    this.updatePreloader(45, 'Generating Championship Fairway & Sculpted Bunkers...');

    // 4. Initialize Main Hole Mesh (outer land backdrop removed per user request)
    this.terrain = new TerrainGrid(this.scene);
    this.terrain.buildMesh();
    await this.terrain.initHighResPhotoPatterns();
    this.havok.updateTerrainCollision(this.terrain.terrainMesh!);

    if (this.terrain.terrainMesh) {
      this.terrain.terrainMesh.receiveShadows = true;
    }

    this.updatePreloader(65, 'Loading 3D Pines, Hero Trees & Coastal Cliffs...');

    // 5. Initialize Realistic Scenery (including pine_tree_medium_01_01.glb) & Course
    this.scenery = new SceneryFactory(this.scene);
    await this.scenery.loadTreeModels();
    this.courseManager = new CourseManager(this.terrain, this.scenery);

    this.updatePreloader(85, 'Placing Flags, Aim Chevrons & Green Contours...');

    // 6. Green Contours
    this.greenVisualizer = new GreenContourVisualizer(this.scene, this.terrain);

    // 7. Dimpled Regulation Golf Ball & Swing Engine
    this.ball = new Ball(this.scene, this.terrain);
    this.ball.setTreeColliders(this.scenery.treeColliders);
    this.swingEngine = new SwingEngine(this.activeClub);

    // 8. Clean 3D Aim Chevron Indicator with real-time ground shadow
    this.aimSystem = new AimSystem(this.scene, this.terrain, this.shadowGenerator);

    // 9. Interactive 3D Circular Brush Visualizer for Course Designer
    this.brushVisualizer = new DesignerBrushVisualizer(this.scene, this.terrain);

    // 10. Setup UI & Event Handlers
    this.setupUI();
    this.ui.showMainMenu();

    // 10b. Setup Transform Gizmos and Electric Blue Selection Glow
    this.selectionHighlightLayer = new HighlightLayer('selectionHighlight', this.scene, {
      isStroke: true,
      blurHorizontalSize: 1.0,
      blurVerticalSize: 1.0
    });
    this.setupGizmoManager();

    // Register all course scenery & golf ball to cast real lighting shadows
    this.registerSceneryShadows();

    // Place ball flush on Hole 1 Tee
    this.placeBallAtActiveTee();

    // 11. Input & Pointer Interactions
    this.setupPointerInteractions();

    // Enforce zero-lag terrain collision right after camera.update() and BEFORE customRenderTargets/CSM
    // so shadow cascade frustum matrices and main camera view are locked to the exact same frame state
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this.cameraCtrl.enforceTerrainCollision((x, z) => this.getWorldElevation(x, z), dt);
    });

    // Update billboarded Toptracer ribbon to face the exact finalized camera position of this frame
    this.scene.onBeforeCameraRenderObservable.add(() => {
      this.ball.updateTracerForCamera(this.cameraCtrl.camera.position);
    });

    this.updatePreloader(95, 'Compiling Shaders & Level Geometry...');
    await this.scene.whenReadyAsync();

    this.updatePreloader(100, 'Teeing Off...');

    // 12. Start Render Loop
    let framesRendered = 0;
    this.engine.runRenderLoop(() => {
      const dt = this.engine.getDeltaTime() / 1000;
      this.update(dt);
      this.scene.render();
      framesRendered++;
      if (framesRendered === 3) {
        this.dismissPreloader();
      }
    });

    window.addEventListener('resize', () => {
      const dpr = window.devicePixelRatio || 1;
      this.engine.setHardwareScalingLevel(1 / Math.min(1.5, dpr));
      this.engine.resize();
    });
    this.isInitialized = true;
  }

  private updatePreloader(percent: number, status: string) {
    const bar = document.getElementById('preloader-bar');
    const percentEl = document.getElementById('preloader-percent');
    const statusEl = document.getElementById('preloader-status');
    if (bar) bar.style.width = `${percent}%`;
    if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
    if (statusEl) statusEl.textContent = status;
  }

  private dismissPreloader() {
    const preloader = document.getElementById('game-preloader');
    if (preloader) {
      preloader.classList.add('fade-out');
    }
  }

  private async setupLighting(): Promise<void> {
    // 1. HDRI Dome Environment Lighting & 360 Sky (Approaching Storm 4K)
    await new Promise<void>((resolve) => {
      let resolved = false;
      const finish = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      const timer = setTimeout(finish, 3500);

      try {
        const hdrTexture = new HDRCubeTexture(
          '/approaching_storm_4k.hdr',
          this.scene,
          512,
          false,
          true,
          false,
          true,
          () => {
            clearTimeout(timer);
            finish();
          },
          (msg, err) => {
            console.warn('HDRI load issue, continuing:', msg, err);
            clearTimeout(timer);
            finish();
          }
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
        clearTimeout(timer);
        finish();
      }
    });

    // 2. Natural Ambient Sky & Turf Bounce Light
    const hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 0.44;
    hemiLight.diffuse = new Color3(0.92, 0.96, 1.0);
    hemiLight.groundColor = new Color3(0.36, 0.42, 0.32);

    // 3. Golden-Hour Directional Sun Light (stationary course anchor for rock-solid cascades)
    const courseCenter = new Vector3(110, 4, 210);
    const lightDir = new Vector3(-0.42, -0.68, 0.60).normalize();
    const sun = new DirectionalLight('sunLight', lightDir, this.scene);
    sun.position = courseCenter.subtract(lightDir.scale(550));
    sun.intensity = 1.50;
    sun.diffuse = new Color3(1.0, 0.97, 0.90);
    sun.specular = new Color3(0.40, 0.38, 0.35);
    this.sunLight = sun;

    // 4. Real Lighting-Generated AAA Soft-Edged Cascaded Shadows
    // 4 cascades cover close-ups (chevron, golf ball, ducks) and 480m distant trees/cliffs cleanly without flicker
    try {
      if (CascadedShadowGenerator.IsSupported) {
        const maxTexSize = this.engine.getCaps().maxTextureSize || 2048;
        const csmMapSize = maxTexSize >= 3072 ? 3072 : 2048;
        const csm = new CascadedShadowGenerator(csmMapSize, sun);
        csm.numCascades = 4;
        csm.lambda = 0.80; // Balances ~24m close/mid-flight C0 coverage with much sharper C1-C3 distant resolution
        csm.shadowMaxZ = 480; // Covers entire hole & amphitheater treeline cleanly without wasting C3 resolution past the horizon
        csm.stabilizeCascades = true; // Locks cascade bounds to world-space texel grid
        csm.depthClamp = true; // Prevents near/far plane depth clipping flicker
        csm.autoCalcDepthBounds = false;
        csm.cascadeBlendPercentage = 0.14; // Wide smooth transition band prevents cascade popping at 60m/s flight speed
        csm.frustumEdgeFalloff = 0.10; // Smooth soft falloff at 480m horizon
        csm.filteringQuality = CascadedShadowGenerator.QUALITY_HIGH; // 5x5 bicubic PCF eliminates distant foliage shimmer
        csm.penumbraDarkness = 0.20;
        csm.darkness = 0.20;
        csm.bias = 0.00032; // Eliminates distant terrain/cliff slope acne while keeping chevron & ball contact crisp
        csm.normalBias = 0.004; // 4mm surface-normal offset stops undulating slope shimmer on cliffs/hills without thinning flags
        csm.transparencyShadow = true; // Casts real alpha-cutout shadows from foliage

        // Lock each cascade's bounding sphere radius analytically from fixed camera optics so floating-point noise in
        // Matrix.Invert during aerial ball flight or camera orbit NEVER oscillates orthographic texel scale
        const origComputeCascadeFrustum = (csm as any)._computeCascadeFrustum.bind(csm);
        (csm as any)._computeCascadeFrustum = (cascadeIndex: number) => {
          origComputeCascadeFrustum(cascadeIndex);
          if (!csm.stabilizeCascades) return;
          const cam = (csm as any)._getCamera?.() || this.scene.activeCamera;
          const cascade = (csm as any)._cascades?.[cascadeIndex];
          if (!cam || !cascade) return;
          const near = cam.minZ;
          const far = cam.maxZ || csm.shadowMaxZ;
          const z0 = near + cascade.prevBreakDistance * (far - near);
          const z1 = near + cascade.breakDistance * (far - near);
          const aspect = Math.max(0.1, this.engine.getAspectRatio(cam));
          const halfTan = Math.tan(cam.fov * 0.5);
          const tanV = cam.fovMode === Camera.FOVMODE_VERTICAL_FIXED ? halfTan : halfTan / aspect;
          const tanH = cam.fovMode === Camera.FOVMODE_VERTICAL_FIXED ? halfTan * aspect : halfTan;
          const exactRadius = Math.hypot(z1 * tanH, z1 * tanV, (z1 - z0) * 0.5);
          const lockedRadius = Math.ceil(exactRadius * 16) / 16;
          (csm as any)._cascadeMaxExtents[cascadeIndex].copyFromFloats(lockedRadius, lockedRadius, lockedRadius);
          (csm as any)._cascadeMinExtents[cascadeIndex].copyFromFloats(-lockedRadius, -lockedRadius, -lockedRadius);
        };

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
        sg.transparencyShadow = true;
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
        m.name !== 'BunkerLipWallOverlay' &&
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

    if (this.shadowGenerator instanceof CascadedShadowGenerator) {
      // Lock a static caster envelope covering the full course & high ball flight arc (Y up to 80m):
      // Prevents per-frame shadow depth-range resizing/shimmer while maximizing depth precision
      this.shadowGenerator.freezeShadowCastersBoundingInfo = true;
      this.shadowGenerator.shadowCastersBoundingInfo = new BoundingInfo(
        new Vector3(-40, -15, -40),
        new Vector3(260, 80, 500)
      );
    }
  }

  public getWorldElevation(x: number, z: number): number {
    return this.terrain.getElevation(x, z);
  }

  private placeBallAtActiveTee() {
    // Dynamic wind factor randomized on each hole start or reset
    this.swingEngine.randomizeWind();

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

    if (this.greenVisualizer && this.autoEnabledGreenOverlays) {
      this.greenVisualizer.setVisible(false);
      this.ui?.setGreenToggleStates(false, false);
    }
    this.wasSettledOnGreen = false;
    this.autoEnabledGreenOverlays = false;

    this.registerSceneryShadows();
    this.updateHUDDisplay();
  }

  private setupUI() {
    this.ui = new UIController({
      onMainMenuPlay: () => {
        this.ui.hideMainMenu();
        if (this.courseManager.currentHoleIndex !== 0) {
          this.courseManager.selectHole(0);
        }
        this.ui.setMode('play');
        this.placeBallAtActiveTee();
        this.cameraCtrl.setMode('aim');
        this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
        this.updateHUDDisplay();
      },
      onMainMenuDesigner: () => {
        this.ui.hideMainMenu();
        this.ui.setMode('designer');
      },
      onModeToggle: (mode) => {
        this.activeMode = mode;
        if (mode === 'designer') {
          this.cameraCtrl.setMode('designer');
          if (this.aimSystem) this.aimSystem.setVisible(false);
          this.activeDesignerTool = 'select';
          this.brushVisualizer.setVisible(false);
          this.ui.setDesignerTool('select');
          this.updateDevStats();
          this.ui.updateFeatureList(this.terrain.stampedFeatures, this.selectedFeatureIndex);
          if (this.selectedFeatureIndex < 0 && !this.selectedMesh) {
            this.ui.showGroundPbrInspector(this.terrain.getGroundUvSettings());
          }
        } else {
          this.selectCourseFeature(-1);
          this.selectMesh(null);
          this.setGizmoMode('none');
          if (this.featureGizmoProxy) {
            this.featureGizmoProxy.setEnabled(false);
          }
          if (this.featureDrapeMesh) {
            this.featureDrapeMesh.dispose();
            this.featureDrapeMesh = null;
          }
          if (this.featureSurfaceFillMesh) {
            this.featureSurfaceFillMesh.dispose();
            this.featureSurfaceFillMesh = null;
          }
          if (this.selectionHighlightLayer) this.selectionHighlightLayer.removeAllMeshes();
          if (this.courseManager) {
            this.courseManager.refreshSceneryForFeatures();
            this.registerSceneryShadows();
          }
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
        if (tool === 'erase' || tool === 'select') {
          this.brushVisualizer.setVisible(false);
        } else {
          this.updateBrushVisualizerConfig();
        }
      },
      onGizmoModeChange: (mode) => {
        this.setGizmoMode(mode);
      },
      onDeleteSelectedObject: () => {
        this.deleteSelectedMesh();
      },
      onPushToPlay: () => {
        this.pushChangesToPlay();
      },
      onSaveDefaultHole: () => {
        this.saveDefaultHole();
      },
      onResetFactoryLayout: () => {
        this.resetFactoryLayout();
      },
      onSelectGroundLayer: () => {
        this.selectGroundLayer();
      },
      onFrameSelectedObject: () => {
        this.frameSelectedObject();
      },
      onSelectFeature: (idx) => {
        this.selectCourseFeature(idx);
      },
      onFeatureMaterialChange: (idx, settings) => {
        this.terrain.updateFeatureMaterial(idx, settings);
      },
      onResetFeatureMaterial: (idx) => {
        this.terrain.resetFeatureMaterial(idx);
        const feat = this.terrain.stampedFeatures[idx];
        if (feat) {
          this.ui.updateDevSelectedFeatureMaterial(feat, feat.materialSettings || this.terrain.getDefaultFeatureMaterial(feat.surfaceType));
        }
      },
      onFeatureTextureUpload: async (idx, slot, dataUrl, fileName) => {
        await this.terrain.setFeatureTexture(idx, slot, dataUrl, fileName);
        this.ui.showToast(`Updated ${slot.toUpperCase()} map for feature #${idx}`);
      },
      onObjectTextureUpload: (slot, dataUrl, fileName) => {
        if (!this.selectedMesh || this.selectedMesh === this.featureGizmoProxy) return;
        const mats = this.getUniqueMaterialsForMesh(this.selectedMesh);
        for (const mat of mats) {
          const curUS = (mat as any)._uScale ?? 1.0;
          const curVS = (mat as any)._vScale ?? 1.0;
          const curUO = (mat as any)._uOffset ?? 0.0;
          const curVO = (mat as any)._vOffset ?? 0.0;
          if (slot === 'color') {
            const tex = new Texture(dataUrl, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
            tex.name = fileName;
            tex.uScale = curUS;
            tex.vScale = curVS;
            tex.uOffset = curUO;
            tex.vOffset = curVO;
            mat.diffuseTexture = tex;
            (mat as any)._customColorUrl = dataUrl;
            (mat as any)._customColorName = fileName;
          } else if (slot === 'roughness') {
            const tex = new Texture(dataUrl, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
            tex.name = fileName;
            tex.uScale = curUS;
            tex.vScale = curVS;
            tex.uOffset = curUO;
            tex.vOffset = curVO;
            (mat as any)._origSpecularTex = tex;
            (mat as any)._userEnableRoughness = true;
            (mat as any)._customRoughUrl = dataUrl;
            (mat as any)._customRoughName = fileName;
            this.applyObjectSpecularState(mat);
          } else if (slot === 'normal') {
            const tex = new Texture(dataUrl, this.scene, false, false, Texture.TRILINEAR_SAMPLINGMODE);
            tex.name = fileName;
            tex.uScale = curUS;
            tex.vScale = curVS;
            tex.uOffset = curUO;
            tex.vOffset = curVO;
            mat.bumpTexture = tex;
            (mat as any)._customNormalUrl = dataUrl;
            (mat as any)._customNormalName = fileName;
          }
        }
        const info = this.getObjectMaterialInfo(this.selectedMesh);
        this.ui.updateDevSelectedObjectMaterial(info);
        this.ui.showToast(`Updated ${slot.toUpperCase()} map on ${this.selectedMesh.name}`);
      },
      onGroundTextureUpload: async (slot, dataUrl, fileName) => {
        await this.terrain.setGroundTexture(slot, dataUrl, fileName);
        this.ui.showToast(`Updated Ground PBR ${slot.toUpperCase()} map`);
      },
      onObjectMaterialChange: (settings) => {
        if (!this.selectedMesh || this.selectedMesh === this.featureGizmoProxy) return;
        this.applyObjectMaterialSettings(this.selectedMesh, settings);
      },
      onResetObjectMaterial: () => {
        if (!this.selectedMesh || this.selectedMesh === this.featureGizmoProxy) return;
        this.resetObjectMaterial(this.selectedMesh);
        const info = this.getObjectMaterialInfo(this.selectedMesh);
        this.ui.updateDevSelectedObjectMaterial(info);
      },
      onUndo: () => {
        this.undo();
      },
      onRedo: () => {
        this.redo();
      },
      onMoveFeature: (idx, x, z, isLive) => {
        if (isLive && !this.pendingHistorySnapshot && idx >= 0) {
          const f = this.terrain.stampedFeatures[idx];
          this.pendingHistorySnapshot = this.captureHistorySnapshot('Move ' + (f?.name || f?.surfaceType || 'Feature'));
        }
        this.moveCourseFeature(idx, x, z, isLive);
        if (!isLive && this.pendingHistorySnapshot) {
          this.recordHistoryStep(this.pendingHistorySnapshot.description, this.pendingHistorySnapshot);
          this.pendingHistorySnapshot = null;
        }
      },
      onRotateFeature: (idx, rad, isLive) => {
        if (isLive && !this.pendingHistorySnapshot && idx >= 0) {
          const f = this.terrain.stampedFeatures[idx];
          this.pendingHistorySnapshot = this.captureHistorySnapshot('Rotate ' + (f?.name || f?.surfaceType || 'Feature'));
        }
        this.rotateCourseFeature(idx, rad, isLive);
        if (!isLive && this.pendingHistorySnapshot) {
          this.recordHistoryStep(this.pendingHistorySnapshot.description, this.pendingHistorySnapshot);
          this.pendingHistorySnapshot = null;
        }
      },
      onGroundUvChange: (settings) => {
        this.terrain.setGroundUvSettings(settings);
      },
      onResetGroundMaterial: () => {
        this.terrain.resetGroundMaterial();
        this.ui.showGroundPbrInspector(this.terrain.getGroundUvSettings());
        this.ui.showToast('Reset Main Ground to Grass007 PBR defaults 🌱', 'info', 1800);
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
        this.autoEnabledGreenOverlays = false;
        return this.greenVisualizer.toggleGrid();
      },
      onToggleGreenDots: () => {
        this.autoEnabledGreenOverlays = false;
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
        if (this.aimSystem) {
          this.aimSystem.hideAimArrow();
        }
        this.swingEngine.handleActionClick();
      },
      onAimAdjust: (deltaDeg) => {
        if (this.activeMode !== 'play' || this.ball.state === BallState.IN_FLIGHT || this.ball.state === BallState.ROLLING) return;
        this.currentAimAzimuth += deltaDeg;
        this.swingEngine.aimAzimuthDeg = this.currentAimAzimuth;
        if (this.aimSystem) {
          this.aimSystem.aimHeadingDeg = this.currentAimAzimuth;
          this.aimSystem.showAimArrow(this.ball.position);
          this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
        }
        soundFx.playAimTick();
        // Adjusting arrow heading does NOT rotate or snap camera out of view
        this.updateHUDDisplay();
      },
      onShotShapeChange: (shape) => {
        this.swingEngine.setShotShape(shape);
        soundFx.playAimTick();
        this.ui.showToast(`Shot Shape: ${shape.toUpperCase()}`, 'info', 1000);
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
      onFocusBall: () => {
        // Strictly only when the ball has settled/is stationary
        if (this.activeMode !== 'play') return;
        if (this.ball.state !== BallState.AIMING && this.ball.state !== BallState.AT_REST) return;

        const hole = this.courseManager.currentHole;
        const pin = hole.pinPosition;
        const dxPin = pin.x - this.ball.position.x;
        const dzPin = pin.z - this.ball.position.z;
        const distToPin = Math.hypot(dxPin, dzPin);

        // If on the tee box of a dogleg hole, face the initial dogleg landing waypoint; otherwise face the pin
        let targetPt = pin;
        if (this.ball.currentSurface === SurfaceType.TEE && hole.waypoints && hole.waypoints.length > 0 && distToPin > 220) {
          targetPt = hole.waypoints[0];
        }

        const dx = targetPt.x - this.ball.position.x;
        const dz = targetPt.z - this.ball.position.z;
        this.currentAimAzimuth = (Math.atan2(dx, dz) * 180) / Math.PI;
        this.swingEngine.aimAzimuthDeg = this.currentAimAzimuth;

        if (this.aimSystem) {
          this.aimSystem.aimHeadingDeg = this.currentAimAzimuth;
          this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
        }

        this.cameraCtrl.setMode('aim');
        this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
        this.ball.triggerReadyFlashIndicator();
        this.updateHUDDisplay();
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
      // Smooth slick transition out for Driver/Putter card as ball is hit
      this.ui.updateClubCard(this.activeClub.id, true);
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
          const pin = this.courseManager.currentHole.pinPosition;
          const dx = pin.x - this.ball.position.x;
          const dz = pin.z - this.ball.position.z;
          const dist = Math.hypot(dx, dz);
          this.currentAimAzimuth = (Math.atan2(dx, dz) * 180) / Math.PI;
          this.swingEngine.aimAzimuthDeg = this.currentAimAzimuth;

          const isGreen = (lie === SurfaceType.GREEN || this.ball.currentSurface === SurfaceType.GREEN);
          this.activeClub = getRecommendedClub(dist, isGreen);
          this.swingEngine.setClub(this.activeClub);
          this.swingEngine.setLie(this.ball.currentSurface);

          // Prompt and smooth 450ms settle transition so player is never stuck waiting
          setTimeout(() => {
            if (this.ball.state !== BallState.AT_REST && this.ball.state !== BallState.AIMING) return;

            const onPuttingGreen = (this.ball.currentSurface === SurfaceType.GREEN);
            this.cameraCtrl.setMode(onPuttingGreen ? 'green' : 'aim');

            // In BOTH green/putting and regular aim modes: snap camera right behind the ball aiming at the cup!
            this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);

            // Re-arm ball for next shot/putt and trigger the 3-flash ready indicator
            this.ball.state = BallState.AIMING;
            this.ball.triggerReadyFlashIndicator();

            this.swingEngine.reset();
            this.ui.setSwingEnabled(true);

            if (this.aimSystem && this.activeMode === 'play') {
              this.aimSystem.targetDistanceMeters = Math.min(dist, this.activeClub.typicalCarryMeters);
              this.aimSystem.aimHeadingDeg = this.currentAimAzimuth;
              this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
              this.aimSystem.setVisible(true);
            }

            this.updateHUDDisplay();
          }, 450);
        }
      } else if (state === BallState.IN_WATER) {
        this.courseManager.recordStroke();
        this.ui.showToast('💦 WATER HAZARD! 1 Penalty Stroke — Dropping at point of entry.', 'penalty', 4500);
        this.ui.setSwingEnabled(false);
        if (this.aimSystem) this.aimSystem.setVisible(false);

        // Find nearest point of relief on dry land outside water entry point
        const entry = this.ball.waterEntryPoint;
        const origin = this.ball.shotOrigin;
        let dirX = origin.x - entry.x;
        let dirZ = origin.z - entry.z;
        const dist = Math.hypot(dirX, dirZ);
        if (dist > 0.1) {
          dirX /= dist;
          dirZ /= dist;
        } else {
          dirX = 0;
          dirZ = -1;
        }

        // Step back 1.4m along approach line away from water hazard
        let dropX = entry.x + dirX * 1.4;
        let dropZ = entry.z + dirZ * 1.4;

        if (this.terrain.getSurfaceAt(dropX, dropZ) === SurfaceType.WATER) {
          dropX = entry.x + dirX * 2.8;
          dropZ = entry.z + dirZ * 2.8;
        }

        const dropGroundY = this.terrain.getElevation(dropX, dropZ);
        const finalRestY = dropGroundY + GOLF_CONSTANTS.BALL_RENDER_RADIUS;
        this.executeBallDropAnimation(dropX, dropGroundY, dropZ, finalRestY);
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

  // --- History (Undo / Redo) System ---
  private captureHistorySnapshot(description: string): DesignerHistoryStep {
    const stampedFeatures = this.terrain.stampedFeatures.map(f => ({
      ...f,
      doglegPoints: f.doglegPoints ? f.doglegPoints.map(p => ({ ...p })) : undefined
    }));
    const baseHeights = new Float32Array(this.terrain.baseHeights);
    const sceneryMeshes = this.courseManager.getSceneryMeshes().map(m => ({
      name: m.name,
      pos: [m.position.x, m.position.y, m.position.z] as [number, number, number],
      rot: [m.rotation.x, m.rotation.y, m.rotation.z] as [number, number, number],
      scale: [m.scaling.x, m.scaling.y, m.scaling.z] as [number, number, number]
    }));
    const activeHole = this.courseManager.getActiveHole();
    const holeState = {
      pinPos: [activeHole.pinPosition.x, activeHole.pinPosition.y, activeHole.pinPosition.z] as [number, number, number],
      teePos: [activeHole.teePosition.x, activeHole.teePosition.y, activeHole.teePosition.z] as [number, number, number],
      teeRotY: this.courseManager.activeTeeMesh ? this.courseManager.activeTeeMesh.rotation.y : 0
    };

    return {
      description,
      stampedFeatures,
      selectedFeatureIndex: this.selectedFeatureIndex,
      baseHeights,
      sceneryMeshes,
      holeState
    };
  }

  private recordHistoryStep(description: string, preSnapshot?: DesignerHistoryStep) {
    if (this.isHistoryNavigating) return;
    const step = preSnapshot || this.captureHistorySnapshot(description);
    this.historyUndoStack.push(step);
    if (this.historyUndoStack.length > 50) {
      this.historyUndoStack.shift();
    }
    this.historyRedoStack = [];
    this.updateUndoRedoUI();
  }

  public undo() {
    if (this.historyUndoStack.length === 0) {
      this.ui.showToast('Nothing to undo', 'info', 1500);
      return;
    }
    this.isHistoryNavigating = true;
    const current = this.captureHistorySnapshot('Current State');
    this.historyRedoStack.push(current);

    const step = this.historyUndoStack.pop()!;
    this.applyHistorySnapshot(step);
    this.isHistoryNavigating = false;
    this.updateUndoRedoUI();
    this.ui.showToast(`↩ Undid: ${step.description}`, 'info', 2000);
  }

  public redo() {
    if (this.historyRedoStack.length === 0) {
      this.ui.showToast('Nothing to redo', 'info', 1500);
      return;
    }
    this.isHistoryNavigating = true;
    const current = this.captureHistorySnapshot('Current State');
    this.historyUndoStack.push(current);

    const step = this.historyRedoStack.pop()!;
    this.applyHistorySnapshot(step);
    this.isHistoryNavigating = false;
    this.updateUndoRedoUI();
    this.ui.showToast(`↪ Redid: ${step.description}`, 'info', 2000);
  }

  private updateUndoRedoUI() {
    if (this.ui) {
      this.ui.setUndoRedoEnabled(this.historyUndoStack.length > 0, this.historyRedoStack.length > 0);
    }
  }

  private applyHistorySnapshot(step: DesignerHistoryStep) {
    // 1. Restore stamped features
    this.terrain.stampedFeatures = step.stampedFeatures.map(f => ({
      ...f,
      doglegPoints: f.doglegPoints ? f.doglegPoints.map(p => ({ ...p })) : undefined
    }));

    // 2. Restore base heights
    if (step.baseHeights && step.baseHeights.length === this.terrain.baseHeights.length) {
      this.terrain.baseHeights.set(step.baseHeights);
    }

    // 3. Rebuild all stamped features and mesh with full quality
    this.terrain.rebuildAllStampedFeatures(false);

    // 4. Update Havok physics collision and 1m grid
    if (this.terrain.terrainMesh) {
      this.havok.updateTerrainCollision(this.terrain.terrainMesh);
    }
    this.update1mGridMesh();

    // 5. Restore active hole state
    if (this.courseManager) {
      const activeHole = this.courseManager.getActiveHole();
      if (step.holeState) {
        activeHole.pinPosition.x = step.holeState.pinPos[0];
        activeHole.pinPosition.y = step.holeState.pinPos[1];
        activeHole.pinPosition.z = step.holeState.pinPos[2];
        activeHole.teePosition.x = step.holeState.teePos[0];
        activeHole.teePosition.y = step.holeState.teePos[1];
        activeHole.teePosition.z = step.holeState.teePos[2];
      }
      if (this.courseManager.activePinMesh) {
        this.courseManager.activePinMesh.position.set(activeHole.pinPosition.x, activeHole.pinPosition.y, activeHole.pinPosition.z);
      }
      if (this.courseManager.activeTeeMesh) {
        this.courseManager.activeTeeMesh.position.set(activeHole.teePosition.x, activeHole.teePosition.y, activeHole.teePosition.z);
        this.courseManager.activeTeeMesh.rotation.y = step.holeState.teeRotY;
      }
    }

    // 6. Restore scenery meshes positions/rotations/scales
    if (step.sceneryMeshes) {
      const sceneryMap = new Map<string, Mesh>();
      for (const m of this.courseManager.getSceneryMeshes()) {
        sceneryMap.set(m.name, m);
      }
      for (const sm of step.sceneryMeshes) {
        const mesh = sceneryMap.get(sm.name);
        if (mesh) {
          mesh.position.set(sm.pos[0], sm.pos[1], sm.pos[2]);
          mesh.rotation.set(sm.rot[0], sm.rot[1], sm.rot[2]);
          mesh.scaling.set(sm.scale[0], sm.scale[1], sm.scale[2]);
        }
      }
    }

    // 7. Restore green visualizer slope grid
    this.greenVisualizer.rebuildSlopeGrid();

    // 8. Restore selection
    if (step.selectedFeatureIndex >= 0 && step.selectedFeatureIndex < this.terrain.stampedFeatures.length) {
      this.selectCourseFeature(step.selectedFeatureIndex);
    } else {
      this.selectCourseFeature(-1);
      this.selectMesh(null);
    }

    this.ui.updateFeatureList(this.terrain.stampedFeatures, this.selectedFeatureIndex);
    this.updateDevStats();
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
          if (this.activeDesignerTool === 'erase' || this.activeDesignerTool === 'select') {
            this.brushVisualizer.setVisible(false);
          } else {
            const pick = this.scene.pick(
              this.scene.pointerX,
              this.scene.pointerY,
              (m) => m.name === 'GolfTerrain'
            );
            if (pick && pick.hit && pick.pickedPoint) {
              this.brushVisualizer.setVisible(true);
              this.brushVisualizer.updatePosition(pick.pickedPoint);

              // Continuous brush sculpting when holding Shift + dragging on terrain in sculpt mode
              if (this.isPointerDownInDesigner && pointerInfo.event.shiftKey && this.activeDesignerTool === 'sculpt') {
                this.handleDesignerActionAtPoint(pick.pickedPoint);
              }
            } else {
              this.brushVisualizer.setVisible(false);
            }
          }
        } else if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
          // Holding down LMB (0) orbits, MMB (1) pans, and RMB (2) pans & zooms.
          // A clean click without dragging (< 5px) selects, sculpts, or places!
          if (pointerInfo.event.button === 0 || pointerInfo.event.button === 2) {
            this.isPointerDownInDesigner = true;
            this.pointerDownX = pointerInfo.event.clientX;
            this.pointerDownY = pointerInfo.event.clientY;
          }
        } else if (pointerInfo.type === PointerEventTypes.POINTERUP) {
          if (this.isPointerDownInDesigner && (pointerInfo.event.button === 0 || pointerInfo.event.button === 2)) {
            this.isPointerDownInDesigner = false;

            // Check if clicking or dragging a transform gizmo - if so, ignore click selection!
            if (this.isGizmoDragging || (this.gizmoManager && this.gizmoManager.isDragging)) return;

            const dragDist = Math.hypot(
              pointerInfo.event.clientX - this.pointerDownX,
              pointerInfo.event.clientY - this.pointerDownY
            );
            if (dragDist < 12.0) {
              // 1. SELECT MODE [V]: Left click selects object/mesh for Move [G], Rotate [R], Scale [S]; clicking ground selects ground layer
              if (this.activeDesignerTool === 'select') {
                const pickScenery = this.scene.pick(
                  this.scene.pointerX,
                  this.scene.pointerY,
                  (m) => this.isPickableSceneryMesh(m)
                );
                if (pickScenery && pickScenery.hit && pickScenery.pickedMesh) {
                  // 1a. Feature elements: pin, flag, cup, ducks, water hazard plane, drape mesh, proxy
                  const featureIdx = this.findFeatureForNode(pickScenery.pickedMesh);
                  if (featureIdx >= 0) {
                    this.selectCourseFeature(featureIdx);
                    return;
                  }

                  // 1b. Placed 3D scenery props: Trees, Rocks, Cliffs, Dam Wall, Bushes
                  const sceneryObj = this.findSceneryObjectForMesh(pickScenery.pickedMesh);
                  if (sceneryObj) {
                    const featIdx = this.findFeatureForNode(sceneryObj);
                    if (featIdx >= 0) {
                      this.selectCourseFeature(featIdx);
                    } else {
                      this.selectMesh(sceneryObj);
                    }
                    return;
                  }
                }

                // 2. Terrain ground raycast: Fairway, Green, Bunkers, Tee, Water
                const pickGround = this.scene.pick(
                  this.scene.pointerX,
                  this.scene.pointerY,
                  (m) => m === this.terrain.terrainMesh
                );
                if (pickGround && pickGround.hit && pickGround.pickedPoint) {
                  const hitFeat = this.terrain.findFeatureAt(pickGround.pickedPoint.x, pickGround.pickedPoint.z);
                  if (hitFeat) {
                    this.selectCourseFeature(hitFeat.index);
                  } else {
                    // Clicked main ground (rough/terrain outside features): select Main Ground material & textures!
                    this.selectGroundLayer();
                  }
                } else {
                  // Clicked in empty space / sky: cleanly DESELECT features/objects!
                  this.selectCourseFeature(-1);
                  this.selectMesh(null);
                }
                return;
              }

              // 2. ERASE MODE [X]: Left click deletes clicked scenery object immediately
              if (this.activeDesignerTool === 'erase') {
                const pick = this.scene.pick(
                  this.scene.pointerX,
                  this.scene.pointerY,
                  (m) => this.isPickableSceneryMesh(m)
                );
                if (pick && pick.hit && pick.pickedMesh) {
                  this.deleteSceneryObject(pick.pickedMesh as Mesh);
                }
                return;
              }

              // 3. SCULPT MODE [B]: Left click sculpts terrain at the brush cursor
              if (this.activeDesignerTool === 'sculpt') {
                const pick = this.scene.pick(
                  this.scene.pointerX,
                  this.scene.pointerY,
                  (m) => m.name === 'GolfTerrain'
                );
                if (pick && pick.hit && pick.pickedPoint) {
                  this.handleDesignerActionAtPoint(pick.pickedPoint);
                }
                return;
              }

              // 4. ADD OBJECT / PRESETS MODE [A]: Left click stamps scenery prop or surface feature
              if (this.activeDesignerTool === 'stamp') {
                const pick = this.scene.pick(
                  this.scene.pointerX,
                  this.scene.pointerY,
                  (m) => m.name === 'GolfTerrain'
                );
                if (pick && pick.hit && pick.pickedPoint) {
                  this.handleDesignerActionAtPoint(pick.pickedPoint);
                }
                return;
              }

              // 5. SET TEE / SET PIN
              if (this.activeDesignerTool === 'set_tee' || this.activeDesignerTool === 'set_pin') {
                const pick = this.scene.pick(
                  this.scene.pointerX,
                  this.scene.pointerY,
                  (m) => m.name === 'GolfTerrain'
                );
                if (pick && pick.hit && pick.pickedPoint) {
                  this.handleDesignerActionAtPoint(pick.pickedPoint);
                }
                return;
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
      const snap = this.captureHistorySnapshot('Sculpt Terrain');
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
      this.recordHistoryStep('Sculpt Terrain', snap);

    } else if (this.activeDesignerTool === 'stamp') {
      if (!this.activePreset) return;
      const snap = this.captureHistorySnapshot('Stamp ' + (this.activePreset.name || 'Object'));

      const p = this.activePreset;
      if (p.category === 'scenery') {
        const gy = this.terrain.getElevation(gx, gz);
        let createdMesh: Mesh | null = null;
        if (p.sceneryType === 'pine') createdMesh = this.scenery.createPineTree(gx, gy, gz);
        else if (p.sceneryType === 'hero_tree') createdMesh = this.scenery.createHeroTree(gx, gy, gz);
        else if (p.sceneryType === 'oak') createdMesh = this.scenery.createOakTree(gx, gy, gz);
        else if (p.sceneryType === 'rock_cluster') createdMesh = this.scenery.createRockCluster(gx, gy, gz);
        else if (p.sceneryType === 'dam_wall') createdMesh = this.scenery.createDamWall(gx, gy, gz, p.width, 4);

        if (createdMesh) {
          this.courseManager.addSceneryMesh(createdMesh);
          if (this.shadowGenerator) {
            this.shadowGenerator.addShadowCaster(createdMesh, true);
          }
          this.selectMesh(createdMesh);
          this.updateDevStats();
        }
      } else {
        if (p.surfaceType === SurfaceType.WATER) {
          const rimElevation = this.terrain.getBaseElevation(gx, gz);
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
          const waterMesh = this.scenery.createWaterPlane(gx, rimElevation, gz, p.width, p.length, 0);
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
            p.lipHeight ?? 0,
            undefined,
            p.bunkerShapeIndex
          );
        }

        this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
        if (p.surfaceType === SurfaceType.GREEN) {
          this.greenVisualizer.rebuildSlopeGrid();
        }
        if (this.courseManager) {
          this.courseManager.refreshSceneryForFeatures();
        }
        this.update1mGridMesh();
        this.registerSceneryShadows();
      }
      this.recordHistoryStep('Stamp ' + (p.name || 'Object'), snap);

    } else if (this.activeDesignerTool === 'set_tee') {
      const snap = this.captureHistorySnapshot('Move Tee Position');
      const hole = this.courseManager.currentHole;
      hole.teePosition.x = gx;
      hole.teePosition.z = gz;
      this.courseManager.setupHoleVisuals();
      this.registerSceneryShadows();
      this.placeBallAtActiveTee();
      this.updateHUDDisplay();
      this.recordHistoryStep('Move Tee Position', snap);

    } else if (this.activeDesignerTool === 'set_pin') {
      const snap = this.captureHistorySnapshot('Move Pin Position');
      const hole = this.courseManager.currentHole;
      hole.pinPosition.x = gx;
      hole.pinPosition.z = gz;
      this.courseManager.setupHoleVisuals();
      this.ball.setTargetPin(hole.pinPosition);
      this.registerSceneryShadows();
      this.updateHUDDisplay();
      this.recordHistoryStep('Move Pin Position', snap);
    }
  }

  private handleGizmoDragStart = () => {
    this.isGizmoDragging = true;
    if (this.selectedFeatureIndex >= 0 && this.featureGizmoProxy && this.selectedMesh === this.featureGizmoProxy) {
      const feat = this.terrain.stampedFeatures[this.selectedFeatureIndex];
      this.pendingHistorySnapshot = this.captureHistorySnapshot('Transform ' + (feat?.name || feat?.surfaceType || 'Feature'));
    } else if (this.selectedMesh) {
      this.pendingHistorySnapshot = this.captureHistorySnapshot('Transform ' + (this.selectedMesh.name || 'Object'));
    }
  };

  private handleGizmoDrag = () => {
    this.isGizmoDragging = true;
    if (this.selectedFeatureIndex >= 0 && this.featureGizmoProxy && this.selectedMesh === this.featureGizmoProxy) {
      this.featureGizmoProxy.position.y = this.terrain.getElevation(this.featureGizmoProxy.position.x, this.featureGizmoProxy.position.z) + 0.12;
      if (!this.gizmoRaf) {
        this.gizmoRaf = requestAnimationFrame(() => {
          this.gizmoRaf = null;
          this.applyFeatureGizmoTransform(true);
        });
      }
    }
  };

  private handleGizmoDragEnd = () => {
    if (this.gizmoRaf) {
      cancelAnimationFrame(this.gizmoRaf);
      this.gizmoRaf = null;
    }
    setTimeout(() => {
      this.isGizmoDragging = false;
    }, 80);

    if (this.selectedFeatureIndex >= 0 && this.featureGizmoProxy && this.selectedMesh === this.featureGizmoProxy) {
      this.featureGizmoProxy.position.y = this.terrain.getElevation(this.featureGizmoProxy.position.x, this.featureGizmoProxy.position.z) + 0.12;
      this.applyFeatureGizmoTransform(false);
      if (this.pendingHistorySnapshot) {
        this.recordHistoryStep(this.pendingHistorySnapshot.description, this.pendingHistorySnapshot);
        this.pendingHistorySnapshot = null;
      }
    } else if (this.selectedMesh) {
      this.scenery.syncColliders();
      this.ball.setTreeColliders(this.scenery.treeColliders);
      this.ui.updateDevSelectedObject(this.selectedMesh);
      if (this.pendingHistorySnapshot) {
        this.recordHistoryStep(this.pendingHistorySnapshot.description, this.pendingHistorySnapshot);
        this.pendingHistorySnapshot = null;
      }
    }
  };

  private hookBehavior(target: any) {
    if (!target || this.hookedGizmoBehaviors.has(target)) return;
    this.hookedGizmoBehaviors.add(target);
    if (target.onDragStartObservable) {
      target.onDragStartObservable.add(this.handleGizmoDragStart);
    }
    if (target.onDragObservable) {
      target.onDragObservable.add(this.handleGizmoDrag);
    }
    if (target.onDragEndObservable) {
      target.onDragEndObservable.add(this.handleGizmoDragEnd);
    }
  }

  private hookGizmoListeners() {
    if (!this.gizmoManager || !this.gizmoManager.gizmos) return;

    const posGizmo = this.gizmoManager.gizmos.positionGizmo;
    if (posGizmo) {
      posGizmo.planarGizmoEnabled = true;
      this.hookBehavior(posGizmo);
      const subGizmos = [
        posGizmo.xGizmo,
        posGizmo.yGizmo,
        posGizmo.zGizmo,
        posGizmo.xPlaneGizmo,
        posGizmo.yPlaneGizmo,
        posGizmo.zPlaneGizmo
      ];
      for (const sg of subGizmos) {
        if (sg) {
          this.hookBehavior(sg);
          if (sg.dragBehavior) {
            this.hookBehavior(sg.dragBehavior);
          }
        }
      }
    }

    const rotGizmo = this.gizmoManager.gizmos.rotationGizmo;
    if (rotGizmo) {
      this.hookBehavior(rotGizmo);
      const rotSubGizmos = [rotGizmo.xGizmo, rotGizmo.yGizmo, rotGizmo.zGizmo];
      for (const rg of rotSubGizmos) {
        if (rg) {
          this.hookBehavior(rg);
          if (rg.dragBehavior) {
            this.hookBehavior(rg.dragBehavior);
          }
        }
      }
    }

    const scaleGizmo = this.gizmoManager.gizmos.scaleGizmo;
    if (scaleGizmo) {
      this.hookBehavior(scaleGizmo);
      const scaleSubGizmos = [scaleGizmo.xGizmo, scaleGizmo.yGizmo, scaleGizmo.zGizmo, (scaleGizmo as any).uniformScaleGizmo, (scaleGizmo as any).uniformGizmo];
      for (const sg of scaleSubGizmos) {
        if (sg) {
          this.hookBehavior(sg);
          if (sg.dragBehavior) {
            this.hookBehavior(sg.dragBehavior);
          }
        }
      }
    }
  }

  private setupGizmoManager() {
    this.gizmoManager = new GizmoManager(this.scene);
    this.gizmoManager.usePointerToAttachGizmos = false;
    this.gizmoManager.boundingBoxGizmoEnabled = false;

    this.gizmoManager.onAttachedToMeshObservable.add(() => {
      this.hookGizmoListeners();
    });

    // Reset initial state to none
    this.gizmoManager.positionGizmoEnabled = false;
    this.gizmoManager.rotationGizmoEnabled = false;
    this.gizmoManager.scaleGizmoEnabled = false;
  }

  private setGizmoMode(mode: 'none' | 'position' | 'rotation' | 'scale') {
    this.activeGizmoMode = mode;
    if (!this.gizmoManager) this.setupGizmoManager();
    this.gizmoManager.positionGizmoEnabled = (mode === 'position');
    this.gizmoManager.rotationGizmoEnabled = (mode === 'rotation');
    this.gizmoManager.scaleGizmoEnabled = (mode === 'scale');

    this.hookGizmoListeners();

    if (this.selectedMesh && mode !== 'none') {
      this.gizmoManager.attachToMesh(this.selectedMesh);
    } else {
      this.gizmoManager.attachToMesh(null);
    }
    this.ui.setGizmoModeButton(mode);
  }

  private selectGroundLayer() {
    this.selectCourseFeature(-1);
    this.selectMesh(null);
    this.ui.showGroundPbrInspector(this.terrain.getGroundUvSettings(), true);
    this.ui.showToast('Selected Main Ground — edit material & textures in Developer Zone 🌱', 'info', 1800);
  }

  private executeBallDropAnimation(dropX: number, dropGroundY: number, dropZ: number, finalRestY: number) {
    const dropHeight = 1.85;
    const startY = dropGroundY + dropHeight;
    this.ball.setPosition(dropX, startY, dropZ);

    this.cameraCtrl.setMode('aim');
    this.cameraCtrl.camera.target.set(dropX, dropGroundY + 0.45, dropZ);

    let currentY = startY;
    let velY = 0;
    const gravity = -20.0;
    let bounces = 0;

    const dropObserver = this.scene.onBeforeRenderObservable.add(() => {
      const dt = Math.min(0.033, this.scene.getEngine().getDeltaTime() / 1000);
      velY += gravity * dt;
      currentY += velY * dt;

      if (currentY <= finalRestY) {
        currentY = finalRestY;
        bounces++;
        soundFx.playBounce('rough', 0.6);

        if (bounces === 1) {
          velY = 2.4;
        } else if (bounces === 2) {
          velY = 0.8;
        } else {
          this.scene.onBeforeRenderObservable.remove(dropObserver);
          this.ball.setPosition(dropX, finalRestY, dropZ);
          this.cameraCtrl.snapAimBehindBall(this.ball.position, this.currentAimAzimuth);
          this.ui.setSwingEnabled(true);
          if (this.aimSystem) {
            this.aimSystem.setVisible(true);
            this.aimSystem.update(this.ball.position, this.activeClub, this.swingEngine.windSpeedMps, this.swingEngine.windHeadingDeg);
          }
          this.updateHUDDisplay();
          return;
        }
      }

      this.ball.setPosition(dropX, currentY, dropZ);
    });
  }

  private selectMesh(mesh: Mesh | null) {
    this.selectedMesh = mesh;
    if (!this.gizmoManager) this.setupGizmoManager();
    this.hookGizmoListeners();
    if (mesh && this.activeGizmoMode !== 'none') {
      this.gizmoManager.attachToMesh(mesh);
    } else if (mesh && this.activeGizmoMode === 'none') {
      this.setGizmoMode('position');
      this.gizmoManager.attachToMesh(mesh);
    } else {
      this.gizmoManager.attachToMesh(null);
    }
    this.ui.updateDevSelectedObject(mesh);

    if (mesh && mesh !== this.featureGizmoProxy) {
      const matInfo = this.getObjectMaterialInfo(mesh);
      this.ui.updateDevSelectedObjectMaterial(matInfo);
      this.ui.updateDevSelectedFeatureMaterial(null, null);
    } else if (!mesh && this.selectedFeatureIndex < 0) {
      this.ui.updateDevSelectedObjectMaterial(null);
      this.ui.updateDevSelectedFeatureMaterial(null, null);
    }

    // Electric Blue Selection Glow Layer
    if (this.selectionHighlightLayer) {
      this.selectionHighlightLayer.removeAllMeshes();
      if (mesh && mesh !== this.featureGizmoProxy) {
        if (this.featureDrapeMesh) {
          this.featureDrapeMesh.dispose();
          this.featureDrapeMesh = null;
        }
        if (this.featureSurfaceFillMesh) {
          this.featureSurfaceFillMesh.dispose();
          this.featureSurfaceFillMesh = null;
        }
        if (this.featureGizmoProxy) {
          this.featureGizmoProxy.setEnabled(false);
        }
        this.selectedFeatureIndex = -1;
        this.ui.updateFeatureList(this.terrain.stampedFeatures, -1);
      }
      if (mesh && mesh.name !== 'GolfTerrain') {
        const glowColor = new Color3(0.18, 0.65, 1.0);
        try {
          this.selectionHighlightLayer.addMesh(mesh, glowColor);
        } catch (e) {}
        mesh.getChildMeshes().forEach((c) => {
          if (c instanceof Mesh) {
            try {
              this.selectionHighlightLayer.addMesh(c, glowColor);
            } catch (e) {}
          }
        });
      }
    }
  }

  public frameSelectedObject() {
    if (!this.selectedMesh) {
      this.ui.showToast('Select an object or course feature first to frame [F]', 'info', 2000);
      return;
    }
    const targetPos = this.selectedMesh.getAbsolutePosition();
    const sphereRadius = this.selectedMesh.getBoundingInfo?.().boundingSphere.radiusWorld || 3.0;
    const targetRadius = Math.max(3.5, Math.min(65, sphereRadius * 2.8));
    this.cameraCtrl.frameOnTarget(targetPos, targetRadius);
    this.ui.showToast(`🎯 Framed on ${this.selectedMesh.name} [F] — Orbiting around selection`, 'info', 2200);
  }

  public selectCourseFeature(index: number) {
    if (index < 0 || index >= this.terrain.stampedFeatures.length) {
      this.selectedFeatureIndex = -1;
      if (this.featureGizmoProxy) this.featureGizmoProxy.setEnabled(false);
      if (this.featureDrapeMesh) {
        this.featureDrapeMesh.dispose();
        this.featureDrapeMesh = null;
      }
      if (this.featureSurfaceFillMesh) {
        this.featureSurfaceFillMesh.dispose();
        this.featureSurfaceFillMesh = null;
      }
      this.selectMesh(null);
      this.ui.updateFeatureList(this.terrain.stampedFeatures, -1);
      this.ui.updateDevSelectedFeatureMaterial(null, null);
      this.terrain.setGroundUvSettings(this.terrain.getGroundUvSettings());
      return;
    }

    this.selectedFeatureIndex = index;
    const feat = this.terrain.stampedFeatures[index];

    if (!this.featureGizmoProxy) {
      this.featureGizmoProxy = MeshBuilder.CreateCylinder('courseFeatureProxy', { diameter: 2.4, height: 0.18 }, this.scene);
      this.featureGizmoProxy.isPickable = true;
      const mat = new StandardMaterial('featProxyMat', this.scene);
      mat.diffuseColor = new Color3(0.0, 0.85, 1.0);
      mat.emissiveColor = new Color3(0.0, 0.65, 1.0);
      mat.alpha = 0.65;
      this.featureGizmoProxy.material = mat;
    }
    this.featureGizmoProxy.isPickable = true;

    this.featureGizmoProxy.setEnabled(true);
    const elev = this.terrain.getElevation(feat.centerX, feat.centerZ);
    this.featureGizmoProxy.position.set(feat.centerX, elev + 0.15, feat.centerZ);
    this.featureGizmoProxy.rotation.y = feat.rotationRad;
    if (this.featureGizmoProxy.rotationQuaternion) {
      this.featureGizmoProxy.rotationQuaternion = Quaternion.RotationYawPitchRoll(feat.rotationRad, 0, 0);
    }
    this.featureGizmoProxy.name = feat.name || `${feat.surfaceType} Feature`;

    // 1. Build & update the terrain-conforming drape ribbon outline
    this.updateFeatureDrapeMesh(index);

    // 2. Attach transform gizmo to central feature proxy
    this.selectMesh(this.featureGizmoProxy);

    // 3. Highlight all feature components together (drape, proxy, and attached objects)
    this.highlightFeatureComponents(index);

    this.ui.updateFeatureList(this.terrain.stampedFeatures, index);
    const featMat = feat.materialSettings || this.terrain.getDefaultFeatureMaterial(feat.surfaceType);
    this.terrain.updateFeatureMaterial(index, featMat);
    this.ui.updateDevSelectedFeatureMaterial(feat, featMat);
    this.ui.updateDevSelectedObjectMaterial(null);
    this.ui.showToast(`Selected ${feat.name || feat.surfaceType} in its entirety [G: Slide, R: Rotate]`, 'info', 2500);
  }

  public moveCourseFeature(index: number, newX: number, newZ: number, isLive = false) {
    if (index < 0 || index >= this.terrain.stampedFeatures.length) return;
    this.terrain.moveFeature(index, newX, newZ, isLive);
    this.syncFeatureSubsystems(index, isLive);
    this.updateFeatureDrapeMesh(index);
    this.highlightFeatureComponents(index);
  }

  public rotateCourseFeature(index: number, newRotRad: number, isLive = false) {
    if (index < 0 || index >= this.terrain.stampedFeatures.length) return;
    this.terrain.rotateFeature(index, newRotRad, isLive);
    this.syncFeatureSubsystems(index, isLive);
    this.updateFeatureDrapeMesh(index);
    this.highlightFeatureComponents(index);
  }

  private applyFeatureGizmoTransform(isLive = false) {
    if (this.selectedFeatureIndex < 0 || !this.featureGizmoProxy) return;
    const feat = this.terrain.stampedFeatures[this.selectedFeatureIndex];
    if (!feat) return;

    const newX = this.featureGizmoProxy.position.x;
    const newZ = this.featureGizmoProxy.position.z;
    let newRot = this.featureGizmoProxy.rotation.y;
    if (this.featureGizmoProxy.rotationQuaternion) {
      newRot = this.featureGizmoProxy.rotationQuaternion.toEulerAngles().y;
    }

    const posChanged = Math.abs(newX - feat.centerX) > 0.001 || Math.abs(newZ - feat.centerZ) > 0.001;
    const rotChanged = Math.abs(newRot - feat.rotationRad) > 0.001;

    if (!posChanged && !rotChanged && isLive) return;

    if (posChanged && rotChanged) {
      this.terrain.moveAndRotateFeature(this.selectedFeatureIndex, newX, newZ, newRot, isLive);
    } else if (posChanged) {
      this.terrain.moveFeature(this.selectedFeatureIndex, newX, newZ, isLive);
    } else if (rotChanged) {
      this.terrain.rotateFeature(this.selectedFeatureIndex, newRot, isLive);
    }

    this.syncFeatureSubsystems(this.selectedFeatureIndex, isLive);
    this.updateFeatureDrapeMesh(this.selectedFeatureIndex);
    this.highlightFeatureComponents(this.selectedFeatureIndex);
    this.ui.updateDevSelectedFeature(feat, this.selectedFeatureIndex);
  }

  private syncFeatureSubsystems(index: number, isLive = false) {
    const feat = this.terrain.stampedFeatures[index];
    if (!feat) return;

    if (this.featureGizmoProxy) {
      const elev = this.terrain.getElevation(feat.centerX, feat.centerZ);
      this.featureGizmoProxy.position.set(feat.centerX, elev + 0.15, feat.centerZ);
      this.featureGizmoProxy.rotation.y = feat.rotationRad;
      if (this.featureGizmoProxy.rotationQuaternion) {
        this.featureGizmoProxy.rotationQuaternion = Quaternion.RotationYawPitchRoll(feat.rotationRad, 0, 0);
      }
    }

    if (feat.surfaceType === SurfaceType.GREEN && this.courseManager) {
      const activeHole = this.courseManager.getActiveHole();
      activeHole.pinPosition.x = feat.centerX;
      activeHole.pinPosition.z = feat.centerZ;
      activeHole.pinPosition.y = this.terrain.getElevation(feat.centerX, feat.centerZ);
      if (this.courseManager.activePinMesh) {
        this.courseManager.activePinMesh.position.set(feat.centerX, activeHole.pinPosition.y, feat.centerZ);
      }
      this.greenVisualizer.rebuildSlopeGrid();
    } else if (feat.surfaceType === SurfaceType.TEE && this.courseManager) {
      const activeHole = this.courseManager.getActiveHole();
      activeHole.teePosition.x = feat.centerX;
      activeHole.teePosition.z = feat.centerZ;
      activeHole.teePosition.y = this.terrain.getElevation(feat.centerX, feat.centerZ);
      if (this.courseManager.activeTeeMesh) {
        this.courseManager.activeTeeMesh.position.set(feat.centerX, activeHole.teePosition.y, feat.centerZ);
        this.courseManager.activeTeeMesh.rotation.y = feat.rotationRad;
      }
    } else if (feat.surfaceType === SurfaceType.WATER) {
      const waterMesh = this.scene.meshes.find(m => m.name.startsWith('water_'));
      if (waterMesh) {
        waterMesh.position.x = feat.centerX;
        waterMesh.position.z = feat.centerZ;
        waterMesh.position.y = this.terrain.getBaseElevation(feat.centerX, feat.centerZ) - 0.19;
        waterMesh.rotation.y = -feat.rotationRad;
      }
    }

    if (isLive) {
      // Debounce heavy Havok collision, scenery clearance, and 1m grid update during live drag to keep locked 60 FPS
      if (this.physicsSyncTimeout) clearTimeout(this.physicsSyncTimeout);
      this.physicsSyncTimeout = window.setTimeout(() => {
        this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
        this.update1mGridMesh();
        if (this.courseManager) this.courseManager.refreshSceneryForFeatures();
      }, 120);
    } else {
      if (this.physicsSyncTimeout) clearTimeout(this.physicsSyncTimeout);
      this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
      this.update1mGridMesh();
      if (this.courseManager) this.courseManager.refreshSceneryForFeatures();
    }
  }

  private updateFeatureDrapeMesh(index: number) {
    if (index < 0 || index >= this.terrain.stampedFeatures.length) {
      if (this.featureDrapeMesh) {
        this.featureDrapeMesh.dispose();
        this.featureDrapeMesh = null;
      }
      if (this.featureSurfaceFillMesh) {
        this.featureSurfaceFillMesh.dispose();
        this.featureSurfaceFillMesh = null;
      }
      return;
    }

    const feat = this.terrain.stampedFeatures[index];
    const perim = this.terrain.getFeaturePerimeterPoints(feat);
    if (!perim || perim.length < 3) return;

    const pathInner: Vector3[] = [];
    const pathOuter: Vector3[] = [];
    const n = perim.length;

    for (let i = 0; i <= n; i++) {
      const p = perim[i % n];
      const dx = p.x - feat.centerX;
      const dz = p.z - feat.centerZ;
      const dist = Math.hypot(dx, dz) || 1;
      const nx = dx / dist;
      const nz = dz / dist;

      // Crisp draped perimeter outline (+0.30m outward, -0.30m inward)
      const ox = p.x + nx * 0.30;
      const oz = p.z + nz * 0.30;
      const oy = this.terrain.getElevation(ox, oz) + 0.08;
      pathOuter.push(new Vector3(ox, oy, oz));

      const ix = p.x - nx * 0.30;
      const iz = p.z - nz * 0.30;
      const iy = this.terrain.getElevation(ix, iz) + 0.08;
      pathInner.push(new Vector3(ix, iy, iz));
    }

    if (this.featureDrapeMesh) {
      this.featureDrapeMesh.dispose();
      this.featureDrapeMesh = null;
    }
    if (this.featureSurfaceFillMesh) {
      this.featureSurfaceFillMesh.dispose();
      this.featureSurfaceFillMesh = null;
    }

    this.featureDrapeMesh = MeshBuilder.CreateRibbon(
      'featureDrapeRibbon',
      { pathArray: [pathInner, pathOuter], closeArray: true, sideOrientation: Mesh.DOUBLESIDE },
      this.scene
    );
    this.featureDrapeMesh.isPickable = false;

    if (!this.featureDrapeMaterial) {
      const mat = new StandardMaterial('featureDrapeMat', this.scene);
      mat.diffuseColor = new Color3(0.0, 0.90, 1.0);
      mat.emissiveColor = new Color3(0.0, 0.75, 1.0);
      mat.alpha = 0.90;
      mat.backFaceCulling = false;
      this.featureDrapeMaterial = mat;
    }
    this.featureDrapeMesh.material = this.featureDrapeMaterial;
  }

  private highlightFeatureComponents(index: number) {
    if (!this.selectionHighlightLayer || index < 0 || index >= this.terrain.stampedFeatures.length) return;
    const feat = this.terrain.stampedFeatures[index];
    const glowColor = new Color3(0.05, 0.80, 1.0);

    // 1. Highlight draped contour outline ribbon
    if (this.featureDrapeMesh) {
      try { this.selectionHighlightLayer.addMesh(this.featureDrapeMesh, glowColor); } catch (e) {}
    }
    // 2. Highlight central proxy
    if (this.featureGizmoProxy) {
      try { this.selectionHighlightLayer.addMesh(this.featureGizmoProxy, glowColor); } catch (e) {}
    }

    // 3. Highlight attached physical subcomponents
    if (feat.surfaceType === SurfaceType.GREEN && this.courseManager?.activePinMesh) {
      this.addMeshTreeToHighlight(this.courseManager.activePinMesh, glowColor);
    } else if (feat.surfaceType === SurfaceType.TEE && this.courseManager?.activeTeeMesh) {
      this.addMeshTreeToHighlight(this.courseManager.activeTeeMesh, glowColor);
    } else if (feat.surfaceType === SurfaceType.WATER) {
      const waterMesh = this.scene.meshes.find(m => m.name.startsWith('water_'));
      if (waterMesh instanceof Mesh) {
        this.addMeshTreeToHighlight(waterMesh, glowColor);
      }
    }
  }

  private addMeshTreeToHighlight(mesh: Mesh, glowColor: Color3) {
    try { this.selectionHighlightLayer.addMesh(mesh, glowColor); } catch (e) {}
    mesh.getChildMeshes().forEach(c => {
      if (c instanceof Mesh) {
        try { this.selectionHighlightLayer.addMesh(c, glowColor); } catch (e) {}
      }
    });
  }

  private findFeatureForNode(node: Node | null): number {
    let curr: Node | null = node;
    while (curr) {
      if (curr === this.featureGizmoProxy || curr === this.featureDrapeMesh || curr === this.featureSurfaceFillMesh ||
          curr.name === 'courseFeatureProxy' || curr.name === 'featureDrapeRibbon' || curr.name === 'featureSurfaceFill') {
        if (this.selectedFeatureIndex >= 0) return this.selectedFeatureIndex;
      }
      if (curr === this.courseManager?.activePinMesh) {
        return this.terrain.stampedFeatures.findIndex(f => f.surfaceType === SurfaceType.GREEN);
      }
      if (curr === this.courseManager?.activeTeeMesh) {
        return this.terrain.stampedFeatures.findIndex(f => f.surfaceType === SurfaceType.TEE);
      }
      const name = (curr.name || '').toLowerCase();
      if (!name.includes('pine') && (
        name.includes('flag') ||
        name.includes('cup') ||
        name.includes('pole') ||
        name.includes('flagpole') ||
        name.includes('green_hole') ||
        name.startsWith('pin_') ||
        name.startsWith('flag_') ||
        name.startsWith('cup_') ||
        name.startsWith('pole_') ||
        name === 'pin'
      )) {
        return this.terrain.stampedFeatures.findIndex(f => f.surfaceType === SurfaceType.GREEN);
      }
      if (name.includes('tee') || name.includes('duck')) {
        return this.terrain.stampedFeatures.findIndex(f => f.surfaceType === SurfaceType.TEE);
      }
      if (name.includes('water') || name.includes('pond') || name.includes('lake')) {
        return this.terrain.stampedFeatures.findIndex(f => f.surfaceType === SurfaceType.WATER);
      }
      curr = curr.parent;
    }
    return -1;
  }

  private findFeatureForSceneryMesh(mesh: Mesh): number {
    return this.findFeatureForNode(mesh);
  }

  private findSceneryObjectForMesh(mesh: AbstractMesh): Mesh | null {
    if (!mesh || mesh.name === 'GolfTerrain') return null;
    if (mesh === this.courseManager?.activePinMesh || mesh === this.courseManager?.activeTeeMesh) return null;
    const name = (mesh.name || '').toLowerCase();
    if (name.startsWith('water_') || (!name.includes('pine') && name.startsWith('pin_')) || name.startsWith('flag_') || name.startsWith('cup_') || name.includes('pole') || name.includes('duck') || name === 'coursefeatureproxy' || name === 'featuredraperibbon' || name === 'featuresurfacefill') {
      return null;
    }
    const sceneryList = this.courseManager ? this.courseManager.getSceneryMeshes() : [];
    let curr: Node | null = mesh;
    while (curr) {
      if (curr instanceof Mesh) {
        if (curr === this.courseManager?.activePinMesh || curr === this.courseManager?.activeTeeMesh) return null;
        const cName = (curr.name || '').toLowerCase();
        if (cName.startsWith('water_') || (!cName.includes('pine') && cName.startsWith('pin_')) || cName.startsWith('flag_') || cName.startsWith('cup_') || cName.includes('pole') || cName.includes('duck') || cName === 'coursefeatureproxy' || cName === 'featuredraperibbon' || cName === 'featuresurfacefill') return null;
        if (sceneryList.includes(curr) || cName.startsWith('pine_')) {
          return curr;
        }
      }
      curr = curr.parent;
    }
    return this.getRootSceneryMesh(mesh);
  }

  private isPickableSceneryMesh(abstractMesh: AbstractMesh): boolean {
    if (!abstractMesh || abstractMesh.name === 'GolfTerrain' || abstractMesh.name === 'ApproachingStormSkybox') return false;
    if (abstractMesh.name.includes('AimChevron') || abstractMesh.name.includes('brush') || abstractMesh.name.includes('contour')) return false;
    if (abstractMesh.name.includes('Gizmo') && abstractMesh !== this.featureGizmoProxy) return false;
    if (abstractMesh.name === 'featureDrapeRibbon' || abstractMesh.name === 'featureSurfaceFill') return false;
    return true;
  }

  private getRootSceneryMesh(mesh: AbstractMesh): Mesh | null {
    let curr: Node | null = mesh;
    let highestScenery: Mesh | null = null;
    while (curr) {
      if (curr instanceof Mesh && curr.name !== 'GolfTerrain' && !curr.name.includes('Gizmo') && curr.name !== '__root__') {
        const name = (curr.name || '').toLowerCase();
        if (name.startsWith('water_') || (!name.includes('pine') && name.startsWith('pin_')) || name.startsWith('flag_') || name.startsWith('cup_') || name.includes('pole') || name.includes('duck') || name === 'coursefeatureproxy' || name === 'featuredraperibbon' || name === 'featuresurfacefill') {
          return null;
        }
        highestScenery = curr;
      }
      curr = curr.parent;
    }
    return highestScenery;
  }

  private deleteSelectedMesh() {
    if (this.selectedMesh) {
      this.deleteSceneryObject(this.selectedMesh);
    }
  }

  private deleteSceneryObject(mesh: Mesh) {
    const root = this.getRootSceneryMesh(mesh) || mesh;
    if (!root || root.name === 'GolfTerrain') return;

    this.recordHistoryStep('Delete ' + (root.name || 'Object'));

    if (this.selectedMesh === root || this.selectedMesh === mesh) {
      this.gizmoManager.attachToMesh(null);
      this.selectedMesh = null;
      this.ui.updateDevSelectedObject(null);
    }

    if (this.shadowGenerator) {
      this.shadowGenerator.removeShadowCaster(root, true);
    }

    const colliders = this.scenery.treeColliders;
    const pos = root.position;
    for (let i = colliders.length - 1; i >= 0; i--) {
      const c = colliders[i];
      if (c.mesh === root || Math.hypot(c.x - pos.x, c.z - pos.z) < 2.0) {
        colliders.splice(i, 1);
      }
    }

    this.courseManager.removeSceneryMesh(root);
    root.dispose(false, true);

    soundFx.playCupDrop();
    this.ui.showToast('Object deleted 🧹', 'info', 2000);
    this.updateDevStats();
  }

  private pushChangesToPlay() {
    this.selectCourseFeature(-1);
    this.selectMesh(null);
    this.setGizmoMode('none');
    if (this.featureGizmoProxy) {
      this.featureGizmoProxy.setEnabled(false);
    }
    if (this.featureDrapeMesh) {
      this.featureDrapeMesh.dispose();
      this.featureDrapeMesh = null;
    }
    if (this.featureSurfaceFillMesh) {
      this.featureSurfaceFillMesh.dispose();
      this.featureSurfaceFillMesh = null;
    }
    if (this.selectionHighlightLayer) {
      this.selectionHighlightLayer.removeAllMeshes();
    }

    this.scenery.syncColliders();
    if (this.courseManager) {
      this.courseManager.refreshSceneryForFeatures();
    }
    this.havok.updateTerrainCollision(this.terrain.terrainMesh!);
    this.ball.setTreeColliders(this.scenery.treeColliders);
    this.greenVisualizer.rebuildSlopeGrid();
    this.registerSceneryShadows();
    this.ui.toggleMode();
    this.ui.showToast('Course changes pushed to Play mode! 🏌️', 'success', 3000);
  }

  private saveDefaultHole() {
    const ok = this.courseManager.saveCurrentAsDefault();
    if (ok) {
      this.ui.showToast('Default hole saved to browser storage! 💾', 'success', 3000);
    } else {
      this.ui.showToast('Failed to save default hole', 'penalty', 3000);
    }
  }

  private resetFactoryLayout() {
    this.ui.showToast('Restoring factory championship layout...', 'warning', 2000);
    setTimeout(() => {
      this.courseManager.resetToFactoryDefault();
    }, 500);
  }

  private updateDevStats() {
    const scenery = this.courseManager.getSceneryMeshes();
    let trees = 0;
    let rocks = 0;
    let cliffs = 0;
    for (const m of scenery) {
      const n = (m.name || '').toLowerCase();
      if (n.includes('tree') || n.includes('pine') || n.includes('hero') || n.includes('oak') || n.includes('bush')) trees++;
      else if (n.includes('rock')) rocks++;
      else if (n.includes('cliff')) cliffs++;
    }
    const bunkers = 5;
    this.ui.updateDevStats(trees, rocks, cliffs, bunkers);
  }

  private getObjectMaterialInfo(mesh: Mesh): any {
    if (!mesh || mesh === this.featureGizmoProxy) return null;
    let mat: StandardMaterial | null = null;
    if (mesh.material instanceof StandardMaterial) {
      mat = mesh.material;
    } else {
      const child = mesh.getChildMeshes().find(c => c.material instanceof StandardMaterial);
      if (child && child.material instanceof StandardMaterial) {
        mat = child.material as StandardMaterial;
      }
    }
    if (!mat) return null;

    const baseColor = mat.diffuseColor ? mat.diffuseColor.toHexString() : '#ffffff';
    const specularColor = (mat as any)._userSpecularColor || (mat.specularColor ? mat.specularColor.toHexString() : '#ffffff');
    const specularPower = (mat as any)._userSpecularPower ?? mat.specularPower ?? 64;

    const primaryTex = mat.diffuseTexture || mat.bumpTexture || (mat as any)._origDiffuseTex || (mat as any)._origBumpTex;
    const uScale = (primaryTex as any)?.uScale ?? 1.0;
    const vScale = (primaryTex as any)?.vScale ?? 1.0;
    const uOffset = (primaryTex as any)?.uOffset ?? 0.0;
    const vOffset = (primaryTex as any)?.vOffset ?? 0.0;
    const normalLevel = (mat.bumpTexture as any)?.level ?? (mat as any)._origBumpTex?.level ?? 1.0;

    const enableBaseColorTex = !!mat.diffuseTexture;
    const enableRoughnessTex = (mat as any)._userEnableRoughness !== undefined
      ? !!(mat as any)._userEnableRoughness
      : !!mat.specularTexture;
    const enableNormalTex = !!mat.bumpTexture;

    const getTexUrl = (t: any) => {
      if (!t) return null;
      return t.url || t._url || t.name || null;
    };
    const getTexName = (t: any, fallback: string) => {
      if (!t) return fallback;
      const url = t.url || t.name || '';
      const parts = url.split('/');
      return parts[parts.length - 1] || fallback;
    };

    const diffTex = mat.diffuseTexture || (mat as any)._origDiffuseTex;
    const specTex = mat.specularTexture || (mat as any)._origSpecularTex;
    const bumpTex = mat.bumpTexture || (mat as any)._origBumpTex;

    const colorMapUrl = (mat as any)._customColorUrl || getTexUrl(diffTex) || '/textures/pbr_grass/grass_pbr_diff.jpg';
    const colorMapName = (mat as any)._customColorName || getTexName(diffTex, 'model_diff.jpg');
    const roughnessMapUrl = (mat as any)._customRoughUrl || getTexUrl(specTex) || '/textures/pbr_grass/grass_pbr_rough.jpg';
    const roughnessMapName = (mat as any)._customRoughName || getTexName(specTex, 'model_rough.jpg');
    const normalMapUrl = (mat as any)._customNormalUrl || getTexUrl(bumpTex) || '/textures/pbr_grass/grass_pbr_nor.jpg';
    const normalMapName = (mat as any)._customNormalName || getTexName(bumpTex, 'model_nor.jpg');

    return {
      name: mesh.name,
      baseColor,
      specularColor,
      specularPower,
      uScale,
      vScale,
      uOffset,
      vOffset,
      normalLevel,
      enableBaseColorTex,
      enableRoughnessTex,
      enableNormalTex,
      colorMapUrl,
      colorMapName,
      roughnessMapUrl,
      roughnessMapName,
      normalMapUrl,
      normalMapName
    };
  }

  private getUniqueMaterialsForMesh(mesh: Mesh): StandardMaterial[] {
    const mats: StandardMaterial[] = [];
    const processMat = (m: any, owner: Mesh): StandardMaterial | null => {
      if (m instanceof StandardMaterial) {
        if (!m.name.includes('_inst_')) {
          const cloned = m.clone(`${m.name}_inst_${owner.name}`);
          (cloned as any)._origDiffuseTex = m.diffuseTexture;
          (cloned as any)._origSpecularTex = m.specularTexture;
          (cloned as any)._origBumpTex = m.bumpTexture;
          (cloned as any)._initialSettings = {
            baseColor: m.diffuseColor ? m.diffuseColor.toHexString() : '#ffffff',
            specularColor: m.specularColor ? m.specularColor.toHexString() : '#ffffff',
            specularPower: m.specularPower ?? 64,
            uScale: (m.diffuseTexture as any)?.uScale ?? 1.0,
            vScale: (m.diffuseTexture as any)?.vScale ?? 1.0,
            uOffset: (m.diffuseTexture as any)?.uOffset ?? 0.0,
            vOffset: (m.diffuseTexture as any)?.vOffset ?? 0.0,
            normalLevel: (m.bumpTexture as any)?.level ?? 1.0,
            hasDiffuse: !!m.diffuseTexture,
            hasSpecular: !!m.specularTexture,
            hasBump: !!m.bumpTexture
          };
          (cloned as any)._userSpecularColor = (cloned as any)._initialSettings.specularColor;
          (cloned as any)._userSpecularPower = (cloned as any)._initialSettings.specularPower;
          (cloned as any)._userEnableRoughness = (cloned as any)._initialSettings.hasSpecular;
          owner.material = cloned;
          return cloned;
        }
        return m;
      }
      return null;
    };

    if (mesh.material) {
      const p = processMat(mesh.material, mesh);
      if (p && !mats.includes(p)) mats.push(p);
    }
    mesh.getChildMeshes().forEach(c => {
      if (c instanceof Mesh && c.material) {
        const p = processMat(c.material, c);
        if (p && !mats.includes(p)) mats.push(p);
      }
    });
    return mats;
  }

  private applyObjectSpecularState(mat: StandardMaterial) {
    const specPower = (mat as any)._userSpecularPower ?? mat.specularPower ?? 64;
    const specColHex = (mat as any)._userSpecularColor || '#ffffff';
    const enableRough = (mat as any)._userEnableRoughness ?? !!mat.specularTexture;

    if (specPower <= 0) {
      if (mat.specularTexture) (mat as any)._origSpecularTex = mat.specularTexture;
      mat.specularTexture = null;
      mat.specularColor = Color3.Black();
      mat.specularPower = 1;
    } else {
      mat.specularColor = Color3.FromHexString(specColHex);
      mat.specularPower = specPower;
      if (enableRough && (mat as any)._origSpecularTex) {
        mat.specularTexture = (mat as any)._origSpecularTex;
      } else {
        if (mat.specularTexture) (mat as any)._origSpecularTex = mat.specularTexture;
        mat.specularTexture = null;
      }
    }
  }

  private applyObjectMaterialSettings(mesh: Mesh, settings: any) {
    const mats = this.getUniqueMaterialsForMesh(mesh);
    for (const mat of mats) {
      if (settings.baseColor !== undefined) {
        mat.diffuseColor = Color3.FromHexString(settings.baseColor);
      }
      if (settings.specularColor !== undefined) {
        (mat as any)._userSpecularColor = settings.specularColor;
      }
      if (settings.specularPower !== undefined) {
        (mat as any)._userSpecularPower = settings.specularPower;
      }
      if (settings.uScale !== undefined) (mat as any)._uScale = settings.uScale;
      if (settings.vScale !== undefined) (mat as any)._vScale = settings.vScale;
      if (settings.uOffset !== undefined) (mat as any)._uOffset = settings.uOffset;
      if (settings.vOffset !== undefined) (mat as any)._vOffset = settings.vOffset;

      const curUScale = (mat as any)._uScale ?? 1.0;
      const curVScale = (mat as any)._vScale ?? 1.0;
      const curUOffset = (mat as any)._uOffset ?? 0.0;
      const curVOffset = (mat as any)._vOffset ?? 0.0;

      const applyUvToTex = (t: any) => {
        if (!t) return;
        t.uScale = curUScale;
        t.vScale = curVScale;
        t.uOffset = curUOffset;
        t.vOffset = curVOffset;
      };

      const allTexs = [
        mat.diffuseTexture,
        mat.bumpTexture,
        mat.specularTexture,
        (mat as any)._origDiffuseTex,
        (mat as any)._origBumpTex,
        (mat as any)._origSpecularTex
      ];
      for (const t of allTexs) {
        applyUvToTex(t);
      }

      if (settings.normalLevel !== undefined) {
        const safeLevel = Math.max(0.0001, settings.normalLevel);
        if (!mat.bumpTexture) {
          mat.bumpTexture = new Texture('/textures/pbr_grass/grass_pbr_nor_disp_2k.png', this.scene);
        }
        applyUvToTex(mat.bumpTexture);
        (mat.bumpTexture as any).level = safeLevel;
        if ((mat as any)._origBumpTex) {
          applyUvToTex((mat as any)._origBumpTex);
          (mat as any)._origBumpTex.level = safeLevel;
        }
      }

      if (settings.enableBaseColorTex !== undefined) {
        if (!settings.enableBaseColorTex) {
          if (mat.diffuseTexture) (mat as any)._origDiffuseTex = mat.diffuseTexture;
          mat.diffuseTexture = null;
        } else {
          if ((mat as any)._origDiffuseTex) mat.diffuseTexture = (mat as any)._origDiffuseTex;
          applyUvToTex(mat.diffuseTexture);
        }
      }

      if (settings.enableRoughnessTex !== undefined) {
        (mat as any)._userEnableRoughness = !!settings.enableRoughnessTex;
      }
      if (
        settings.specularColor !== undefined ||
        settings.specularPower !== undefined ||
        settings.enableRoughnessTex !== undefined
      ) {
        this.applyObjectSpecularState(mat);
        applyUvToTex(mat.specularTexture);
      }

      if (settings.enableNormalTex !== undefined) {
        if (!settings.enableNormalTex) {
          if (mat.bumpTexture) (mat as any)._origBumpTex = mat.bumpTexture;
          mat.bumpTexture = null;
        } else {
          if ((mat as any)._origBumpTex) mat.bumpTexture = (mat as any)._origBumpTex;
          applyUvToTex(mat.bumpTexture);
        }
      }

      mat.markAsDirty(1);
      mat.resetDrawCache();
    }
  }

  private resetObjectMaterial(mesh: Mesh) {
    const mats = this.getUniqueMaterialsForMesh(mesh);
    for (const mat of mats) {
      const init = (mat as any)._initialSettings;
      if (!init) continue;
      mat.diffuseColor = Color3.FromHexString(init.baseColor);
      (mat as any)._userSpecularColor = init.specularColor;
      (mat as any)._userSpecularPower = init.specularPower;
      (mat as any)._userEnableRoughness = init.hasSpecular;
      this.applyObjectSpecularState(mat);

      if (init.hasDiffuse && (mat as any)._origDiffuseTex) {
        mat.diffuseTexture = (mat as any)._origDiffuseTex;
      }
      if (init.hasBump && (mat as any)._origBumpTex) {
        mat.bumpTexture = (mat as any)._origBumpTex;
        (mat.bumpTexture as any).level = init.normalLevel;
      }

      const allTexs = [
        mat.diffuseTexture,
        mat.bumpTexture,
        mat.specularTexture,
        (mat as any)._origDiffuseTex,
        (mat as any)._origBumpTex,
        (mat as any)._origSpecularTex
      ];
      for (const t of allTexs) {
        if (t) {
          (t as any).uScale = init.uScale;
          (t as any).vScale = init.vScale;
          (t as any).uOffset = init.uOffset;
          (t as any).vOffset = init.vOffset;
        }
      }
      mat.markAsDirty(1);
      mat.resetDrawCache();
    }
  }

  private update(dt: number) {
    this.swingEngine.update(dt);
    // Advance ball physics and trail points BEFORE camera tracking so flight camera & tracer have zero 1-frame lag
    this.ball.step(dt);

    if (this.ball.state === BallState.IN_FLIGHT || this.ball.state === BallState.ROLLING) {
      this.ui.updateShotStats(this.ball.carryDistance, this.ball.totalDistance, false);
    }

    if (this.cameraCtrl.mode === 'flight') {
      const groundY = this.terrain.getElevation(this.ball.position.x, this.ball.position.z);
      this.cameraCtrl.updateFlightCamera(this.ball.position, this.ball.curVelocity, groundY, this.ball.hasLanded);
    }

    if (this.aimSystem && this.activeMode === 'play' && this.ball.state === BallState.AT_REST) {
      this.aimSystem.update(
        this.ball.position,
        this.activeClub,
        this.swingEngine.windSpeedMps,
        this.swingEngine.windHeadingDeg
      );
    }

    // Note: Keep sunLight stationary so CSM cascade texel grids remain rock-solid without jumping during ball flight.

    // Automatically enable both Green Grid and Green Dots when ball settles on the green (or putting) in Play Mode,
    // while keeping manual toolbar toggles completely independent on/off at all times.
    const isBallSettled = this.ball.state === BallState.AT_REST || this.ball.state === BallState.AIMING;
    const isOnGreen = this.terrain.getSurfaceAt(this.ball.position.x, this.ball.position.z) === SurfaceType.GREEN;
    const isSettledOnGreenOrPutting =
      this.activeMode === 'play' && isBallSettled && (isOnGreen || this.activeClub.category === 'putter');

    if (isSettledOnGreenOrPutting && !this.wasSettledOnGreen) {
      this.greenVisualizer.setGridVisible(true);
      this.greenVisualizer.setDotsVisible(true);
      this.ui.setGreenToggleStates(true, true);
      this.autoEnabledGreenOverlays = true;
    } else if (!isSettledOnGreenOrPutting && this.ball.state === BallState.IN_FLIGHT && this.autoEnabledGreenOverlays && !isOnGreen) {
      this.greenVisualizer.setVisible(false);
      this.ui.setGreenToggleStates(false, false);
      this.autoEnabledGreenOverlays = false;
    }
    this.wasSettledOnGreen = isSettledOnGreenOrPutting;

    this.greenVisualizer.updatePuttingFade(dt);
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const app = new FairwayStudioApp();
  (window as any).app = app;
  (window as any).__GOLF_APP__ = app;
  await app.start();
});
