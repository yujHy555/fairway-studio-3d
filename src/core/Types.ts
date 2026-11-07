import { SurfaceType } from './Constants';

export interface Vector2D {
  x: number;
  z: number;
}

export interface Vector3D {
  x: number;
  y: number;
  z: number;
}

export type PresetFeatureCategory = 
  | 'fairway' 
  | 'green' 
  | 'bunker' 
  | 'water' 
  | 'tee' 
  | 'scenery';

export interface PresetFeature {
  id: string;
  name: string;
  category: PresetFeatureCategory;
  description: string;
  icon: string;
  surfaceType: SurfaceType;
  width: number;       // meters
  length: number;      // meters
  depthProfile?: number; // negative for depressions (bunkers: -0.8m, water: -1.8m), positive for elevated tees/greens
  lipHeight?: number;    // bunker lip elevation
  sceneryType?: 'pine' | 'oak' | 'rock_cluster' | 'distance_marker' | 'dam_wall';
}

export interface PlacedFeature {
  id: string;
  presetId: string;
  position: Vector3D;
  rotationY: number; // radians
  scale: Vector3D;
  surfaceType: SurfaceType;
}

export interface GolfHole {
  number: number;       // 1 - 9
  par: 3 | 4 | 5;
  name: string;
  teePosition: Vector3D;
  pinPosition: Vector3D;
  waypoints: Vector3D[]; // optional dogleg fairway target markers
}

export interface GolfCourseData {
  id: string;
  name: string;
  author: string;
  gridWidth: number;
  gridLength: number;
  holes: GolfHole[];
  currentHoleIndex: number;
  features: PlacedFeature[];
  heightMap: number[]; // Flattened Float32 or 1D array of elevations
  surfaceMap: number[]; // Flattened array of SurfaceType
}

export interface ClubSpec {
  id: string;
  name: string;
  shortName: string;
  category: 'wood' | 'iron' | 'wedge' | 'putter';
  loftDegrees: number;
  typicalCarryMeters: number;
  baseBallSpeedMps: number; // meters/second
  baseBackspinRPM: number;
  spinDecayFactor: number;
  maxSidespinRPM: number;
  sweetspotWidth: number; // tolerance window
}

export interface ShotResult {
  club: ClubSpec;
  powerPercent: number;     // 0 - 1.2 (can over-hit up to 120%)
  accuracyOffset: number;   // -1.0 (hook/pull) to +1.0 (slice/push)
  launchAngleDeg: number;
  launchSpeedMps: number;
  backspinRPM: number;
  sidespinRPM: number;
  azimuthDeg: number;       // Aiming direction in horizontal plane
  windSpeedMps: number;
  windHeadingDeg: number;   // Wind direction
}

export interface TrajectoryPoint {
  position: Vector3D;
  velocity: Vector3D;
  time: number;
  spinRPM: number;
  altitude: number;
}

export interface HoleScore {
  holeNumber: number;
  par: number;
  strokes: number;
  putts: number;
  scoreText: string; // e.g. "Birdie (-1)", "Par (E)", "Bogey (+1)"
}
