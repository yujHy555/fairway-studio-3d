import { ClubSpec } from '../core/Types';

export const GOLF_CLUBS: ClubSpec[] = [
  {
    id: 'driver',
    name: 'Driver 10.5°',
    shortName: 'DR',
    category: 'wood',
    loftDegrees: 10.5,
    typicalCarryMeters: 272,
    baseBallSpeedMps: 72.8, // ~163 mph: calibrated for 300m max total distance on fairway
    baseBackspinRPM: 2450,
    spinDecayFactor: 0.030,
    maxSidespinRPM: 1200,
    sweetspotWidth: 0.12
  },
  {
    id: '3wood',
    name: '3-Wood 15°',
    shortName: '3W',
    category: 'wood',
    loftDegrees: 15.0,
    typicalCarryMeters: 225,
    baseBallSpeedMps: 64.0, // ~143 mph
    baseBackspinRPM: 3500,
    spinDecayFactor: 0.032,
    maxSidespinRPM: 1100,
    sweetspotWidth: 0.14
  },
  {
    id: '3hybrid',
    name: '3-Hybrid 19°',
    shortName: '3H',
    category: 'wood',
    loftDegrees: 19.0,
    typicalCarryMeters: 205,
    baseBallSpeedMps: 59.0,
    baseBackspinRPM: 4300,
    spinDecayFactor: 0.035,
    maxSidespinRPM: 1000,
    sweetspotWidth: 0.16
  },
  {
    id: '5iron',
    name: '5-Iron 26°',
    shortName: '5I',
    category: 'iron',
    loftDegrees: 26.0,
    typicalCarryMeters: 185,
    baseBallSpeedMps: 54.0,
    baseBackspinRPM: 5200,
    spinDecayFactor: 0.036,
    maxSidespinRPM: 950,
    sweetspotWidth: 0.18
  },
  {
    id: '7iron',
    name: '7-Iron 34°',
    shortName: '7I',
    category: 'iron',
    loftDegrees: 34.0,
    typicalCarryMeters: 160,
    baseBallSpeedMps: 48.0,
    baseBackspinRPM: 6500,
    spinDecayFactor: 0.038,
    maxSidespinRPM: 900,
    sweetspotWidth: 0.20
  },
  {
    id: '9iron',
    name: '9-Iron 42°',
    shortName: '9I',
    category: 'iron',
    loftDegrees: 42.0,
    typicalCarryMeters: 135,
    baseBallSpeedMps: 42.0,
    baseBackspinRPM: 7800,
    spinDecayFactor: 0.040,
    maxSidespinRPM: 850,
    sweetspotWidth: 0.22
  },
  {
    id: 'pw',
    name: 'Pitching Wedge 46°',
    shortName: 'PW',
    category: 'wedge',
    loftDegrees: 46.0,
    typicalCarryMeters: 115,
    baseBallSpeedMps: 37.0,
    baseBackspinRPM: 8800,
    spinDecayFactor: 0.042,
    maxSidespinRPM: 800,
    sweetspotWidth: 0.24
  },
  {
    id: 'sw',
    name: 'Sand Wedge 56°',
    shortName: 'SW',
    category: 'wedge',
    loftDegrees: 56.0,
    typicalCarryMeters: 85,
    baseBallSpeedMps: 31.0,
    baseBackspinRPM: 9800,
    spinDecayFactor: 0.045,
    maxSidespinRPM: 750,
    sweetspotWidth: 0.26
  },
  {
    id: 'lw',
    name: 'Lob Wedge 60°',
    shortName: 'LW',
    category: 'wedge',
    loftDegrees: 60.0,
    typicalCarryMeters: 65,
    baseBallSpeedMps: 26.0,
    baseBackspinRPM: 10500,
    spinDecayFactor: 0.048,
    maxSidespinRPM: 700,
    sweetspotWidth: 0.28
  },
  {
    id: 'putter',
    name: 'Putter 3°',
    shortName: 'PT',
    category: 'putter',
    loftDegrees: 3.0,
    typicalCarryMeters: 36, // Allows full lag putts across championship greens
    baseBallSpeedMps: 8.5,  // Calibrated for authentic 0.8m - 38m putting range
    baseBackspinRPM: 0,
    spinDecayFactor: 0.1,
    maxSidespinRPM: 0,
    sweetspotWidth: 0.35
  }
];

export function getRecommendedClub(distanceToPinMeters: number, isOnGreen: boolean): ClubSpec {
  if (isOnGreen) {
    return GOLF_CLUBS.find(c => c.id === 'putter')!;
  }

  // Find club whose typical carry is closest to or slightly greater than distance
  const playableClubs = GOLF_CLUBS.filter(c => c.category !== 'putter');
  let chosen = playableClubs[0];
  let minDiff = 9999;

  for (const club of playableClubs) {
    const diff = Math.abs(club.typicalCarryMeters - distanceToPinMeters);
    if (diff < minDiff) {
      minDiff = diff;
      chosen = club;
    }
  }

  return chosen;
}
