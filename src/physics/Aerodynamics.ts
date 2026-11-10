import { GOLF_CONSTANTS } from '../core/Constants';
import { Vector3D, TrajectoryPoint, ShotResult } from '../core/Types';

export class Aerodynamics {
  /**
   * Computes aerodynamic forces (Drag, Magnus Lift, Gravity) on a golf ball.
   * @param velocity Current ball velocity vector (m/s)
   * @param spinVec Current spin vector (rad/s)
   * @param windVec Wind velocity vector (m/s)
   * @returns Acceleration vector (m/s^2)
   */
  public static computeAcceleration(
    velocity: Vector3D,
    spinVec: Vector3D,
    windVec: Vector3D
  ): Vector3D {
    // Relative velocity with respect to air
    const vRel: Vector3D = {
      x: velocity.x - windVec.x,
      y: velocity.y - windVec.y,
      z: velocity.z - windVec.z
    };

    const speed = Math.sqrt(vRel.x * vRel.x + vRel.y * vRel.y + vRel.z * vRel.z);
    if (speed < 0.1) {
      return { x: 0, y: GOLF_CONSTANTS.GRAVITY, z: 0 };
    }

    const spinSpeed = Math.sqrt(spinVec.x * spinVec.x + spinVec.y * spinVec.y + spinVec.z * spinVec.z);
    const spinFactor = (GOLF_CONSTANTS.BALL_RADIUS * spinSpeed) / speed;

    // Empirical drag coefficient for dimpled golf ball
    const cd = 0.21 + 0.15 / (1.0 + Math.exp((speed - 22.0) / 6.0)) + 0.12 * Math.min(1.0, spinFactor);

    // Dynamic pressure * Area = 0.5 * rho * A * speed^2
    const qA = 0.5 * GOLF_CONSTANTS.AIR_DENSITY * GOLF_CONSTANTS.BALL_CROSS_SECTION * speed;

    // Drag Force = -0.5 * rho * A * Cd * |vRel| * vRel
    const fDrag: Vector3D = {
      x: -qA * cd * vRel.x,
      y: -qA * cd * vRel.y,
      z: -qA * cd * vRel.z
    };

    // Lift Force (Magnus Effect)
    // Cross product: vRel x spinVec (gives +Y upward lift for forward vRel and rightward backspin)
    const cross: Vector3D = {
      x: vRel.y * spinVec.z - vRel.z * spinVec.y,
      y: vRel.z * spinVec.x - vRel.x * spinVec.z,
      z: vRel.x * spinVec.y - vRel.y * spinVec.x
    };
    const crossMag = Math.sqrt(cross.x * cross.x + cross.y * cross.y + cross.z * cross.z);

    let fLift: Vector3D = { x: 0, y: 0, z: 0 };
    if (crossMag > 1e-4) {
      // Lift coefficient Cl
      const cl = Math.min(0.40, 1.25 * Math.pow(Math.max(1e-4, spinFactor), 0.7));
      const liftMag = qA * cl * speed;
      fLift = {
        x: (cross.x / crossMag) * liftMag,
        y: (cross.y / crossMag) * liftMag,
        z: (cross.z / crossMag) * liftMag
      };
    }

    // Gravity force
    const fGravY = GOLF_CONSTANTS.BALL_MASS * GOLF_CONSTANTS.GRAVITY;

    // Acceleration a = F / m
    const invM = 1.0 / GOLF_CONSTANTS.BALL_MASS;
    return {
      x: (fDrag.x + fLift.x) * invM,
      y: (fDrag.y + fLift.y + fGravY) * invM,
      z: (fDrag.z + fLift.z) * invM
    };
  }

