import { PresetFeature, GolfHole, ClubSpec, HoleScore } from '../core/Types';
import { SurfaceType, SURFACE_PROPERTIES } from '../core/Constants';
import { PRESET_FEATURES } from '../terrain/FeatureLibrary';
import { GOLF_CLUBS } from '../game/ClubBag';
import { SwingPhase } from '../game/SwingEngine';
import { soundFx } from '../core/Audio';
import { FeatureMaterialSettings, StampedFeatureRecord } from '../terrain/TerrainGrid';

export interface UIEventCallbacks {
  onMainMenuPlay?: () => void;
  onMainMenuDesigner?: () => void;
  onModeToggle: (mode: 'designer' | 'play') => void;
  onToolSelect: (tool: 'select' | 'sculpt' | 'stamp' | 'set_tee' | 'set_pin' | 'erase') => void;
  onSculptModeSelect: (mode: 'raise' | 'lower' | 'flatten' | 'smooth') => void;
  onPresetSelect: (preset: PresetFeature) => void;
  onBrushRadiusChange: (radius: number) => void;
  onBrushStrengthChange: (strength: number) => void;
  onTargetSurfaceSelect: (surface: SurfaceType) => void;
  onHoleSelect: (holeIndex: number) => void;
  onAddHole: () => void;
  onHoleParChange: (par: 3 | 4 | 5) => void;
  onToggleGrid: () => boolean;
  onToggleGreenGrid: () => boolean;
  onToggleGreenDots: () => boolean;
  onExportCourse: () => void;
  onImportCourse: (json: string) => void;
  onClubSelect: (club: ClubSpec) => void;
  onSwingAction: () => void;
  onAimAdjust: (deltaDeg: number) => void;
  onTargetDistanceAdjust?: (deltaMeters: number) => void;
  onCameraModeToggle: () => void;
  onShotShapeChange?: (shape: 'straight' | 'draw' | 'fade') => void;
  onFocusBall?: () => void;
  onResetShot: () => void;
  onGizmoModeChange?: (mode: 'none' | 'position' | 'rotation' | 'scale') => void;
  onDeleteSelectedObject?: () => void;
  onPushToPlay?: () => void;
  onSaveDefaultHole?: () => void;
  onResetFactoryLayout?: () => void;
  onSelectGroundLayer?: () => void;
  onGroundUvChange?: (settings: {
    baseColor?: string;
    specularColor?: string;
    specularPower?: number;
    uScale?: number;
    vScale?: number;
    uOffset?: number;
    vOffset?: number;
    normalLevel?: number;
    detailBlendLevel?: number;
    enableBaseColorTex?: boolean;
    enableRoughnessTex?: boolean;
    enableNormalTex?: boolean;
  }) => void;
  onResetGroundMaterial?: () => void;
  onFrameSelectedObject?: () => void;
  onSelectFeature?: (featureIndex: number) => void;
  onMoveFeature?: (featureIndex: number, newX: number, newZ: number, isLive?: boolean) => void;
  onRotateFeature?: (featureIndex: number, newRotRad: number, isLive?: boolean) => void;
  onFeatureMaterialChange?: (featureIndex: number, settings: Partial<FeatureMaterialSettings>) => void;
  onResetFeatureMaterial?: (featureIndex: number) => void;
  onObjectMaterialChange?: (settings: {
    baseColor?: string;
    specularColor?: string;
    specularPower?: number;
    uScale?: number;
    vScale?: number;
    uOffset?: number;
    vOffset?: number;
    normalLevel?: number;
    enableBaseColorTex?: boolean;
    enableRoughnessTex?: boolean;
    enableNormalTex?: boolean;
  }) => void;
  onResetObjectMaterial?: () => void;
  onFeatureTextureUpload?: (featureIndex: number, slot: 'color' | 'roughness' | 'normal', dataUrl: string, fileName: string) => void;
  onObjectTextureUpload?: (slot: 'color' | 'roughness' | 'normal', dataUrl: string, fileName: string) => void;
  onGroundTextureUpload?: (slot: 'color' | 'roughness' | 'normal', dataUrl: string, fileName: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
}


interface TipSlide {
  badge: string;
  badgeColor: string;
  title: string;
  description: string;
  rows: { key: string; desc: string }[];
  proTip: string;
}

const TIP_SLIDES: TipSlide[] = [
  {
    badge: 'TEE & DRIVING',
    badgeColor: '#10b981',
    title: 'Teeing Off & Maximum Carry',
    description: 'Championship tee shots set up the entire hole. Plan around prevailing winds and dogleg corners.',
    rows: [
      { key: 'A / D or Drag', desc: 'Adjust aim direction with 3D Aim Chevrons' },
      { key: '1 - 9 / Tab', desc: 'Select Clubs (Driver max carry 300m, 3W, 5W, 3I-9I, PW-LW)' },
      { key: 'Wind Indicator', desc: 'Compensate for crosswinds and headwinds shown in top-left HUD' },
      { key: 'Duck Markers', desc: 'Oriented directly towards the green down the optimal fairway corridor' }
    ],
    proTip: 'Driver carries up to 300m with optimal tailwind. Aim slightly left on dogleg rights to stay clear of fairway bunkers.'
  },
  {
    badge: 'SWING MECHANICS',
    badgeColor: '#3b82f6',
    title: '3-Click PGA Tour Swing Engine',
    description: 'Master the 3-click rhythm for maximum distance and surgical accuracy.',
    rows: [
      { key: '1st Space / Click', desc: 'Starts backswing meter towards peak power' },
      { key: '2nd Space / Click', desc: 'Sets swing power percentage at target notch' },
      { key: '3rd Space / Click', desc: 'Locks impact in the green sweet spot for straight flight' },
      { key: 'Draw / Fade', desc: 'Select Shot Shaper curve: Draw (right-to-left) or Fade (left-to-right)' }
    ],
    proTip: 'Missing impact left produces a hook; missing right produces a slice. Hitting the white center line yields pure trajectory.'
  },
  {
    badge: 'TURF & HAZARDS',
    badgeColor: '#f59e0b',
    title: 'Lies, Bunkers & Water Hazards',
    description: 'Different course surfaces directly influence ball flight, spin, bounce, and roll.',
    rows: [
      { key: 'Fairway', desc: 'Pure 100% power transfer and true forward roll' },
      { key: 'First Cut / Rough', desc: '70% - 85% carry distance with reduced backspin' },
      { key: 'Sand Bunkers', desc: 'High loft sand shots with controlled roll and steep lip clearance' },
      { key: 'Water Hazard', desc: '1 Penalty stroke; ball automatically drops with physics bounce at point of entry' }
    ],
    proTip: 'Bunkers feature revetted sod lips with subtle bounce. Avoid water hazard edges where slopes feed directly into ponds.'
  },
  {
    badge: 'PUTTING GREEN',
    badgeColor: '#06b6d4',
    title: 'Velvety Greens & Dynamic Break Contours',
    description: 'When putting on the green, contour grid lines and animated flow beads activate automatically.',
    rows: [
      { key: 'Auto Activation', desc: 'Grid lines fade in first, followed by flowing downhill slope beads' },
      { key: 'Flow Direction', desc: 'Beads flow downhill in the exact direction the ball will break' },
      { key: 'Bead Color', desc: 'Green = Mild break (<1.8°), Gold = Medium break (<3.5°), Red = Severe break' },
      { key: 'Bead Speed', desc: 'Speed directly reflects the steepness of the green contour' }
    ],
    proTip: 'Aim uphill of the break to allow gravity to guide the putt into the cup liner.'
  },
  {
    badge: 'CAMERA NAVIGATION',
    badgeColor: '#8b5cf6',
    title: 'Silky Smooth View Controls',
    description: 'Full 3D camera navigation for scouting, shot alignment, and course inspection.',
    rows: [
      { key: 'Left Mouse Drag', desc: 'Orbit view smoothly around current target' },
      { key: 'MMB or RMB Drag', desc: 'Pure screen-plane pan with radius-proportional speed' },
      { key: 'Mouse Wheel', desc: 'Zoom camera in and out' },
      { key: 'C Key', desc: 'Toggle top-down aerial course map' },
      { key: 'F Key', desc: 'Toggle Fullscreen in Play mode / Frame Selected Object in Designer' }
    ],
    proTip: 'Middle-mouse button (MMB) and Right-mouse button (RMB) provide identical, ultra-smooth course panning.'
  },
  {
    badge: 'COURSE ARCHITECT',
    badgeColor: '#ec4899',
    title: 'Terrain Sculpting & Stamping',
    description: 'Design custom golf holes with real-time elevation sculpting and surface painting.',
    rows: [
      { key: 'M Key / Header', desc: 'Switch instantly between Play and Designer Architect mode' },
      { key: 'Sculpt Tools [1-5]', desc: 'Raise, Lower, Flatten, Smooth, and Paint brushes' },
      { key: '1m Grid [G]', desc: 'Toggle 1m x 1m terrain contour grid overlay' },
      { key: 'Radius & Strength', desc: 'Adjust brush size (3m - 40m) and sculpting intensity' }
    ],
    proTip: 'Use the Smooth brush along bunker rims and green edges to blend natural grade changes smoothly.'
  },
  {
    badge: 'TRANSFORMS & GIZMOS',
    badgeColor: '#38bdf8',
    title: 'Select, Move, Rotate, Scale & Frame',
    description: 'Full 3D object manipulation with electric blue selection glow and Blender-style gizmos.',
    rows: [
      { key: 'Select Tool [V]', desc: 'Click any tree, rock, cliff, duck marker, or pin flag' },
      { key: 'Blue Selection Glow', desc: 'Vibrant highlight layer wraps selected 3D geometry' },
      { key: 'G / R / S', desc: 'Activate Move [G], Rotate [R], and Scale [S] gizmos' },
      { key: 'F Key', desc: 'Frame camera directly onto selected object and orbit around its center' },
      { key: 'Del / Backspace', desc: 'Delete the selected object from the course' }
    ],
    proTip: 'Press F anytime in Designer mode to center the camera on whatever object or course feature you have selected.'
  },
  {
    badge: 'COURSE SLIDING & ROTATION',
    badgeColor: '#eab308',
    title: 'Slide & Rotate Greens, Fairways & Hazards',
    description: 'Select entire course features and re-position or rotate them across the terrain in real-time.',
    rows: [
      { key: 'Click Feature', desc: 'Click any Tee, Fairway, Green, Bunker, or Water Pond in Select mode [V]' },
      { key: 'Slide on Ground', desc: 'Move feature across terrain with automatic elevation tracking' },
      { key: 'Rotate Z (Blender Yaw)', desc: 'Rotate dogleg angles, hazard orientations, and green entries' },
      { key: 'Push to Play', desc: 'Test changes instantly in live Play mode with Havok physics' },
      { key: 'Save Default Hole', desc: 'Persist your custom hole layout as the new default' }
    ],
    proTip: 'You can select features either by clicking them directly on the course or selecting from the Developer Zone dropdown.'
  }
];

export class UIController {
  private callbacks: UIEventCallbacks;
  private currentMode: 'designer' | 'play' = 'play';
  private currentTipSlideIndex: number = 0;
  private isTipsModalOpen: boolean = false;
  private activeFeatureList: any[] = [];
  private selectedFeatureIdx: number = -1;
  public isSwingEnabled: boolean = true;

  // Elements
  private container: HTMLDivElement;
  private menuOverlay!: HTMLDivElement;
  private menuBgTimer: number | null = null;
  private menuBgIndex: number = 0;
  private isMainMenuVisible: boolean = false;
  private menuFocusedIdx: 0 | 1 = 0;
  private designerPanel!: HTMLDivElement;
  private playHUD!: HTMLDivElement;
  private swingMeterBar!: HTMLDivElement;
  private swingIndicator!: HTMLDivElement;
  private lockedMarker!: HTMLDivElement;
  private lockedLabel!: HTMLElement;
  private swingFeedback!: HTMLDivElement;
  private distanceToPinLabel!: HTMLElement;
  private lieBadge!: HTMLElement;
  private clubNameLabel!: HTMLElement;
  private clubLoftLabel!: HTMLElement;
  private clubCarryLabel!: HTMLElement;
  private windSpeedLabel!: HTMLElement;
  private windArrow!: HTMLElement;
  private holeTitleLabel!: HTMLElement;
  private holeParLabel!: HTMLElement;
  private strokeCounterLabel!: HTMLElement;

  constructor(callbacks: UIEventCallbacks) {
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.id = 'golf-ui-root';
    document.body.appendChild(this.container);

    this.createMainMenuOverlay();
    this.render();
    this.setupListeners();
    this.updateHotkeysGuide('play');
  }

