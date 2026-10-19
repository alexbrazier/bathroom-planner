// Product catalogue: Dansani Luna data (scraped into data/catalog.json) + generic room items.

export const COLOURS = {
  'White matt': '#efeeea',
  'White matt lacquer': '#f3f2ee',
  'White gloss': '#fbfbfa',
  'White': '#f7f7f5',
  'Grey matt': '#9c9d9a',
  'Sand matt': '#cfc2ab',
  'Soft stone': '#b9b3a7',
  'Deep Blue': '#26364f',
  'Light blue matt': '#aac0d0',
  'Black rubber': '#2b2b2c',
  'Black matt': '#262626',
  'Black': '#1f1f1f',
  'Natural oak': '#c9a57c',
  'Light oak': '#dcc29d',
  'Warm oak': '#a97b4f',
  'Brown oak': '#7b5639',
  'Black oak': '#33302c',
  'Oak noir': '#3d3129',
  'Bespoke colour': '#8b9a86',
  'Blanco Zeus': '#f2f1ee',
  'Charcoal Soapstone': '#3e3e3e',
  'Coral Clay': '#cbb9a6',
  'Desert Silver': '#bab7b1',
  'Eternal Marquina': '#232323',
  'Eternal Statuario': '#f1efea',
  'Trilium': '#7b7369',
  'Mirror': '#d9e1e6',
  'Mirror gables': '#d9e1e6',
  'Chrome': '#c9ccd0',
  'Brushed brass': '#b8955a',
  'Glossy white': '#f7f7f5', 'Glossy grey': '#9ea1a3', 'Alpine white': '#f8f8f6', 'Stone white': '#ece7dd', 'Matt white': '#efefec', 'Pure white': '#f5f5f2', 'Brilliant white': '#fafaf8',
  'Arizona oak': '#b98f63', 'Nordic oak': '#d6bf9c', 'Kansas oak': '#9a7754', 'Stone oak': '#a69a87', 'White oak': '#e2d6c2', 'White wood': '#e6ded0',
  'Taupe': '#8f8478', 'Cashmere grey': '#b4aca3', 'Volcano black': '#2a2a2a', 'Graphite': '#4a4c4f', 'Soft green': '#8f9d88', 'Wine red': '#6b2c34', 'Marine blue': '#2c3e57',
  'Matt black': '#202020', 'Pure black': '#1b1b1b', 'Brushed gold': '#c8a55e', 'Brushed nickel matt': '#aaa9a3', 'Brushed bronze': '#8a6a4a', 'Brushed black chrome': '#4a4a4c', 'Polished gold optic': '#d6b56a', 'Beige': '#d8c9ad',
  'Brushed nickel': '#a9a9a4',
  'Gunmetal': '#55575a',
};
export const WOOD = /oak/i;
export const STONE = /Zeus|Soapstone|Clay|Silver|Marquina|Statuario|Trilium/;

// Returns { front, carcass, frontName, carcassName } hex colours for a variant colour name.
export function colourPair(name, bespoke) {
  name = name || 'White matt';
  const parts = name.split('/').map((s) => s.trim());
  const norm = (s) => {
    if (/bespoke/i.test(s)) return { hex: bespoke || COLOURS['Bespoke colour'], name: 'Bespoke colour' };
    if (/^matt white$/i.test(s) || /^white matt$/i.test(s)) return { hex: COLOURS['White matt'], name: 'White matt' };
    const k = Object.keys(COLOURS).find((c) => c.toLowerCase() === s.toLowerCase());
    if (k) return { hex: COLOURS[k], name: k };
    const f = [[/no trim|flush/i, '#d9e1e6'], [/gunmetal/i, '#55575a'], [/oak|wood/i, '#b99a76'], [/black/i, '#232323'], [/white|alpin/i, '#f5f5f2'], [/grey|gray/i, '#9a9b99'], [/gold|brass/i, '#c8a55e'], [/bronze/i, '#8a6a4a'], [/nickel/i, '#aaa9a3'], [/chrome/i, '#c9ccd0'], [/blue/i, '#3a5574'], [/green/i, '#8f9d88']].find(([re]) => re.test(s));
    return { hex: f ? f[1] : '#dddddd', name: s };
  };
  const f = norm(parts[0]);
  const c = parts[1] ? norm(parts[1]) : f;
  return { front: f.hex, carcass: c.hex, frontName: f.name, carcassName: c.name };
}

