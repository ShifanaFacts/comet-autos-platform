'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Languages, Loader2, Mic, Square, Trash2, TriangleAlert } from 'lucide-react';
import { CONTROL } from '@/components/forms/control';
import { SPEECH_LANGUAGES, isRtl, languageLabel } from '@/lib/team/labels';
import { cn } from '@/lib/utils';

/*
 * Say it or type it.
 *
 * A text box with a microphone. Tap the mic and speak in the language
 * chosen beside it; the words appear in the box as they are heard. Tap
 * again to stop. Whatever was heard is then shown back with a request to
 * check it — the box stays editable, so a wrong word is fixed by typing —
 * and nothing is saved until the person presses save.
 *
 * The browser's own speech recognition does the listening (Chrome and
 * Android send it to Google; an iPhone uses Apple's). It must be told the
 * language, so the speaker picks once and the phone remembers it. The text
 * is saved in that language, tagged with it.
 *
 * "Keep the recording" (off by default) records the sound as well, and it is
 * saved with the text. Off: nothing but the text leaves the phone.
 */

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const LANGUAGE_KEY = 'garage:speech-language';
const KEEP_KEY = 'garage:speech-keep-voice';
/** A voice note is a note, not a meeting: recording stops by itself after this. */
const MAX_RECORDING_MS = 3 * 60 * 1000;

const ERRORS: Record<string, string> = {
  'not-allowed': 'The microphone is blocked. Allow it for this site in the browser’s settings, then try again.',
  'service-not-allowed': 'The microphone is blocked. Allow it for this site in the browser’s settings, then try again.',
  'no-speech': 'Nothing was heard. Hold the phone closer and try again.',
  'audio-capture': 'No microphone was found, or another app is using it.',
  network: 'Voice typing needs an internet connection. Type instead, or try again.',
  'language-not-supported': 'This phone can’t type in that language. Pick another, or type.',
};

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

export interface SpeechFieldValue {
  text: string;
  language: string;
  /** The recording, when the speaker chose to keep it. */
  voice: Blob | null;
  /** Speech was turned into text and not yet confirmed by a save. */
  heard: boolean;
}