  private render() {
    this.container.innerHTML = `
      <!-- Top Navigation & Header -->
      <header id="ui-header">
        <div class="header-left">
          <div class="logo">
            <span class="logo-ball">⛳</span>
            <span class="logo-text">FAIRWAY<strong>STUDIO</strong></span>
            <span class="badge">PGA TOUR EDITION</span>
          </div>

          <div class="hole-selector" id="hole-tabs">
            <!-- Populated dynamically -->
          </div>

          <button id="btn-open-main-menu" class="btn btn-icon" title="Return to Main Menu [Esc]">
            <span>🏠 Menu</span>
          </button>

          <button id="btn-open-tips" class="btn btn-tips-header" title="Open Controls & Pro Tips Guide">
            <span>💡 Tips & Controls</span>
          </button>
        </div>

        <div class="header-center">
          <button id="btn-mode-toggle" class="btn btn-primary">
            <span id="mode-icon">🎨</span>
            <span id="mode-text">Switch to Designer</span>
          </button>
        </div>

        <div class="header-right">
          <button id="btn-toggle-green-grid" class="btn btn-icon" title="Toggle Green Contour Grid Lines">
            <span>🔲 Green Grid</span>
          </button>
          <button id="btn-toggle-green-dots" class="btn btn-icon" title="Toggle Green Slope Flow Dots">
            <span>🟢 Green Dots</span>
          </button>
          <button id="btn-toggle-grid" class="btn btn-icon" title="Toggle 1m Course Grid Overlay">
            <span>📏 1m Grid</span>
          </button>
          <button id="btn-export-course" class="btn btn-icon" title="Export Course JSON">
            <span>💾 Export</span>
          </button>
          <label class="btn btn-icon btn-file" title="Import Course JSON">
            <span>📂 Import</span>
            <input type="file" id="input-import-course" accept=".json" style="display:none;" />
          </label>
          <button id="btn-ambient-mute" class="btn btn-icon" title="Forest Ambience (Mute/Unmute)">
            <span id="ambient-mute-icon">🌲 🔊</span>
          </button>
          <button id="btn-sfx-mute" class="btn btn-icon" title="Golf Hit & Cup SFX (Mute/Unmute)">
            <span id="sfx-mute-icon">⛳ 🔊</span>
          </button>
          <button id="btn-sound-mute" class="btn btn-icon" title="Master Audio Mute" style="display:none;">
            <span id="mute-icon">🔊</span>
          </button>
        </div>
      </header>

      <!-- DESIGNER MODE DRAWER & TOOLBAR -->
      <aside id="designer-panel" class="hidden">
        <div class="panel-header">
          <h3>Course Architect</h3>
          <span class="scale-info">1m x 1m Grid</span>
        </div>
        <div class="designer-controls-hint" style="background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); border-radius: 6px; padding: 6px 10px; margin: 0 12px 10px 12px; font-size: 11px; color: #a7f3d0; line-height: 1.4;">
          <strong>LMB Hold:</strong> Orbit &nbsp;|&nbsp; <strong>RMB / MMB Hold:</strong> Pan &nbsp;|&nbsp; <strong>Scroll:</strong> Zoom<br/>
          <strong>Click Terrain:</strong> Place / Sculpt &nbsp;|&nbsp; <strong>Shift + Drag:</strong> Paint Sculpt
        </div>

        <div class="panel-section">
          <h4>Editor Modes</h4>
          <div class="tool-tabs">
            <button class="btn tool-tab active" data-tool="select">Select 🎯 [V]</button>
            <button class="btn tool-tab" data-tool="sculpt">Sculpt 🏔️ [B]</button>
            <button class="btn tool-tab" data-tool="stamp">Add Object 🌲 [A]</button>
            <button class="btn tool-tab" data-tool="erase">Erase 🧹 [X]</button>
            <button class="btn tool-tab" data-tool="set_tee">Set Tee ⛳</button>
            <button class="btn tool-tab" data-tool="set_pin">Set Pin 🚩</button>
          </div>
        </div>

        <!-- Select Mode Controls -->
        <div id="select-controls" class="panel-section">
          <h4>Selection Mode Active 🎯</h4>
          <div style="font-size: 11px; color: #a7f3d0; line-height: 1.45; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; padding: 8px 10px;">
            <strong>LMB Click</strong> any tree, rock, cliff, or prop to select it.<br/>
            Use <strong>Move [G]</strong>, <strong>Rotate [R]</strong>, and <strong>Scale [S]</strong> gizmos to adjust.
          </div>
          <button id="btn-select-ground-layer" class="btn btn-sm btn-block mt-2" style="background: rgba(34, 197, 94, 0.2); border: 1px solid #22c55e; color: #86efac; font-weight: 700; padding: 6px 10px;">
            🌱 Inspect Ground PBR Material
          </button>
        </div>

        <!-- Sculpt Controls -->
        <div id="sculpt-controls" class="panel-section hidden">
          <h4>Sculpt Brush</h4>
          <div class="btn-group">
            <button class="btn btn-sm sculpt-mode-btn active" data-sculpt="raise">Raise ⬆️</button>
            <button class="btn btn-sm sculpt-mode-btn" data-sculpt="lower">Lower ⬇️</button>
            <button class="btn btn-sm sculpt-mode-btn" data-sculpt="flatten">Flatten ⏸️</button>
            <button class="btn btn-sm sculpt-mode-btn" data-sculpt="smooth">Smooth 〰️</button>
          </div>

          <div class="slider-control">
            <label>Radius: <span id="val-brush-radius">12m</span></label>
            <input type="range" id="input-brush-radius" min="3" max="30" value="12" />
          </div>
          <div class="slider-control">
            <label>Strength: <span id="val-brush-strength">0.5</span></label>
            <input type="range" id="input-brush-strength" min="0.1" max="1.5" step="0.1" value="0.5" />
          </div>
        </div>

        <!-- Preset Feature Library -->
        <div id="preset-controls" class="panel-section hidden">
          <h4>Preset Library (Auto-Blending)</h4>
          <div class="preset-category-filter">
            <button class="btn-chip active" data-cat="all">All</button>
            <button class="btn-chip" data-cat="green">Greens</button>
            <button class="btn-chip" data-cat="bunker">Bunkers</button>
            <button class="btn-chip" data-cat="fairway">Fairways</button>
            <button class="btn-chip" data-cat="water">Water</button>
            <button class="btn-chip" data-cat="tee">Tees</button>
            <button class="btn-chip" data-cat="scenery">Props</button>
          </div>

          <div class="preset-grid" id="preset-grid-container">
            <!-- Populated dynamically -->
          </div>
        </div>

        <!-- Hole Architecture Details -->
        <div class="panel-section">
          <h4>Active Hole Settings</h4>
          <div class="hole-par-selector">
            <label>Par:</label>
            <button class="btn btn-sm par-btn active" data-par="3">Par 3</button>
            <button class="btn btn-sm par-btn" data-par="4">Par 4</button>
            <button class="btn btn-sm par-btn" data-par="5">Par 5</button>
          </div>
          <button id="btn-add-new-hole" class="btn btn-accent btn-block mt-2">+ Add Hole (up to 9)</button>
        </div>
      </aside>

      <!-- PLAY MODE HUD -->
      <div id="play-hud">
        <!-- Target Info Card -->
        <div class="hud-top-card">
          <div class="hole-meta">
            <h2 id="hud-hole-title">Hole 1</h2>
            <span id="hud-hole-par" class="par-tag">PAR 4</span>
            <span class="stroke-tag">STOKES: <strong id="hud-strokes">0</strong></span>
          </div>
          <div class="distance-display">
            <div class="dist-num" id="hud-dist-to-pin">320<span class="unit">m</span></div>
            <div class="dist-yards" id="hud-dist-yards">350 yds to pin</div>
          </div>
          <div class="lie-status">
            <span>Lie:</span>
            <span id="hud-lie-badge" class="badge-lie badge-tee">Tee Box</span>
          </div>

          <!-- Live Shot Distance Tracker -->
          <div class="shot-tracker-badge" id="hud-shot-tracker" style="display: none;">
            <span class="shot-tracker-label">LAST SHOT</span>
            <span class="shot-tracker-total" id="hud-shot-total">0m</span>
            <span class="shot-tracker-sub" id="hud-shot-breakdown">In flight...</span>
          </div>
        </div>

        <!-- Wind Gauge -->
        <div class="hud-wind-gauge">
          <div class="compass-circle">
            <div class="wind-arrow-wrapper" id="hud-wind-arrow">
              <div class="wind-arrow-head"></div>
            </div>
            <span class="compass-n">N</span>
          </div>
          <div class="wind-speed" id="hud-wind-speed">3.5 m/s</div>
          <div class="wind-sub">WIND</div>
        </div>

        <!-- Club Selection & Shot Info -->
        <div class="hud-club-selector">
          <button id="btn-prev-club" class="btn btn-icon">◀</button>
          <div class="club-info">
            <div class="club-title" id="hud-club-name">Driver 10.5°</div>
            <div class="club-details">
              <span id="hud-club-loft">Loft: 10.5°</span> | 
              <span id="hud-club-carry">Typical: 255m</span>
            </div>
          </div>
          <button id="btn-next-club" class="btn btn-icon">▶</button>
        </div>

        <!-- PGA Tour Shot Shaper Controls -->
        <div class="hud-shot-shaper">
          <span class="shot-shaper-title">SHAPE:</span>
          <div class="shot-shaper-buttons">
            <button id="btn-shape-draw" class="btn btn-shaper" title="Draw shot: curves right-to-left [Q]">⤹ Draw [Q]</button>
            <button id="btn-shape-straight" class="btn btn-shaper active" title="Straight shot [W]">⇡ Straight [W]</button>
            <button id="btn-shape-fade" class="btn btn-shaper" title="Fade shot: curves left-to-right [E]">⤵ Fade [E]</button>
          </div>
        </div>

        <!-- 3-Click AAA Swing Meter -->
        <div class="hud-swing-container">
          <div class="swing-feedback" id="hud-swing-feedback">PRESS SPACE / CLICK TO SWING</div>
          <div class="swing-meter-track">
            <!-- Over-hit zone -->
            <div class="meter-zone meter-power-over"></div>
            <!-- Sweetspot power zone -->
            <div class="meter-zone meter-power-sweet"></div>
            <!-- Impact sweet spot zone (11% to 19%) -->
            <div class="meter-impact-zone"></div>
            <!-- Snap hash line with top & bottom target pointers -->
            <div class="meter-snap-line">
              <span class="snap-marker-top">▼</span>
              <span class="snap-marker-bottom">▲</span>
            </div>
            <!-- Dynamic moving meter bar -->
            <div class="swing-meter-bar" id="hud-meter-bar"></div>
            <!-- Locked power reference line -->
            <div class="meter-locked-marker" id="hud-meter-locked" style="display: none;">
              <span class="locked-power-label" id="hud-locked-label">85%</span>
            </div>
            <!-- High-contrast accuracy marker needle -->
            <div class="swing-accuracy-needle" id="hud-meter-needle">
              <span class="needle-tip-top">▼</span>
              <span class="needle-core"></span>
              <span class="needle-tip-bottom">▲</span>
            </div>
          </div>
          <div class="swing-action-bar">
            <button id="btn-swing-action" class="btn btn-swing">
              <span class="swing-main-btn-text">SWING [SPACE]</span>
            </button>
          </div>
          <div class="hud-aim-controls">
            <button id="btn-aim-left" class="btn btn-sm">◀ Aim Left [← / A]</button>
            <button id="btn-aim-right" class="btn btn-sm">Aim Right [→ / D] ▶</button>
            <button id="btn-focus-ball" class="btn btn-sm">⛳ Ball [B]</button>
            <button id="btn-camera-view" class="btn btn-sm">📷 View [C]</button>
            <button id="btn-fullscreen" class="btn btn-sm">⛶ Fullscreen [F]</button>
          </div>
        </div>

        <!-- In-App Notification Toast Container -->
        <div id="hud-toast-container" class="hud-toast-container"></div>
      </div>

      <!-- DEVELOPER ZONE RIGHT COLLAPSIBLE DRAWER -->
      <aside id="developer-zone-panel" class="hidden">
        <div class="dev-panel-header">
          <div class="dev-panel-title">
            <span class="dev-icon">🛠️</span>
            <h3>DEVELOPER ZONE</h3>
          </div>
          <button id="btn-toggle-dev-zone" class="btn-dev-collapse" title="Collapse / Expand Developer Zone">✕</button>
        </div>
        <div class="dev-panel-body" id="dev-zone-body">
          <!-- History: Undo & Redo -->
          <div class="dev-section" id="dev-history-section" style="padding-bottom: 4px;">
            <div class="dev-section-title">HISTORY (UNDO / REDO)</div>
            <div style="display: flex; gap: 8px;">
              <button id="btn-dev-undo" class="btn btn-secondary btn-sm" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700;" title="Undo last action (Ctrl+Z)" disabled>
                <span>↩ Undo</span>
                <span style="font-size: 10px; opacity: 0.65; background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px;">Ctrl+Z</span>
              </button>
              <button id="btn-dev-redo" class="btn btn-secondary btn-sm" style="flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; font-weight: 700;" title="Redo action (Ctrl+Y)" disabled>
                <span>↪ Redo</span>
                <span style="font-size: 10px; opacity: 0.65; background: rgba(0,0,0,0.3); padding: 1px 4px; border-radius: 3px;">Ctrl+Y</span>
              </button>
            </div>
          </div>

          <!-- Transform Gizmo Mode -->
          <div class="dev-section">
            <div class="dev-section-title">TRANSFORM GIZMO</div>
            <div class="dev-gizmo-buttons">
              <button class="btn btn-dev-gizmo active" data-gizmo="none">None [Q]</button>
              <button class="btn btn-dev-gizmo" data-gizmo="position">Move [G]</button>
              <button class="btn btn-dev-gizmo" data-gizmo="rotation">Rotate [R]</button>
              <button class="btn btn-dev-gizmo" data-gizmo="scale">Scale [S]</button>
            </div>
          </div>

          <!-- Selected Object Inspector -->
          <div class="dev-section">
            <div class="dev-section-title">SELECTED OBJECT</div>
            <div class="dev-info-box" id="dev-selected-info">
              <div class="dev-info-empty">Click any tree, rock, cliff, or prop to select</div>
            </div>
            <div style="display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap;">
              <button id="btn-dev-select-ground" class="btn btn-secondary btn-sm" style="flex: 1; background: rgba(34, 197, 94, 0.16); border-color: rgba(34, 197, 94, 0.45); color: #86efac;">
                🌱 Select Main Ground
              </button>
              <button id="btn-dev-frame-obj" class="btn btn-secondary btn-sm" style="display: none; flex: 1;">
                🎯 Frame Camera [F]
              </button>
              <button id="btn-dev-delete-obj" class="btn btn-danger btn-sm" style="display: none; flex: 1;">
                🗑️ Delete [Del]
              </button>
            </div>
          </div>

          <!-- Course Architecture Features (Slide & Rotate) -->
          <div class="dev-section" id="dev-features-section">
            <div class="dev-section-title">COURSE ARCHITECTURE (Slide & Rotate)</div>
            <div style="font-size: 11px; color: #94a3b8; margin-bottom: 8px; line-height: 1.4;">
              Select greens, fairways, bunkers, tee boxes, or water hazards to slide across ground or rotate around Blender Z.
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">Feature</span>
              <select id="dev-feature-select" class="dev-select" style="flex: 1; background: #0f172a; color: #f8fafc; border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; padding: 4px 8px; font-size: 11px;">
                <option value="-1">-- Click on Course or Pick --</option>
              </select>
            </div>
            <div id="dev-feature-sliders" style="display: none; margin-top: 8px;">
              <div class="dev-control-row">
                <span class="dev-control-lbl">Center X</span>
                <input type="range" id="feat-slide-x" min="10" max="230" step="1" class="dev-slider" />
                <span id="val-feat-x" class="dev-slider-val">0m</span>
              </div>
              <div class="dev-control-row">
                <span class="dev-control-lbl">Center Z</span>
                <input type="range" id="feat-slide-z" min="20" max="450" step="1" class="dev-slider" />
                <span id="val-feat-z" class="dev-slider-val">0m</span>
              </div>
              <div class="dev-control-row">
                <span class="dev-control-lbl">Rotate Z (Yaw)</span>
                <input type="range" id="feat-rotate-z" min="-180" max="180" step="1" class="dev-slider" />
                <span id="val-feat-rot" class="dev-slider-val">0°</span>
              </div>
              <div style="display: flex; gap: 6px; margin-top: 8px;">
                <button id="btn-dev-frame-feat" class="btn btn-secondary btn-sm" style="flex: 1;">
                  🎯 Frame Feature [F]
                </button>
              </div>
            </div>
          </div>

          <!-- Course Feature Material & UV Settings Inspector -->
          <div class="dev-section" id="dev-feature-material-section" style="display: none;">
            <div class="dev-section-title" id="dev-feat-mat-title">FEATURE MATERIAL</div>
            
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 6px; font-weight: 700; letter-spacing: 0.3px;">IMAGE MAPS (PREVIEW & UPLOAD)</div>
            <div class="dev-maps-grid">
              <!-- Color Map -->
              <div class="dev-map-card">
                <div class="dev-map-header">
                  <span class="dev-map-type">COLOR</span>
                  <label class="dev-map-toggle" title="Toggle Base Color Map">
                    <input type="checkbox" id="feat-mat-tex-color" checked />
                  </label>
                </div>
                <div class="dev-map-preview-wrap">
                  <img id="feat-thumb-color" class="dev-map-preview-img" src="/textures/short_grass_01.jpg" alt="Color Map" />
                  <label class="dev-map-upload-overlay" title="Upload custom color texture">
                    <span>📁 Upload</span>
                    <input type="file" id="feat-upload-color" accept="image/*" style="display:none;" />
                  </label>
                </div>
                <div class="dev-map-filename" id="feat-name-color">short_grass_01.jpg</div>
                <label class="dev-map-upload-btn" for="feat-upload-color" title="Upload custom color texture">
                  <span>📁 Upload</span>
                </label>
              </div>

              <!-- Roughness Map -->
              <div class="dev-map-card">
                <div class="dev-map-header">
                  <span class="dev-map-type">ROUGHNESS</span>
                  <label class="dev-map-toggle" title="Toggle Roughness Map">
                    <input type="checkbox" id="feat-mat-tex-rough" checked />
                  </label>
                </div>
                <div class="dev-map-preview-wrap">
                  <img id="feat-thumb-rough" class="dev-map-preview-img" src="/textures/pbr_grass/grass_pbr_rough.jpg" alt="Roughness Map" />
                  <label class="dev-map-upload-overlay" title="Upload custom roughness map">
                    <span>📁 Upload</span>
                    <input type="file" id="feat-upload-rough" accept="image/*" style="display:none;" />
                  </label>
                </div>
                <div class="dev-map-filename" id="feat-name-rough">grass_pbr_rough.jpg</div>
                <label class="dev-map-upload-btn" for="feat-upload-rough" title="Upload custom roughness map">
                  <span>📁 Upload</span>
                </label>
              </div>

              <!-- Normal Map -->
              <div class="dev-map-card">
                <div class="dev-map-header">
                  <span class="dev-map-type">NORMAL</span>
                  <label class="dev-map-toggle" title="Toggle Normal Map">
                    <input type="checkbox" id="feat-mat-tex-normal" checked />
                  </label>
                </div>
                <div class="dev-map-preview-wrap">
                  <img id="feat-thumb-normal" class="dev-map-preview-img" src="/textures/pbr_grass/grass_pbr_nor.jpg" alt="Normal Map" />
                  <label class="dev-map-upload-overlay" title="Upload custom normal map">
                    <span>📁 Upload</span>
                    <input type="file" id="feat-upload-normal" accept="image/*" style="display:none;" />
                  </label>
                </div>
                <div class="dev-map-filename" id="feat-name-normal">grass_pbr_nor.jpg</div>
                <label class="dev-map-upload-btn" for="feat-upload-normal" title="Upload custom normal map">
                  <span>📁 Upload</span>
                </label>
              </div>
            </div>

            <div class="dev-control-row mt-2">
              <span class="dev-control-lbl">Base Color</span>
              <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <input type="color" id="feat-mat-base-color" class="dev-color-input" value="#28a745" />
                <span id="val-feat-base-color" class="dev-color-hex">#28a745</span>
              </div>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">Specular Color</span>
              <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <input type="color" id="feat-mat-spec-color" class="dev-color-input" value="#1a221a" />
                <span id="val-feat-spec-color" class="dev-color-hex">#1a221a</span>
              </div>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">Specular Power</span>
              <input type="range" id="feat-mat-spec-power" min="0" max="128" step="1" value="32" class="dev-slider" />
              <span id="val-feat-spec-power" class="dev-slider-val">32</span>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Scale U</span>
              <input type="range" id="feat-mat-uv-scale-u" min="0.05" max="25.00" step="0.05" value="1.00" class="dev-slider" />
              <span id="val-feat-scale-u" class="dev-slider-val">1.00</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Scale V</span>
              <input type="range" id="feat-mat-uv-scale-v" min="0.05" max="25.00" step="0.05" value="1.00" class="dev-slider" />
              <span id="val-feat-scale-v" class="dev-slider-val">1.00</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Offset U</span>
              <input type="range" id="feat-mat-uv-offset-u" min="-1.00" max="1.00" step="0.02" value="0.00" class="dev-slider" />
              <span id="val-feat-offset-u" class="dev-slider-val">0.00</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Offset V</span>
              <input type="range" id="feat-mat-uv-offset-v" min="-1.00" max="1.00" step="0.02" value="0.00" class="dev-slider" />
              <span id="val-feat-offset-v" class="dev-slider-val">0.00</span>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">Normal Relief</span>
              <input type="range" id="feat-mat-normal-level" min="0.00" max="2.50" step="0.02" value="0.35" class="dev-slider" />
              <span id="val-feat-normal" class="dev-slider-val">0.35</span>
            </div>

            <!-- Lawn Mowing Stripes & Collar Settings -->
            <div id="feat-mowing-section" style="margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.08);">
              <div style="font-size: 10px; color: #38bdf8; font-weight: 700; margin-bottom: 6px; letter-spacing: 0.3px;">LAWN MOWING & COLLAR RINGS</div>
              <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <label class="dev-toggle-chip" id="chip-feat-stripes" style="flex: 1;" title="Toggle alternating lawn mowing stripes">
                  <input type="checkbox" id="feat-mat-stripes-toggle" checked />
                  <span>Mowing Stripes</span>
                </label>
                <label class="dev-toggle-chip" style="flex: 1;" title="Toggle outer fringe/first-cut collar rings and green perimeter border">
                  <input type="checkbox" id="feat-mat-collars-toggle" checked />
                  <span>Collar Rings</span>
                </label>
              </div>
              <div class="dev-control-row" id="row-feat-stripe-width">
                <span class="dev-control-lbl">Stripe Width</span>
                <input type="range" id="feat-mat-stripe-width" min="0.5" max="5.0" step="0.1" value="1.6" class="dev-slider" />
                <span id="val-feat-stripe-width" class="dev-slider-val">1.6m</span>
              </div>
              <div class="dev-control-row" id="row-feat-stripe-contrast">
                <span class="dev-control-lbl">Stripe Contrast</span>
                <input type="range" id="feat-mat-stripe-contrast" min="0.00" max="1.00" step="0.05" value="0.50" class="dev-slider" />
                <span id="val-feat-stripe-contrast" class="dev-slider-val">50%</span>
              </div>
              <div class="dev-control-row" id="row-feat-collar-width">
                <span class="dev-control-lbl">Collar Width</span>
                <input type="range" id="feat-mat-collar-width" min="0.1" max="6.0" step="0.1" value="0.5" class="dev-slider" />
                <span id="val-feat-collar-width" class="dev-slider-val">0.5m</span>
              </div>
            </div>

            <button id="btn-reset-feat-mat" class="btn btn-secondary btn-sm btn-block mt-2">
              🔄 Reset Feature Material
            </button>
          </div>

          <!-- 3D Object Material & UV Settings Inspector -->
          <div class="dev-section" id="dev-object-material-section" style="display: none;">
            <div class="dev-section-title" id="dev-obj-mat-title">3D OBJECT MATERIAL</div>
            
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 6px; font-weight: 700; letter-spacing: 0.3px;">IMAGE MAPS (PREVIEW & UPLOAD)</div>
            <div class="dev-maps-grid">
              <!-- Color Map -->
              <div class="dev-map-card">
                <div class="dev-map-header">
                  <span class="dev-map-type">COLOR</span>
                  <label class="dev-map-toggle" title="Toggle Base Color Map">
                    <input type="checkbox" id="obj-mat-tex-color" checked />
                  </label>
                </div>
                <div class="dev-map-preview-wrap">
                  <img id="obj-thumb-color" class="dev-map-preview-img" src="/textures/pbr_grass/grass_pbr_diff.jpg" alt="Color Map" />
                  <label class="dev-map-upload-overlay" title="Upload custom color texture">
                    <span>📁 Upload</span>
                    <input type="file" id="obj-upload-color" accept="image/*" style="display:none;" />
                  </label>
                </div>
                <div class="dev-map-filename" id="obj-name-color">model_diff.jpg</div>
                <label class="dev-map-upload-btn" for="obj-upload-color" title="Upload custom color texture">
                  <span>📁 Upload</span>
                </label>
              </div>

              <!-- Roughness Map -->
              <div class="dev-map-card">
                <div class="dev-map-header">
                  <span class="dev-map-type">ROUGHNESS</span>
                  <label class="dev-map-toggle" title="Toggle Roughness Map">
                    <input type="checkbox" id="obj-mat-tex-rough" checked />
                  </label>
                </div>
                <div class="dev-map-preview-wrap">
                  <img id="obj-thumb-rough" class="dev-map-preview-img" src="/textures/pbr_grass/grass_pbr_rough.jpg" alt="Roughness Map" />
                  <label class="dev-map-upload-overlay" title="Upload custom roughness map">
                    <span>📁 Upload</span>
                    <input type="file" id="obj-upload-rough" accept="image/*" style="display:none;" />
                  </label>
                </div>
                <div class="dev-map-filename" id="obj-name-rough">model_rough.jpg</div>
                <label class="dev-map-upload-btn" for="obj-upload-rough" title="Upload custom roughness map">
                  <span>📁 Upload</span>
                </label>
              </div>

              <!-- Normal Map -->
              <div class="dev-map-card">
                <div class="dev-map-header">
                  <span class="dev-map-type">NORMAL</span>
                  <label class="dev-map-toggle" title="Toggle Normal Map">
                    <input type="checkbox" id="obj-mat-tex-normal" checked />
                  </label>
                </div>
                <div class="dev-map-preview-wrap">
                  <img id="obj-thumb-normal" class="dev-map-preview-img" src="/textures/pbr_grass/grass_pbr_nor.jpg" alt="Normal Map" />
                  <label class="dev-map-upload-overlay" title="Upload custom normal map">
                    <span>📁 Upload</span>
                    <input type="file" id="obj-upload-normal" accept="image/*" style="display:none;" />
                  </label>
                </div>
                <div class="dev-map-filename" id="obj-name-normal">model_nor.jpg</div>
                <label class="dev-map-upload-btn" for="obj-upload-normal" title="Upload custom normal map">
                  <span>📁 Upload</span>
                </label>
              </div>
            </div>

            <div class="dev-control-row mt-2">
              <span class="dev-control-lbl">Base Color</span>
              <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <input type="color" id="obj-mat-base-color" class="dev-color-input" value="#ffffff" />
                <span id="val-obj-base-color" class="dev-color-hex">#ffffff</span>
              </div>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">Specular Color</span>
              <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <input type="color" id="obj-mat-spec-color" class="dev-color-input" value="#ffffff" />
                <span id="val-obj-spec-color" class="dev-color-hex">#ffffff</span>
              </div>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">Specular Power</span>
              <input type="range" id="obj-mat-spec-power" min="0" max="128" step="1" value="64" class="dev-slider" />
              <span id="val-obj-spec-power" class="dev-slider-val">64</span>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Scale U</span>
              <input type="range" id="obj-mat-uv-scale-u" min="0.05" max="25.00" step="0.05" value="1.00" class="dev-slider" />
              <span id="val-obj-scale-u" class="dev-slider-val">1.00</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Scale V</span>
              <input type="range" id="obj-mat-uv-scale-v" min="0.05" max="25.00" step="0.05" value="1.00" class="dev-slider" />
              <span id="val-obj-scale-v" class="dev-slider-val">1.00</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Offset U</span>
              <input type="range" id="obj-mat-uv-offset-u" min="-1.00" max="1.00" step="0.02" value="0.00" class="dev-slider" />
              <span id="val-obj-offset-u" class="dev-slider-val">0.00</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Offset V</span>
              <input type="range" id="obj-mat-uv-offset-v" min="-1.00" max="1.00" step="0.02" value="0.00" class="dev-slider" />
              <span id="val-obj-offset-v" class="dev-slider-val">0.00</span>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">Normal Relief</span>
              <input type="range" id="obj-mat-normal-level" min="0.00" max="2.50" step="0.02" value="1.00" class="dev-slider" />
              <span id="val-obj-normal" class="dev-slider-val">1.00</span>
            </div>

            <button id="btn-reset-obj-mat" class="btn btn-secondary btn-sm btn-block mt-2">
              🔄 Reset Object Material
            </button>
          </div>

          <!-- Ground PBR Material & UV Settings Inspector -->
          <div class="dev-section" id="dev-ground-pbr-section">
            <div class="dev-section-title">MAIN GROUND MATERIAL (GolfTerrain)</div>
            
            <div style="font-size: 10px; color: #94a3b8; margin-bottom: 6px; font-weight: 700; letter-spacing: 0.3px;">IMAGE MAPS (PREVIEW, TOGGLE & UPLOAD)</div>
            <div class="dev-maps-grid">
              <!-- Color Map -->
              <div class="dev-map-card">
                <div class="dev-map-header">
                  <span class="dev-map-type">COLOR</span>
                  <label class="dev-map-toggle" title="Toggle Ground Color Map">
                    <input type="checkbox" id="ground-mat-tex-color" checked />
                  </label>
                </div>
                <div class="dev-map-preview-wrap">
                  <img id="ground-thumb-color" class="dev-map-preview-img" src="/textures/pbr_grass/grass_pbr_diff.jpg" alt="Ground Color" />
                  <label class="dev-map-upload-overlay" title="Upload custom ground color texture">
                    <span>📁 Upload</span>
                    <input type="file" id="ground-upload-color" accept="image/*" style="display:none;" />
                  </label>
                </div>
                <div class="dev-map-filename" id="ground-name-color">grass_pbr_diff.jpg</div>
                <label class="dev-map-upload-btn" for="ground-upload-color" title="Upload custom ground color texture">
                  <span>📁 Upload</span>
                </label>
              </div>

              <!-- Roughness Map -->
              <div class="dev-map-card">
                <div class="dev-map-header">
                  <span class="dev-map-type">ROUGHNESS</span>
                  <label class="dev-map-toggle" title="Toggle Ground Roughness Map">
                    <input type="checkbox" id="ground-mat-tex-rough" checked />
                  </label>
                </div>
                <div class="dev-map-preview-wrap">
                  <img id="ground-thumb-rough" class="dev-map-preview-img" src="/textures/pbr_grass/grass_pbr_rough.jpg" alt="Ground Roughness" />
                  <label class="dev-map-upload-overlay" title="Upload custom ground roughness map">
                    <span>📁 Upload</span>
                    <input type="file" id="ground-upload-rough" accept="image/*" style="display:none;" />
                  </label>
                </div>
                <div class="dev-map-filename" id="ground-name-rough">grass_pbr_rough.jpg</div>
                <label class="dev-map-upload-btn" for="ground-upload-rough" title="Upload custom ground roughness map">
                  <span>📁 Upload</span>
                </label>
              </div>

              <!-- Normal Map -->
              <div class="dev-map-card">
                <div class="dev-map-header">
                  <span class="dev-map-type">NORMAL</span>
                  <label class="dev-map-toggle" title="Toggle Ground Normal Map">
                    <input type="checkbox" id="ground-mat-tex-normal" checked />
                  </label>
                </div>
                <div class="dev-map-preview-wrap">
                  <img id="ground-thumb-normal" class="dev-map-preview-img" src="/textures/pbr_grass/grass_pbr_nor.jpg" alt="Ground Normal" />
                  <label class="dev-map-upload-overlay" title="Upload custom ground normal map">
                    <span>📁 Upload</span>
                    <input type="file" id="ground-upload-normal" accept="image/*" style="display:none;" />
                  </label>
                </div>
                <div class="dev-map-filename" id="ground-name-normal">grass_pbr_nor.jpg</div>
                <label class="dev-map-upload-btn" for="ground-upload-normal" title="Upload custom ground normal map">
                  <span>📁 Upload</span>
                </label>
              </div>
            </div>

            <div class="dev-control-row mt-2">
              <span class="dev-control-lbl">Base Color</span>
              <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <input type="color" id="ground-mat-base-color" class="dev-color-input" value="#ffffff" />
                <span id="val-ground-base-color" class="dev-color-hex">#ffffff</span>
              </div>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">Specular Color</span>
              <div style="display: flex; align-items: center; gap: 8px; flex: 1;">
                <input type="color" id="ground-mat-spec-color" class="dev-color-input" value="#0a0d08" />
                <span id="val-ground-spec-color" class="dev-color-hex">#0a0d08</span>
              </div>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">Specular Power</span>
              <input type="range" id="ground-mat-spec-power" min="0" max="128" step="1" value="36" class="dev-slider" />
              <span id="val-ground-spec-power" class="dev-slider-val">36</span>
            </div>

            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Scale U</span>
              <input type="range" id="ground-uv-scale-u" min="1" max="1500" step="1" value="110" class="dev-slider" />
              <span id="val-ground-scale-u" class="dev-slider-val">110</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Scale V</span>
              <input type="range" id="ground-uv-scale-v" min="1" max="3000" step="1" value="230" class="dev-slider" />
              <span id="val-ground-scale-v" class="dev-slider-val">230</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Offset U</span>
              <input type="range" id="ground-uv-offset-u" min="-1" max="1" step="0.01" value="0" class="dev-slider" />
              <span id="val-ground-offset-u" class="dev-slider-val">0.00</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">UV Offset V</span>
              <input type="range" id="ground-uv-offset-v" min="-1" max="1" step="0.01" value="0" class="dev-slider" />
              <span id="val-ground-offset-v" class="dev-slider-val">0.00</span>
            </div>
            <div class="dev-control-row">
              <span class="dev-control-lbl">Normal Relief</span>
              <input type="range" id="ground-normal-level" min="0.00" max="2.50" step="0.02" value="0.45" class="dev-slider" />
              <span id="val-ground-normal" class="dev-slider-val">0.45</span>
            </div>

            <button id="btn-reset-ground-mat" class="btn btn-secondary btn-sm btn-block mt-2">
              🔄 Reset Ground Material
            </button>
          </div>

          <!-- Deploy & Persist Zone Actions -->
          <div class="dev-section">
            <div class="dev-section-title">DEPLOY & PERSIST</div>
            <button id="btn-dev-push-to-play" class="btn btn-dev-action btn-dev-push btn-block">
              🚀 Push Changes to Play Mode
            </button>
            <button id="btn-dev-save-default" class="btn btn-dev-action btn-dev-save btn-block mt-2">
              💾 Save Default Hole
            </button>
            <button id="btn-dev-reset-default" class="btn btn-dev-action btn-dev-reset btn-block mt-2">
              🔄 Reset to Factory Default
            </button>
          </div>

          <!-- Scenery & Hole Architecture Stats -->
          <div class="dev-section">
            <div class="dev-section-title">SCENERY METRICS</div>
            <div class="dev-stats-grid">
              <div class="dev-stat-card"><span class="dev-stat-val" id="stat-trees-count">0</span><span class="dev-stat-lbl">Trees</span></div>
              <div class="dev-stat-card"><span class="dev-stat-val" id="stat-rocks-count">0</span><span class="dev-stat-lbl">Rocks</span></div>
              <div class="dev-stat-card"><span class="dev-stat-val" id="stat-cliffs-count">0</span><span class="dev-stat-lbl">Cliffs</span></div>
              <div class="dev-stat-card"><span class="dev-stat-val" id="stat-bunkers-count">0</span><span class="dev-stat-lbl">Bunkers</span></div>
            </div>
          </div>
        </div>
      </aside>

      <!-- FLOATING DRAGGABLE CONTROLS & TIPS SLIDESHOW MODAL -->
      <div id="tips-floating-modal" class="tips-modal hidden">
        <div class="tips-modal-header" id="tips-modal-header">
          <div class="tips-modal-title">
            <span class="tips-modal-icon">💡</span>
            <span class="tips-modal-heading">CONTROLS & PRO TIPS</span>
            <span id="tips-mode-badge" class="tips-mode-badge">PLAY MODE</span>
          </div>
          <button id="btn-close-tips-modal" class="tips-modal-close" title="Close Guide [Esc]">✕</button>
        </div>
        <div class="tips-modal-body">
          <div id="tips-slide-content" class="tips-slide-content">
            <!-- Rendered 1 screen per tip -->
          </div>
        </div>
        <div class="tips-modal-footer">
          <button id="btn-prev-tip" class="btn btn-sm btn-tips-nav">◀ Prev</button>
          <div class="tips-pagination">
            <span id="tips-slide-counter" class="tips-slide-counter">Tip 1 of 8</span>
            <div id="tips-dots-container" class="tips-dots-container"></div>
          </div>
          <button id="btn-next-tip" class="btn btn-sm btn-tips-nav">Next ▶</button>
        </div>
      </div>
    `;

    // Cache elements
    this.designerPanel = document.getElementById('designer-panel') as HTMLDivElement;
    this.playHUD = document.getElementById('play-hud') as HTMLDivElement;
    this.swingMeterBar = document.getElementById('hud-meter-bar') as HTMLDivElement;
    this.swingIndicator = document.getElementById('hud-meter-needle') as HTMLDivElement;
    this.lockedMarker = document.getElementById('hud-meter-locked') as HTMLDivElement;
    this.lockedLabel = document.getElementById('hud-locked-label') as HTMLElement;
    this.swingFeedback = document.getElementById('hud-swing-feedback') as HTMLDivElement;
    this.distanceToPinLabel = document.getElementById('hud-dist-to-pin') as HTMLElement;
    this.lieBadge = document.getElementById('hud-lie-badge') as HTMLElement;
    this.clubNameLabel = document.getElementById('hud-club-name') as HTMLElement;
    this.clubLoftLabel = document.getElementById('hud-club-loft') as HTMLElement;
    this.clubCarryLabel = document.getElementById('hud-club-carry') as HTMLElement;
    this.windSpeedLabel = document.getElementById('hud-wind-speed') as HTMLElement;
    this.windArrow = document.getElementById('hud-wind-arrow') as HTMLElement;
    this.holeTitleLabel = document.getElementById('hud-hole-title') as HTMLElement;
    this.holeParLabel = document.getElementById('hud-hole-par') as HTMLElement;
    this.strokeCounterLabel = document.getElementById('hud-strokes') as HTMLElement;

    this.renderPresets('all');
  }

