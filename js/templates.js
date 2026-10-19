// Ready-made designs.
import { defaultRoom, uid } from './state.js';

// Ensuite: 3475 × 2003 mm, 2936 mm ceiling (based on the saved bathroom-design (1).json).
//  - Left wall built out 150 mm; vanity → basin → in-wall taps → LED niche → in-built mirror cabinets above.
//    The niche is the same depth as the mirror cabinets (129 mm) so their fronts line up.
//  - WC on 230 mm boxing (concealed cistern, no space in the wall) with a Silestone shelf on top,
//    running from the vanity to the shower glass, below the window sill.
export function ensuite() {
  const W = 3475, L = 2003;
  const room = { ...defaultRoom(), pts: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: L }, { x: 0, y: L }], height: 2936 };
  const FW = 150; // built-out wall depth
  const NICHE = { on: true, bottom: 1060, height: 200, depth: 129, led: true };
  const BOX_D = 230, BOX_H = 850;
  const boxX0 = FW + 440, boxX1 = 2607; // vanity front edge → shower glass
  const bays = [501.5, 1501.5];
  const items = [
    { id: uid(), model: 'generic-falsewall', size: 0, variant: 0, x: FW / 2, y: L / 2, rot: 270, elev: 0, custom: { w: L, d: FW, h: room.height }, niche: NICHE },
    { id: uid(), model: 'basins-minore-double-basin-without-tap-holes', size: 0, variant: 0, x: FW + 227.5, y: L / 2, rot: 270, elev: 850, custom: { w: 2000, d: 455, h: 15 } },
  ];
  for (const y of bays) {
    items.push({ id: uid(), model: 'vanity-units-vanity-unit-with-2-drawers', size: 10, variant: 5, x: FW + 220, y, rot: 270, elev: 370 });
    items.push({ id: uid(), model: 'generic-walltap', size: 0, variant: 0, x: FW + 100, y, rot: 270, elev: 940 });
    // in-built cabinet recessed into the built-out wall, front 3 mm proud
    items.push({ id: uid(), model: 'mirror-cabinets-in-built-mirror-cabinet-with-lighting-and-touch-control', size: 0, variant: 0, x: FW + 3 - 129 / 2, y, rot: 270, elev: NICHE.bottom + NICHE.height });
  }
  items.push(
    { id: uid(), model: 'generic-boxing', size: 0, variant: 0, x: (boxX0 + boxX1) / 2, y: BOX_D / 2, rot: 0, elev: 0, custom: { w: boxX1 - boxX0, d: BOX_D, h: BOX_H } },
    { id: uid(), model: 'worktops-worktop-silestone', size: 0, variant: 0, x: (boxX0 + boxX1) / 2, y: 125, rot: 0, elev: BOX_H, custom: { w: boxX1 - boxX0, d: 250, h: 12 } },
    { id: uid(), model: 'toilets-incl-seat-creasani-wall-hung-toilet', size: 0, variant: 0, x: 2290, y: BOX_D + 265, rot: 0, elev: 110 },
    { id: uid(), model: 'showers-d-fixed-shower-panel', size: 3, variant: 0, x: 2610, y: 495, rot: 90, elev: 0 },
    { id: uid(), model: 'generic-wetroom', size: 0, variant: 0, x: 3043, y: 600, rot: 90, elev: 0, custom: { w: 1200, d: 864, h: 5 } },
    { id: uid(), model: 'generic-showervalve', size: 0, variant: 0, x: W - 35, y: 900, rot: 90, elev: 1000 },
    // rain head on the back wall, directly opposite the towel ladder (x 2905); valve stays on the end wall
    { id: uid(), model: 'generic-showerhead', size: 1, variant: 0, x: 2905, y: 225, rot: 0, elev: 2150 },
    // hand towel ring on the door wall, just past the end of the vanity
    { id: uid(), model: 'generic-towelring', size: 0, variant: 0, x: FW + 440 + 160, y: L - 35, rot: 180, elev: 950 },
    { id: uid(), model: 'generic-towel-ladder', size: 0, variant: 0, x: 2905, y: 1948, rot: 180, elev: 700 },
  );
  return {
    version: 1,
    room,
    openings: [
      { id: uid(), type: 'door', wall: 2, offset: 1205, width: 850, height: 2040, sill: 0, hinge: 'left', swing: 'in' },
      { id: uid(), type: 'window', wall: 0, offset: 1288, width: 900, height: 1050, sill: 900, hinge: 'left', swing: 'in' },
    ],
    items,
  };
}

export const TEMPLATES = [{ id: 'ensuite', name: 'Ensuite 3475 × 2003', make: ensuite }];
