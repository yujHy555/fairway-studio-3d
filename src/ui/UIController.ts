import { PresetFeature, GolfHole, ClubSpec, HoleScore } from '../core/Types';
import { SurfaceType, SURFACE_PROPERTIES } from '../core/Constants';
import { PRESET_FEATURES } from '../terrain/FeatureLibrary';
import { GOLF_CLUBS } from '../game/ClubBag';
import { SwingPhase } from '../game/SwingEngine';
import { soundFx } from '../core/Audio';

export interface UIEventCallbacks {
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
}

export class UIController {
  private callbacks: UIEventCallbacks;
  private currentMode: 'designer' | 'play' = 'play';
  public isSwingEnabled: boolean = true;

  // Elements
  private container: HTMLDivElement;
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
        </div>

        <div class="header-center">
          <button id="btn-mode-toggle" class="btn btn-primary">
            <span id="mode-icon">🎨</span>
            <span id="mode-text">Switch to Designer</span>
          </button>
        </div>

        <div class="header-right">
          <button id="btn-toggle-green-grid" class="btn btn-icon active" title="Toggle Green Contour Grid Lines">
            <span>🔲 Green Grid</span>
          </button>
          <button id="btn-toggle-green-dots" class="btn btn-icon active" title="Toggle Green Slope Flow Dots">
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
            <button id="btn-dev-delete-obj" class="btn btn-danger btn-block mt-2" style="display: none;">
              🗑️ Delete Object [Del]
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

      <!-- BOTTOM-LEFT HOTKEYS & TIPS GUIDE -->
      <div id="hud-hotkeys-guide">
        <div class="guide-header">
          <span class="guide-title" id="guide-title">🎮 PLAY CONTROLS & TIPS</span>
          <button id="btn-toggle-guide" class="guide-toggle-btn" title="Toggle Guide">_</button>
        </div>
        <div class="guide-body" id="guide-body">
          <!-- Dynamically populated -->
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

    if (filtered.length > 0) {
      this.callbacks.onPresetSelect(filtered[0]);
    }

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

    // Hotkeys Guide toggle minimize
    const guideBody = document.getElementById('guide-body');
    const guideToggle = document.getElementById('btn-toggle-guide');
    if (guideToggle && guideBody) {
      guideToggle.addEventListener('click', () => {
        guideBody.classList.toggle('hidden');
        guideToggle.innerText = guideBody.classList.contains('hidden') ? '+' : '–';
      });
    }

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
      if (e.code === 'KeyF') {
        if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen().catch(() => {});
        } else {
          document.exitFullscreen().catch(() => {});
        }
        return;
      }

      if (this.currentMode === 'designer') {
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

  public updateDevSelectedObject(mesh: { name: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scaling: { x: number; y: number; z: number } } | null) {
    const container = document.getElementById('dev-selected-info');
    const deleteBtn = document.getElementById('btn-dev-delete-obj');
    if (!container) return;

    if (!mesh) {
      container.innerHTML = `<div class="dev-info-empty">Click any tree, rock, cliff, or prop to select</div>`;
      if (deleteBtn) deleteBtn.style.display = 'none';
      return;
    }

    const pos = mesh.position;
    const rot = mesh.rotation;
    const scl = mesh.scaling;
    const name = mesh.name || 'Prop';

    container.innerHTML = `
      <div class="dev-obj-name"><strong>${name}</strong></div>
      <div class="dev-obj-details">
        <div><strong>Pos:</strong> X:${pos.x.toFixed(1)} Y:${pos.y.toFixed(1)} Z:${pos.z.toFixed(1)}</div>
        <div><strong>Rot Y:</strong> ${(rot.y * 180 / Math.PI).toFixed(0)}°</div>
        <div><strong>Scale:</strong> ${scl.x.toFixed(2)}x</div>
      </div>
    `;
    if (deleteBtn) deleteBtn.style.display = 'block';
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

  public updateHotkeysGuide(mode: 'play' | 'designer') {
    const title = document.getElementById('guide-title');
    const body = document.getElementById('guide-body');
    if (!title || !body) return;

    if (mode === 'play') {
      title.innerText = '🎮 PLAY CONTROLS & TIPS';
      body.innerHTML = `
        <div class="guide-row"><span class="guide-key">SPACE</span><span class="guide-desc">3-Click Swing (Start → Power → Snap)</span></div>
        <div class="guide-row"><span class="guide-key">A / D</span><span class="guide-desc">Aim Left / Right (+ Click sound)</span></div>
        <div class="guide-row"><span class="guide-key">Q / W / E</span><span class="guide-desc">Shot Shaper (Draw / Straight / Fade)</span></div>
        <div class="guide-row"><span class="guide-key">B</span><span class="guide-desc">Center Behind Ball (Ready Stance)</span></div>
        <div class="guide-row"><span class="guide-key">C / F</span><span class="guide-desc">Orbit Camera / Fullscreen</span></div>
        <div class="guide-row"><span class="guide-key">R</span><span class="guide-desc">Reset Ball to Active Tee</span></div>
        <div class="guide-tip">💡 Read green contour dots to gauge break when putting!</div>
      `;
    } else {
      title.innerText = '🎨 DESIGNER CONTROLS & TIPS';
      body.innerHTML = `
        <div class="guide-row"><span class="guide-key">V</span><span class="guide-desc">Select Mode (Click Mesh to Move/Rot/Scale)</span></div>
        <div class="guide-row"><span class="guide-key">B</span><span class="guide-desc">Sculpt Mode (Click / Shift+Drag to Shape)</span></div>
        <div class="guide-row"><span class="guide-key">A</span><span class="guide-desc">Add Object Mode (Click to Place Prop/Feature)</span></div>
        <div class="guide-row"><span class="guide-key">X</span><span class="guide-desc">Erase Mode (Click to Delete Object)</span></div>
        <div class="guide-row"><span class="guide-key">G / R / S</span><span class="guide-desc">Transform Gizmos: Move / Rotate / Scale</span></div>
        <div class="guide-row"><span class="guide-key">Del / Bksp</span><span class="guide-desc">Delete Selected Object</span></div>
        <div class="guide-row"><span class="guide-key">RMB / MMB</span><span class="guide-desc">Pan Camera Smoothly</span></div>
        <div class="guide-tip">🛠️ Use Developer Zone on the right to Push changes or Save as Default Hole!</div>
      `;
    }
  }
}