export const CATS = [
  { id: 'vanity', label: 'Vanity units', kinds: ['vanity'] },
  { id: 'basin', label: 'Basins', kinds: ['basin', 'ctbasin'] },
  { id: 'cabinet', label: 'Cabinets', kinds: ['base', 'open'] },
  { id: 'tall', label: 'Tall cabinets', kinds: ['tall'] },
  { id: 'wall', label: 'Wall units', kinds: ['wall', 'shelf'] },
  { id: 'mirror', label: 'Mirrors', kinds: ['mirror'] },
  { id: 'mirrorcab', label: 'Mirror cabinets', kinds: ['mirrorcab'] },
  { id: 'worktop', label: 'Worktops', kinds: ['worktop', 'console'] },
  { id: 'taps', label: 'Taps & showers', kinds: ['walltap', 'tap', 'showervalve', 'showerhead', 'porterset', 'handshower', 'walloutlet', 'porter', 'showerrail'] },
  { id: 'acc', label: 'Towel holders & accessories', kinds: ['towelholder', 'accessory'] },
  { id: 'shower', label: 'Shower glass & trays', kinds: ['wetpanel', 'glass', 'tray'] },
  { id: 'wc', label: 'WC, bath & rails', kinds: ['toilet', 'wc', 'bath', 'towelrail', 'radiator'] },
  { id: 'room', label: 'Walls, boxing & doors', kinds: ['falsewall', 'niche', 'door', 'window', 'box'] },
];

const G = (id, name, kind, sizes, extra = {}) => ({
  id: 'generic-' + id, name, kind, cat: 'generic', generic: true, front: 'plain', drawers: 0, doors: 0, hinge: '', double: false, shape: 'rect',
  sizes: sizes.map(([w, d, h]) => ({ w, d, h, variants: (extra.colours || [extra.colour || 'White']).map((c) => ({ sku: '', colour: c, price: '', img: null })) })),
  ...extra,
});

