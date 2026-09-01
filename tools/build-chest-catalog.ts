#!/usr/bin/env node
/**
 * Builds `src/ui/PartsChest/catalog.generated.json` — the parts chest's real names and
 * categories, read from the local LDraw mirror.
 *
 * **This script makes no network requests.** Titles come from line one of each part's
 * `.dat` file (`3001.dat` begins `0 Brick  2 x  4`); categories are curated below rather
 * than derived, because chest membership and grouping are product decisions, same as
 * `tools/prebake.ts`'s `DEFAULT_CHEST`.
 *
 * Source, in order:
 *   1. The local mirror at `.cache/ldraw/`, populated by `npm run sync-mirror`. Preferred
 *      because it covers the whole curated list.
 *   2. The committed fixture mirror at `src/ldraw/__fixtures__/mirror/`, which has the
 *      same `library/parts/…` layout but only a handful of real part files. Used so the
 *      chest still shows real names and a working catalog with no mirror synced — a
 *      reduced chest, not an empty or fabricated one.
 *
 * If neither source has any of the curated parts, the build fails with a message pointing
 * at `npm run sync-mirror` rather than emitting nothing.
 *
 * Usage: node tools/build-chest-catalog.ts [--mirror <dir>] [--out <file>]
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { DEFAULT_MIRROR_ROOT, createLibraryReader, mirrorExists, type MirrorReader } from '../src/ldraw/mirror.ts'

const FIXTURE_MIRROR_ROOT = 'src/ui/PartsChest/__fixtures__/mirror'
const DEFAULT_OUT = 'src/ui/PartsChest/catalog.generated.json'

/**
 * The chest: several hundred parts drawn from the ~3,300 the LDCad shadow library
 * resolves to actual connection points (see `docs/PREBAKE.md` and
 * `public/baked/connections.bin`) — every entry here snaps, because that pool is exactly
 * what determines whether a part snaps at runtime. A handful of parts from the original
 * 36-part development chest fell outside that pool (`973`, `3010`, `3037`, `3626b`,
 * `3665a`, `4162`, `4716` among them) — real, undeprecated parts whose own id resolves to
 * zero connection points in the annotated corpus, so they never snapped in the running
 * app. They're replaced below by the nearest connected sibling in the same category
 * (`3626bp01` for the plain head, `17`/`6260` for the torso, and so on).
 *
 * Selected from the shadow-annotated pool by category, filtered to drop LDraw's `~Moved`
 * /`=Alias` placeholders and decorative print/pattern/sticker variants (which would
 * otherwise flood every category with near-duplicates of the same base shape), then
 * capped per category and ranked by title brevity as a proxy for "the plain, common
 * version of this shape" — with a short hand-picked whitelist per category (minifig body
 * parts, the classic clip) pinned first so the heuristic can't crowd out the essentials.
 * Regenerate this selection with the categorisation script kept in this file's history;
 * membership and grouping are still product decisions, same as `tools/prebake.ts`'s
 * `DEFAULT_CHEST`.
 */
