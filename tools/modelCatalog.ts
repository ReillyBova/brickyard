/**
 * Curated metadata for the bundled model corpus, keyed by the `.mpd` slug under
 * `public/models/`. `tools/build-model-manifests.ts` merges this with what it derives
 * from parsing each file (brick count, unique parts, submodels, steps) to produce
 * `public/models/index.json`.
 *
 * The LDraw Official Model Repository (`library.ldraw.org/omr`) has no bulk API and no
 * CORS headers, so this is a hand-curated mirror rather than a live scrape: each `.mpd`
 * was downloaded once from `library.ldraw.org/library/omr/<set>-1.mpd` and committed
 * under `public/models/`, the same "hosted, same-origin, fetched on demand" tier
 * `docs/PREBAKE.md` already uses for part geometry. `officialPieceCount` is the LEGO
 * set's published piece count — usually close to but not identical to the parsed
 * `brickCount`, since decorated/sticker variants and some minifig accessories are not
 * always modelled.
 */
import type { ModelCuration } from '../src/features/omr/types.ts';

export interface CatalogEntry {
  name: string;
  setNumber: string;
  theme: string;
  year: number;
  officialPieceCount: number;
  curated: ModelCuration;
}

export const MODEL_CATALOG: Readonly<Record<string, CatalogEntry>> = {
  // ── previously bundled ──────────────────────────────────────────────────
  '1713-shipwrecked-pirate': {
    name: 'Shipwrecked Pirate',
    setNumber: '1713',
    theme: 'Pirates',
    year: 1992,
    officialPieceCount: 29,
    curated: null,
  },
  '10156-lego-truck': {
    name: 'LEGO Truck',
    setNumber: '10156',
    theme: 'Town',
    year: 2004,
    officialPieceCount: 425,
    curated: 'popular',
  },
  '21109-exo-suit': {
    name: 'Exo Suit',
    setNumber: '21109',
    theme: 'Ideas',
    year: 2014,
    officialPieceCount: 528,
    curated: 'popular',
  },
  '928-galaxy-explorer': {
    name: 'Galaxy Explorer',
    setNumber: '928',
    theme: 'Classic Space',
    year: 1979,
    officialPieceCount: 227,
    curated: 'popular',
  },
  '21309-nasa-apollo-saturn-v': {
    name: 'NASA Apollo Saturn V',
    setNumber: '21309',
    theme: 'Ideas',
    year: 2017,
    officialPieceCount: 1969,
    curated: 'jumbo',
  },
  // ── new, sourced from library.ldraw.org/omr ─────────────────────────────
  '10242-mini-cooper': {
    name: 'Mini Cooper',
    setNumber: '10242',
    theme: 'Creator Expert',
    year: 2014,
    officialPieceCount: 1077,
    curated: 'popular',
  },
  '75054-at-at': {
    name: 'AT-AT',
    setNumber: '75054',
    theme: 'Star Wars',
    year: 2014,
    officialPieceCount: 1137,
    curated: 'popular',
  },
  '10248-ferrari-f40': {
    name: 'Ferrari F40',
    setNumber: '10248',
    theme: 'Creator Expert',
    year: 2015,
    officialPieceCount: 1158,
    curated: 'popular',
  },
  '10271-fiat-500': {
    name: 'Fiat 500',
    setNumber: '10271',
    theme: 'Creator Expert',
    year: 2020,
    officialPieceCount: 960,
    curated: 'popular',
  },
  '10143-death-star-ii': {
    name: 'Death Star II',
    setNumber: '10143',
    theme: 'Star Wars Ultimate Collector Series',
    year: 2005,
    officialPieceCount: 3441,
    curated: 'jumbo',
  },
  '10256-taj-mahal': {
    name: 'Taj Mahal',
    setNumber: '10256',
    theme: 'Creator Expert',
    year: 2017,
    officialPieceCount: 5923,
    curated: null,
  },
  '10241-maersk-triple-e': {
    name: 'Maersk Line Triple-E',
    setNumber: '10241',
    theme: 'Creator Expert',
    year: 2013,
    officialPieceCount: 1518,
    curated: null,
  },
  '21319-central-perk': {
    name: 'Central Perk',
    setNumber: '21319',
    theme: 'Ideas',
    year: 2019,
    officialPieceCount: 1070,
    curated: 'popular',
  },
  '10269-harley-davidson-fat-boy': {
    name: 'Harley-Davidson Fat Boy',
    setNumber: '10269',
    theme: 'Creator Expert',
    year: 2020,
    officialPieceCount: 1023,
    curated: 'popular',
  },
  '75060-slave-i': {
    name: 'Slave I',
    setNumber: '75060',
    theme: 'Star Wars Ultimate Collector Series',
    year: 2015,
    officialPieceCount: 1996,
    curated: null,
  },
  '10280-flower-bouquet': {
    name: 'Flower Bouquet',
    setNumber: '10280',
    theme: 'Botanical Collection',
    year: 2021,
    officialPieceCount: 756,
    curated: 'popular',
  },
  '21042-statue-of-liberty': {
    name: 'Statue of Liberty',
    setNumber: '21042',
    theme: 'Architecture',
    year: 2018,
    officialPieceCount: 1685,
    curated: null,
  },
  '10253-big-ben': {
    name: 'Big Ben',
    setNumber: '10253',
    theme: 'Creator Expert',
    year: 2016,
    officialPieceCount: 4163,
    curated: null,
  },
  '10272-old-trafford': {
    name: 'Old Trafford - Manchester United',
    setNumber: '10272',
    theme: 'Creator Expert',
    year: 2020,
    officialPieceCount: 3898,
    curated: null,
  },
  '10276-colosseum': {
    name: 'Colosseum',
    setNumber: '10276',
    theme: 'Creator Expert',
    year: 2020,
    officialPieceCount: 9036,
    curated: 'jumbo',
  },
  '10278-police-station': {
    name: 'Police Station',
    setNumber: '10278',
    theme: 'Creator Expert',
    year: 2020,
    officialPieceCount: 2923,
    curated: null,
  },
  '10281-bonsai-tree': {
    name: 'Bonsai Tree',
    setNumber: '10281',
    theme: 'Botanical Collection',
    year: 2021,
    officialPieceCount: 878,
    curated: 'popular',
  },
  '10283-nasa-space-shuttle-discovery': {
    name: 'NASA Space Shuttle Discovery',
    setNumber: '10283',
    theme: 'Creator Expert',
    year: 2021,
    officialPieceCount: 2354,
    curated: null,
  },
  '10294-titanic': {
    name: 'Titanic',
    setNumber: '10294',
    theme: 'Creator Expert',
    year: 2021,
    officialPieceCount: 9090,
    curated: 'jumbo',
  },
  '10295-porsche-911': {
    name: 'Porsche 911',
    setNumber: '10295',
    theme: 'Creator Expert',
    year: 2021,
    officialPieceCount: 1458,
    curated: null,
  },
  '10297-boutique-hotel': {
    name: 'Boutique Hotel',
    setNumber: '10297',
    theme: 'Creator Expert',
    year: 2022,
    officialPieceCount: 3066,
    curated: null,
  },
  '10298-vespa-125': {
    name: 'Vespa 125',
    setNumber: '10298',
    theme: 'Creator Expert',
    year: 2021,
    officialPieceCount: 1106,
    curated: 'popular',
  },
  '10220-vw-t1-camper-van': {
    name: 'Volkswagen T1 Camper Van',
    setNumber: '10220',
    theme: 'Creator Expert',
    year: 2011,
    officialPieceCount: 1334,
    curated: 'popular',
  },
  '10243-parisian-restaurant': {
    name: 'Parisian Restaurant',
    setNumber: '10243',
    theme: 'Creator Expert (Modular)',
    year: 2014,
    officialPieceCount: 2469,
    curated: null,
  },
  '10252-vw-beetle': {
    name: 'Volkswagen Beetle',
    setNumber: '10252',
    theme: 'Creator Expert',
    year: 2016,
    officialPieceCount: 1167,
    curated: 'popular',
  },
  '10261-roller-coaster': {
    name: 'Roller Coaster',
    setNumber: '10261',
    theme: 'Creator Expert',
    year: 2018,
    officialPieceCount: 4124,
    curated: null,
  },
  '10262-aston-martin-db5': {
    name: 'Aston Martin DB5',
    setNumber: '10262',
    theme: 'Creator Expert',
    year: 2018,
    officialPieceCount: 1295,
    curated: 'popular',
  },
  '10270-bookshop': {
    name: 'Bookshop',
    setNumber: '10270',
    theme: 'Creator Expert (Modular)',
    year: 2020,
    officialPieceCount: 2504,
    curated: null,
  },
  '21323-grand-piano': {
    name: 'Grand Piano',
    setNumber: '21323',
    theme: 'Ideas',
    year: 2020,
    officialPieceCount: 3662,
    curated: null,
  },
  '42056-porsche-911-gt3-rs': {
    name: 'Porsche 911 GT3 RS',
    setNumber: '42056',
    theme: 'Technic',
    year: 2016,
    officialPieceCount: 2704,
    curated: null,
  },
  '42083-bugatti-chiron': {
    name: 'Bugatti Chiron',
    setNumber: '42083',
    theme: 'Technic',
    year: 2018,
    officialPieceCount: 3599,
    curated: 'jumbo',
  },
  '42115-lamborghini-sian': {
    name: 'Lamborghini Sián FKP 37',
    setNumber: '42115',
    theme: 'Technic',
    year: 2020,
    officialPieceCount: 3696,
    curated: null,
  },
  // Parses to ~190k flattened bricks against an official count of 3854 — deep nested
  // submodel reuse in the tread/motor rigging multiplies out far beyond the physical
  // part count. Left in deliberately as the most extreme stress case in the corpus;
  // see the model import report for measured load time.
  '42131-cat-d11-bulldozer': {
    name: 'Cat D11 Bulldozer',
    setNumber: '42131',
    theme: 'Technic',
    year: 2022,
    officialPieceCount: 3854,
    curated: 'jumbo',
  },
  '75144-snowspeeder': {
    name: 'Snowspeeder',
    setNumber: '75144',
    theme: 'Star Wars Ultimate Collector Series',
    year: 2017,
    officialPieceCount: 1703,
    curated: null,
  },
  '76139-1989-batmobile': {
    name: '1989 Batmobile',
    setNumber: '76139',
    theme: 'DC',
    year: 2019,
    officialPieceCount: 3306,
    curated: null,
  },
};
