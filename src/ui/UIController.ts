import { PresetFeature, GolfHole, ClubSpec } from '../core/Types';
import { SurfaceType, SURFACE_PROPERTIES } from '../core/Constants';
import { PRESET_FEATURES } from '../terrain/FeatureLibrary';
import { GOLF_CLUBS } from '../game/ClubBag';
import { SwingPhase } from '../game/SwingEngine';
import { soundFx } from '../core/Audio';

export interface UIEventCallbacks {
  onModeToggle: (mode: 'designer' | 'play') => void;
  onToolSelect: (tool: 'sculpt' | 'stamp' | 'set_tee' | 'set_pin') => void;
  onSculptModeSelect: (mode: 'raise' | 'lower' | 'flatten' | 'smooth') => void;
  onPresetSelect: (preset: PresetFeature) => void;
  onBrushRadiusChange: (radius: number) => void;
  onBrushStrengthChange: (strength: number) => void;
  onTargetSurfaceSelect: (surface: SurfaceType) => void;
  onHoleSelect: (holeIndex: number) => void;
  onAddHole: () => void;
  onHoleParChange: (par: 3 | 4 | 5) => void;
  onToggleGrid: () => boolean;
  onToggleContours: () => boolean;
  onExportCourse: () => void;
  onImportCourse: (json: string) => void;
  onClubSelect: (club: ClubSpec) => void;
  onSwingAction: () => void;
  onAimAdjust: (deltaDeg: number) => void;
  onCameraModeToggle: () => void;
  onResetShot: () => void;
}

export class UIController {
  private callbacks: UIEventCallbacks;
  private currentMode: 'designer' | 'play' = 'play';