export function SpeechField({
  id,
  label,
  placeholder,
  rows = 3,
  value,
  onChange,
  allowKeepVoice = true,
  error,
  autoFocus,
}: {
  id: string;
  label: string;
  placeholder?: string;
  rows?: number;
  value: SpeechFieldValue;
  onChange: (next: SpeechFieldValue) => void;
  /** Offer "keep the recording". Off for short things like a reason. */
  allowKeepVoice?: boolean;
  error?: string;
  autoFocus?: boolean;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [keepVoice, setKeepVoice] = useState(false);

  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const wanted = useRef(false);
  const committed = useRef('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  latest.current = value;

  // Read once in the browser: what it can do, and what this phone chose before.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- browser-only facts, read after hydration */
    setSupported(recognitionCtor() !== null);
    try {
      const saved = localStorage.getItem(LANGUAGE_KEY);
      if (saved && SPEECH_LANGUAGES.some((l) => l.code === saved) && saved !== latest.current.language) {
        onChange({ ...latest.current, language: saved });
      }
      if (allowKeepVoice && localStorage.getItem(KEEP_KEY) === '1') setKeepVoice(true);
    } catch {
      // Storage blocked: defaults are fine.
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () => () => {
      wanted.current = false;
      recognition.current?.abort();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The recording, playable before it is sent.
  const voiceUrl = useMemo(() => (value.voice ? URL.createObjectURL(value.voice) : null), [value.voice]);
  useEffect(() => () => void (voiceUrl && URL.revokeObjectURL(voiceUrl)), [voiceUrl]);

  function update(patch: Partial<SpeechFieldValue>) {
    onChange({ ...latest.current, ...patch });
  }

  function chooseLanguage(code: string) {
    try {
      localStorage.setItem(LANGUAGE_KEY, code);
    } catch {}
    update({ language: code });
  }

  function toggleKeep(next: boolean) {
    setKeepVoice(next);
    try {
      localStorage.setItem(KEEP_KEY, next ? '1' : '0');
    } catch {}
  }

  /** One listening session. Phones end a session at each pause; we start another while the person still wants to talk. */
  function listen(Ctor: RecognitionCtor) {
    const rec = new Ctor();
    rec.lang = latest.current.language;
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (event) => {
      let finals = '';
      let pending = '';
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finals += result[0].transcript;
        else pending += result[0].transcript;
      }
      if (finals) {
        const base = committed.current;
        committed.current = `${base}${base && !/\s$/.test(base) ? ' ' : ''}${finals.trim()}`;
        update({ text: committed.current, heard: true });
      }
      setInterim(pending);
    };
    rec.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech' && committed.current) return; // a pause, not a failure
      setProblem(ERRORS[event.error] ?? 'Voice typing stopped. Try again, or type.');
      if (event.error !== 'no-speech') wanted.current = false;
    };
    rec.onend = () => {
      setInterim('');
      if (wanted.current) {
        try {
          listen(Ctor);
          return;
        } catch {
          wanted.current = false;
        }
      }
      setListening(false);
    };
    recognition.current = rec;
    rec.start();
  }

  async function start() {
    setProblem(null);
    const Ctor = recognitionCtor();
    const record = allowKeepVoice && (keepVoice || !Ctor);
    if (!Ctor && !record) {
      setProblem('Voice typing isn’t available in this browser. Use Chrome, or Safari on an iPhone — or type.');
      return;
    }
    committed.current = latest.current.text;

    if (record) {
      const mimeType = pickMimeType();
      if (mimeType === null || !navigator.mediaDevices?.getUserMedia) {
        setProblem('This browser can’t record sound. The text will still be typed for you.');
      } else {
        try {
          stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
          const chunks: Blob[] = [];
          const rec = new MediaRecorder(stream.current, mimeType ? { mimeType } : undefined);
          rec.ondataavailable = (event) => event.data.size > 0 && chunks.push(event.data);
          rec.onstop = () => {
            stream.current?.getTracks().forEach((track) => track.stop());
            stream.current = null;
            if (chunks.length) update({ voice: new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) });
          };
          rec.start(1000);
          recorder.current = rec;
          timer.current = setTimeout(stop, MAX_RECORDING_MS);
        } catch {
          setProblem(ERRORS['not-allowed']);
          return;
        }
      }
    }

    wanted.current = true;
    setListening(true);
    if (Ctor) {
      try {
        listen(Ctor);
      } catch {
        setProblem('Voice typing couldn’t start. Try again, or type.');
      }
    }
  }

  function stop() {
    wanted.current = false;
    if (timer.current) clearTimeout(timer.current);
    recognition.current?.stop();
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
    recorder.current = null;
    setListening(false);
    setInterim('');
  }

  const shown = interim ? `${value.text}${value.text ? ' ' : ''}${interim}` : value.text;
  const rtl = isRtl(value.language);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <label className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card pr-1 pl-2.5 text-xs text-muted-foreground">
          <Languages className="size-3.5 shrink-0" />
          <span className="sr-only">Language you will speak</span>
          <select
            value={value.language}
            onChange={(event) => chooseLanguage(event.target.value)}
            disabled={listening}
            className="h-8 w-32 bg-transparent text-xs font-medium text-foreground outline-none"
          >
            {SPEECH_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label} · {language.native}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="relative">
        <textarea
          id={id}
          rows={rows}
          dir={rtl ? 'rtl' : 'auto'}
          value={shown}
          readOnly={listening}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          onChange={(event) => update({ text: event.target.value })}
          className={cn(CONTROL, 'min-h-24 py-2.5 pr-16 text-base leading-relaxed md:text-sm', listening && 'border-primary')}
        />
        <button
          type="button"
          onClick={listening ? stop : start}
          aria-label={listening ? 'Stop listening' : `Speak in ${languageLabel(value.language)}`}
          className={cn(
            'absolute top-2 right-2 flex size-12 items-center justify-center rounded-full transition-colors',
            listening
              ? 'animate-pulse bg-destructive text-white'
              : 'bg-primary text-primary-foreground hover:bg-primary-hover',
          )}
        >
          {listening ? <Square className="size-5 fill-current" /> : <Mic className="size-5" />}
        </button>
      </div>

      {listening ? (
        <p className="flex items-center gap-2 text-xs text-primary">
          <Loader2 className="size-3.5 animate-spin" />
          Listening in {languageLabel(value.language)}… tap the red button when you’re done.
        </p>
      ) : value.heard && value.text ? (
        <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          Check what was heard. If a word is wrong, tap the text and correct it — then save.
        </p>
      ) : supported === false && !allowKeepVoice ? (
        <p className="text-xs text-muted-foreground">Voice typing isn’t available in this browser — type instead.</p>
      ) : null}

      {problem ? (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {problem}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {allowKeepVoice ? (
        <div className="flex flex-col gap-2">
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={keepVoice}
              disabled={listening}
              onChange={(event) => toggleKeep(event.target.checked)}
              className="size-5 shrink-0 accent-primary"
            />
            <span className="flex flex-col">
              <span className="font-medium">Keep the voice recording too</span>
              <span className="text-xs text-muted-foreground">
                Off: only the text is saved. {supported === false ? 'This browser can’t type speech, so turn this on to record it.' : ''}
              </span>
            </span>
          </label>
          {voiceUrl ? (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 p-2">
              <audio controls src={voiceUrl} className="h-10 min-w-0 flex-1" />
              <button
                type="button"
                onClick={() => update({ voice: null })}
                aria-label="Remove the recording"
                className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export const emptySpeech = (language = 'en-IN'): SpeechFieldValue => ({
  text: '',
  language,
  voice: null,
  heard: false,
});
