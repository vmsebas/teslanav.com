/**
 * Spoken proximity alerts.
 *
 * Where the browser has a text-to-speech voice for the chosen language
 * (desktop, phones, most Chromium builds) the alert is spoken. The Tesla
 * in-car browser ships no synthesis voices, so there `announce()` falls back
 * to the short chime passed in — the same sound the app already played.
 *
 * No audio is bundled for speech: real spoken alerts inside the car would
 * need prerecorded clips. Drop MP3s at `public/voice/<lang>/<key>.mp3` and
 * extend `announce()` to prefer them, and the car gets spoken alerts too.
 */

export type VoiceLang = "auto" | "es" | "pt" | "en";
export type AnnouncementKey = "police" | "speed_camera" | "red_light_camera";

const PHRASES: Record<"es" | "pt" | "en", Record<AnnouncementKey, string>> = {
  es: {
    police: "Policía cerca",
    speed_camera: "Radar cerca",
    red_light_camera: "Cámara de semáforo",
  },
  pt: {
    police: "Polícia próxima",
    speed_camera: "Radar próximo",
    red_light_camera: "Câmara de semáforo",
  },
  en: {
    police: "Police ahead",
    speed_camera: "Speed camera ahead",
    red_light_camera: "Red light camera ahead",
  },
};

export const VOICE_LANG_STORAGE_KEY = "teslanav-voice-lang";

function resolveLang(pref: VoiceLang): "es" | "pt" | "en" {
  if (pref === "es" || pref === "pt" || pref === "en") return pref;
  const nav =
    typeof navigator !== "undefined"
      ? (navigator.language || "en").toLowerCase()
      : "en";
  if (nav.startsWith("pt")) return "pt";
  if (nav.startsWith("es")) return "es";
  return "en";
}

// getVoices() is empty until the engine loads them; cache and refresh on the
// voiceschanged event so the first alert after load still finds a voice.
let cachedVoices: SpeechSynthesisVoice[] = [];
let listenerAttached = false;

function getSynth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window
    ? window.speechSynthesis
    : null;
}

function refreshVoices(): SpeechSynthesisVoice[] {
  const synth = getSynth();
  if (!synth) return [];
  const voices = synth.getVoices();
  if (voices.length > 0) cachedVoices = voices;
  if (!listenerAttached) {
    listenerAttached = true;
    synth.addEventListener?.("voiceschanged", () => {
      cachedVoices = synth.getVoices();
    });
  }
  return cachedVoices;
}

function pickVoice(lang: "es" | "pt" | "en"): SpeechSynthesisVoice | null {
  const voices = cachedVoices.length ? cachedVoices : refreshVoices();
  return (
    voices.find((v) => v.lang?.toLowerCase().startsWith(lang)) ?? null
  );
}

/** Returns true if a synthesis voice exists for the resolved language. */
export function hasVoiceFor(pref: VoiceLang): boolean {
  return getSynth() !== null && pickVoice(resolveLang(pref)) !== null;
}

/**
 * Speak the alert if a voice is available; otherwise play the fallback chime.
 * Safe to call from anywhere; never throws.
 */
export function announce(
  key: AnnouncementKey,
  options: { lang?: VoiceLang; fallback?: HTMLAudioElement | null } = {}
): void {
  const { lang = "auto", fallback = null } = options;
  const synth = getSynth();
  if (synth) {
    const resolved = resolveLang(lang);
    const voice = pickVoice(resolved);
    if (voice) {
      try {
        synth.cancel();
        const utterance = new SpeechSynthesisUtterance(PHRASES[resolved][key]);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        utterance.rate = 1;
        utterance.volume = 1;
        synth.speak(utterance);
        return;
      } catch {
        // Fall through to the chime.
      }
    }
  }
  if (fallback) {
    try {
      fallback.currentTime = 0;
      void fallback.play().catch(() => {});
    } catch {
      // Ignore: audio needs a prior user gesture on some browsers.
    }
  }
}

/** Prime voice loading early (e.g. on first user gesture). */
export function warmUpVoices(): void {
  refreshVoices();
}