const CURATED_CHEST: readonly { id: string; category: string }[] = [
  // Minifigure
  { id: '3626bp01', category: 'Minifigure' },
  { id: '17', category: 'Minifigure' },
  { id: '6260', category: 'Minifigure' },
  { id: '15', category: 'Minifigure' },
  { id: '41879b', category: 'Minifigure' },
  { id: '3818', category: 'Minifigure' },
  { id: '3819', category: 'Minifigure' },
  { id: '3820', category: 'Minifigure' },
  { id: '3901', category: 'Minifigure' },
  { id: '6093a', category: 'Minifigure' },
  { id: '61506', category: 'Minifigure' },
  { id: '71015', category: 'Minifigure' },
  { id: '3899', category: 'Minifigure' },
  { id: '24085', category: 'Minifigure' },
  { id: '33054', category: 'Minifigure' },
  { id: '40359a', category: 'Minifigure' },
  { id: '2488', category: 'Minifigure' },
  { id: '4524', category: 'Minifigure' },
  { id: '30112b', category: 'Minifigure' },
  { id: '3849', category: 'Minifigure' },
  { id: '3959', category: 'Minifigure' },
  { id: '4332', category: 'Minifigure' },
  { id: '4337', category: 'Minifigure' },
  { id: '29636', category: 'Minifigure' },
  { id: '44658', category: 'Minifigure' },
  { id: '71342', category: 'Minifigure' },
  { id: '99253', category: 'Minifigure' },
  { id: '2343', category: 'Minifigure' },
  { id: '3837', category: 'Minifigure' },
  { id: '4528', category: 'Minifigure' },
  { id: '23986', category: 'Minifigure' },
  { id: '24077', category: 'Minifigure' },
  { id: '2543', category: 'Minifigure' },
  { id: '3841', category: 'Minifigure' },
  { id: '10154', category: 'Minifigure' },
  { id: '11459', category: 'Minifigure' },
  { id: '29109', category: 'Minifigure' },
  { id: '30154', category: 'Minifigure' },
  { id: '30193', category: 'Minifigure' },
  { id: '35485', category: 'Minifigure' },

  // Plants
  { id: '6064b', category: 'Plants' },
  { id: '3742', category: 'Plants' },
  { id: '51270', category: 'Plants' },
  { id: '6065', category: 'Plants' },
  { id: '30093', category: 'Plants' },
  { id: '15279', category: 'Plants' },
  { id: '3741a', category: 'Plants' },
  { id: '2417', category: 'Plants' },
  { id: '2423', category: 'Plants' },
  { id: '2566b', category: 'Plants' },
  { id: '2682a', category: 'Plants' },
  { id: '2563a', category: 'Plants' },
  { id: '87691', category: 'Plants' },
  { id: '6148', category: 'Plants' },
  { id: '4265a', category: 'Plants' },
  { id: '6577', category: 'Plants' },
  { id: '3470', category: 'Plants' },
  { id: '4727', category: 'Plants' },
  { id: '1997', category: 'Plants' },
  { id: '2518', category: 'Plants' },

  // Wheels
  { id: '2496', category: 'Wheels' },
  { id: '2927', category: 'Wheels' },
  { id: '32003', category: 'Wheels' },
  { id: '4624', category: 'Wheels' },
  { id: '32019', category: 'Wheels' },
  { id: '2654a', category: 'Wheels' },
  { id: '4720', category: 'Wheels' },
  { id: '30663', category: 'Wheels' },
  { id: '32496', category: 'Wheels' },
  { id: '2999', category: 'Wheels' },
  { id: '3736', category: 'Wheels' },
  { id: '4003', category: 'Wheels' },
  { id: '4779', category: 'Wheels' },
  { id: '4782', category: 'Wheels' },
  { id: '2695', category: 'Wheels' },
  { id: '3641', category: 'Wheels' },
  { id: '34337', category: 'Wheels' },
  { id: '57519', category: 'Wheels' },
  { id: '2741', category: 'Wheels' },
  { id: '2819', category: 'Wheels' },
  { id: '3464b', category: 'Wheels' },
  { id: '4488', category: 'Wheels' },
  { id: '21445', category: 'Wheels' },
  { id: '32007', category: 'Wheels' },

  // Windows & Doors
  { id: '2657', category: 'Windows & Doors' },
  { id: '4131', category: 'Windows & Doors' },
  { id: '7930', category: 'Windows & Doors' },
  { id: '80683', category: 'Windows & Doors' },
  { id: '671', category: 'Windows & Doors' },
  { id: '3761', category: 'Windows & Doors' },
  { id: '3853', category: 'Windows & Doors' },
  { id: '4132', category: 'Windows & Doors' },
  { id: '4608', category: 'Windows & Doors' },
  { id: '30223', category: 'Windows & Doors' },
  { id: '4611', category: 'Windows & Doors' },
  { id: '4218b', category: 'Windows & Doors' },
  { id: '3189', category: 'Windows & Doors' },
  { id: '6546', category: 'Windows & Doors' },
  { id: '2352', category: 'Windows & Doors' },
  { id: '2826', category: 'Windows & Doors' },
  { id: '3188', category: 'Windows & Doors' },
  { id: '3579', category: 'Windows & Doors' },
  { id: '3823', category: 'Windows & Doors' },
  { id: '4071', category: 'Windows & Doors' },
  { id: '4130', category: 'Windows & Doors' },
  { id: '4176', category: 'Windows & Doors' },
  { id: '4183', category: 'Windows & Doors' },
  { id: '6016', category: 'Windows & Doors' },
  { id: '20684', category: 'Windows & Doors' },
  { id: '24248', category: 'Windows & Doors' },

  // Arches
  { id: '3455', category: 'Arches' },
  { id: '3659', category: 'Arches' },
  { id: '2339', category: 'Arches' },
  { id: '3572', category: 'Arches' },
  { id: '4743', category: 'Arches' },
  { id: '5850', category: 'Arches' },
  { id: '6182', category: 'Arches' },
  { id: '30528', category: 'Arches' },
  { id: '80543', category: 'Arches' },
  { id: '6108', category: 'Arches' },
  { id: '92950', category: 'Arches' },
  { id: '88292', category: 'Arches' },
  { id: '16577', category: 'Arches' },
  { id: '13965', category: 'Arches' },
  { id: '14707', category: 'Arches' },
  { id: '18653', category: 'Arches' },
  { id: '30099', category: 'Arches' },
  { id: '78666', category: 'Arches' },

  // Wedges
  { id: '2399', category: 'Wedges' },
  { id: '2916', category: 'Wedges' },
  { id: '22391', category: 'Wedges' },
  { id: '30382', category: 'Wedges' },
  { id: '4856', category: 'Wedges' },
  { id: '43712', category: 'Wedges' },
  { id: '11291', category: 'Wedges' },
  { id: '45301', category: 'Wedges' },
  { id: '45677', category: 'Wedges' },
  { id: '29115', category: 'Wedges' },
  { id: '50373', category: 'Wedges' },
  { id: '43713', category: 'Wedges' },
  { id: '32084', category: 'Wedges' },
  { id: '47755', category: 'Wedges' },
  { id: '64225', category: 'Wedges' },
  { id: '80545', category: 'Wedges' },
  { id: '87619', category: 'Wedges' },
  { id: '4855', category: 'Wedges' },

  // Slopes
  { id: '3038', category: 'Slopes' },
  { id: '3040b', category: 'Slopes' },
  { id: '4161', category: 'Slopes' },
  { id: '4286', category: 'Slopes' },
  { id: '4445', category: 'Slopes' },
  { id: '15672', category: 'Slopes' },
  { id: '23949', category: 'Slopes' },
  { id: '30182', category: 'Slopes' },
  { id: '92946', category: 'Slopes' },
  { id: '44126', category: 'Slopes' },
  { id: '49618', category: 'Slopes' },
  { id: '50950', category: 'Slopes' },
  { id: '61678', category: 'Slopes' },
  { id: '3041', category: 'Slopes' },
  { id: '3042', category: 'Slopes' },
  { id: '3043', category: 'Slopes' },
  { id: '3048b', category: 'Slopes' },
  { id: '3299', category: 'Slopes' },
  { id: '3300', category: 'Slopes' },
  { id: '4509', category: 'Slopes' },
  { id: '32083', category: 'Slopes' },
  { id: '35464', category: 'Slopes' },
  { id: '43708', category: 'Slopes' },
  { id: 'u7033', category: 'Slopes' },
  { id: '678', category: 'Slopes' },
  { id: '2875', category: 'Slopes' },
  { id: '5404', category: 'Slopes' },
  { id: '41766', category: 'Slopes' },
  { id: '61487', category: 'Slopes' },
  { id: 'u7030', category: 'Slopes' },
  { id: 'u7031', category: 'Slopes' },
  { id: 'u7032', category: 'Slopes' },

  // Hinges
  { id: '2651', category: 'Hinges' },
  { id: '2650', category: 'Hinges' },
  { id: '3938', category: 'Hinges' },
  { id: '6134', category: 'Hinges' },
  { id: '3937', category: 'Hinges' },
  { id: '4625', category: 'Hinges' },
  { id: '4593', category: 'Hinges' },
  { id: '4213', category: 'Hinges' },
  { id: '314d', category: 'Hinges' },
  { id: '2430', category: 'Hinges' },
  { id: '3830', category: 'Hinges' },
  { id: '652', category: 'Hinges' },
  { id: '2429', category: 'Hinges' },
  { id: '3831', category: 'Hinges' },
  { id: '653', category: 'Hinges' },
  { id: '4592', category: 'Hinges' },
  { id: '2873', category: 'Hinges' },
  { id: '3597', category: 'Hinges' },
  { id: '13358', category: 'Hinges' },
  { id: '18910', category: 'Hinges' },
  { id: '654', category: 'Hinges' },
  { id: '4214', category: 'Hinges' },
  { id: '4531', category: 'Hinges' },
  { id: '4587', category: 'Hinges' },
  { id: '30388', category: 'Hinges' },
  { id: '2347', category: 'Hinges' },

  // Connectors — clips and bars, the two shapes Technic doesn't otherwise cover.
  { id: '4085c', category: 'Connectors' },
  { id: '30374', category: 'Connectors' },
  { id: '87994', category: 'Connectors' },
  { id: '6046', category: 'Connectors' },
  { id: '4628', category: 'Connectors' },
  { id: '2486', category: 'Connectors' },
  { id: '2583', category: 'Connectors' },
  { id: '6187', category: 'Connectors' },
  { id: '6221', category: 'Connectors' },
  { id: '30395', category: 'Connectors' },
  { id: '71184', category: 'Connectors' },
  { id: '3711', category: 'Connectors' },
  { id: '4095', category: 'Connectors' },
  { id: '11090', category: 'Connectors' },
  { id: '99061', category: 'Connectors' },
  { id: '35365', category: 'Connectors' },
  { id: '2555', category: 'Connectors' },
  { id: '23443', category: 'Connectors' },
  { id: '35366', category: 'Connectors' },
  { id: '87618', category: 'Connectors' },
  { id: '66909', category: 'Connectors' },
  { id: '92220', category: 'Connectors' },
  { id: '2432', category: 'Connectors' },
  { id: '23444', category: 'Connectors' },
  { id: '35654', category: 'Connectors' },
  { id: '63965a', category: 'Connectors' },
  { id: '64727', category: 'Connectors' },
  { id: '2540', category: 'Connectors' },
  { id: '2921', category: 'Connectors' },
  { id: '3136', category: 'Connectors' },

  // SNOT — sideways-facing studs, off the vertical lattice entirely.
  { id: '30250', category: 'SNOT' },
  { id: '2422', category: 'SNOT' },
  { id: '4598', category: 'SNOT' },
  { id: '5712', category: 'SNOT' },
  { id: '18671', category: 'SNOT' },
  { id: '93274', category: 'SNOT' },
  { id: '30263', category: 'SNOT' },
  { id: '4732', category: 'SNOT' },
  { id: '3956', category: 'SNOT' },
  { id: '36840', category: 'SNOT' },
  { id: '73825', category: 'SNOT' },
  { id: '98287', category: 'SNOT' },
  { id: '99207', category: 'SNOT' },
  { id: '99780', category: 'SNOT' },
  { id: '4070', category: 'SNOT' },
  { id: '30209', category: 'SNOT' },
  { id: '36841', category: 'SNOT' },
  { id: '44728', category: 'SNOT' },

  // Technic — beams, pins, axles, gears.
  { id: '3673', category: 'Technic' },
  { id: '3704', category: 'Technic' },
  { id: '3705', category: 'Technic' },
  { id: '3706', category: 'Technic' },
  { id: '3707', category: 'Technic' },
  { id: '4519', category: 'Technic' },
  { id: '32073', category: 'Technic' },
  { id: '32316', category: 'Technic' },
  { id: '32523', category: 'Technic' },
  { id: '32524', category: 'Technic' },
  { id: '40490', category: 'Technic' },
  { id: '43857', category: 'Technic' },
  { id: '44294', category: 'Technic' },
  { id: '60485', category: 'Technic' },
  { id: '3708', category: 'Technic' },
  { id: '3737', category: 'Technic' },
  { id: '4274', category: 'Technic' },
  { id: '23948', category: 'Technic' },
  { id: '30397', category: 'Technic' },
  { id: '31625', category: 'Technic' },
  { id: '32002', category: 'Technic' },
  { id: '32278', category: 'Technic' },
  { id: '32525', category: 'Technic' },
  { id: '41239', category: 'Technic' },
  { id: '50450', category: 'Technic' },
  { id: '50451', category: 'Technic' },
  { id: '3749', category: 'Technic' },
  { id: '4698', category: 'Technic' },
  { id: '6247', category: 'Technic' },
  { id: '4022', category: 'Technic' },
  { id: '61510', category: 'Technic' },
  { id: '2497', category: 'Technic' },
  { id: '6530', category: 'Technic' },
  { id: '6538a', category: 'Technic' },
  { id: '32072', category: 'Technic' },
  { id: '2736', category: 'Technic' },
  { id: '2792', category: 'Technic' },
  { id: '4261', category: 'Technic' },
  { id: '4730', category: 'Technic' },
  { id: '15458', category: 'Technic' },
  { id: '32012', category: 'Technic' },
  { id: '32017', category: 'Technic' },
  { id: '32063', category: 'Technic' },
  { id: '32065', category: 'Technic' },
  { id: '64782', category: 'Technic' },
  { id: '641', category: 'Technic' },
  { id: '2712', category: 'Technic' },
  { id: '2790a', category: 'Technic' },
  { id: '2823', category: 'Technic' },
  { id: '3649', category: 'Technic' },
  { id: '4019', category: 'Technic' },
  { id: '40244', category: 'Technic' },
  { id: '799', category: 'Technic' },
  { id: '32062', category: 'Technic' },
  { id: '57587', category: 'Technic' },
  { id: '57719', category: 'Technic' },
  { id: '71917', category: 'Technic' },
  { id: '71944', category: 'Technic' },
  { id: '71951', category: 'Technic' },
  { id: '71952', category: 'Technic' },

  // Round
  { id: '4589', category: 'Round' },
  { id: '6942', category: 'Round' },
  { id: '272', category: 'Round' },
  { id: '3350', category: 'Round' },
  { id: '6233', category: 'Round' },
  { id: '6141', category: 'Round' },
  { id: '6259', category: 'Round' },
  { id: '6900', category: 'Round' },
  { id: '38317', category: 'Round' },
  { id: '48310', category: 'Round' },
  { id: '45', category: 'Round' },
  { id: '59900', category: 'Round' },
  { id: '71076a', category: 'Round' },
  { id: '1748', category: 'Round' },
  { id: '28598', category: 'Round' },
  { id: '27507', category: 'Round' },
  { id: '27925', category: 'Round' },
  { id: '79393', category: 'Round' },
  { id: '2577', category: 'Round' },
  { id: '5152', category: 'Round' },
  { id: '48092', category: 'Round' },
  { id: '71075a', category: 'Round' },
  { id: '745', category: 'Round' },
  { id: '746', category: 'Round' },
  { id: '4588', category: 'Round' },
  { id: '33291', category: 'Round' },
  { id: '3943b', category: 'Round' },
  { id: '4841', category: 'Round' },
  { id: '6002', category: 'Round' },
  { id: '6039', category: 'Round' },
  { id: '6059', category: 'Round' },
  { id: '6222', category: 'Round' },
  { id: '18897', category: 'Round' },
  { id: '22888', category: 'Round' },

  // Tiles — studless tops.
  { id: '6934', category: 'Tiles' },
  { id: '14719', category: 'Tiles' },
  { id: '11203', category: 'Tiles' },
  { id: '3068b', category: 'Tiles' },
  { id: '3069b', category: 'Tiles' },
  { id: '3070b', category: 'Tiles' },
  { id: '2342', category: 'Tiles' },
  { id: '30256', category: 'Tiles' },
  { id: '3068a', category: 'Tiles' },
  { id: '3069a', category: 'Tiles' },
  { id: '3070a', category: 'Tiles' },
  { id: '22385', category: 'Tiles' },
  { id: '48995', category: 'Tiles' },
  { id: '2412b', category: 'Tiles' },
  { id: '5091', category: 'Tiles' },
  { id: '5092', category: 'Tiles' },
  { id: '35463', category: 'Tiles' },
  { id: '2412a', category: 'Tiles' },
  { id: '15209', category: 'Tiles' },
  { id: '27263', category: 'Tiles' },
  { id: '6881b', category: 'Tiles' },
  { id: '24445', category: 'Tiles' },
  { id: '65092', category: 'Tiles' },
  { id: '6881a', category: 'Tiles' },
  { id: '6923', category: 'Tiles' },
  { id: '2833', category: 'Tiles' },

  // Plates
  { id: '3020', category: 'Plates' },
  { id: '3021', category: 'Plates' },
  { id: '3022', category: 'Plates' },
  { id: '3024', category: 'Plates' },
  { id: '3031', category: 'Plates' },
  { id: '3032', category: 'Plates' },
  { id: '3034', category: 'Plates' },
  { id: '3035', category: 'Plates' },
  { id: '3036', category: 'Plates' },
  { id: '3460', category: 'Plates' },
  { id: '3623', category: 'Plates' },
  { id: '3666', category: 'Plates' },
  { id: '3710', category: 'Plates' },
  { id: '3795', category: 'Plates' },
  { id: '3958', category: 'Plates' },
  { id: '11212', category: 'Plates' },
  { id: '41539', category: 'Plates' },
  { id: '78329', category: 'Plates' },
  { id: '728', category: 'Plates' },
  { id: '2445', category: 'Plates' },
  { id: '3026', category: 'Plates' },
  { id: '3027', category: 'Plates' },
  { id: '3028', category: 'Plates' },
  { id: '3029', category: 'Plates' },
  { id: '3030', category: 'Plates' },
  { id: '3033', category: 'Plates' },
  { id: '3456', category: 'Plates' },
  { id: '3832', category: 'Plates' },
  { id: '4282', category: 'Plates' },
  { id: '4477', category: 'Plates' },
  { id: '60479', category: 'Plates' },
  { id: '91988', category: 'Plates' },
  { id: '92438', category: 'Plates' },
  { id: '15397', category: 'Plates' },

  // Bricks — plain studs, the baseline connection.
  { id: '2356', category: 'Bricks' },
  { id: '2456', category: 'Bricks' },
  { id: '3001', category: 'Bricks' },
  { id: '3002', category: 'Bricks' },
  { id: '3003', category: 'Bricks' },
  { id: '3004', category: 'Bricks' },
  { id: '3005', category: 'Bricks' },
  { id: '4201', category: 'Bricks' },
  { id: '3006', category: 'Bricks' },
  { id: '4202', category: 'Bricks' },
  { id: '4204', category: 'Bricks' },
  { id: '6111', category: 'Bricks' },
  { id: '6112', category: 'Bricks' },
  { id: '6212', category: 'Bricks' },
  { id: '733', category: 'Bricks' },
  { id: '30072', category: 'Bricks' },
  { id: '3245a', category: 'Bricks' },
  { id: '3754', category: 'Bricks' },
  { id: '6213', category: 'Bricks' },
  { id: '14716', category: 'Bricks' },
  { id: '30136', category: 'Bricks' },
  { id: '30137', category: 'Bricks' },
  { id: '30144', category: 'Bricks' },
  { id: '30145', category: 'Bricks' },
  { id: '2462', category: 'Bricks' },
  { id: '6107', category: 'Bricks' },
  { id: '14413', category: 'Bricks' },
  { id: '87620', category: 'Bricks' },
  { id: '702', category: 'Bricks' },
  { id: '2357', category: 'Bricks' },
  { id: '2653', category: 'Bricks' },
  { id: '2877', category: 'Bricks' },
  { id: '4216', category: 'Bricks' },
  { id: '4217', category: 'Bricks' },
  { id: '16968', category: 'Bricks' },
  { id: '30076', category: 'Bricks' },
  { id: '2463', category: 'Bricks' },
  { id: '4612', category: 'Bricks' },
  { id: '30505', category: 'Bricks' },
  { id: '33243', category: 'Bricks' },
]

