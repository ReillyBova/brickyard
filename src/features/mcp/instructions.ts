/**
 * What the server tells the model on connect.
 *
 * Rendering a subject in brick is a creative problem, and a handful of decisions
 * determine everything after them. These name the decisions rather than prescribing a
 * procedure — the choices are the model's to make, but making them unknowingly is what
 * produces a build that cannot be finished at the size it was started.
 */

export const SERVER_INSTRUCTIONS = `You are building with real LEGO parts. Pieces join through
their actual connection geometry, so sideways building, clips, bars, hinges and minifigures all work;
placements you cannot express are placements that would not hold.

Settle these before placing the first brick:

- Scale, first and hardest. The same subject is a different model at every size. At minifig scale a
  feature is a sub-assembly of several parts; at microscale the whole feature is one part. Fix the
  overall footprint and height in studs up front — nothing else can be chosen until it is.
- What has to read. Name the three or four features that make the subject recognisable. At small
  scale only the silhouette survives, so decide what earns its bricks.
- Which way the studs face. Smooth or angled surfaces mean building sideways, which is supported
  directly. Decide it before committing to a stack.
- A small parts vocabulary. Choose a handful of parts and reuse them, the way published sets do,
  rather than reaching for a new one for each problem.

While building:

- Work in batches. brick_place takes many bricks in one call and each can build on the last, so a
  wall is one call rather than forty.
- Read before you place. model_inspect reports the free connection points on a brick, which is what
  the next placement chooses among — naming a point beats guessing at coordinates.
- Check the silhouette as you go with model_screenshot. A build that has drifted is far easier to fix
  at fifty bricks than at four hundred.
- Group as you go. Named groups let you address a wall or a wing later as one thing.

Units are LDU: a stud is 20 apart, a plate is 8 tall, a brick is 24. Y points down, so stacking
upward is negative Y.`;

export interface PromptDefinition {
  name: string;
  description: string;
  arguments: readonly { name: string; description: string; required: boolean }[];
  render: (args: Record<string, string>) => string;
}

export const PROMPTS: readonly PromptDefinition[] = [
  {
    name: 'build',
    description: 'Build a subject out of bricks, deciding scale and silhouette before placing.',
    arguments: [
      { name: 'subject', description: 'What to build, e.g. "a dragon".', required: true },
      {
        name: 'scale',
        description: 'Optional size, e.g. "minifig", "microscale", "30 studs tall".',
        required: false,
      },
    ],
    render: (args) => {
      const subject = args.subject ?? 'something';
      const scale =
        args.scale === undefined || args.scale === ''
          ? 'Choose a scale and say why it suits the subject.'
          : `Build it at ${args.scale}.`;
      return `Build ${subject}.

${scale}

Before placing anything, say in two or three sentences: the footprint and height in studs, the three
or four features that have to read at that size, and the handful of parts you will work in. Then
build, in batches, checking the silhouette with a screenshot as you go.`;
    },
  },
];
