/**
 * The sound a brick makes.
 *
 * Synthesised rather than sampled: a click is a short broadband transient, which Web
 * Audio makes from a noise burst and a fast envelope in a few lines. No asset to
 * license, nothing to download, and — the reason that matters here — every parameter is
 * tunable by ear rather than fixed in a file.
 *
 * `docs/DESIGN.md` describes `--by-ease-snap` as the piece being *pulled* the last
 * fraction of a millimetre by the connection rather than pushed there by software. This
 * is that, in sound: it should read as the piece seating, not as a UI confirmation beep.
 */

/** Short enough to read as a click rather than a tap. */
const DURATION = 0.055;

/** Where the noise sits. Low enough to be plastic, high enough to be a click. */
const CENTRE_HZ = 2200;
const Q = 1.4;

/** A quiet default: this fires on every placement, and loud would be unbearable. */
const DEFAULT_GAIN = 0.18;

export interface ClickOptions {
  /** 0 silences it. Above 1 is allowed but will clip. */
  gain?: number;
}

const STORAGE_KEY = 'by-sound-muted';

/** Reads the stored preference. Private browsing and blocked site data both throw. */
function readStoredMuted(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Private browsing / blocked site data — the app still mutes for this session, it
    // just won't be remembered next load.
  }
}

/**
 * Mute is a class-level switch, not an instance flag: `SceneRenderer` and
 * `BuilderCanvas` each construct their own `SnapSound` for their own call site (arrival
 * clicks vs. placement clicks), and neither knows about the other. A per-instance
 * `enabled` would need both callers to remember to wire the same toggle to both
 * instances — a static one means muting is a property of "brick sounds", not of any
 * particular `SnapSound`, and a third call site gains it for free just by constructing
 * one.
 */
export class SnapSound {
  private static globalMuted = readStoredMuted();

  private context: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  /**
   * Browsers refuse to start audio without a user gesture. Placement *is* a gesture, so
   * the context is created on first play rather than up front, and a refusal is
   * swallowed — a silent tool is a far better failure than a broken one.
   */
  private ensure(): AudioContext | null {
    if (this.context) return this.context;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.context = new Ctor();
    } catch {
      return null;
    }
    return this.context;
  }

  /** One buffer of white noise, reused. Regenerating per click is pure waste. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const frames = Math.ceil(ctx.sampleRate * DURATION);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buffer;
    return buffer;
  }

  /** Whether brick sounds are muted, app-wide. Defaults to on (unmuted). */
  static get muted(): boolean {
    return SnapSound.globalMuted;
  }

  /** Mutes or unmutes every `SnapSound`, and persists the choice. */
  static setMuted(muted: boolean): void {
    SnapSound.globalMuted = muted;
    writeStoredMuted(muted);
  }

  /**
   * Play one click.
   *
   * `strength` scales with how much engaged — a piece landing on eight studs sounds
   * more substantial than one catching a single stud. That is the same information the
   * design language refuses to show as a badge, carried in a channel where it costs no
   * screen space and no attention.
   */
  play(strength = 1, options: ClickOptions = {}): void {
    // Checked before `ensure()`, not after: a muted app never opens an `AudioContext`
    // at all, rather than opening one and discarding every click it would have played.
    if (SnapSound.globalMuted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    // A context created before any gesture starts suspended; resuming is a no-op once running.
    void ctx.resume?.().catch(() => undefined);

    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer(ctx);

    // Bandpass turns white noise into something with a body to it. More engagement
    // pulls the centre down, which reads as a bigger, blunter click.
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = CENTRE_HZ - Math.min(strength, 8) * 90;
    band.Q.value = Q;

    // Near-instant attack and a fast exponential decay: the shape of a hard object
    // seating, not a tone. A linear ramp here sounds like a beep.
    const gain = ctx.createGain();
    const peak = (options.gain ?? DEFAULT_GAIN) * (0.7 + Math.min(strength, 8) * 0.04);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + DURATION);

    source.connect(band).connect(gain).connect(ctx.destination);
    source.start(now);
    source.stop(now + DURATION);
  }

  dispose(): void {
    void this.context?.close().catch(() => undefined);
    this.context = null;
    this.noise = null;
  }
}