interface CatalogEntry {
  id: string
  title: string
  category: string
}

/** Line one of a part file, e.g. `0 Brick  2 x  4` — collapsed to single spaces. */
function readTitle(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  return firstLine.replace(/^0\s*/, '').trim().replace(/\s+/g, ' ')
}

interface BuildResult {
  catalog: CatalogEntry[]
  source: 'mirror' | 'fixtures'
  missing: string[]
}

async function readCatalog(readLibrary: MirrorReader, source: 'mirror' | 'fixtures'): Promise<BuildResult> {
  const catalog: CatalogEntry[] = []
  const missing: string[] = []
  for (const { id, category } of CURATED_CHEST) {
    const text = await readLibrary(`${id}.dat`)
    if (text === null) {
      missing.push(id)
      continue
    }
    catalog.push({ id, title: readTitle(text), category })
  }
  return { catalog, source, missing }
}

interface BuildOptions {
  mirror: string
  out: string
}

async function build(options: BuildOptions): Promise<BuildResult> {
  if (await mirrorExists(options.mirror)) {
    const result = await readCatalog(createLibraryReader(options.mirror), 'mirror')
    if (result.missing.length > 0) {
      throw new Error(
        `mirror at ${path.resolve(options.mirror)} is missing curated parts: ${result.missing.join(', ')}\n` +
          `Re-run \`npm run sync-mirror\` if the mirror looks stale, or drop those ids from CURATED_CHEST.`,
      )
    }
    return result
  }

  console.warn(
    `no mirror at ${path.resolve(options.mirror)} — falling back to the committed fixtures at ` +
      `${FIXTURE_MIRROR_ROOT}. Run \`npm run sync-mirror\` for the full curated chest.`,
  )
  const result = await readCatalog(createLibraryReader(FIXTURE_MIRROR_ROOT), 'fixtures')
  if (result.catalog.length === 0) {
    throw new Error(
      `no mirror at ${path.resolve(options.mirror)} and none of the curated parts are in the committed ` +
        `fixtures either — run \`npm run sync-mirror\` to populate the mirror, then re-run this script.`,
    )
  }
  if (result.missing.length > 0) {
    console.warn(
      `fixtures cover ${result.catalog.length} of ${CURATED_CHEST.length} curated parts. Missing: ` +
        `${result.missing.join(', ')}. Run \`npm run sync-mirror\` for the rest.`,
    )
  }
  return result
}

function parseArgs(argv: string[]): BuildOptions {
  const options: BuildOptions = { mirror: DEFAULT_MIRROR_ROOT, out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--mirror') options.mirror = argv[++i]
    else if (arg === '--out') options.out = argv[++i]
    else throw new Error(`unknown argument ${arg}`)
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))

  // Enforced, not merely documented: this script reads local files and nothing else.
  globalThis.fetch = (() => {
    throw new Error('build-chest-catalog makes no network requests')
  }) as typeof fetch

  let result: BuildResult
  try {
    result = await build(options)
  } catch (error) {
    console.error(`build-chest-catalog failed: ${(error as Error).message}`)
    process.exitCode = 1
    return
  }

  const sorted = [...result.catalog].sort(
    (a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id, undefined, { numeric: true }),
  )
  await fsp.mkdir(path.dirname(options.out), { recursive: true })
  await fsp.writeFile(options.out, `${JSON.stringify(sorted, null, 2)}\n`)

  console.log(`wrote ${options.out} — ${sorted.length} parts, source: ${result.source}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
