import { ClubSpec, ShotResult } from '../core/Types';
import { SURFACE_PROPERTIES, SurfaceType } from '../core/Constants';

export enum SwingPhase {
  IDLE = 'IDLE',
  BACKSWING = 'BACKSWING',   // Meter rising to set power
  DOWNSWING = 'DOWNSWING',   // Needle falling to snap accuracy
  COMPLETE = 'COMPLETE'
}

export class SwingEngine {
  public phase: SwingPhase = SwingPhase.IDLE;
  public powerPercent: number = 0;      // 0.0 to 1.05
  public lockedPowerPercent: number | null = null; // Stored power level for visual marker
  public accuracyOffset: number = 0;    // -1.0 (hook) to +1.0 (slice)

  public meterProgress: number = 0;     // 0 to 1
  private meterSpeed: number = 0.76;    // Rhythmic, comfortable PGA Tour tempo (~1.3s backswing, ~1.0s downswing)
  private activeClub: ClubSpec;
  private currentLie: SurfaceType = SurfaceType.TEE;

  // Aiming parameters
  public aimAzimuthDeg: number = 0;
  public windSpeedMps: number = 3.5;
  public windHeadingDeg: number = 45;

  public onUpdate?: (meterValue: number, phase: SwingPhase, lockedPower?: number | null) => void;
  public onShotExecute?: (shot: ShotResult) => void;
  public onSwingCancelled?: (reason: string) => void;

  constructor(initialClub: ClubSpec) {
    this.activeClub = initialClub;
  }

  public setClub(club: ClubSpec) {
    this.activeClub = club;
  }

  public setLie(lie: SurfaceType) {
    this.currentLie = lie;
  }

  /**
   * PGA Tour 3-Click Control:
   * Click 1: Begin backswing
   * Click 2: Lock Power (MUST click to set power)
   * Click 3: Strike on Impact Snap Line
   */
  public handleActionClick(): SwingPhase {
    if (this.phase === SwingPhase.IDLE) {
      // 1st Click: Start backswing
      this.phase = SwingPhase.BACKSWING;
      this.meterProgress = 0;
      this.powerPercent = 0;
      this.lockedPowerPercent = null;
      this.accuracyOffset = 0;
      this.onUpdate?.(0, this.phase, null);
      return this.phase;

    } else if (this.phase === SwingPhase.BACKSWING) {
      // 2nd Click: Confirms power level and transitions to downswing
      this.phase = SwingPhase.DOWNSWING;
      this.powerPercent = Math.max(0.15, Math.min(1.05, this.meterProgress));
      this.lockedPowerPercent = this.powerPercent;
      this.onUpdate?.(this.meterProgress, this.phase, this.lockedPowerPercent);
      return this.phase;

    } else if (this.phase === SwingPhase.DOWNSWING) {
      // 3rd Click: Snaps accuracy on impact hash mark
      this.phase = SwingPhase.COMPLETE;

      // Snap hash line is located at 15% (0.15)
      const snapTarget = 0.15;
      const rawError = (this.meterProgress - snapTarget) / 0.18; // scaled offset

      // Sweetspot deadzone for forgiving, rewarding center-face strikes
      if (Math.abs(rawError) <= 0.22) {
        this.accuracyOffset = 0; // Pure center strike!
      } else {
        const sign = Math.sign(rawError);
        const err = (Math.abs(rawError) - 0.22) / (1.0 - 0.22);
        this.accuracyOffset = sign * Math.min(1.0, Math.pow(err, 1.15));
      }

      this.executeShot();
      return this.phase;
    }

    return this.phase;
  }

  public reset() {
    this.phase = SwingPhase.IDLE;
    this.meterProgress = 0;
    this.powerPercent = 0;
    this.lockedPowerPercent = null;
    this.accuracyOffset = 0;
    this.onUpdate?.(0, this.phase, null);
  }

  public update(dt: number) {
    if (this.phase === SwingPhase.BACKSWING) {
      this.meterProgress += this.meterSpeed * dt;

      // If user does NOT click to set power, the swing reaches apex and cancels safely
      if (this.meterProgress >= 1.05) {
        this.reset();
        this.onSwingCancelled?.('Power not locked. Click during backswing to set power!');
        return;
      }
      this.onUpdate?.(this.meterProgress, this.phase, this.lockedPowerPercent);

    } else if (this.phase === SwingPhase.DOWNSWING) {
      this.meterProgress -= this.meterSpeed * 0.95 * dt;

      // Generous bottom grace window (down to -0.25) allowing human reaction time
      if (this.meterProgress <= -0.25) {
        this.reset();
        this.onSwingCancelled?.('Impact missed! Click on the white line to strike.');
        return;
      }
      this.onUpdate?.(this.meterProgress, this.phase, this.lockedPowerPercent);
    }
  }

  public executeShot() {
    const lieProps = SURFACE_PROPERTIES[this.currentLie];
    // Scale power so locking near top (0.85 - 1.05) gives full 95% - 105% power smoothly
    let effectivePower = this.powerPercent;
    if (effectivePower >= 0.85) {
      effectivePower = 0.95 + (effectivePower - 0.85) * 0.5; // up to 1.05
    } else {
      effectivePower = (effectivePower / 0.85) * 0.95;
    }
    const power = Math.max(0.15, Math.min(1.05, effectivePower)) * lieProps.liePenalty;

    const launchSpeed = this.activeClub.baseBallSpeedMps * power;

    let launchAngle = this.activeClub.loftDegrees;
    if (this.activeClub.category === 'putter') {
      launchAngle = 2.0;
    }

    const backspin = this.activeClub.baseBackspinRPM * power * lieProps.spinMultiplier;
    const sidespin = this.activeClub.maxSidespinRPM * this.accuracyOffset;
    const azimuthAdjustment = this.accuracyOffset * 3.5;
    const finalAzimuth = this.aimAzimuthDeg + azimuthAdjustment;

    const shot: ShotResult = {
      club: this.activeClub,
      powerPercent: power,
      accuracyOffset: this.accuracyOffset,
      launchAngleDeg: launchAngle,
      launchSpeedMps: launchSpeed,
      backspinRPM: backspin,
      sidespinRPM: sidespin,
      azimuthDeg: finalAzimuth,
      windSpeedMps: this.windSpeedMps,
      windHeadingDeg: this.windHeadingDeg
    };

    this.onShotExecute?.(shot);

    setTimeout(() => {
      this.reset();
    }, 1200);
  }
}