const GENERIC = [
  {
    id: 'mtm-vanity', name: 'Made-to-measure vanity unit (Luna)', kind: 'vanity', cat: 'vanity-units', mtm: true, custom: true,
    front: 'plain', drawers: 1, doors: 0, hinge: '', double: false, shape: 'rect', thumb: null,
    note: 'Luna vanity units are available in made-to-measure widths. Set any width, depth and height, and pick the front style.',
    sizes: [{ w: 900, d: 440, h: 400, variants: ['White matt', 'Grey matt', 'Sand matt', 'Soft stone', 'Deep Blue', 'Light blue matt', 'Natural oak', 'Light oak', 'Warm oak', 'Brown oak', 'Black oak', 'Oak noir', 'Bespoke colour'].map((c) => ({ sku: 'MTM', colour: c, price: '', img: null })) }],
  },
  {
    id: 'mtm-cabinet', name: 'Made-to-measure cabinet (Luna)', kind: 'base', cat: 'cabinets', mtm: true, custom: true,
    front: 'plain', drawers: 2, doors: 0, hinge: '', double: false, shape: 'rect', thumb: null,
    note: 'Side cabinet at a custom size.',
    sizes: [{ w: 400, d: 440, h: 480, variants: ['White matt', 'Grey matt', 'Sand matt', 'Natural oak', 'Warm oak', 'Brown oak', 'Black oak', 'Bespoke colour'].map((c) => ({ sku: 'MTM', colour: c, price: '', img: null })) }],
  },
  G('bath', 'Bath (built-in)', 'bath', [[1700, 700, 560], [1700, 750, 560], [1600, 700, 560], [1800, 800, 560]], { custom: true }),
  G('bath-free', 'Freestanding bath', 'bath', [[1700, 800, 600], [1600, 750, 600]], { shape: 'oval', custom: true }),
  G('tray', 'Shower tray', 'tray', [[900, 900, 40], [1000, 800, 40], [1200, 800, 40], [1200, 900, 40], [1400, 900, 40], [1600, 800, 40]], { custom: true }),
  G('wetroom', 'Wet-room floor area', 'tray', [[1200, 900, 5]], { custom: true, wet: true }),
  G('wc-floor', 'Close-coupled WC (generic)', 'wc', [[380, 660, 800]]),
  G('radiator', 'Radiator', 'radiator', [[600, 100, 600], [800, 100, 600], [1000, 100, 600], [500, 100, 1200]], { custom: true }),
  G('towel-ladder', 'Towel ladder rail (generic)', 'towelrail', [[500, 110, 1200], [600, 110, 1600]], { colour: 'Chrome', custom: true }),
  G('door', 'Door', 'door', [[762, 100, 1981], [826, 100, 2040], [700, 100, 2000]], { opening: true }),
  G('window', 'Window', 'window', [[600, 100, 900], [900, 100, 1050], [1200, 100, 1200]], { opening: true }),
  G('falsewall', 'Built-out wall with LED niche', 'falsewall', [[2000, 150, 2400], [1200, 150, 2400]], { custom: true, niche: true,
    note: 'Stud wall built off the real wall. The niche is a recessed shelf (with LED strip) — set its depth to match in-built mirror cabinets so they sit flush above it.' }),
  G('niche', 'Recessed niche (with LED)', 'niche', [[600, 100, 300], [900, 129, 200], [300, 80, 600], [1200, 129, 250]], { custom: true,
    note: 'A shelf recess cut into whichever wall you place it on: a built-out wall, boxing, or a real wall (depth limited by the wall thickness). Size it freely; height off floor = the shelf.' }),
  G('boxing', 'Boxing for concealed cistern', 'falsewall', [[1000, 230, 850], [600, 230, 1200]], { custom: true, niche: false,
    note: 'Boxing off the wall for a concealed cistern frame. Drop a worktop on it for a shelf; the WC flush plate sits on its face.' }),
  G('walltap', 'In-wall basin mixer', 'walltap', [[200, 200, 65], [200, 180, 65], [200, 220, 65]], { colours: ['Chrome', 'Black matt', 'Brushed brass', 'Brushed nickel', 'Gunmetal'], note: 'Wall-mounted spout with lever on a single plate. Depth = spout reach from the wall; height off floor = bottom of the plate.' }),
  G('towelring', 'Hand towel ring', 'towelholder', [[180, 70, 200]], { colours: ['Chrome', 'Black matt', 'Brushed brass', 'Brushed nickel', 'Gunmetal'], shape: 'round' }),
  G('towelbar', 'Hand towel bar', 'towelholder', [[300, 70, 40], [450, 70, 40], [600, 70, 40]], { colours: ['Chrome', 'Black matt', 'Brushed brass', 'Brushed nickel', 'Gunmetal'] }),
  G('rollholder', 'Toilet roll holder', 'accessory', [[150, 120, 80]], { colours: ['Chrome', 'Black matt', 'Brushed brass', 'Brushed nickel', 'Gunmetal'] }),
  G('rollholder-lid', 'Toilet roll holder with lid', 'accessory', [[155, 125, 90]], { colours: ['Chrome', 'Black matt', 'Brushed brass', 'Brushed nickel', 'Gunmetal'] }),
  G('towelhook', 'Robe / towel hook', 'towelholder', [[40, 50, 40]], { colours: ['Chrome', 'Black matt', 'Brushed brass', 'Brushed nickel', 'Gunmetal'], shape: 'hook' }),
  G('porterset', 'Hand shower on hose with wall outlet', 'porterset', [[120, 130, 330], [110, 130, 400]], { colours: ['Chrome', 'Black matt', 'Brushed brass', 'Brushed nickel', 'Gunmetal'],
    note: 'Extra hand shower: wall outlet (e.g. hansgrohe FixFit) with the hose running up to a wall holder (Porter). Height off floor = the outlet; the holder sits at the top of the item.' }),
  G('showervalve', 'In-wall thermostatic shower valve', 'showervalve', [[160, 70, 160], [150, 70, 320]], { colours: ['Chrome', 'Black matt', 'Brushed brass', 'Brushed nickel', 'Gunmetal'] }),
  G('showerhead', 'Rain shower head on wall arm', 'showerhead', [[250, 400, 40], [300, 450, 40], [400, 450, 40]], { colours: ['Chrome', 'Black matt', 'Brushed brass', 'Brushed nickel', 'Gunmetal'] }),
  G('box', 'Boxing / custom block', 'box', [[300, 200, 1000], [1000, 200, 1100]], { custom: true, colour: 'White' }),
];

