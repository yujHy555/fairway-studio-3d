// Physical constants and surface definitions for Low-Poly 3D Golf Course Designer & Simulation

export enum SurfaceType {
  ROUGH = 0,
  FAIRWAY = 1,
  GREEN = 2,
  BUNKER = 3,
  TEE = 4,
  WATER = 5,
  CUP_BOTTOM = 6
}

export interface SurfaceProperties {
  name: string;
  color: [number, number, number]; // RGB 0-1
  restitution: number;            // Bounciness (0 = dead stop, 1 = perfectly elastic)
  friction: number;               // Dynamic surface friction
  rollingResistance: number;      // Resistance when rolling
  liePenalty: number;             // Power multiplier when hitting from this lie (0.0 to 1.0)
  spinMultiplier: number;         // Spin multiplier generated from this lie
}

export const SURFACE_PROPERTIES: Record<SurfaceType, SurfaceProperties> = {
  [SurfaceType.ROUGH]: {
    name: 'Rough',
    color: [0.22, 0.48, 0.18],     // Deep lush grass green
    restitution: 0.12,
    friction: 0.85,
    rollingResistance: 0.85,       // Decisive stop in rough
    liePenalty: 0.75,              // 75% power from rough
    spinMultiplier: 0.50           // Fliers / reduced spin
  },
  [SurfaceType.FAIRWAY]: {
    name: 'Fairway',
    color: [0.38, 0.70, 0.28],     // Crisp bright fairway green
    restitution: 0.30,
    friction: 0.45,
    rollingResistance: 0.38,       // Natural rollout and decisive stop
    liePenalty: 1.0,
    spinMultiplier: 1.0
  },
  [SurfaceType.GREEN]: {
    name: 'Green',
    color: [0.28, 0.78, 0.38],     // Silky manicured putting green
    restitution: 0.38,
    friction: 0.25,
    rollingResistance: 0.24,       // Tournament stimp speed with clean deceleration
    liePenalty: 1.0,
    spinMultiplier: 1.0
  },
  [SurfaceType.BUNKER]: {
    name: 'Bunker',
    color: [0.91, 0.82, 0.59],     // Warm golden sand
    restitution: 0.03,             // Dead thud
    friction: 0.98,
    rollingResistance: 1.4,        // Instant sand plug
    liePenalty: 0.60,
    spinMultiplier: 0.35
  },
  [SurfaceType.TEE]: {
    name: 'Tee Box',
    color: [0.42, 0.75, 0.32],
    restitution: 0.35,
    friction: 0.35,
    rollingResistance: 0.35,
    liePenalty: 1.0,
    spinMultiplier: 1.0
  },
  [SurfaceType.WATER]: {
    name: 'Water Hazard',
    color: [0.18, 0.52, 0.75],
    restitution: 0.0,
    friction: 0.0,
    rollingResistance: 2.0,
    liePenalty: 0.0,
    spinMultiplier: 0.0
  },
  [SurfaceType.CUP_BOTTOM]: {
    name: 'Hole Cup',
    color: [0.1, 0.1, 0.1],
    restitution: 0.1,
    friction: 0.9,
    rollingResistance: 1.5,
    liePenalty: 1.0,
    spinMultiplier: 1.0
  }
};

// Real-world golf specifications & visual tuning
export const GOLF_CONSTANTS = {
  // Ball specs: Authentic 1:1 USGA regulation dimensions (42.67 mm diameter)
  BALL_MASS: 0.04593,             // 45.93 grams
  BALL_PHYSICS_RADIUS: 0.021335,  // 42.67 mm USGA regulation diameter
  BALL_CROSS_SECTION: Math.PI * Math.pow(0.021335, 2), // ~0.00143 m^2
  BALL_RENDER_RADIUS: 0.021335,   // Actual regulation golf ball radius (~2.13 cm)
  BALL_RADIUS: 0.021335,
  CUP_RADIUS: 0.054,              // USGA regulation 108 mm (4.25 in) cup diameter
  CUP_DEPTH: 0.1016,              // USGA regulation 101.6 mm (4.0 in) cup depth
  
  // Aerodynamics & Environment
  AIR_DENSITY: 1.204,             // kg/m^3 at 20 deg C
  GRAVITY: -9.80665,              // m/s^2
  SPIN_DECAY_RATE: 0.035,         // ~3.5% spin loss per second in air
  
  // Grid & Scale
  GRID_CELL_SIZE: 1.0,            // 1 meter x 1 meter grid
  DEFAULT_MAP_WIDTH: 220,         // 220 meters wide
  DEFAULT_MAP_LENGTH: 460,        // 460 meters long
  
  // Putting
  STIMP_RATING: 11.5
};