  /**
   * Performs high-precision 4th-Order Runge-Kutta (RK4) integration for flight state.
   */
  public static stepRK4(
    pos: Vector3D,
    vel: Vector3D,
    spin: Vector3D,
    wind: Vector3D,
    dt: number
  ): { nextPos: Vector3D; nextVel: Vector3D; nextSpin: Vector3D } {
    // k1
    const a1 = this.computeAcceleration(vel, spin, wind);
    const v1 = vel;

    // k2
    const v2: Vector3D = {
      x: vel.x + 0.5 * dt * a1.x,
      y: vel.y + 0.5 * dt * a1.y,
      z: vel.z + 0.5 * dt * a1.z
    };
    const a2 = this.computeAcceleration(v2, spin, wind);

    // k3
    const v3: Vector3D = {
      x: vel.x + 0.5 * dt * a2.x,
      y: vel.y + 0.5 * dt * a2.y,
      z: vel.z + 0.5 * dt * a2.z
    };
    const a3 = this.computeAcceleration(v3, spin, wind);

    // k4
    const v4: Vector3D = {
      x: vel.x + dt * a3.x,
      y: vel.y + dt * a3.y,
      z: vel.z + dt * a3.z
    };
    const a4 = this.computeAcceleration(v4, spin, wind);

    // Integrate position and velocity
    const nextPos: Vector3D = {
      x: pos.x + (dt / 6.0) * (v1.x + 2 * v2.x + 2 * v3.x + v4.x),
      y: pos.y + (dt / 6.0) * (v1.y + 2 * v2.y + 2 * v3.y + v4.y),
      z: pos.z + (dt / 6.0) * (v1.z + 2 * v2.z + 2 * v3.z + v4.z)
    };

    const nextVel: Vector3D = {
      x: vel.x + (dt / 6.0) * (a1.x + 2 * a2.x + 2 * a3.x + a4.x),
      y: vel.y + (dt / 6.0) * (a1.y + 2 * a2.y + 2 * a3.y + a4.y),
      z: vel.z + (dt / 6.0) * (a1.z + 2 * a2.z + 2 * a3.z + a4.z)
    };

    // Spin decay in flight
    const decay = Math.exp(-GOLF_CONSTANTS.SPIN_DECAY_RATE * dt);
    const nextSpin: Vector3D = {
      x: spin.x * decay,
      y: spin.y * decay,
      z: spin.z * decay
    };

    return { nextPos, nextVel, nextSpin };
  }

  /**
   * Computes club- and swing-speed-dependent wind influence factor.
   * Long clubs (Driver, 3-Wood, 3-Hybrid, Long Irons) traverse high open air and feel strong wind drift,
   * while shorter irons, wedges, and low partial chip shots are much more sheltered and wind-resistant.
   */
  public static getWindFactorForShot(shot: ShotResult): number {
    const club = shot.club;
    if (club.category === 'putter') return 0.0;

    const clubWindWeights: Record<string, number> = {
      driver: 1.00,
      '3wood': 0.94,
      '3hybrid': 0.88,
      '5iron': 0.80,
      '7iron': 0.56,
      '9iron': 0.36,
      pw: 0.24,
      sw: 0.16,
      lw: 0.12
    };
    let baseWeight = clubWindWeights[club.id];
    if (baseWeight === undefined) {
      const carryT = Math.max(0, Math.min(1, (club.typicalCarryMeters - 60) / 180));
      baseWeight = 0.14 + 0.86 * Math.pow(carryT, 1.35);
    }

    // Partial-power swings / chips stay below the canopy boundary layer and experience even less wind drift
    const speedRatio = Math.max(0.15, Math.min(1.05, shot.launchSpeedMps / Math.max(10, club.baseBallSpeedMps)));
    const chipShelterScale = speedRatio < 0.85 ? Math.pow(speedRatio / 0.85, 1.35) : 1.0;

    return Math.max(0.06, Math.min(1.0, baseWeight * chipShelterScale));
  }