// Merlyn 8mm wet room panel with bracing bar (2015 mm high incl. rail, 8 mm clear glass, reversible,
// 1000 mm straight bracing bar included). Widths per Merlyn's range, plus 1400 mm.
const MERLYN_URL = 'https://jtdove.co.uk/products/merlyn-chrome-wetroom-panel-with-bracing-bar-8mm';
const MERLYN = {
  id: 'merlyn-8mm-wetroom-panel-bracing-bar', name: 'Merlyn 8mm Wet Room Panel & Bracing Bar', kind: 'wetpanel',
  brand: 'Merlyn', range: '8mm Wetroom', cat: 'showers', front: 'plain', drawers: 0, doors: 0, hinge: '', double: false, shape: 'rect', custom: true,
  thumb: 'data/img/merlyn/wetroom-panel-chrome.webp',
  note: '8 mm clear glass, 2015 mm high including the rail, wall channel on one edge and a straight bracing bar (1000 mm, cut to fit) from the top of the free end back to the wall. Bracing bar side and length can be changed below.',
  sizes: [700, 760, 800, 900, 1000, 1100, 1200, 1400].map((w) => ({
    w, d: 8, h: 2015,
    variants: [['Chrome/clear', w === 1000 ? '8W10' : ''], ['Brushed bronze/clear', w === 1000 ? '8W10BBZ' : ''], ['Brushed gunmetal/clear', w === 1000 ? '8W10BGM' : ''], ['Brushed nickel/clear', w === 1000 ? '8W10BN' : ''], ['Brushed brass/clear', w === 1000 ? '8W10BBR' : '']]
      .map(([colour, sku]) => ({ sku, colour, price: '', img: 'data/img/merlyn/wetroom-panel-chrome.webp', url: MERLYN_URL })),
  })),
};

// HiB Vanquish recessed mirror cabinet (hib.co.uk): LED 2800–6400 K, heated pad, charging socket, soft close,
// double-sided mirror doors, IP44. Fits into the wall with the front ~5 mm proud. Trim kits sold separately.
const HIB_URL = 'https://www.hib.co.uk/products/vanquish-bathroom-cabinet';
const VANQUISH = {
  id: 'hib-vanquish-recessed-cabinet', name: 'HiB Vanquish Recessed Mirror Cabinet', kind: 'mirrorcab', recessed: true,
  brand: 'HiB', range: 'Vanquish', cat: 'mirror-cabinets', front: 'plain', drawers: 0, doors: 0, hinge: '', double: false, shape: 'rect',
  thumb: 'data/img/hib/vanquish-123.webp',
  note: 'Recessed into the wall (125 mm deep) with the front ~5 mm proud: place it on a wall or built-out wall deep enough to take it. LED lighting, heated anti-mist pad, charging socket, soft-close double-sided mirror doors. Trim kits are sold separately.',
  sizes: [
    [300, 1700, '57900', 988, 1, 'vanquish-30-tall', 'w30xh170xd125cm'],
    [530, 730, '47600', 779, 1, 'vanquish-53', '53cm'],
    [630, 730, '47700', 935, 2, 'vanquish-63', '63cm'],
    [830, 730, '47800', 1010, 2, 'vanquish-123', '83cm'],
    [1230, 730, '47900', 1298, 3, 'vanquish-123', '123cm'],
    [1430, 730, '48700', 1455, 3, 'vanquish-123', 'w143xh73xd125cm'],
  ].map(([w, h, sku, price, doors, img, q]) => ({
    w, d: 125, h, doors, thumb: `data/img/hib/${img}.webp`,
    variants: [['No trim (flush)', img], ['Gunmetal trim', 'vanquish-trim-gunmetal'], ['Brushed bronze trim', 'vanquish-trim-bronze'], ['Black trim', img], ['Brushed brass trim', img]]
      .map(([colour, im]) => ({ sku, colour, price: `£${price.toLocaleString('en-GB')}`, img: `data/img/hib/${im}.webp`, url: `${HIB_URL}?size=${q}` })),
  })),
};

export let MODELS = [];
export const byId = new Map();

export async function loadCatalog() {
  const load = async (f) => { try { return await (await fetch(f)).json(); } catch { return []; } };
  const [data, vb, hg] = await Promise.all([load('data/catalog.json'), load('data/catalog_vb.json'), load('data/catalog_hg.json')]);
  for (const m of data) { m.brand = 'Dansani'; m.range = 'Luna'; }
  for (const m of GENERIC) { m.brand = m.brand || (m.mtm ? 'Dansani' : 'Generic'); m.range = m.range || (m.mtm ? 'Luna' : ''); }
  MODELS = [...GENERIC.filter((g) => g.mtm), ...data, ...vb, ...hg, MERLYN, VANQUISH, ...GENERIC.filter((g) => !g.mtm)];
  for (const m of MODELS) if (m.kind === 'showerhead' && !m.generic) normaliseShowerHead(m);
  for (const m of MODELS) {
    m.custom = m.custom || ['vanity', 'base', 'worktop', 'basin', 'open', 'tall', 'wall'].includes(m.kind);
    byId.set(m.id, m);
  }
  return MODELS;
}