  // Elements
  private container: HTMLDivElement;
  private designerPanel!: HTMLDivElement;
  private playHUD!: HTMLDivElement;
  private swingMeterBar!: HTMLDivElement;
  private swingIndicator!: HTMLDivElement;
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
  }

  private render() {
    this.container.innerHTML = `
      <!-- Top Navigation & Header -->
      <header id="ui-header">
        <div class="header-left">
          <div class="logo">
            <span class="logo-ball">⛳</span>
            <span class="logo-text">FAIRWAY<strong>STUDIO</strong></span>
            <span class="badge">3D LOW-POLY</span>
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
          <button id="btn-toggle-contours" class="btn btn-icon" title="Toggle Green Contours & Slope Beads">
            <span>〰️ Contours</span>
          </button>
          <button id="btn-toggle-grid" class="btn btn-icon" title="Toggle 1m Grid Overlay">
            <span>📏 1m Grid</span>
          </button>
          <button id="btn-export-course" class="btn btn-icon" title="Export Course JSON">
            <span>💾 Export</span>
          </button>
          <label class="btn btn-icon btn-file" title="Import Course JSON">
            <span>📂 Import</span>
            <input type="file" id="input-import-course" accept=".json" style="display:none;" />
          </label>
          <button id="btn-sound-mute" class="btn btn-icon" title="Mute/Unmute Audio">
            <span id="mute-icon">🔊</span>
          </button>
        </div>
      </header>

      <!-- DESIGNER MODE DRAWER & TOOLBAR -->
      <aside id="designer-panel" class="hidden">
        <div class="panel-header">
          <h3>Course Architect</h3>
          <span class="scale-info">Scale: 1m x 1m Grid</span>
        </div>

        <div class="panel-section">
          <h4>Tools</h4>
          <div class="tool-tabs">
            <button class="btn tool-tab active" data-tool="stamp">Presets</button>
            <button class="btn tool-tab" data-tool="sculpt">Sculpt</button>
            <button class="btn tool-tab" data-tool="set_tee">Set Tee</button>
            <button class="btn tool-tab" data-tool="set_pin">Set Pin</button>
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
        <div id="preset-controls" class="panel-section">
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

        <!-- 3-Click AAA Swing Meter -->
        <div class="hud-swing-container">
          <div class="swing-feedback" id="hud-swing-feedback">PRESS SPACE / CLICK TO SWING</div>
          <div class="swing-meter-track">
            <!-- Over-hit zone -->
            <div class="meter-zone meter-power-over"></div>
            <!-- Sweetspot power zone -->
            <div class="meter-zone meter-power-sweet"></div>
            <!-- Snap hash line -->
            <div class="meter-snap-line"></div>
            <!-- Dynamic moving meter bar -->
            <div class="swing-meter-bar" id="hud-meter-bar"></div>
            <!-- Accuracy marker indicator -->
            <div class="swing-accuracy-needle" id="hud-meter-needle"></div>
          </div>
          <div class="swing-action-bar">
            <button id="btn-swing-action" class="btn btn-swing">
              <span class="swing-main-btn-text">SWING [SPACE]</span>
            </button>
            <div class="hud-aim-controls">
              <button id="btn-aim-left" class="btn btn-sm">⟲ Aim Left [A]</button>
              <button id="btn-aim-right" class="btn btn-sm">Aim Right [D] ⟳</button>
              <button id="btn-camera-view" class="btn btn-sm">📷 View [C]</button>
              <button id="btn-reset-shot" class="btn btn-sm">🔄 Reset [R]</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Cache elements
    this.designerPanel = document.getElementById('designer-panel') as HTMLDivElement;
    this.playHUD = document.getElementById('play-hud') as HTMLDivElement;
    this.swingMeterBar = document.getElementById('hud-meter-bar') as HTMLDivElement;
    this.swingIndicator = document.getElementById('hud-meter-needle') as HTMLDivElement;
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

    grid.innerHTML = filtered.map(p => `
      <div class="preset-card" data-preset-id="${p.id}">
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
    const yards = Math.round(distMeters * 1.09361);
    const ydsElem = document.getElementById('hud-dist-yards');
    if (ydsElem) ydsElem.innerText = `${yards} yds to pin`;

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
    this.clubCarryLabel.innerText = `Typical: ${club.typicalCarryMeters}m (${Math.round(club.typicalCarryMeters * 1.09361)} yds)`;

    // Wind
    this.windSpeedLabel.innerText = `${windMps.toFixed(1)} m/s (${Math.round(windMps * 2.23694)} mph)`;
    this.windArrow.style.transform = `rotate(${windDeg}deg)`;
  }

  public updateSwingMeter(progress: number, phase: SwingPhase) {
    if (phase === SwingPhase.IDLE) {
      this.swingMeterBar.style.height = '0%';
      this.swingIndicator.style.bottom = '0%';
      this.swingFeedback.innerText = 'PRESS SPACE / CLICK TO SWING';
      this.swingFeedback.className = 'swing-feedback';
    } else if (phase === SwingPhase.BACKSWING) {
      const pct = Math.max(0, Math.min(100, (progress / 1.0) * 100));
      this.swingMeterBar.style.height = `${pct}%`;
      this.swingFeedback.innerText = 'CLICK FOR POWER!';
      this.swingFeedback.className = 'swing-feedback feedback-active';
    } else if (phase === SwingPhase.DOWNSWING) {
      const snapPct = Math.max(0, Math.min(100, (progress + 0.15) * 80));
      this.swingIndicator.style.bottom = `${snapPct}%`;
      this.swingFeedback.innerText = 'CLICK ON SNAP LINE!';
      this.swingFeedback.className = 'swing-feedback feedback-snap';
    } else if (phase === SwingPhase.COMPLETE) {
      this.swingFeedback.innerText = 'STRIKE!';
    }
  }

  public setSwingFeedbackText(text: string, type: 'perfect' | 'great' | 'draw' | 'fade' | 'hook' | 'slice' | 'miss') {
    this.swingFeedback.innerText = text;
    this.swingFeedback.className = `swing-feedback feedback-${type}`;
  }

  public toggleMode(): 'designer' | 'play' {
    if (this.currentMode === 'play') {
      this.currentMode = 'designer';
      this.designerPanel.classList.remove('hidden');
      this.playHUD.classList.add('hidden');
      document.getElementById('mode-text')!.innerText = 'Switch to Play';
      document.getElementById('mode-icon')!.innerText = '🏌️';
    } else {
      this.currentMode = 'play';
      this.designerPanel.classList.add('hidden');
      this.playHUD.classList.remove('hidden');
      document.getElementById('mode-text')!.innerText = 'Switch to Designer';
      document.getElementById('mode-icon')!.innerText = '🎨';
    }
    this.callbacks.onModeToggle(this.currentMode);
    return this.currentMode;
  }

  private setupListeners() {
    // Mode toggle
    document.getElementById('btn-mode-toggle')!.addEventListener('click', () => {
      this.toggleMode();
    });

    // Mute
    document.getElementById('btn-sound-mute')!.addEventListener('click', () => {
      const muted = soundFx.toggleMute();
      document.getElementById('mute-icon')!.innerText = muted ? '🔇' : '🔊';
    });

    // Grid toggle
    document.getElementById('btn-toggle-grid')!.addEventListener('click', () => {
      const active = this.callbacks.onToggleGrid();
      document.getElementById('btn-toggle-grid')!.classList.toggle('active', active);
    });

    // Contours toggle
    document.getElementById('btn-toggle-contours')!.addEventListener('click', () => {
      const active = this.callbacks.onToggleContours();
      document.getElementById('btn-toggle-contours')!.classList.toggle('active', active);
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
        document.querySelectorAll('.tool-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tool = btn.getAttribute('data-tool') as 'sculpt' | 'stamp' | 'set_tee' | 'set_pin';
        this.callbacks.onToolSelect(tool);

        const sculptControls = document.getElementById('sculpt-controls')!;
        const presetControls = document.getElementById('preset-controls')!;
        if (tool === 'sculpt') {
          sculptControls.classList.remove('hidden');
          presetControls.classList.add('hidden');
        } else if (tool === 'stamp') {
          sculptControls.classList.add('hidden');
          presetControls.classList.remove('hidden');
        } else {
          sculptControls.classList.add('hidden');
          presetControls.classList.add('hidden');
        }
      });
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
      this.callbacks.onSwingAction();
    });

    document.getElementById('btn-aim-left')!.addEventListener('click', () => {
      this.callbacks.onAimAdjust(-2.0);
    });

    document.getElementById('btn-aim-right')!.addEventListener('click', () => {
      this.callbacks.onAimAdjust(2.0);
    });

    document.getElementById('btn-camera-view')!.addEventListener('click', () => {
      this.callbacks.onCameraModeToggle();
    });

    document.getElementById('btn-reset-shot')!.addEventListener('click', () => {
      this.callbacks.onResetShot();
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        this.callbacks.onSwingAction();
      } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        this.callbacks.onAimAdjust(-1.5);
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        this.callbacks.onAimAdjust(1.5);
      } else if (e.code === 'KeyC') {
        this.callbacks.onCameraModeToggle();
      } else if (e.code === 'KeyR') {
        this.callbacks.onResetShot();
      }
    });
  }
}