  /**
   * Converts launch shot parameters (speed, angle, azimuth, backspin, sidespin)
   * into initial 3D velocity and spin vectors.
   */
  public static calculateInitialVectors(shot: ShotResult): {
    velocity: Vector3D;
    spinVec: Vector3D;
  } {
    const launchAngleRad = (shot.launchAngleDeg * Math.PI) / 180.0;
    const azimuthRad = (shot.azimuthDeg * Math.PI) / 180.0;

    const vH = shot.launchSpeedMps * Math.cos(launchAngleRad);
    const vY = shot.launchSpeedMps * Math.sin(launchAngleRad);

    const vX = vH * Math.sin(azimuthRad);
    const vZ = vH * Math.cos(azimuthRad);

    // Backspin axis is perpendicular to launch azimuth (pointing rightwards horizontally)
    // Positive backspin creates lift (+Y)
    const backspinRadS = (shot.backspinRPM * 2.0 * Math.PI) / 60.0;
    const sidespinRadS = (shot.sidespinRPM * 2.0 * Math.PI) / 60.0;

    // Right vector in horizontal plane
    const rightX = Math.cos(azimuthRad);
    const rightZ = -Math.sin(azimuthRad);

    // Backspin vector (pointing to the right for positive lift)
    // Sidespin vector (pointing up/down: positive sidespin = fade/slice right, negative = draw/hook left)
    const spinVec: Vector3D = {
      x: rightX * backspinRadS,
      y: -sidespinRadS, // vertical spin axis induces horizontal curve
      z: rightZ * backspinRadS
    };

    return {
      velocity: { x: vX, y: vY, z: vZ },
      spinVec
    };
  }

  /**
   * Fast trajectory predictor for real-time visual aim arc
   */
  public static predictTrajectory(
    startPos: Vector3D,
    shot: ShotResult,
    sampleInterval = 0.05,
    maxTime = 12.0,
    getTerrainElevation?: (x: number, z: number) => number
  ): TrajectoryPoint[] {
    const points: TrajectoryPoint[] = [];
    const { velocity, spinVec } = this.calculateInitialVectors(shot);

    const windRad = (shot.windHeadingDeg * Math.PI) / 180.0;
    const windFactor = this.getWindFactorForShot(shot);
    const windVec: Vector3D = {
      x: shot.windSpeedMps * windFactor * Math.sin(windRad),
      y: 0,
      z: shot.windSpeedMps * windFactor * Math.cos(windRad)
    };

    let curPos = { ...startPos };
    let curVel = { ...velocity };
    let curSpin = { ...spinVec };
    let t = 0;

    points.push({
      position: { ...curPos },
      velocity: { ...curVel },
      time: 0,
      spinRPM: shot.backspinRPM,
      altitude: curPos.y
    });

    const dt = 0.02; // fine physics dt for accurate curve
    let accumulator = 0;

    while (t < maxTime) {
      const step = this.stepRK4(curPos, curVel, curSpin, windVec, dt);
      curPos = step.nextPos;
      curVel = step.nextVel;
      curSpin = step.nextSpin;
      t += dt;
      accumulator += dt;

      // Sample points for renderer
      if (accumulator >= sampleInterval) {
        accumulator = 0;
        const spinMag = Math.sqrt(curSpin.x * curSpin.x + curSpin.y * curSpin.y + curSpin.z * curSpin.z);
        points.push({
          position: { ...curPos },
          velocity: { ...curVel },
          time: t,
          spinRPM: (spinMag * 60) / (2 * Math.PI),
          altitude: curPos.y
        });
      }

      // Check ground contact if terrain elevation callback provided
      if (getTerrainElevation) {
        const groundY = getTerrainElevation(curPos.x, curPos.z);
        if (curPos.y <= groundY + GOLF_CONSTANTS.BALL_RADIUS) {
          curPos.y = groundY + GOLF_CONSTANTS.BALL_RADIUS;
          points.push({
            position: { ...curPos },
            velocity: { ...curVel },
            time: t,
            spinRPM: 0,
            altitude: curPos.y
          });
          break;
        }
      } else if (curPos.y <= 0) {
        break;
      }
    }

    return points;
  }
}