// Retailer data often gives only the head size. Wall-arm heads get a realistic projection (head + ~240 mm
// arm); ceiling-mounted heads drop any made-up depth. Identical sizes are then merged.
function normaliseShowerHead(m) {
  const n = m.name.toLowerCase();
  const ceiling = /ceiling/.test(n), arm = !ceiling && /arm|wall/.test(n);
  for (const s of m.sizes) {
    if (arm && s.d < s.w + 150) s.d = s.w + 240;
    if (ceiling && s.d > s.w * 1.15) s.d = s.w;
  }
  const seen = new Map();
  m.sizes = m.sizes.filter((s) => {
    const k = `${s.w}x${s.d}x${s.h}`;
    const prev = seen.get(k);
    if (!prev) { seen.set(k, s); return true; }
    for (const v of s.variants) if (!prev.variants.some((x) => x.colour === v.colour)) prev.variants.push(v);
    return false;
  });
}

export function catOf(model) {
  return CATS.find((c) => c.kinds.includes(model.kind))?.id || 'room';
}

export function parsePrice(p) {
  if (!p) return null;
  const n = parseFloat(String(p).replace(/[^0-9.]/g, ''));
  return isNaN(n) ? null : n;
}
export const fmtPrice = (n, cur = '£') => (n == null ? '—' : cur + n.toLocaleString('en-GB', { maximumFractionDigits: 0 }));
export const currencyOf = (p) => (String(p || '').trim().startsWith('€') ? '€' : '£');

// Brand / range groups for the library filter.
export const BRANDS = [
  { id: 'all', label: 'All brands', test: () => true },
  { id: 'dansani', label: 'Dansani Luna', test: (m) => m.brand === 'Dansani' },
  { id: 'collaro', label: 'V&B Collaro', test: (m) => m.brand === 'Villeroy & Boch' && m.range === 'Collaro' },
  { id: 'subway', label: 'V&B Subway 3.0', test: (m) => m.brand === 'Villeroy & Boch' && m.range === 'Subway 3.0' },
  { id: 'viclean', label: 'V&B ViClean shower toilets', test: (m) => m.brand === 'Villeroy & Boch' && m.range === 'ViClean' },
  { id: 'hansgrohe', label: 'hansgrohe', test: (m) => m.brand === 'hansgrohe' },
  { id: 'logis', label: 'hansgrohe Logis', test: (m) => m.brand === 'hansgrohe' && m.range === 'Logis' },
  { id: 'merlyn', label: 'Merlyn shower glass', test: (m) => m.brand === 'Merlyn' },
  { id: 'hib', label: 'HiB cabinets', test: (m) => m.brand === 'HiB' },
  { id: 'generic', label: 'Generic', test: (m) => m.brand === 'Generic' },
];

// Default bottom elevation (mm above floor) for a newly placed item.
export function defaultElev(kind, h) {
  switch (kind) {
    case 'vanity': case 'base': return Math.max(0, 850 - h);
    case 'open': return 150;
    case 'basin': case 'ctbasin': case 'worktop': return 850;
    case 'console': return 820;
    case 'tall': return 200;
    case 'wall': return 1400;
    case 'mirrorcab': return 1150;
    case 'mirror': return h > 1200 ? 400 : 1100;
    case 'shelf': return h < 20 ? 1050 : 1300;
    case 'toilet': return 110;
    case 'towelrail': case 'radiator': return 150;
    case 'window': return 900;
    case 'walltap': return 940;
    case 'porterset': return 1000;
    case 'niche': return 1100;
    case 'porter': return 1200;
    case 'walloutlet': return 1000;
    case 'towelholder': return h > 150 ? 1000 : 1100;
    case 'handshower': return 1100;
    case 'showerrail': return h > 900 ? 1100 : 900;
    case 'accessory': return 1000;
    case 'tap': return 865;
    case 'showervalve': return 1000;
    case 'showerhead': return 2150;
    default: return 0;
  }
}

export const WALL_MOUNTED = new Set(['vanity', 'base', 'open', 'tall', 'wall', 'mirrorcab', 'mirror', 'shelf', 'toilet', 'wc', 'towelrail', 'radiator', 'worktop', 'console', 'glass', 'bath', 'tray', 'box', 'basin', 'falsewall', 'walltap', 'showervalve', 'showerhead', 'towelholder', 'handshower', 'showerrail', 'accessory', 'porterset', 'porter', 'walloutlet', 'wetpanel', 'niche']);
export const STACKS_ON = new Set(['basin', 'ctbasin', 'worktop', 'tap']);
export const SUPPORTS = new Set(['vanity', 'base', 'open', 'worktop', 'console', 'falsewall', 'basin', 'ctbasin']);
export const ABOVE_FLOOR_DASHED = new Set(['wall', 'mirrorcab', 'mirror', 'shelf']);
