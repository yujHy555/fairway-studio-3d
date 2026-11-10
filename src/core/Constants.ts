// Physical constants and surface definitions for Low-Poly 3D Golf Course Designer & Simulation

export enum SurfaceType {
  ROUGH = 0,
  FAIRWAY = 1,
  GREEN = 2,
  BUNKER = 3,
  TEE = 4,
  WATER = 5,
  CUP_BOTTOM = 6,
  FRINGE = 7,
  FIRST_CUT = 8
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
    color: [0.32, 0.42, 0.20],     // Earthy olive & golden-brown fescue rough
    restitution: 0.12,             // Very low bounce in tall grass
    friction: 0.85,                // Heavy turf friction
    rollingResistance: 1.15,       // High resistance; ball stops in 1-3m
    liePenalty: 0.72,              // 72% power from deep rough
    spinMultiplier: 0.45           // Fliers / reduced spin
  },
  [SurfaceType.FAIRWAY]: {
    name: 'Fairway',
    color: [0.38, 0.70, 0.28],     // Crisp bright fairway green
    restitution: 0.32,             // Natural, authentic fairway bounce and forward release
    friction: 0.32,                // Smooth fairway glide
    rollingResistance: 0.28,       // Refined PGA-style rollout (~15-22m for driver)
    liePenalty: 1.0,
    spinMultiplier: 1.0
  },
  [SurfaceType.GREEN]: {
    name: 'Green',
    color: [0.28, 0.78, 0.38],     // Silky manicured putting green
    restitution: 0.28,             // Receptive tournament green with natural hop & smooth rollout
    friction: 0.36,                // Balanced turf friction allowing smooth release on high shots
    rollingResistance: 0.15,       // Realistic tournament Stimp 10.5 for controlled, readable putts
    liePenalty: 1.0,
    spinMultiplier: 1.0
  },
  [SurfaceType.BUNKER]: {
    name: 'Bunker',
    color: [0.91, 0.82, 0.59],     // Warm golden sand
    restitution: 0.12,             // Receptive sand cushion bounce
    friction: 0.94,                // High sand friction
    rollingResistance: 0.85,       // Controlled sand roll
    liePenalty: 0.55,
    spinMultiplier: 0.30
  },
  [SurfaceType.TEE]: {
    name: 'Tee Box',
    color: [0.42, 0.75, 0.32],
    restitution: 0.36,
    friction: 0.35,
    rollingResistance: 0.30,
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
  },
  [SurfaceType.FRINGE]: {
    name: 'Green Fringe',
    color: [0.33, 0.74, 0.33],     // Vivid fringe collar surrounding the green
    restitution: 0.20,             // Soft collar dampening
    friction: 0.55,                // Moderate-high resistance
    rollingResistance: 0.45,       // Checks runaway balls
    liePenalty: 0.95,
    spinMultiplier: 0.90
  },
  [SurfaceType.FIRST_CUT]: {
    name: 'First Cut',
    color: [0.29, 0.58, 0.22],     // Intermediate cut bordering fairway
    restitution: 0.24,             // Less bounce than fairway
    friction: 0.58,                // Moderate-high grab
    rollingResistance: 0.55,       // Catches runaway fairway rollouts cleanly
    liePenalty: 0.88,
    spinMultiplier: 0.75
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
