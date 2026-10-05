/*
 * The sound of a notification while the app is open: a short chime made
 * here with Web Audio (no sound files to download), then the message read
 * out in a man's voice by the browser's own speech.
 *
 * Browsers only allow sound after the person has touched the page once;
 * `primeSound` is called on the first tap so later notifications can play.
 * When the app is closed, the phone plays its own notification sound — a
 * web app can't choose that one.
 */

type Kind = 'CHECK_IN_REMINDER' | 'CHECK_OUT_REMINDER' | 'TASK_ASSIGNED' | string;

const SOUND_KEY = 'garage:notification-sound';

const SPOKEN: Record<string, string> = {
  CHECK_IN_REMINDER: "Good morning. It's check-in time. Please check in at the workshop.",
  CHECK_OUT_REMINDER: 'Your working day has ended. Are you leaving? Please check out.',
  TASK_ASSIGNED: 'You have a new task from the admin. Please check it.',
};

/** Notes for each kind: [frequency Hz, start s, length s]. */
const CHIMES: Record<string, [number, number, number][]> = {
  // Bright, rising: "time to start".
  CHECK_IN_REMINDER: [
    [523.25, 0, 0.18],
    [659.25, 0.16, 0.18],
    [783.99, 0.32, 0.38],
  ],
  // Down, then up — it asks a question.
  CHECK_OUT_REMINDER: [
    [783.99, 0, 0.22],
    [587.33, 0.22, 0.22],
    [880, 0.5, 0.42],
  ],
  // Two quick dings: "you've got something".
  TASK_ASSIGNED: [
    [987.77, 0, 0.16],
    [1318.51, 0.18, 0.34],
  ],
};

let context: AudioContext | null = null;
const lastPlayed = new Map<string, number>();

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {}
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

/** Called on the first tap: browsers start sound only after one. */
export function primeSound() {
  const ctx = audio();
  if (ctx?.state === 'suspended') void ctx.resume().catch(() => {});
  // Loading the voices early: some browsers list them only after a first ask.
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.getVoices();
}

function chime(kind: Kind) {
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  const notes = CHIMES[kind] ?? CHIMES.TASK_ASSIGNED;
  const start = ctx.currentTime + 0.02;
  for (const [frequency, at, length] of notes) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(0.35, start + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + at);
    oscillator.stop(start + at + length + 0.05);
  }
}

/** A man's voice if the device has one: by name, since voices don't say. */
function maleVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith('en'));
  return (
    voices.find((voice) => /male|david|daniel|alex|fred|george|mark|james|rishi|aaron|arthur|guy|ravi/i.test(voice.name) && !/female/i.test(voice.name)) ??
    voices.find((voice) => /en-(in|gb)/i.test(voice.lang)) ??
    voices[0] ??
    null
  );
}

function speak(text: string) {
  if (typeof speechSynthesis === 'undefined') return;
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = maleVoice();
  if (voice) utterance.voice = voice;
  utterance.lang = voice?.lang ?? 'en-GB';
  utterance.rate = 0.95;
  // A little lower: reads as a man's voice even on a neutral one.
  utterance.pitch = 0.8;
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

/**
 * Chime, then say it. The same kind is not repeated within two minutes, so
 * a reminder that arrives both as a push and as the page's own popup is
 * heard once.
 */
export function announce(kind: Kind, text?: string) {
  if (typeof window === 'undefined' || !soundEnabled()) return;
  const now = Date.now();
  if (now - (lastPlayed.get(kind) ?? 0) < 120_000) return;
  lastPlayed.set(kind, now);
  try {
    chime(kind);
    const spoken = text ?? SPOKEN[kind];
    if (spoken) setTimeout(() => speak(spoken), 900);
  } catch {
    // Sound is a courtesy: never let it break the page.
  }
}