  public renderPresets(category: string) {
    const grid = document.getElementById('preset-grid-container');
    if (!grid) return;

    const filtered = category === 'all'
      ? PRESET_FEATURES
      : PRESET_FEATURES.filter(p => p.category === category);

    grid.innerHTML = filtered.map((p, idx) => `
      <div class="preset-card ${idx === 0 ? 'selected' : ''}" data-preset-id="${p.id}">
        <span class="preset-icon">${p.icon}</span>
        <div class="preset-info">
          <div class="preset-title">${p.name}</div>
          <div class="preset-desc">${p.description}</div>
        </div>
      </div>
    `).join('');

    // Attach card click handlers
    grid.querySelectorAll('.preset-card').forEach(card => {
      card.addEventListener('click', () => {
        grid.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const id = card.getAttribute('data-preset-id');
        const preset = PRESET_FEATURES.find(p => p.id === id);
        if (preset) this.callbacks.onPresetSelect(preset);
      });
    });
  }

  public updateHolesList(holes: GolfHole[], activeIndex: number) {
    const container = document.getElementById('hole-tabs');
    if (!container) return;

    container.innerHTML = holes.map((h, i) => `
      <button class="hole-tab-btn ${i === activeIndex ? 'active' : ''}" data-hole-idx="${i}">
        Hole ${h.number} (Par ${h.par})
      </button>
    `).join('');

    container.querySelectorAll('.hole-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.getAttribute('data-hole-idx') || '0', 10);
        this.callbacks.onHoleSelect(idx);
      });
    });
  }

  public updateHUD(
    distMeters: number,
    lie: SurfaceType,
    club: ClubSpec,
    strokes: number,
    hole: GolfHole,
    windMps: number,
    windDeg: number
  ) {
    this.distanceToPinLabel.innerHTML = `${Math.round(distMeters)}<span class="unit">m</span>`;
    const ydsElem = document.getElementById('hud-dist-yards');
    if (ydsElem) ydsElem.innerText = `${Math.round(distMeters)}m to pin`;

    this.strokeCounterLabel.innerText = `${strokes}`;
    this.holeTitleLabel.innerText = `Hole ${hole.number}: ${hole.name}`;
    this.holeParLabel.innerText = `PAR ${hole.par}`;

    // Lie badge
    const lieProps = SURFACE_PROPERTIES[lie];
    this.lieBadge.innerText = lieProps.name;
    this.lieBadge.className = `badge-lie badge-${lieProps.name.toLowerCase().replace(/\s+/g, '-')}`;

    // Club
    this.clubNameLabel.innerText = club.name;
    this.clubLoftLabel.innerText = `Loft: ${club.loftDegrees}°`;
    const maxPrefix = club.id === 'driver' ? 'Max: 300m • ' : '';
    this.clubCarryLabel.innerText = `${maxPrefix}Typical: ${club.typicalCarryMeters}m`;
    this.updateClubCard(club.id);

    // Wind
    this.windSpeedLabel.innerText = `${windMps.toFixed(1)} m/s (${Math.round(windMps * 2.23694)} mph)`;
    this.windArrow.style.transform = `rotate(${windDeg}deg)`;
  }

  public updateSwingMeter(progress: number, phase: SwingPhase, lockedPower?: number | null) {
    const swingBtnText = document.querySelector('.swing-main-btn-text') as HTMLElement;

    if (phase === SwingPhase.IDLE) {
      this.swingMeterBar.style.width = '0%';
      this.lockedMarker.style.display = 'none';
      this.swingIndicator.style.left = '15%';
      this.swingIndicator.classList.remove('downswing-active');
      this.swingFeedback.innerText = 'PRESS SPACE / CLICK TO SWING';
      this.swingFeedback.className = 'swing-feedback';
      if (swingBtnText) swingBtnText.innerText = 'SWING [SPACE]';
    } else if (phase === SwingPhase.BACKSWING) {
      const pct = Math.max(0, Math.min(100, progress * 100));
      this.swingMeterBar.style.width = `${pct}%`;
      this.swingIndicator.style.left = `${pct}%`;
      this.lockedMarker.style.display = 'none';
      this.swingIndicator.classList.remove('downswing-active');
      this.swingFeedback.innerText = `BACKSWING: ${Math.round(pct)}% (CLICK TO LOCK POWER)`;
      this.swingFeedback.className = 'swing-feedback feedback-active';
      if (swingBtnText) swingBtnText.innerText = 'LOCK POWER!';
    } else if (phase === SwingPhase.DOWNSWING) {
      // Progress goes down towards 0.0, needle travels across width
      const needlePct = Math.max(0, Math.min(100, progress * 100));
      this.swingIndicator.style.left = `${needlePct}%`;
      this.swingIndicator.classList.add('downswing-active');

      if (lockedPower != null) {
        const lockPct = Math.max(15, Math.min(100, lockedPower * 100));
        this.lockedMarker.style.display = 'flex';
        this.lockedMarker.style.left = `${lockPct}%`;
        this.lockedLabel.innerText = `${Math.round(lockPct)}%`;
        this.swingMeterBar.style.width = `${lockPct}%`;
      }

      this.swingFeedback.innerText = 'DOWNSWING: CLICK ON WHITE IMPACT LINE!';
      this.swingFeedback.className = 'swing-feedback feedback-snap';
      if (swingBtnText) swingBtnText.innerText = 'SNAP STRIKE!';
    } else if (phase === SwingPhase.COMPLETE) {
      this.swingFeedback.innerText = 'STRIKE!';
      if (swingBtnText) swingBtnText.innerText = 'SHOT DISPATCHED!';
    }
  }

  public setSwingFeedbackText(text: string, type: 'perfect' | 'great' | 'draw' | 'fade' | 'hook' | 'slice' | 'miss') {
    this.swingFeedback.innerText = text;
    this.swingFeedback.className = `swing-feedback feedback-${type}`;
  }

  public updateShotStats(carry: number, total: number, isFinal = false) {
    const badge = document.getElementById('hud-shot-tracker');
    const totalLabel = document.getElementById('hud-shot-total');
    const breakdownLabel = document.getElementById('hud-shot-breakdown');
    if (!badge || !totalLabel || !breakdownLabel) return;

    if (total <= 1.5) {
      badge.style.display = 'none';
      return;
    }

    badge.style.display = 'flex';
    const totalMeters = Math.round(total);
    const carryMeters = Math.round(carry || total);
    const rollMeters = Math.max(0, totalMeters - carryMeters);

    totalLabel.innerHTML = `${totalMeters}m`;
    breakdownLabel.innerText = isFinal
      ? `Carry: ${carryMeters}m | Roll: ${rollMeters}m`
      : `In flight... ${totalMeters}m`;
  }

  public updateClubCard(clubId: string, isBallInMotion = false) {
    const driverCard = document.getElementById('club-card-driver');
    const putterCard = document.getElementById('club-card-putter');
    if (!driverCard || !putterCard) return;

    if (isBallInMotion) {
      driverCard.classList.add('fade-out');
      putterCard.classList.add('fade-out');
      driverCard.classList.add('hidden');
      putterCard.classList.add('hidden');
      return;
    }

    if (clubId === 'driver') {
      putterCard.classList.add('hidden');
      putterCard.classList.add('fade-out');
      driverCard.classList.remove('hidden');
      driverCard.classList.remove('fade-out');
    } else if (clubId === 'putter') {
      driverCard.classList.add('hidden');
      driverCard.classList.add('fade-out');
      putterCard.classList.remove('hidden');
      putterCard.classList.remove('fade-out');
    } else {
      driverCard.classList.add('hidden');
      driverCard.classList.add('fade-out');
      putterCard.classList.add('hidden');
      putterCard.classList.add('fade-out');
    }
  }

  public setSwingEnabled(enabled: boolean) {
    this.isSwingEnabled = enabled;
    const swingBtn = document.getElementById('btn-swing-action') as HTMLButtonElement | null;
    const swingBtnText = document.querySelector('.swing-main-btn-text') as HTMLElement | null;
    if (swingBtn) {
      swingBtn.disabled = !enabled;
      if (!enabled) {
        swingBtn.classList.add('btn-swing-disabled');
        if (swingBtnText) swingBtnText.innerText = 'BALL IN FLIGHT...';
        this.swingFeedback.innerText = 'BALL IN MOTION — FREE ORBIT CAMERA ACTIVE';
        this.swingFeedback.className = 'swing-feedback feedback-active';
      } else {
        swingBtn.classList.remove('btn-swing-disabled');
        if (swingBtnText) swingBtnText.innerText = 'SWING [SPACE]';
        this.swingFeedback.innerText = 'PRESS SPACE / CLICK TO SWING';
        this.swingFeedback.className = 'swing-feedback';
      }
    }
  }

  public updateAimStats(targetDistMeters: number, elevationDiffMeters: number) {
    const distElem = document.getElementById('hud-aim-target-dist');
    const elevElem = document.getElementById('hud-aim-elev');
    if (distElem) {
      distElem.innerText = `TARGET: ${Math.round(targetDistMeters)}m`;
    }
    if (elevElem) {
      const sign = elevationDiffMeters >= 0 ? '+' : '';
      elevElem.innerText = `ELEV: ${sign}${elevationDiffMeters.toFixed(1)}m`;
    }
  }

  public showToast(message: string, type: 'info' | 'warning' | 'penalty' | 'success' = 'info', durationMs = 3500) {
    const toastContainer = document.getElementById('hud-toast-container');
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `hud-toast hud-toast-${type}`;
    toast.innerText = message;
    toastContainer.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add('hud-toast-visible');
    });

    setTimeout(() => {
      toast.classList.remove('hud-toast-visible');
      setTimeout(() => toast.remove(), 400);
    }, durationMs);
  }

  public showHoleCompleteModal(
    score: HoleScore,
    isCourseComplete: boolean,
    onNext: () => void,
    onReplay: () => void
  ) {
    const existing = document.getElementById('modal-hole-complete');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'modal-hole-complete';
    modal.className = 'modal-overlay';

    const diff = score.strokes - score.par;
    const badgeClass = diff <= -2 ? 'badge-eagle' :
                       diff === -1 ? 'badge-birdie' :
                       diff === 0 ? 'badge-par' : 'badge-bogey';

    modal.innerHTML = `
      <div class="modal-card celebration-card">
        <div class="celebration-confetti">✨ ⛳ 🎉</div>
        <h2 class="celebration-title">HOLE ${score.holeNumber} COMPLETED!</h2>
        <div class="score-badge ${badgeClass}">${score.scoreText}</div>

        <div class="celebration-stats-grid">
          <div class="stat-col">
            <div class="stat-val">${score.strokes}</div>
            <div class="stat-lbl">STROKES</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-col">
            <div class="stat-val">${score.par}</div>
            <div class="stat-lbl">PAR</div>
          </div>
          <div class="stat-divider"></div>
          <div class="stat-col">
            <div class="stat-val">${score.putts}</div>
            <div class="stat-lbl">PUTTS</div>
          </div>
        </div>

        <div class="celebration-actions">
          ${!isCourseComplete ? `
            <button id="btn-next-hole" class="btn btn-celebration-next">
              NEXT HOLE ➔
            </button>
          ` : `
            <button id="btn-finish-round" class="btn btn-celebration-next">
              ROUND COMPLETE 🏆
            </button>
          `}
          <button id="btn-replay-hole" class="btn btn-celebration-replay">
            ↺ REPLAY HOLE
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('btn-next-hole')?.addEventListener('click', () => {
      modal.remove();
      onNext();
    });

    document.getElementById('btn-finish-round')?.addEventListener('click', () => {
      modal.remove();
      onNext();
    });

    document.getElementById('btn-replay-hole')?.addEventListener('click', () => {
      modal.remove();
      onReplay();
    });
  }

  private createMainMenuOverlay() {
    const existing = document.getElementById('main-menu-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'main-menu-overlay';
    overlay.className = 'main-menu-overlay hidden';
    overlay.innerHTML = `
      <div class="menu-bg-layer">
        <img class="menu-bg-slide active" src="/images/menu/menu_bg_1.jpg" alt="Coastal Links Course" />
        <img class="menu-bg-slide" src="/images/menu/menu_bg_2.jpg" alt="Desert Windmill Course" />
        <img class="menu-bg-slide" src="/images/menu/menu_bg_3.jpg" alt="Red Rock Canyon Course" />
      </div>
      <div class="menu-scrim"></div>

      <div class="menu-brand-header">
        <div class="menu-brand-title">FAIRWAY STUDIO</div>
        <div class="menu-brand-sub">
          <span class="menu-brand-line"></span>
          <span class="menu-brand-tag">3D PRO</span>
          <span class="menu-brand-line"></span>
        </div>
      </div>

      <nav class="menu-glass-card" aria-label="Main Menu">
        <button id="btn-menu-play" type="button" class="menu-option-btn is-active" data-menu-idx="0">
          <span class="menu-option-icon" aria-hidden="true">
            <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.6">
              <circle cx="18" cy="18" r="15.5" />
              <polygon points="15,12 25,18 15,24" fill="none" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="menu-option-label">PLAY HOLE 1</span>
        </button>

        <div class="menu-card-divider"></div>

        <button id="btn-menu-designer" type="button" class="menu-option-btn" data-menu-idx="1">
          <span class="menu-option-icon" aria-hidden="true">
            <svg viewBox="0 0 36 36" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 6H9a3 3 0 0 0-3 3v18a3 3 0 0 0 3 3h18a3 3 0 0 0 3-3V14" />
              <path d="M16 20l13-13 3 3-13 13-4 1 1-4z" />
              <path d="M10 15h4M10 21h2" />
            </svg>
          </span>
          <span class="menu-option-label menu-option-label-stacked">COURSE<br/>DESIGNER</span>
        </button>
      </nav>

      <div class="menu-bottom-hints">
        <button id="btn-menu-hint-select" type="button" class="menu-hint-item" title="Confirm selection [Enter]">
          <span class="menu-hint-glyph">✕</span>
          <span>SELECT</span>
        </button>
        <button id="btn-menu-hint-back" type="button" class="menu-hint-item" title="Close menu [Esc]">
          <span class="menu-hint-glyph">◯</span>
          <span>BACK</span>
        </button>
      </div>
    `;
    document.body.appendChild(overlay);
    this.menuOverlay = overlay;

    const btnPlay = document.getElementById('btn-menu-play');
    const btnDesigner = document.getElementById('btn-menu-designer');
    const btnHintSelect = document.getElementById('btn-menu-hint-select');
    const btnHintBack = document.getElementById('btn-menu-hint-back');

    const updateFocus = (idx: 0 | 1, playHoverSfx = false) => {
      this.menuFocusedIdx = idx;
      btnPlay?.classList.toggle('is-active', idx === 0);
      btnDesigner?.classList.toggle('is-active', idx === 1);
      if (playHoverSfx) soundFx.playMenuHover();
    };

    btnPlay?.addEventListener('mouseenter', () => updateFocus(0, true));
    btnDesigner?.addEventListener('mouseenter', () => updateFocus(1, true));
    btnHintSelect?.addEventListener('mouseenter', () => soundFx.playMenuHover());
    btnHintBack?.addEventListener('mouseenter', () => soundFx.playMenuHover());

    btnPlay?.addEventListener('click', () => {
      updateFocus(0, false);
      soundFx.playMenuSelect();
      this.callbacks.onMainMenuPlay?.();
    });

    btnDesigner?.addEventListener('click', () => {
      updateFocus(1, false);
      soundFx.playMenuSelect();
      this.callbacks.onMainMenuDesigner?.();
    });

    btnHintSelect?.addEventListener('click', () => {
      soundFx.playMenuSelect();
      if (this.menuFocusedIdx === 0) this.callbacks.onMainMenuPlay?.();
      else this.callbacks.onMainMenuDesigner?.();
    });

    btnHintBack?.addEventListener('click', () => {
      soundFx.playMenuSelect();
      if (this.currentMode === 'designer') this.callbacks.onMainMenuDesigner?.();
      else this.callbacks.onMainMenuPlay?.();
    });
  }

  public advanceMenuBackground() {
    const slides = this.menuOverlay?.querySelectorAll('.menu-bg-slide');
    if (!slides || slides.length === 0) return;
    this.menuBgIndex = (this.menuBgIndex + 1) % slides.length;
    slides.forEach((slide, i) => {
      slide.classList.toggle('active', i === this.menuBgIndex);
    });
  }

  public showMainMenu() {
    this.isMainMenuVisible = true;
    document.body.classList.add('in-main-menu');
    this.menuOverlay.classList.remove('hidden');
    this.setMenuFocus(0);
    if (this.menuBgTimer !== null) {
      window.clearInterval(this.menuBgTimer);
    }
    this.menuBgTimer = window.setInterval(() => {
      this.advanceMenuBackground();
    }, 10000);
  }

  public hideMainMenu() {
    this.isMainMenuVisible = false;
    document.body.classList.remove('in-main-menu');
    this.menuOverlay.classList.add('hidden');
    if (this.menuBgTimer !== null) {
      window.clearInterval(this.menuBgTimer);
      this.menuBgTimer = null;
    }
  }

  private setMenuFocus(idx: 0 | 1, playSound = false) {
    const changed = this.menuFocusedIdx !== idx;
    this.menuFocusedIdx = idx;
    document.getElementById('btn-menu-play')?.classList.toggle('is-active', idx === 0);
    document.getElementById('btn-menu-designer')?.classList.toggle('is-active', idx === 1);
    if (playSound && changed) {
      soundFx.playMenuHover();
    }
  }

  public setGreenToggleStates(gridActive: boolean, dotsActive: boolean) {
    document.getElementById('btn-toggle-green-grid')?.classList.toggle('active', gridActive);
    document.getElementById('btn-toggle-green-dots')?.classList.toggle('active', dotsActive);
  }

  private toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  public setMode(mode: 'designer' | 'play') {
    if (this.currentMode !== mode) {
      this.toggleMode();
    } else {
      const devPanel = document.getElementById('developer-zone-panel');
      if (mode === 'designer') {
        this.designerPanel.classList.remove('hidden');
        this.playHUD.classList.add('hidden');
        if (devPanel) devPanel.classList.remove('hidden');
      } else {
        this.designerPanel.classList.add('hidden');
        this.playHUD.classList.remove('hidden');
        if (devPanel) devPanel.classList.add('hidden');
      }
      this.callbacks.onModeToggle(this.currentMode);
    }
  }

  public toggleMode(): 'designer' | 'play' {
    const devPanel = document.getElementById('developer-zone-panel');
    const driverCard = document.getElementById('club-card-driver');
    const putterCard = document.getElementById('club-card-putter');

    if (this.currentMode === 'play') {
      this.currentMode = 'designer';
      this.designerPanel.classList.remove('hidden');
      this.playHUD.classList.add('hidden');
      if (devPanel) devPanel.classList.remove('hidden');
      if (driverCard) driverCard.classList.add('hidden');
      if (putterCard) putterCard.classList.add('hidden');
      document.getElementById('mode-text')!.innerText = 'Switch to Play';
      document.getElementById('mode-icon')!.innerText = '🏌️';
      this.setDesignerTool('select');
    } else {
      this.currentMode = 'play';
      this.designerPanel.classList.add('hidden');
      this.playHUD.classList.remove('hidden');
      if (devPanel) devPanel.classList.add('hidden');
      document.getElementById('mode-text')!.innerText = 'Switch to Designer';
      document.getElementById('mode-icon')!.innerText = '🎨';
    }
    this.updateHotkeysGuide(this.currentMode);
    this.callbacks.onModeToggle(this.currentMode);
    return this.currentMode;
  }

  private setupListeners() {
    // Open Main Menu
    document.getElementById('btn-open-main-menu')?.addEventListener('click', () => {
      soundFx.playMenuSelect();
      this.showMainMenu();
    });

    // Mode toggle
    document.getElementById('btn-mode-toggle')!.addEventListener('click', () => {
      this.toggleMode();
    });

    // Ambience & SFX Independent Audio Controls
    const btnAmbient = document.getElementById('btn-ambient-mute');
    if (btnAmbient) {
      btnAmbient.addEventListener('click', () => {
        const muted = soundFx.toggleAmbientMute();
        const icon = document.getElementById('ambient-mute-icon');
        if (icon) icon.innerText = muted ? '🌲 🔇' : '🌲 🔊';
        btnAmbient.classList.toggle('active-muted', muted);
      });
    }

    const btnSfx = document.getElementById('btn-sfx-mute');
    if (btnSfx) {
      btnSfx.addEventListener('click', () => {
        const muted = soundFx.toggleSfxMute();
        const icon = document.getElementById('sfx-mute-icon');
        if (icon) icon.innerText = muted ? '⛳ 🔇' : '⛳ 🔊';
        btnSfx.classList.toggle('active-muted', muted);
      });
    }

    // Legacy Master Mute fallback
    const btnSound = document.getElementById('btn-sound-mute');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        const muted = soundFx.toggleMute();
        const icon = document.getElementById('mute-icon');
        if (icon) icon.innerText = muted ? '🔇' : '🔊';
        const ambIcon = document.getElementById('ambient-mute-icon');
        if (ambIcon) ambIcon.innerText = muted ? '🌲 🔇' : '🌲 🔊';
        const sfxIcon = document.getElementById('sfx-mute-icon');
        if (sfxIcon) sfxIcon.innerText = muted ? '⛳ 🔇' : '⛳ 🔊';
      });
    }

    // Grid toggle
    document.getElementById('btn-toggle-grid')!.addEventListener('click', () => {
      const active = this.callbacks.onToggleGrid();
      document.getElementById('btn-toggle-grid')!.classList.toggle('active', active);
    });

    // Separate Green Grid & Green Dots toggles
    document.getElementById('btn-toggle-green-grid')!.addEventListener('click', () => {
      const active = this.callbacks.onToggleGreenGrid();
      document.getElementById('btn-toggle-green-grid')!.classList.toggle('active', active);
    });

    document.getElementById('btn-toggle-green-dots')!.addEventListener('click', () => {
      const active = this.callbacks.onToggleGreenDots();
      document.getElementById('btn-toggle-green-dots')!.classList.toggle('active', active);
    });

    // Export / Import
    document.getElementById('btn-export-course')!.addEventListener('click', () => {
      this.callbacks.onExportCourse();
    });

    const fileInput = document.getElementById('input-import-course') as HTMLInputElement;
    fileInput.addEventListener('change', (e) => {
      const target = e.target as HTMLInputElement;
      if (target.files && target.files[0]) {
        const reader = new FileReader();
        reader.onload = (re) => {
          if (re.target?.result) {
            this.callbacks.onImportCourse(re.target.result as string);
          }
        };
        reader.readAsText(target.files[0]);
      }
    });

    // Designer tool tabs
    document.querySelectorAll('.tool-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        const tool = btn.getAttribute('data-tool') as 'select' | 'sculpt' | 'stamp' | 'set_tee' | 'set_pin' | 'erase';
        this.setDesignerTool(tool);
      });
    });

    // Developer Zone collapsible toggle
    const devPanel = document.getElementById('developer-zone-panel');
    const devToggle = document.getElementById('btn-toggle-dev-zone');
    if (devPanel) {
      devPanel.addEventListener('wheel', (e) => {
        e.stopPropagation();
      }, { passive: true });
    }
    if (devToggle && devPanel) {
      devToggle.addEventListener('click', () => {
        devPanel.classList.toggle('dev-collapsed');
        devToggle.innerText = devPanel.classList.contains('dev-collapsed') ? '◀ 🛠️' : '✕';
      });
    }

    // Developer Zone Gizmo Buttons
    document.querySelectorAll('.btn-dev-gizmo').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-gizmo') as 'none' | 'position' | 'rotation' | 'scale';
        this.setGizmoModeButton(mode);
        this.callbacks.onGizmoModeChange?.(mode);
      });
    });

    // Undo & Redo buttons
    document.getElementById('btn-dev-undo')?.addEventListener('click', () => {
      this.callbacks.onUndo?.();
    });
    document.getElementById('btn-dev-redo')?.addEventListener('click', () => {
      this.callbacks.onRedo?.();
    });

    // Delete Selected Object button
    document.getElementById('btn-dev-delete-obj')?.addEventListener('click', () => {
      this.callbacks.onDeleteSelectedObject?.();
    });

    // Push to Play Mode button
    document.getElementById('btn-dev-push-to-play')?.addEventListener('click', () => {
      this.callbacks.onPushToPlay?.();
    });

    // Save Default Hole button
    document.getElementById('btn-dev-save-default')?.addEventListener('click', () => {
      this.callbacks.onSaveDefaultHole?.();
    });

    // Reset to Factory Default button
    document.getElementById('btn-dev-reset-default')?.addEventListener('click', () => {
      this.callbacks.onResetFactoryLayout?.();
    });

    // Select Ground Layer buttons (Architect & Developer Zone)
    document.getElementById('btn-select-ground-layer')?.addEventListener('click', () => {
      this.callbacks.onSelectGroundLayer?.();
    });
    document.getElementById('btn-dev-select-ground')?.addEventListener('click', () => {
      this.callbacks.onSelectGroundLayer?.();
    });

    // Ground PBR Material Controls
    const bindGroundSlider = (id: string, valId: string, prop: string, decimals = 0) => {
      const slider = document.getElementById(id) as HTMLInputElement | null;
      const valSpan = document.getElementById(valId);
      if (slider && valSpan) {
        slider.addEventListener('input', () => {
          const num = parseFloat(slider.value);
          valSpan.innerText = decimals > 0 ? num.toFixed(decimals) : num.toString();
          this.callbacks.onGroundUvChange?.({ [prop]: num });
        });
      }
    };

    bindGroundSlider('ground-uv-scale-u', 'val-ground-scale-u', 'uScale', 0);
    bindGroundSlider('ground-uv-scale-v', 'val-ground-scale-v', 'vScale', 0);
    bindGroundSlider('ground-uv-offset-u', 'val-ground-offset-u', 'uOffset', 2);
    bindGroundSlider('ground-uv-offset-v', 'val-ground-offset-v', 'vOffset', 2);
    bindGroundSlider('ground-normal-level', 'val-ground-normal', 'normalLevel', 2);
    bindGroundSlider('ground-mat-spec-power', 'val-ground-spec-power', 'specularPower', 0);

    const groundBaseColor = document.getElementById('ground-mat-base-color') as HTMLInputElement | null;
    const valGroundBaseColor = document.getElementById('val-ground-base-color');
    groundBaseColor?.addEventListener('input', () => {
      if (valGroundBaseColor) valGroundBaseColor.innerText = groundBaseColor.value;
      this.callbacks.onGroundUvChange?.({ baseColor: groundBaseColor.value });
    });

    const groundSpecColor = document.getElementById('ground-mat-spec-color') as HTMLInputElement | null;
    const valGroundSpecColor = document.getElementById('val-ground-spec-color');
    groundSpecColor?.addEventListener('input', () => {
      if (valGroundSpecColor) valGroundSpecColor.innerText = groundSpecColor.value;
      this.callbacks.onGroundUvChange?.({ specularColor: groundSpecColor.value });
    });

    const chkGroundColor = document.getElementById('ground-mat-tex-color') as HTMLInputElement | null;
    const chkGroundRough = document.getElementById('ground-mat-tex-rough') as HTMLInputElement | null;
    const chkGroundNormal = document.getElementById('ground-mat-tex-normal') as HTMLInputElement | null;
    chkGroundColor?.addEventListener('change', () => {
      this.callbacks.onGroundUvChange?.({ enableBaseColorTex: chkGroundColor.checked });
    });
    chkGroundRough?.addEventListener('change', () => {
      this.callbacks.onGroundUvChange?.({ enableRoughnessTex: chkGroundRough.checked });
    });
    chkGroundNormal?.addEventListener('change', () => {
      this.callbacks.onGroundUvChange?.({ enableNormalTex: chkGroundNormal.checked });
    });

    document.getElementById('btn-reset-ground-mat')?.addEventListener('click', () => {
      this.callbacks.onResetGroundMaterial?.();
    });

    // Tips modal & feature controls setup
    this.setupTipsModal();
    this.setupFeatureControls();
    this.setupFeatureMaterialControls();
    this.setupObjectMaterialControls();
    this.setupGroundTextureControls();

    document.getElementById('btn-dev-frame-obj')?.addEventListener('click', () => {
      this.callbacks.onFrameSelectedObject?.();
    });
    document.getElementById('btn-dev-frame-feat')?.addEventListener('click', () => {
      this.callbacks.onFrameSelectedObject?.();
    });

    // Sculpt mode buttons
    document.querySelectorAll('.sculpt-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sculpt-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const mode = btn.getAttribute('data-sculpt') as 'raise' | 'lower' | 'flatten' | 'smooth';
        this.callbacks.onSculptModeSelect(mode);
      });
    });

    // Sliders
    const radiusInput = document.getElementById('input-brush-radius') as HTMLInputElement;
    radiusInput.addEventListener('input', () => {
      const val = parseFloat(radiusInput.value);
      document.getElementById('val-brush-radius')!.innerText = `${val}m`;
      this.callbacks.onBrushRadiusChange(val);
    });

    const strengthInput = document.getElementById('input-brush-strength') as HTMLInputElement;
    strengthInput.addEventListener('input', () => {
      const val = parseFloat(strengthInput.value);
      document.getElementById('val-brush-strength')!.innerText = `${val.toFixed(1)}`;
      this.callbacks.onBrushStrengthChange(val);
    });

    // Preset category filter chips
    document.querySelectorAll('.btn-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.btn-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const cat = chip.getAttribute('data-cat') || 'all';
        this.renderPresets(cat);
      });
    });

    // Add hole button
    document.getElementById('btn-add-new-hole')!.addEventListener('click', () => {
      this.callbacks.onAddHole();
    });

    // Par buttons
    document.querySelectorAll('.par-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.par-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const par = parseInt(btn.getAttribute('data-par') || '4', 10) as 3 | 4 | 5;
        this.callbacks.onHoleParChange(par);
      });
    });

    // Play Mode Controls
    document.getElementById('btn-swing-action')!.addEventListener('click', () => {
      if (!this.isSwingEnabled) return;
      this.callbacks.onSwingAction();
    });

    document.getElementById('btn-aim-left')!.addEventListener('click', () => {
      this.callbacks.onAimAdjust(-2.0);
    });

    document.getElementById('btn-aim-right')!.addEventListener('click', () => {
      this.callbacks.onAimAdjust(2.0);
    });

    document.getElementById('btn-target-closer')?.addEventListener('click', () => {
      this.callbacks.onTargetDistanceAdjust?.(-10);
    });

    document.getElementById('btn-target-farther')?.addEventListener('click', () => {
      this.callbacks.onTargetDistanceAdjust?.(10);
    });

    document.getElementById('btn-camera-view')!.addEventListener('click', () => {
      this.callbacks.onCameraModeToggle();
    });

    document.getElementById('btn-focus-ball')?.addEventListener('click', () => {
      this.callbacks.onFocusBall?.();
    });

    document.getElementById('btn-fullscreen')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().catch(() => {});
      } else {
        document.exitFullscreen().catch(() => {});
      }
    });

    document.getElementById('btn-reset-shot')?.addEventListener('click', () => {
      this.callbacks.onResetShot();
    });

    // Shot Shaper Button Handlers
    document.getElementById('btn-shape-draw')?.addEventListener('click', () => {
      this.setShotShape('draw');
    });
    document.getElementById('btn-shape-straight')?.addEventListener('click', () => {
      this.setShotShape('straight');
    });
    document.getElementById('btn-shape-fade')?.addEventListener('click', () => {
      this.setShotShape('fade');
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (this.isMainMenuVisible) {
        if (e.code === 'KeyF') {
          this.toggleFullscreen();
          return;
        }
        if (e.key === 'ArrowUp' || e.code === 'KeyW') {
          e.preventDefault();
          this.setMenuFocus(0, true);
        } else if (e.key === 'ArrowDown' || e.code === 'KeyS') {
          e.preventDefault();
          this.setMenuFocus(1, true);
        } else if (e.key === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          soundFx.playMenuSelect();
          if (this.menuFocusedIdx === 0) this.callbacks.onMainMenuPlay?.();
          else this.callbacks.onMainMenuDesigner?.();
        }
        return;
      }

      if (e.key === 'Escape' && !this.isTipsModalOpen && !document.getElementById('modal-hole-complete')) {
        soundFx.playMenuSelect();
        this.showMainMenu();
        return;
      }

      if (e.code === 'KeyF' || e.code === 'NumpadDecimal') {
        if (this.currentMode === 'designer') {
          this.callbacks.onFrameSelectedObject?.();
          return;
        }
        this.toggleFullscreen();
        return;
      }

      if (this.currentMode === 'designer') {
        if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !e.shiftKey) {
          e.preventDefault();
          this.callbacks.onUndo?.();
          return;
        } else if (((e.ctrlKey || e.metaKey) && e.code === 'KeyY') || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyZ')) {
          e.preventDefault();
          this.callbacks.onRedo?.();
          return;
        }

        if (e.code === 'KeyV') {
          this.setDesignerTool('select');
        } else if (e.code === 'KeyB') {
          this.setDesignerTool('sculpt');
        } else if (e.code === 'KeyA') {
          this.setDesignerTool('stamp');
        } else if (e.code === 'KeyX') {
          this.setDesignerTool('erase');
        } else if (e.code === 'KeyG') {
          this.setGizmoModeButton('position');
          this.callbacks.onGizmoModeChange?.('position');
        } else if (e.code === 'KeyR') {
          this.setGizmoModeButton('rotation');
          this.callbacks.onGizmoModeChange?.('rotation');
        } else if (e.code === 'KeyS') {
          this.setGizmoModeButton('scale');
          this.callbacks.onGizmoModeChange?.('scale');
        } else if (e.code === 'KeyQ') {
          this.setGizmoModeButton('none');
          this.callbacks.onGizmoModeChange?.('none');
        } else if (e.code === 'Delete' || e.code === 'Backspace') {
          this.callbacks.onDeleteSelectedObject?.();
        }
        return;
      }

      if (this.currentMode !== 'play') return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!this.isSwingEnabled) return;
        this.callbacks.onSwingAction();
      } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        this.callbacks.onAimAdjust(-1.5);
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        this.callbacks.onAimAdjust(1.5);
      } else if (e.code === 'KeyQ') {
        this.setShotShape('draw');
      } else if (e.code === 'KeyW') {
        this.setShotShape('straight');
      } else if (e.code === 'KeyE') {
        this.setShotShape('fade');
      } else if (e.code === 'KeyB') {
        this.callbacks.onFocusBall?.();
      } else if (e.code === 'KeyC') {
        this.callbacks.onCameraModeToggle();
      } else if (e.code === 'KeyR') {
        this.callbacks.onResetShot();
      }
    });
  }

  public setDesignerTool(tool: 'select' | 'sculpt' | 'stamp' | 'set_tee' | 'set_pin' | 'erase') {
    document.querySelectorAll('.tool-tab').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-tool') === tool);
    });

    const selectControls = document.getElementById('select-controls');
    const sculptControls = document.getElementById('sculpt-controls');
    const presetControls = document.getElementById('preset-controls');

    if (selectControls) selectControls.classList.toggle('hidden', tool !== 'select');
    if (sculptControls) sculptControls.classList.toggle('hidden', tool !== 'sculpt');
    if (presetControls) presetControls.classList.toggle('hidden', tool !== 'stamp');

    this.callbacks.onToolSelect(tool);
  }

  public currentShotShape: 'straight' | 'draw' | 'fade' = 'straight';

  public setShotShape(shape: 'straight' | 'draw' | 'fade') {
    this.currentShotShape = shape;
    const btnDraw = document.getElementById('btn-shape-draw');
    const btnStraight = document.getElementById('btn-shape-straight');
    const btnFade = document.getElementById('btn-shape-fade');
    btnDraw?.classList.toggle('active', shape === 'draw');
    btnStraight?.classList.toggle('active', shape === 'straight');
    btnFade?.classList.toggle('active', shape === 'fade');
    this.callbacks.onShotShapeChange?.(shape);
  }

  public showGroundPbrInspector(settings: {
    baseColor?: string;
    specularColor?: string;
    specularPower?: number;
    uScale: number;
    vScale: number;
    uOffset: number;
    vOffset: number;
    normalLevel: number;
    detailBlendLevel: number;
    enableBaseColorTex?: boolean;
    enableRoughnessTex?: boolean;
    enableNormalTex?: boolean;
    colorMapUrl?: string;
    colorMapName?: string;
    roughnessMapUrl?: string;
    roughnessMapName?: string;
    normalMapUrl?: string;
    normalMapName?: string;
  }, scrollIntoView = false) {
    const groundSec = document.getElementById('dev-ground-pbr-section');
    if (groundSec) groundSec.style.display = 'block';
    const featSec = document.getElementById('dev-feature-material-section');
    if (featSec) featSec.style.display = 'none';
    const objSec = document.getElementById('dev-object-material-section');
    if (objSec) objSec.style.display = 'none';

    const baseColorEl = document.getElementById('ground-mat-base-color') as HTMLInputElement | null;
    const valBaseColor = document.getElementById('val-ground-base-color');
    const specColorEl = document.getElementById('ground-mat-spec-color') as HTMLInputElement | null;
    const valSpecColor = document.getElementById('val-ground-spec-color');
    const specPowerEl = document.getElementById('ground-mat-spec-power') as HTMLInputElement | null;
    const valSpecPower = document.getElementById('val-ground-spec-power');

    const scaleU = document.getElementById('ground-uv-scale-u') as HTMLInputElement | null;
    const scaleV = document.getElementById('ground-uv-scale-v') as HTMLInputElement | null;
    const offU = document.getElementById('ground-uv-offset-u') as HTMLInputElement | null;
    const offV = document.getElementById('ground-uv-offset-v') as HTMLInputElement | null;
    const nor = document.getElementById('ground-normal-level') as HTMLInputElement | null;

    if (baseColorEl && settings.baseColor) {
      baseColorEl.value = settings.baseColor;
      if (valBaseColor) valBaseColor.innerText = settings.baseColor;
    }
    if (specColorEl && settings.specularColor) {
      specColorEl.value = settings.specularColor;
      if (valSpecColor) valSpecColor.innerText = settings.specularColor;
    }
    if (specPowerEl && settings.specularPower !== undefined) {
      specPowerEl.value = settings.specularPower.toString();
      if (valSpecPower) valSpecPower.innerText = settings.specularPower.toString();
    }

    if (scaleU) scaleU.value = settings.uScale.toString();
    if (scaleV) scaleV.value = settings.vScale.toString();
    if (offU) offU.value = settings.uOffset.toString();
    if (offV) offV.value = settings.vOffset.toString();
    if (nor) nor.value = settings.normalLevel.toString();

    const valScaleU = document.getElementById('val-ground-scale-u');
    const valScaleV = document.getElementById('val-ground-scale-v');
    const valOffU = document.getElementById('val-ground-offset-u');
    const valOffV = document.getElementById('val-ground-offset-v');
    const valNor = document.getElementById('val-ground-normal');

    if (valScaleU) valScaleU.innerText = Math.round(settings.uScale).toString();
    if (valScaleV) valScaleV.innerText = Math.round(settings.vScale).toString();
    if (valOffU) valOffU.innerText = settings.uOffset.toFixed(2);
    if (valOffV) valOffV.innerText = settings.vOffset.toFixed(2);
    if (valNor) valNor.innerText = settings.normalLevel.toFixed(2);

    const chkColor = document.getElementById('ground-mat-tex-color') as HTMLInputElement | null;
    const chkRough = document.getElementById('ground-mat-tex-rough') as HTMLInputElement | null;
    const chkNormal = document.getElementById('ground-mat-tex-normal') as HTMLInputElement | null;
    if (chkColor) chkColor.checked = settings.enableBaseColorTex !== false;
    if (chkRough) chkRough.checked = settings.enableRoughnessTex !== false;
    if (chkNormal) chkNormal.checked = settings.enableNormalTex !== false;

    const thumbColor = document.getElementById('ground-thumb-color') as HTMLImageElement | null;
    const nameColor = document.getElementById('ground-name-color');
    const thumbRough = document.getElementById('ground-thumb-rough') as HTMLImageElement | null;
    const nameRough = document.getElementById('ground-name-rough');
    const thumbNormal = document.getElementById('ground-thumb-normal') as HTMLImageElement | null;
    const nameNormal = document.getElementById('ground-name-normal');

    if (thumbColor && settings.colorMapUrl) thumbColor.src = settings.colorMapUrl;
    if (nameColor && settings.colorMapName) nameColor.innerText = settings.colorMapName;
    if (thumbRough && settings.roughnessMapUrl) thumbRough.src = settings.roughnessMapUrl;
    if (nameRough && settings.roughnessMapName) nameRough.innerText = settings.roughnessMapName;
    if (thumbNormal && settings.normalMapUrl) thumbNormal.src = settings.normalMapUrl;
    if (nameNormal && settings.normalMapName) nameNormal.innerText = settings.normalMapName;

    // Also update selected info box to show Main Ground Layer
    const info = document.getElementById('dev-selected-info');
    if (info) {
      info.innerHTML = `
        <div class="dev-obj-name" style="color: #4ade80;">🌱 Main Ground (GolfTerrain)</div>
        <div class="dev-obj-details">Material: Main Ground PBR<br/>Textures: Color, Roughness, NormalGL</div>
      `;
    }
    if (scrollIntoView) {
      groundSec?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  public updateDevStats(trees: number, rocks: number, cliffs: number, bunkers: number) {
    const elTrees = document.getElementById('stat-trees-count');
    const elRocks = document.getElementById('stat-rocks-count');
    const elCliffs = document.getElementById('stat-cliffs-count');
    const elBunkers = document.getElementById('stat-bunkers-count');
    if (elTrees) elTrees.innerText = `${trees}`;
    if (elRocks) elRocks.innerText = `${rocks}`;
    if (elCliffs) elCliffs.innerText = `${cliffs}`;
    if (elBunkers) elBunkers.innerText = `${bunkers}`;
  }

  public setGizmoModeButton(mode: 'none' | 'position' | 'rotation' | 'scale') {
    document.querySelectorAll('.btn-dev-gizmo').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-gizmo') === mode);
    });
  }

  private setupTipsModal() {
    const modal = document.getElementById('tips-floating-modal');
    const header = document.getElementById('tips-modal-header');
    const btnOpen = document.getElementById('btn-open-tips');
    const btnClose = document.getElementById('btn-close-tips-modal');
    const btnPrev = document.getElementById('btn-prev-tip') as HTMLButtonElement | null;
    const btnNext = document.getElementById('btn-next-tip') as HTMLButtonElement | null;

    btnOpen?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleTipsModal();
    });

    btnClose?.addEventListener('click', () => {
      this.closeTipsModal();
    });

    btnPrev?.addEventListener('click', () => {
      if (this.currentTipSlideIndex > 0) {
        this.renderTipSlide(this.currentTipSlideIndex - 1);
      }
    });

    btnNext?.addEventListener('click', () => {
      if (this.currentTipSlideIndex < TIP_SLIDES.length - 1) {
        this.renderTipSlide(this.currentTipSlideIndex + 1);
      }
    });

    // Keyboard navigation when tips window is open
    window.addEventListener('keydown', (e) => {
      if (!this.isTipsModalOpen) return;
      if (e.key === 'Escape') {
        this.closeTipsModal();
      } else if (e.key === 'ArrowLeft') {
        if (this.currentTipSlideIndex > 0) this.renderTipSlide(this.currentTipSlideIndex - 1);
      } else if (e.key === 'ArrowRight') {
        if (this.currentTipSlideIndex < TIP_SLIDES.length - 1) this.renderTipSlide(this.currentTipSlideIndex + 1);
      }
    });

    // Floating window draggable logic
    if (modal && header) {
      let isDragging = false;
      let startX = 0;
      let startY = 0;
      let initialLeft = 20;
      let initialTop = 72;

      header.addEventListener('mousedown', (e: MouseEvent) => {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = modal.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        header.style.cursor = 'grabbing';
        e.preventDefault();
      });

      window.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const newLeft = Math.max(10, Math.min(window.innerWidth - modal.offsetWidth - 10, initialLeft + dx));
        const newTop = Math.max(10, Math.min(window.innerHeight - modal.offsetHeight - 10, initialTop + dy));
        modal.style.left = `${newLeft}px`;
        modal.style.top = `${newTop}px`;
      });

      window.addEventListener('mouseup', () => {
        if (isDragging) {
          isDragging = false;
          header.style.cursor = 'grab';
        }
      });
    }

    this.renderTipSlide(0);
  }

  public openTipsModal(slideIndex?: number) {
    const modal = document.getElementById('tips-floating-modal');
    if (!modal) return;
    this.isTipsModalOpen = true;
    modal.classList.remove('hidden');

    const badge = document.getElementById('tips-mode-badge');
    if (badge) {
      badge.innerText = this.currentMode === 'play' ? 'PLAY MODE' : 'DESIGNER MODE';
    }

    if (slideIndex !== undefined) {
      this.renderTipSlide(slideIndex);
    } else {
      // Jump to relevant slide for current mode if not already on one
      if (this.currentMode === 'designer' && this.currentTipSlideIndex < 5) {
        this.renderTipSlide(5);
      } else if (this.currentMode === 'play' && this.currentTipSlideIndex >= 5) {
        this.renderTipSlide(0);
      } else {
        this.renderTipSlide(this.currentTipSlideIndex);
      }
    }
  }

  public closeTipsModal() {
    const modal = document.getElementById('tips-floating-modal');
    if (!modal) return;
    this.isTipsModalOpen = false;
    modal.classList.add('hidden');
  }

  public toggleTipsModal() {
    if (this.isTipsModalOpen) {
      this.closeTipsModal();
    } else {
      this.openTipsModal();
    }
  }

  private renderTipSlide(index: number) {
    this.currentTipSlideIndex = Math.max(0, Math.min(TIP_SLIDES.length - 1, index));
    const slide = TIP_SLIDES[this.currentTipSlideIndex];
    const container = document.getElementById('tips-slide-content');
    const counter = document.getElementById('tips-slide-counter');
    const dotsContainer = document.getElementById('tips-dots-container');
    const btnPrev = document.getElementById('btn-prev-tip') as HTMLButtonElement | null;
    const btnNext = document.getElementById('btn-next-tip') as HTMLButtonElement | null;

    if (btnPrev) btnPrev.disabled = this.currentTipSlideIndex === 0;
    if (btnNext) btnNext.disabled = this.currentTipSlideIndex === TIP_SLIDES.length - 1;
    if (counter) counter.innerText = `Tip ${this.currentTipSlideIndex + 1} of ${TIP_SLIDES.length}`;

    if (container) {
      container.innerHTML = `
        <span class="tip-card-badge" style="background: ${slide.badgeColor}22; border: 1px solid ${slide.badgeColor}66; color: ${slide.badgeColor};">
          ${slide.badge}
        </span>
        <div class="tip-card-title">${slide.title}</div>
        <div class="tip-card-desc">${slide.description}</div>
        <div class="tip-card-rows">
          ${slide.rows.map(r => `
            <div class="tip-row">
              <span class="tip-key">${r.key}</span>
              <span class="tip-text">${r.desc}</span>
            </div>
          `).join('')}
        </div>
        <div class="tip-protip-box">
          <strong>💡 PRO TIP:</strong> ${slide.proTip}
        </div>
      `;
    }

    if (dotsContainer) {
      dotsContainer.innerHTML = TIP_SLIDES.map((_, i) => `
        <div class="tip-dot ${i === this.currentTipSlideIndex ? 'active' : ''}" data-dot-idx="${i}"></div>
      `).join('');
      dotsContainer.querySelectorAll('.tip-dot').forEach(d => {
        d.addEventListener('click', () => {
          const idx = parseInt(d.getAttribute('data-dot-idx') || '0', 10);
          this.renderTipSlide(idx);
        });
      });
    }
  }

  private setupFeatureControls() {
    const sel = document.getElementById('dev-feature-select') as HTMLSelectElement | null;
    const sliderX = document.getElementById('feat-slide-x') as HTMLInputElement | null;
    const sliderZ = document.getElementById('feat-slide-z') as HTMLInputElement | null;
    const sliderRot = document.getElementById('feat-rotate-z') as HTMLInputElement | null;
    const valX = document.getElementById('val-feat-x');
    const valZ = document.getElementById('val-feat-z');
    const valRot = document.getElementById('val-feat-rot');

    sel?.addEventListener('change', () => {
      const idx = parseInt(sel.value, 10);
      this.selectedFeatureIdx = idx;
      this.callbacks.onSelectFeature?.(idx);
    });

    let moveRaf: number | null = null;
    let pendingX: number | null = null;
    let pendingZ: number | null = null;

    const dispatchMove = (isLive: boolean) => {
      if (pendingX !== null && pendingZ !== null && this.selectedFeatureIdx >= 0) {
        this.callbacks.onMoveFeature?.(this.selectedFeatureIdx, pendingX, pendingZ, isLive);
      }
      moveRaf = null;
    };

    const triggerMove = (x: number, z: number, isLive: boolean) => {
      pendingX = x;
      pendingZ = z;
      if (!isLive) {
        if (moveRaf) cancelAnimationFrame(moveRaf);
        dispatchMove(false);
        return;
      }
      if (!moveRaf) {
        moveRaf = requestAnimationFrame(() => dispatchMove(true));
      }
    };

    sliderX?.addEventListener('input', () => {
      const x = parseFloat(sliderX.value);
      if (valX) valX.innerText = `${x}m`;
      const curZ = sliderZ ? parseFloat(sliderZ.value) : 200;
      triggerMove(x, curZ, true);
    });

    sliderX?.addEventListener('change', () => {
      const x = parseFloat(sliderX.value);
      const curZ = sliderZ ? parseFloat(sliderZ.value) : 200;
      triggerMove(x, curZ, false);
    });

    sliderZ?.addEventListener('input', () => {
      const z = parseFloat(sliderZ.value);
      if (valZ) valZ.innerText = `${z}m`;
      const curX = sliderX ? parseFloat(sliderX.value) : 100;
      triggerMove(curX, z, true);
    });

    sliderZ?.addEventListener('change', () => {
      const z = parseFloat(sliderZ.value);
      const curX = sliderX ? parseFloat(sliderX.value) : 100;
      triggerMove(curX, z, false);
    });

    let rotRaf: number | null = null;
    let pendingRad: number | null = null;

    const dispatchRot = (isLive: boolean) => {
      if (pendingRad !== null && this.selectedFeatureIdx >= 0) {
        this.callbacks.onRotateFeature?.(this.selectedFeatureIdx, pendingRad, isLive);
      }
      rotRaf = null;
    };

    const triggerRot = (rad: number, isLive: boolean) => {
      pendingRad = rad;
      if (!isLive) {
        if (rotRaf) cancelAnimationFrame(rotRaf);
        dispatchRot(false);
        return;
      }
      if (!rotRaf) {
        rotRaf = requestAnimationFrame(() => dispatchRot(true));
      }
    };

    sliderRot?.addEventListener('input', () => {
      const deg = parseFloat(sliderRot.value);
      if (valRot) valRot.innerText = `${deg}°`;
      const rad = (deg * Math.PI) / 180.0;
      triggerRot(rad, true);
    });

    sliderRot?.addEventListener('change', () => {
      const deg = parseFloat(sliderRot.value);
      const rad = (deg * Math.PI) / 180.0;
      triggerRot(rad, false);
    });
  }

  private setupFeatureMaterialControls() {
    const baseColorInput = document.getElementById('feat-mat-base-color') as HTMLInputElement | null;
    const valBaseColor = document.getElementById('val-feat-base-color');
    const specColorInput = document.getElementById('feat-mat-spec-color') as HTMLInputElement | null;
    const valSpecColor = document.getElementById('val-feat-spec-color');
    const specPowerInput = document.getElementById('feat-mat-spec-power') as HTMLInputElement | null;
    const valSpecPower = document.getElementById('val-feat-spec-power');

    const scaleUInput = document.getElementById('feat-mat-uv-scale-u') as HTMLInputElement | null;
    const valScaleU = document.getElementById('val-feat-scale-u');
    const scaleVInput = document.getElementById('feat-mat-uv-scale-v') as HTMLInputElement | null;
    const valScaleV = document.getElementById('val-feat-scale-v');
    const offsetUInput = document.getElementById('feat-mat-uv-offset-u') as HTMLInputElement | null;
    const valOffsetU = document.getElementById('val-feat-offset-u');
    const offsetVInput = document.getElementById('feat-mat-uv-offset-v') as HTMLInputElement | null;
    const valOffsetV = document.getElementById('val-feat-offset-v');

    const normalInput = document.getElementById('feat-mat-normal-level') as HTMLInputElement | null;
    const valNormal = document.getElementById('val-feat-normal');

    const chkColor = document.getElementById('feat-mat-tex-color') as HTMLInputElement | null;
    const chkRough = document.getElementById('feat-mat-tex-rough') as HTMLInputElement | null;
    const chkNormal = document.getElementById('feat-mat-tex-normal') as HTMLInputElement | null;
    const btnReset = document.getElementById('btn-reset-feat-mat');

    const notifyChange = (settings: Partial<FeatureMaterialSettings>) => {
      if (this.selectedFeatureIdx >= 0) {
        this.callbacks.onFeatureMaterialChange?.(this.selectedFeatureIdx, settings);
      }
    };

    baseColorInput?.addEventListener('input', () => {
      if (valBaseColor) valBaseColor.innerText = baseColorInput.value;
      notifyChange({ baseColor: baseColorInput.value });
    });

    specColorInput?.addEventListener('input', () => {
      if (valSpecColor) valSpecColor.innerText = specColorInput.value;
      notifyChange({ specularColor: specColorInput.value });
    });

    specPowerInput?.addEventListener('input', () => {
      const val = parseInt(specPowerInput.value, 10);
      if (valSpecPower) valSpecPower.innerText = val.toString();
      notifyChange({ specularPower: val });
    });

    scaleUInput?.addEventListener('input', () => {
      const val = parseFloat(scaleUInput.value);
      if (valScaleU) valScaleU.innerText = val.toFixed(2);
      notifyChange({ uScale: val });
    });

    scaleVInput?.addEventListener('input', () => {
      const val = parseFloat(scaleVInput.value);
      if (valScaleV) valScaleV.innerText = val.toFixed(2);
      notifyChange({ vScale: val });
    });

    offsetUInput?.addEventListener('input', () => {
      const val = parseFloat(offsetUInput.value);
      if (valOffsetU) valOffsetU.innerText = val.toFixed(2);
      notifyChange({ uOffset: val });
    });

    offsetVInput?.addEventListener('input', () => {
      const val = parseFloat(offsetVInput.value);
      if (valOffsetV) valOffsetV.innerText = val.toFixed(2);
      notifyChange({ vOffset: val });
    });

    normalInput?.addEventListener('input', () => {
      const val = parseFloat(normalInput.value);
      if (valNormal) valNormal.innerText = val.toFixed(2);
      notifyChange({ normalLevel: val });
    });

    chkColor?.addEventListener('change', () => {
      notifyChange({ enableBaseColorTex: chkColor.checked });
    });
    chkRough?.addEventListener('change', () => {
      notifyChange({ enableRoughnessTex: chkRough.checked });
    });
    chkNormal?.addEventListener('change', () => {
      notifyChange({ enableNormalTex: chkNormal.checked });
    });

    btnReset?.addEventListener('click', () => {
      if (this.selectedFeatureIdx >= 0) {
        this.callbacks.onResetFeatureMaterial?.(this.selectedFeatureIdx);
      }
    });

    // Wire Mowing Stripes & Collar Rings
    const chkStripes = document.getElementById('feat-mat-stripes-toggle') as HTMLInputElement | null;
    const chkCollars = document.getElementById('feat-mat-collars-toggle') as HTMLInputElement | null;
    const sliderStripeWidth = document.getElementById('feat-mat-stripe-width') as HTMLInputElement | null;
    const valStripeWidth = document.getElementById('val-feat-stripe-width');
    const sliderStripeContrast = document.getElementById('feat-mat-stripe-contrast') as HTMLInputElement | null;
    const valStripeContrast = document.getElementById('val-feat-stripe-contrast');
    const sliderCollarWidth = document.getElementById('feat-mat-collar-width') as HTMLInputElement | null;
    const valCollarWidth = document.getElementById('val-feat-collar-width');

    chkStripes?.addEventListener('change', () => {
      notifyChange({ showMowingStripes: chkStripes.checked });
    });

    chkCollars?.addEventListener('change', () => {
      notifyChange({ showCollarRings: chkCollars.checked });
    });

    sliderStripeWidth?.addEventListener('input', () => {
      const val = parseFloat(sliderStripeWidth.value);
      if (valStripeWidth) valStripeWidth.innerText = `${val.toFixed(1)}m`;
      notifyChange({ mowingStripeWidth: val });
    });

    sliderStripeContrast?.addEventListener('input', () => {
      const val = parseFloat(sliderStripeContrast.value);
      if (valStripeContrast) valStripeContrast.innerText = `${Math.round(val * 100)}%`;
      notifyChange({ mowingStripeContrast: val });
    });

    sliderCollarWidth?.addEventListener('input', () => {
      const val = parseFloat(sliderCollarWidth.value);
      if (valCollarWidth) valCollarWidth.innerText = `${val.toFixed(1)}m`;
      notifyChange({ collarWidth: val });
    });

    // Wire Feature Image Map Uploads
    const bindFeatureUpload = (inputId: string, thumbId: string, nameId: string, slot: 'color' | 'roughness' | 'normal') => {
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      input?.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          if (!dataUrl) return;
          const thumb = document.getElementById(thumbId) as HTMLImageElement | null;
          const nameEl = document.getElementById(nameId);
          if (thumb) thumb.src = dataUrl;
          if (nameEl) nameEl.innerText = file.name;
          if (this.selectedFeatureIdx >= 0) {
            this.callbacks.onFeatureTextureUpload?.(this.selectedFeatureIdx, slot, dataUrl, file.name);
          }
        };
        reader.readAsDataURL(file);
        input.value = '';
      });
    };
    bindFeatureUpload('feat-upload-color', 'feat-thumb-color', 'feat-name-color', 'color');
    bindFeatureUpload('feat-upload-rough', 'feat-thumb-rough', 'feat-name-rough', 'roughness');
    bindFeatureUpload('feat-upload-normal', 'feat-thumb-normal', 'feat-name-normal', 'normal');
  }

  private setupObjectMaterialControls() {
    const baseColorInput = document.getElementById('obj-mat-base-color') as HTMLInputElement | null;
    const valBaseColor = document.getElementById('val-obj-base-color');
    const specColorInput = document.getElementById('obj-mat-spec-color') as HTMLInputElement | null;
    const valSpecColor = document.getElementById('val-obj-spec-color');
    const specPowerInput = document.getElementById('obj-mat-spec-power') as HTMLInputElement | null;
    const valSpecPower = document.getElementById('val-obj-spec-power');

    const scaleUInput = document.getElementById('obj-mat-uv-scale-u') as HTMLInputElement | null;
    const valScaleU = document.getElementById('val-obj-scale-u');
    const scaleVInput = document.getElementById('obj-mat-uv-scale-v') as HTMLInputElement | null;
    const valScaleV = document.getElementById('val-obj-scale-v');
    const offsetUInput = document.getElementById('obj-mat-uv-offset-u') as HTMLInputElement | null;
    const valOffsetU = document.getElementById('val-obj-offset-u');
    const offsetVInput = document.getElementById('obj-mat-uv-offset-v') as HTMLInputElement | null;
    const valOffsetV = document.getElementById('val-obj-offset-v');

    const normalInput = document.getElementById('obj-mat-normal-level') as HTMLInputElement | null;
    const valNormal = document.getElementById('val-obj-normal');

    const chkColor = document.getElementById('obj-mat-tex-color') as HTMLInputElement | null;
    const chkRough = document.getElementById('obj-mat-tex-rough') as HTMLInputElement | null;
    const chkNormal = document.getElementById('obj-mat-tex-normal') as HTMLInputElement | null;
    const btnReset = document.getElementById('btn-reset-obj-mat');

    const notifyChange = (settings: any) => {
      this.callbacks.onObjectMaterialChange?.(settings);
    };

    baseColorInput?.addEventListener('input', () => {
      if (valBaseColor) valBaseColor.innerText = baseColorInput.value;
      notifyChange({ baseColor: baseColorInput.value });
    });

    specColorInput?.addEventListener('input', () => {
      if (valSpecColor) valSpecColor.innerText = specColorInput.value;
      notifyChange({ specularColor: specColorInput.value });
    });

    specPowerInput?.addEventListener('input', () => {
      const val = parseInt(specPowerInput.value, 10);
      if (valSpecPower) valSpecPower.innerText = val.toString();
      notifyChange({ specularPower: val });
    });

    scaleUInput?.addEventListener('input', () => {
      const val = parseFloat(scaleUInput.value);
      if (valScaleU) valScaleU.innerText = val.toFixed(2);
      notifyChange({ uScale: val });
    });

    scaleVInput?.addEventListener('input', () => {
      const val = parseFloat(scaleVInput.value);
      if (valScaleV) valScaleV.innerText = val.toFixed(2);
      notifyChange({ vScale: val });
    });

    offsetUInput?.addEventListener('input', () => {
      const val = parseFloat(offsetUInput.value);
      if (valOffsetU) valOffsetU.innerText = val.toFixed(2);
      notifyChange({ uOffset: val });
    });

    offsetVInput?.addEventListener('input', () => {
      const val = parseFloat(offsetVInput.value);
      if (valOffsetV) valOffsetV.innerText = val.toFixed(2);
      notifyChange({ vOffset: val });
    });

    normalInput?.addEventListener('input', () => {
      const val = parseFloat(normalInput.value);
      if (valNormal) valNormal.innerText = val.toFixed(2);
      notifyChange({ normalLevel: val });
    });

    chkColor?.addEventListener('change', () => {
      notifyChange({ enableBaseColorTex: chkColor.checked });
    });
    chkRough?.addEventListener('change', () => {
      notifyChange({ enableRoughnessTex: chkRough.checked });
    });
    chkNormal?.addEventListener('change', () => {
      notifyChange({ enableNormalTex: chkNormal.checked });
    });

    btnReset?.addEventListener('click', () => {
      this.callbacks.onResetObjectMaterial?.();
    });

    // Wire 3D Object Image Map Uploads
    const bindObjectUpload = (inputId: string, thumbId: string, nameId: string, slot: 'color' | 'roughness' | 'normal') => {
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      input?.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          if (!dataUrl) return;
          const thumb = document.getElementById(thumbId) as HTMLImageElement | null;
          const nameEl = document.getElementById(nameId);
          if (thumb) thumb.src = dataUrl;
          if (nameEl) nameEl.innerText = file.name;
          this.callbacks.onObjectTextureUpload?.(slot, dataUrl, file.name);
        };
        reader.readAsDataURL(file);
        input.value = '';
      });
    };
    bindObjectUpload('obj-upload-color', 'obj-thumb-color', 'obj-name-color', 'color');
    bindObjectUpload('obj-upload-rough', 'obj-thumb-rough', 'obj-name-rough', 'roughness');
    bindObjectUpload('obj-upload-normal', 'obj-thumb-normal', 'obj-name-normal', 'normal');
  }

  private setupGroundTextureControls() {
    const bindGroundUpload = (
      inputId: string,
      thumbId: string,
      nameId: string,
      chkId: string,
      slot: 'color' | 'roughness' | 'normal'
    ) => {
      const input = document.getElementById(inputId) as HTMLInputElement | null;
      input?.addEventListener('change', () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
          const dataUrl = e.target?.result as string;
          if (!dataUrl) return;
          const thumb = document.getElementById(thumbId) as HTMLImageElement | null;
          const nameEl = document.getElementById(nameId);
          const chkEl = document.getElementById(chkId) as HTMLInputElement | null;
          if (thumb) thumb.src = dataUrl;
          if (nameEl) nameEl.innerText = file.name;
          if (chkEl) chkEl.checked = true;
          this.callbacks.onGroundTextureUpload?.(slot, dataUrl, file.name);
        };
        reader.readAsDataURL(file);
        input.value = '';
      });
    };
    bindGroundUpload('ground-upload-color', 'ground-thumb-color', 'ground-name-color', 'ground-mat-tex-color', 'color');
    bindGroundUpload('ground-upload-rough', 'ground-thumb-rough', 'ground-name-rough', 'ground-mat-tex-rough', 'roughness');
    bindGroundUpload('ground-upload-normal', 'ground-thumb-normal', 'ground-name-normal', 'ground-mat-tex-normal', 'normal');
  }

  public updateFeatureList(features: any[], selectedIndex: number = -1) {
    this.activeFeatureList = features;
    this.selectedFeatureIdx = selectedIndex;

    const sel = document.getElementById('dev-feature-select') as HTMLSelectElement | null;
    if (sel) {
      sel.innerHTML = '<option value="-1">-- Click on Course or Pick --</option>' +
        features.map((f, i) => `
          <option value="${i}" ${i === selectedIndex ? 'selected' : ''}>
            ${f.name || f.surfaceType} (${Math.round(f.centerX)}m, ${Math.round(f.centerZ)}m)
          </option>
        `).join('');
    }

    const controls = document.getElementById('dev-feature-sliders');
    if (selectedIndex >= 0 && selectedIndex < features.length) {
      const feat = features[selectedIndex];
      if (controls) controls.style.display = 'block';
      this.updateDevSelectedFeature(feat, selectedIndex);
    } else {
      if (controls) controls.style.display = 'none';
    }
  }

  public updateDevSelectedFeature(feat: any | null, index: number) {
    this.selectedFeatureIdx = index;
    const controls = document.getElementById('dev-feature-sliders');
    const sel = document.getElementById('dev-feature-select') as HTMLSelectElement | null;
    if (sel) sel.value = index.toString();

    if (!feat || index < 0) {
      if (controls) controls.style.display = 'none';
      return;
    }

    if (controls) controls.style.display = 'block';
    const sliderX = document.getElementById('feat-slide-x') as HTMLInputElement | null;
    const sliderZ = document.getElementById('feat-slide-z') as HTMLInputElement | null;
    const sliderRot = document.getElementById('feat-rotate-z') as HTMLInputElement | null;
    const valX = document.getElementById('val-feat-x');
    const valZ = document.getElementById('val-feat-z');
    const valRot = document.getElementById('val-feat-rot');

    if (sliderX) sliderX.value = feat.centerX.toString();
    if (sliderZ) sliderZ.value = feat.centerZ.toString();
    const deg = Math.round((feat.rotationRad * 180.0) / Math.PI);
    if (sliderRot) sliderRot.value = deg.toString();

    if (valX) valX.innerText = `${Math.round(feat.centerX)}m`;
    if (valZ) valZ.innerText = `${Math.round(feat.centerZ)}m`;
    if (valRot) valRot.innerText = `${deg}°`;

    // Also reflect in the dev-selected-info box
    const info = document.getElementById('dev-selected-info');
    if (info) {
      info.innerHTML = `
        <div class="dev-obj-name" style="color: #38bdf8;">${feat.name || feat.surfaceType}</div>
        <div class="dev-obj-details">
          Center: X: ${feat.centerX.toFixed(1)}m, Z: ${feat.centerZ.toFixed(1)}m<br/>
          Rotation Z: ${deg}° | Size: ${Math.round(feat.width)}m x ${Math.round(feat.length)}m
        </div>
      `;
    }
  }

  public updateDevSelectedObject(mesh: any | null) {
    const info = document.getElementById('dev-selected-info');
    const btnDel = document.getElementById('btn-dev-delete-obj');
    const btnFrame = document.getElementById('btn-dev-frame-obj');
    if (!info) return;

    if (!mesh) {
      if (this.selectedFeatureIdx < 0) {
        info.innerHTML = '<div class="dev-info-empty">Click any tree, rock, cliff, prop, or course feature to select</div>';
      }
      if (btnDel) btnDel.style.display = 'none';
      if (btnFrame) btnFrame.style.display = 'none';
      return;
    }

    if (btnDel) btnDel.style.display = 'block';
    if (btnFrame) btnFrame.style.display = 'block';

    const p = mesh.position;
    const r = mesh.rotation;
    const s = mesh.scaling;
    const rotZDeg = Math.round((r.y * 180) / Math.PI); // World Y is Blender Z

    info.innerHTML = `
      <div class="dev-obj-name">${mesh.name}</div>
      <div class="dev-obj-details">
        Pos: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})<br/>
        Rot Z: ${rotZDeg}° | Scale: (${s.x.toFixed(2)}, ${s.y.toFixed(2)}, ${s.z.toFixed(2)})
      </div>
    `;
  }

  public updateDevSelectedFeatureMaterial(feat: StampedFeatureRecord | null, mat: FeatureMaterialSettings | null) {
    const sec = document.getElementById('dev-feature-material-section');
    if (!sec) return;

    if (!feat || !mat || this.selectedFeatureIdx < 0) {
      sec.style.display = 'none';
      return;
    }

    sec.style.display = 'block';
    const objSec = document.getElementById('dev-object-material-section');
    if (objSec) objSec.style.display = 'none';
    const groundSec = document.getElementById('dev-ground-pbr-section');
    if (groundSec) groundSec.style.display = 'none';

    const title = document.getElementById('dev-feat-mat-title');
    if (title) {
      title.innerText = `FEATURE MATERIAL (${String(feat.name || feat.surfaceType).toUpperCase()} #${this.selectedFeatureIdx})`;
    }

    const baseColorInput = document.getElementById('feat-mat-base-color') as HTMLInputElement | null;
    const valBaseColor = document.getElementById('val-feat-base-color');
    const specColorInput = document.getElementById('feat-mat-spec-color') as HTMLInputElement | null;
    const valSpecColor = document.getElementById('val-feat-spec-color');
    const specPowerInput = document.getElementById('feat-mat-spec-power') as HTMLInputElement | null;
    const valSpecPower = document.getElementById('val-feat-spec-power');

    const scaleUInput = document.getElementById('feat-mat-uv-scale-u') as HTMLInputElement | null;
    const valScaleU = document.getElementById('val-feat-scale-u');
    const scaleVInput = document.getElementById('feat-mat-uv-scale-v') as HTMLInputElement | null;
    const valScaleV = document.getElementById('val-feat-scale-v');
    const offsetUInput = document.getElementById('feat-mat-uv-offset-u') as HTMLInputElement | null;
    const valOffsetU = document.getElementById('val-feat-offset-u');
    const offsetVInput = document.getElementById('feat-mat-uv-offset-v') as HTMLInputElement | null;
    const valOffsetV = document.getElementById('val-feat-offset-v');

    const normalInput = document.getElementById('feat-mat-normal-level') as HTMLInputElement | null;
    const valNormal = document.getElementById('val-feat-normal');

    const chkColor = document.getElementById('feat-mat-tex-color') as HTMLInputElement | null;
    const chkRough = document.getElementById('feat-mat-tex-rough') as HTMLInputElement | null;
    const chkNormal = document.getElementById('feat-mat-tex-normal') as HTMLInputElement | null;

    if (baseColorInput && mat.baseColor) {
      baseColorInput.value = mat.baseColor;
      if (valBaseColor) valBaseColor.innerText = mat.baseColor;
    }
    if (specColorInput && mat.specularColor) {
      specColorInput.value = mat.specularColor;
      if (valSpecColor) valSpecColor.innerText = mat.specularColor;
    }
    if (specPowerInput && mat.specularPower !== undefined) {
      specPowerInput.value = mat.specularPower.toString();
      if (valSpecPower) valSpecPower.innerText = mat.specularPower.toString();
    }
    if (scaleUInput && mat.uScale !== undefined) {
      scaleUInput.value = mat.uScale.toString();
      if (valScaleU) valScaleU.innerText = mat.uScale.toFixed(2);
    }
    if (scaleVInput && mat.vScale !== undefined) {
      scaleVInput.value = mat.vScale.toString();
      if (valScaleV) valScaleV.innerText = mat.vScale.toFixed(2);
    }
    if (offsetUInput && mat.uOffset !== undefined) {
      offsetUInput.value = mat.uOffset.toString();
      if (valOffsetU) valOffsetU.innerText = mat.uOffset.toFixed(2);
    }
    if (offsetVInput && mat.vOffset !== undefined) {
      offsetVInput.value = mat.vOffset.toString();
      if (valOffsetV) valOffsetV.innerText = mat.vOffset.toFixed(2);
    }
    if (normalInput && mat.normalLevel !== undefined) {
      normalInput.value = mat.normalLevel.toString();
      if (valNormal) valNormal.innerText = mat.normalLevel.toFixed(2);
    }
    if (chkColor) chkColor.checked = mat.enableBaseColorTex !== false;
    if (chkRough) chkRough.checked = mat.enableRoughnessTex !== false;
    if (chkNormal) chkNormal.checked = mat.enableNormalTex !== false;

    // Populate Lawn Mowing Stripes & Collar Rings
    const mowingSec = document.getElementById('feat-mowing-section');
    const chipStripes = document.getElementById('chip-feat-stripes');
    const rowStripeWidth = document.getElementById('row-feat-stripe-width');
    const rowStripeContrast = document.getElementById('row-feat-stripe-contrast');

    if (mowingSec) mowingSec.style.display = 'block';

    if (feat.surfaceType === SurfaceType.BUNKER || feat.surfaceType === SurfaceType.WATER) {
      if (chipStripes) chipStripes.style.display = 'none';
      if (rowStripeWidth) rowStripeWidth.style.display = 'none';
      if (rowStripeContrast) rowStripeContrast.style.display = 'none';
    } else {
      if (chipStripes) chipStripes.style.display = 'flex';
      if (rowStripeWidth) rowStripeWidth.style.display = 'flex';
      if (rowStripeContrast) rowStripeContrast.style.display = 'flex';
    }

    const chkStripes = document.getElementById('feat-mat-stripes-toggle') as HTMLInputElement | null;
    const chkCollars = document.getElementById('feat-mat-collars-toggle') as HTMLInputElement | null;
    const sliderStripeWidth = document.getElementById('feat-mat-stripe-width') as HTMLInputElement | null;
    const valStripeWidth = document.getElementById('val-feat-stripe-width');
    const sliderStripeContrast = document.getElementById('feat-mat-stripe-contrast') as HTMLInputElement | null;
    const valStripeContrast = document.getElementById('val-feat-stripe-contrast');
    const sliderCollarWidth = document.getElementById('feat-mat-collar-width') as HTMLInputElement | null;
    const valCollarWidth = document.getElementById('val-feat-collar-width');

    if (chkStripes) chkStripes.checked = mat.showMowingStripes !== false;
    if (chkCollars) chkCollars.checked = mat.showCollarRings !== false;
    const stripeW = mat.mowingStripeWidth ?? (feat.surfaceType === SurfaceType.TEE ? 1.6 : feat.surfaceType === SurfaceType.GREEN ? 1.8 : 4.6);
    if (sliderStripeWidth) sliderStripeWidth.value = stripeW.toString();
    if (valStripeWidth) valStripeWidth.innerText = `${stripeW.toFixed(1)}m`;
    const stripeC = mat.mowingStripeContrast ?? 0.5;
    if (sliderStripeContrast) sliderStripeContrast.value = stripeC.toString();
    if (valStripeContrast) valStripeContrast.innerText = `${Math.round(stripeC * 100)}%`;

    const defCollar = feat.surfaceType === SurfaceType.TEE ? 0.5 :
                      feat.surfaceType === SurfaceType.GREEN ? 2.2 :
                      feat.surfaceType === SurfaceType.FAIRWAY ? 2.0 :
                      feat.surfaceType === SurfaceType.BUNKER ? 1.2 : 2.15;
    const collarW = mat.collarWidth ?? defCollar;
    if (sliderCollarWidth) sliderCollarWidth.value = collarW.toString();
    if (valCollarWidth) valCollarWidth.innerText = `${collarW.toFixed(1)}m`;

    // Populate Feature Map Thumbnails & Filenames
    const featThumbColor = document.getElementById('feat-thumb-color') as HTMLImageElement | null;
    const featNameColor = document.getElementById('feat-name-color');
    const featThumbRough = document.getElementById('feat-thumb-rough') as HTMLImageElement | null;
    const featNameRough = document.getElementById('feat-name-rough');
    const featThumbNormal = document.getElementById('feat-thumb-normal') as HTMLImageElement | null;
    const featNameNormal = document.getElementById('feat-name-normal');

    let defColor = '/textures/short_grass_01.jpg';
    let defColorName = 'short_grass_01.jpg';
    let defRough = '/textures/pbr_grass/grass_pbr_rough.jpg';
    let defRoughName = 'grass_pbr_rough.jpg';
    let defNormal = '/textures/pbr_grass/grass_pbr_nor.jpg';
    let defNormalName = 'grass_pbr_nor.jpg';

    if (feat.surfaceType === SurfaceType.BUNKER) {
      defColor = '/textures/sand_bunker_diff.jpg';
      defColorName = 'sand_bunker_diff.jpg';
      defRough = '/textures/pbr_grass/grass_pbr_rough.jpg';
      defRoughName = 'sand_pbr_rough.jpg';
      defNormal = '/textures/pbr_grass/grass_pbr_nor.jpg';
      defNormalName = 'sand_pbr_nor.jpg';
    } else if (feat.surfaceType === SurfaceType.FAIRWAY) {
      defColor = '/textures/fairway_stripes_01.jpg';
      defColorName = 'fairway_stripes_01.jpg';
    }

    const cUrls = feat.customTextureUrls;
    if (featThumbColor) featThumbColor.src = cUrls?.color || defColor;
    if (featNameColor) featNameColor.innerText = cUrls?.colorName || defColorName;
    if (featThumbRough) featThumbRough.src = cUrls?.roughness || defRough;
    if (featNameRough) featNameRough.innerText = cUrls?.roughnessName || defRoughName;
    if (featThumbNormal) featThumbNormal.src = cUrls?.normal || defNormal;
    if (featNameNormal) featNameNormal.innerText = cUrls?.normalName || defNormalName;
  }

  public updateDevSelectedObjectMaterial(info: any | null) {
    const sec = document.getElementById('dev-object-material-section');
    if (!sec) return;

    if (!info) {
      sec.style.display = 'none';
      return;
    }

    sec.style.display = 'block';
    const featSec = document.getElementById('dev-feature-material-section');
    if (featSec) featSec.style.display = 'none';
    const groundSec = document.getElementById('dev-ground-pbr-section');
    if (groundSec) groundSec.style.display = 'none';

    const title = document.getElementById('dev-obj-mat-title');
    if (title) {
      title.innerText = `3D OBJECT MATERIAL (${info.name || 'OBJECT'})`;
    }

    const baseColorInput = document.getElementById('obj-mat-base-color') as HTMLInputElement | null;
    const valBaseColor = document.getElementById('val-obj-base-color');
    const specColorInput = document.getElementById('obj-mat-spec-color') as HTMLInputElement | null;
    const valSpecColor = document.getElementById('val-obj-spec-color');
    const specPowerInput = document.getElementById('obj-mat-spec-power') as HTMLInputElement | null;
    const valSpecPower = document.getElementById('val-obj-spec-power');

    const scaleUInput = document.getElementById('obj-mat-uv-scale-u') as HTMLInputElement | null;
    const valScaleU = document.getElementById('val-obj-scale-u');
    const scaleVInput = document.getElementById('obj-mat-uv-scale-v') as HTMLInputElement | null;
    const valScaleV = document.getElementById('val-obj-scale-v');
    const offsetUInput = document.getElementById('obj-mat-uv-offset-u') as HTMLInputElement | null;
    const valOffsetU = document.getElementById('val-obj-offset-u');
    const offsetVInput = document.getElementById('obj-mat-uv-offset-v') as HTMLInputElement | null;
    const valOffsetV = document.getElementById('val-obj-offset-v');

    const normalInput = document.getElementById('obj-mat-normal-level') as HTMLInputElement | null;
    const valNormal = document.getElementById('val-obj-normal');

    const chkColor = document.getElementById('obj-mat-tex-color') as HTMLInputElement | null;
    const chkRough = document.getElementById('obj-mat-tex-rough') as HTMLInputElement | null;
    const chkNormal = document.getElementById('obj-mat-tex-normal') as HTMLInputElement | null;

    if (baseColorInput && info.baseColor) {
      baseColorInput.value = info.baseColor;
      if (valBaseColor) valBaseColor.innerText = info.baseColor;
    }
    if (specColorInput && info.specularColor) {
      specColorInput.value = info.specularColor;
      if (valSpecColor) valSpecColor.innerText = info.specularColor;
    }
    if (specPowerInput && info.specularPower !== undefined) {
      specPowerInput.value = info.specularPower.toString();
      if (valSpecPower) valSpecPower.innerText = info.specularPower.toString();
    }
    if (scaleUInput && info.uScale !== undefined) {
      scaleUInput.value = info.uScale.toString();
      if (valScaleU) valScaleU.innerText = info.uScale.toFixed(2);
    }
    if (scaleVInput && info.vScale !== undefined) {
      scaleVInput.value = info.vScale.toString();
      if (valScaleV) valScaleV.innerText = info.vScale.toFixed(2);
    }
    if (offsetUInput && info.uOffset !== undefined) {
      offsetUInput.value = info.uOffset.toString();
      if (valOffsetU) valOffsetU.innerText = info.uOffset.toFixed(2);
    }
    if (offsetVInput && info.vOffset !== undefined) {
      offsetVInput.value = info.vOffset.toString();
      if (valOffsetV) valOffsetV.innerText = info.vOffset.toFixed(2);
    }
    if (normalInput && info.normalLevel !== undefined) {
      normalInput.value = info.normalLevel.toString();
      if (valNormal) valNormal.innerText = info.normalLevel.toFixed(2);
    }
    if (chkColor) chkColor.checked = info.enableBaseColorTex !== false;
    if (chkRough) chkRough.checked = info.enableRoughnessTex !== false;
    if (chkNormal) chkNormal.checked = info.enableNormalTex !== false;

    // Populate 3D Object Map Thumbnails & Filenames
    const objThumbColor = document.getElementById('obj-thumb-color') as HTMLImageElement | null;
    const objNameColor = document.getElementById('obj-name-color');
    const objThumbRough = document.getElementById('obj-thumb-rough') as HTMLImageElement | null;
    const objNameRough = document.getElementById('obj-name-rough');
    const objThumbNormal = document.getElementById('obj-thumb-normal') as HTMLImageElement | null;
    const objNameNormal = document.getElementById('obj-name-normal');

    if (objThumbColor) objThumbColor.src = info.colorMapUrl || '/textures/pbr_grass/grass_pbr_diff.jpg';
    if (objNameColor) objNameColor.innerText = info.colorMapName || 'model_diff.jpg';
    if (objThumbRough) objThumbRough.src = info.roughnessMapUrl || '/textures/pbr_grass/grass_pbr_rough.jpg';
    if (objNameRough) objNameRough.innerText = info.roughnessMapName || 'model_rough.jpg';
    if (objThumbNormal) objThumbNormal.src = info.normalMapUrl || '/textures/pbr_grass/grass_pbr_nor.jpg';
    if (objNameNormal) objNameNormal.innerText = info.normalMapName || 'model_nor.jpg';
  }

  public setUndoRedoEnabled(canUndo: boolean, canRedo: boolean) {
    const btnUndo = document.getElementById('btn-dev-undo') as HTMLButtonElement | null;
    const btnRedo = document.getElementById('btn-dev-redo') as HTMLButtonElement | null;
    if (btnUndo) {
      btnUndo.disabled = !canUndo;
      btnUndo.style.opacity = canUndo ? '1.0' : '0.45';
      btnUndo.style.cursor = canUndo ? 'pointer' : 'not-allowed';
    }
    if (btnRedo) {
      btnRedo.disabled = !canRedo;
      btnRedo.style.opacity = canRedo ? '1.0' : '0.45';
      btnRedo.style.cursor = canRedo ? 'pointer' : 'not-allowed';
    }
  }

  public updateHotkeysGuide(mode: 'play' | 'designer') {
    this.currentMode = mode;
    const badge = document.getElementById('tips-mode-badge');
    if (badge) {
      badge.innerText = mode === 'play' ? 'PLAY MODE' : 'DESIGNER MODE';
    }
  }
}
