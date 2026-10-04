import type { TaskPriority, TaskStatus } from '@/generated/prisma/enums';

// Pure label maps, safe to import from Client Components.

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'Working on it',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

export const TASK_STATUS_TONE: Record<TaskStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  TODO: 'neutral',
  IN_PROGRESS: 'info',
  DONE: 'success',
  CANCELLED: 'danger',
};

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'NORMAL', label: 'Normal' },
  { value: 'HIGH', label: 'High' },
  { value: 'URGENT', label: 'Urgent' },
];

export const TASK_PRIORITY_LABEL = Object.fromEntries(
  TASK_PRIORITIES.map((priority) => [priority.value, priority.label]),
) as Record<TaskPriority, string>;

export const TASK_PRIORITY_TONE: Record<TaskPriority, 'neutral' | 'info' | 'warning' | 'danger'> = {
  LOW: 'neutral',
  NORMAL: 'info',
  HIGH: 'warning',
  URGENT: 'danger',
};

/**
 * Languages people can speak a task or note in. The browser's speech
 * recognition needs to be told which one — it does not guess — so the
 * speaker picks once and the phone remembers. The text is saved in the
 * language it was spoken in, tagged with it.
 *
 * Chosen for a Dubai workshop floor. Each `code` is a BCP-47 tag the
 * Chrome, Android and iPhone recognisers accept.
 */
export const SPEECH_LANGUAGES: { code: string; label: string; native: string }[] = [
  { code: 'en-IN', label: 'English', native: 'English' },
  { code: 'ar-AE', label: 'Arabic', native: 'العربية' },
  { code: 'hi-IN', label: 'Hindi', native: 'हिन्दी' },
  { code: 'ml-IN', label: 'Malayalam', native: 'മലയാളം' },
  { code: 'ur-PK', label: 'Urdu', native: 'اردو' },
  { code: 'ta-IN', label: 'Tamil', native: 'தமிழ்' },
  { code: 'te-IN', label: 'Telugu', native: 'తెలుగు' },
  { code: 'bn-IN', label: 'Bengali', native: 'বাংলা' },
  { code: 'ne-NP', label: 'Nepali', native: 'नेपाली' },
  { code: 'fil-PH', label: 'Filipino', native: 'Filipino' },
];

/** "Malayalam" for "ml-IN"; the tag itself for anything not in the list. */
export function languageLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return SPEECH_LANGUAGES.find((language) => language.code === code)?.label ?? code;
}

/** Right-to-left scripts, so a saved Arabic or Urdu note reads the right way round. */
export function isRtl(code: string | null | undefined): boolean {
  return !!code && /^(ar|ur|fa|he)\b/.test(code);
}
