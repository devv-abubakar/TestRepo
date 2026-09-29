/**
 * Caption suggestions.
 *
 * Every competing tool leaves the headline to the user, and the headline is the
 * part users get wrong — "Home Screen", "Dashboard", "Settings". A store caption
 * has to name a benefit, not a screen.
 *
 * These are deterministic and run offline: no API key, no request, no cost. The
 * structure follows the sequence that converts — hook, then capability, then
 * proof, then a close — because Play shows the first three screenshots inline
 * and a user decides there.
 */

export type Category =
  | 'productivity'
  | 'finance'
  | 'health'
  | 'social'
  | 'utility'
  | 'security'
  | 'game'
  | 'education'
  | 'shopping';

export type Beat = 'hook' | 'capability' | 'proof' | 'close';

export interface Suggestion {
  headline: string;
  subheadline: string;
  beat: Beat;
}

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'productivity', label: 'Productivity' },
  { id: 'finance', label: 'Finance' },
  { id: 'health', label: 'Health & fitness' },
  { id: 'social', label: 'Social' },
  { id: 'utility', label: 'Tools & utilities' },
  { id: 'security', label: 'Privacy & security' },
  { id: 'game', label: 'Games' },
  { id: 'education', label: 'Education' },
  { id: 'shopping', label: 'Shopping' },
];

const BANK: Record<Category, Record<Beat, Suggestion[]>> = {
  productivity: {
    hook: [
      { headline: 'Everything in one place', subheadline: 'Tasks, notes and deadlines, finally together', beat: 'hook' },
      { headline: 'Plan your day in 30 seconds', subheadline: 'Open it, see what matters, close it', beat: 'hook' },
      { headline: 'Less app, more done', subheadline: 'Opens straight to today', beat: 'hook' },
    ],
    capability: [
      { headline: 'Capture it before you forget', subheadline: 'One tap from anywhere, even offline', beat: 'capability' },
      { headline: 'Your week at a glance', subheadline: 'Drag to reschedule, nothing falls through', beat: 'capability' },
    ],
    proof: [
      { headline: 'Works offline, syncs later', subheadline: 'No connection needed to get things done', beat: 'proof' },
      { headline: 'Nothing to set up', subheadline: 'Useful from the first screen', beat: 'proof' },
    ],
    close: [
      { headline: 'Start with an empty inbox', subheadline: 'Free, no account required', beat: 'close' },
      { headline: 'Try it on today\'s list', subheadline: 'Nothing to configure', beat: 'close' },
    ],
  },
  finance: {
    hook: [
      { headline: 'Know where your money went', subheadline: 'Every rupee accounted for, automatically', beat: 'hook' },
      { headline: 'Stop guessing your balance', subheadline: 'One number that is always right', beat: 'hook' },
      { headline: 'Built for how you actually earn', subheadline: 'Freelance income, irregular months', beat: 'hook' },
    ],
    capability: [
      { headline: 'Log an expense in two taps', subheadline: 'Amount, category, done', beat: 'capability' },
      { headline: 'See the month before it ends', subheadline: 'Spending projected from what you have already spent', beat: 'capability' },
    ],
    proof: [
      { headline: 'Your data stays on your phone', subheadline: 'No bank login, no upload', beat: 'proof' },
      { headline: 'Built for multiple currencies', subheadline: 'Earn in dollars, spend in rupees', beat: 'proof' },
    ],
    close: [
      { headline: 'Take control this month', subheadline: 'Free to start, no card needed', beat: 'close' },
      { headline: 'See last month in one screen', subheadline: 'Import or start fresh', beat: 'close' },
    ],
  },
  health: {
    hook: [
      { headline: 'Small habits, tracked properly', subheadline: 'Progress you can actually see', beat: 'hook' },
      { headline: 'Your streak starts today', subheadline: 'One minute a day is enough', beat: 'hook' },
      { headline: 'No streak to lose', subheadline: 'Miss a day, keep your progress', beat: 'hook' },
    ],
    capability: [
      { headline: 'Log a workout without typing', subheadline: 'Pick, swipe, saved', beat: 'capability' },
      { headline: 'Charts that mean something', subheadline: 'Weekly trends, not raw numbers', beat: 'capability' },
    ],
    proof: [
      { headline: 'No account, no ads', subheadline: 'Your health data never leaves the device', beat: 'proof' },
      { headline: 'Works without a wearable', subheadline: 'Just your phone', beat: 'proof' },
    ],
    close: [
      { headline: 'Begin day one', subheadline: 'Free forever for one habit', beat: 'close' },
      { headline: 'One habit, one minute', subheadline: 'Start without signing up', beat: 'close' },
    ],
  },
  social: {
    hook: [
      { headline: 'Find your people', subheadline: 'Conversations worth opening the app for', beat: 'hook' },
      { headline: 'Less feed, more friends', subheadline: 'No algorithm deciding what you see', beat: 'hook' },
      { headline: 'Quiet by default', subheadline: 'You decide what gets a notification', beat: 'hook' },
    ],
    capability: [
      { headline: 'Share in one tap', subheadline: 'Photos, voice notes, anything', beat: 'capability' },
      { headline: 'Group chats that stay readable', subheadline: 'Threads, mentions and quiet hours', beat: 'capability' },
    ],
    proof: [
      { headline: 'No ads in your feed', subheadline: 'Ever', beat: 'proof' },
      { headline: 'You control who sees what', subheadline: 'Per-post privacy, set by default', beat: 'proof' },
    ],
    close: [
      { headline: 'Join in under a minute', subheadline: 'Free to download', beat: 'close' },
      { headline: 'Bring one friend', subheadline: 'That is enough to start', beat: 'close' },
    ],
  },
  utility: {
    hook: [
      { headline: 'The tool you keep reaching for', subheadline: 'Fast, small, no clutter', beat: 'hook' },
      { headline: 'Does one thing, properly', subheadline: 'No sign-in, no setup, no ads', beat: 'hook' },
      { headline: 'No account, no permissions', subheadline: 'Open it and it works', beat: 'hook' },
    ],
    capability: [
      { headline: 'Works the moment you open it', subheadline: 'No permissions to grant first', beat: 'capability' },
      { headline: 'Batch it all at once', subheadline: 'Select, apply, done', beat: 'capability' },
    ],
    proof: [
      { headline: 'Under 5 MB', subheadline: 'Runs on the phone you already have', beat: 'proof' },
      { headline: 'Offline by design', subheadline: 'Nothing is uploaded anywhere', beat: 'proof' },
    ],
    close: [
      { headline: 'Free, no ads', subheadline: 'Install and use it today', beat: 'close' },
      { headline: 'Keep it on your home screen', subheadline: 'You will use it tomorrow too', beat: 'close' },
    ],
  },
  security: {
    hook: [
      { headline: 'Find the app showing you ads', subheadline: 'Even when it hides its own icon', beat: 'hook' },
      { headline: 'Know what your apps can do', subheadline: 'Before they do it', beat: 'hook' },
      { headline: 'See what runs behind your back', subheadline: 'Overlays, admins, hidden icons', beat: 'hook' },
    ],
    capability: [
      { headline: 'Scan in seconds', subheadline: 'Every installed app, scored and sorted', beat: 'capability' },
      { headline: 'Remove it in one tap', subheadline: 'Straight to uninstall, no hunting in Settings', beat: 'capability' },
    ],
    proof: [
      { headline: 'Nothing leaves your phone', subheadline: 'No account, no uploads, no tracking', beat: 'proof' },
      { headline: 'Open about what it cannot do', subheadline: 'Every permission explained in plain words', beat: 'proof' },
    ],
    close: [
      { headline: 'Run your first scan', subheadline: 'Free, no sign-up', beat: 'close' },
      { headline: 'Check your phone now', subheadline: 'The scan takes seconds', beat: 'close' },
    ],
  },
  game: {
    hook: [
      { headline: 'One more round', subheadline: 'Easy to start, hard to put down', beat: 'hook' },
      { headline: 'Think fast', subheadline: 'Sixty seconds per run', beat: 'hook' },
      { headline: 'Learn it in one round', subheadline: 'Master it in a hundred', beat: 'hook' },
    ],
    capability: [
      { headline: '120 hand-built levels', subheadline: 'Each one a new idea', beat: 'capability' },
      { headline: 'Play with friends', subheadline: 'Same device or online', beat: 'capability' },
    ],
    proof: [
      { headline: 'No ads mid-game', subheadline: 'Never interrupted', beat: 'proof' },
      { headline: 'Plays offline', subheadline: 'On the bus, on a flight, anywhere', beat: 'proof' },
    ],
    close: [
      { headline: 'Beat the first level', subheadline: 'Free to play', beat: 'close' },
      { headline: 'First ten levels free', subheadline: 'No ads, no timers', beat: 'close' },
    ],
  },
  education: {
    hook: [
      { headline: 'Learn it in ten minutes a day', subheadline: 'Short lessons that actually stick', beat: 'hook' },
      { headline: 'Pass, do not cram', subheadline: 'Spaced practice built in', beat: 'hook' },
      { headline: 'Study on the bus', subheadline: 'Every lesson works offline', beat: 'hook' },
    ],
    capability: [
      { headline: 'Practice questions that adapt', subheadline: 'Harder when you are ready', beat: 'capability' },
      { headline: 'Track every topic', subheadline: 'See exactly what is still weak', beat: 'capability' },
    ],
    proof: [
      { headline: 'Works without data', subheadline: 'Download a chapter, study offline', beat: 'proof' },
      { headline: 'Written by teachers', subheadline: 'Not scraped from the internet', beat: 'proof' },
    ],
    close: [
      { headline: 'Start your first lesson', subheadline: 'Free to try', beat: 'close' },
      { headline: 'Pick a subject to begin', subheadline: 'The first chapter is free', beat: 'close' },
    ],
  },
  shopping: {
    hook: [
      { headline: 'Never pay full price', subheadline: 'Price drops, tracked for you', beat: 'hook' },
      { headline: 'Everything you want, one list', subheadline: 'Across every store', beat: 'hook' },
      { headline: 'Compare before you buy', subheadline: 'Same item, every seller, one screen', beat: 'hook' },
    ],
    capability: [
      { headline: 'Checkout in one tap', subheadline: 'Saved address, saved card', beat: 'capability' },
      { headline: 'Track every order', subheadline: 'One screen, all deliveries', beat: 'capability' },
    ],
    proof: [
      { headline: 'Free returns, always', subheadline: 'Thirty days, no questions', beat: 'proof' },
      { headline: 'Cash on delivery', subheadline: 'Pay when it arrives', beat: 'proof' },
    ],
    close: [
      { headline: 'Start with your first order', subheadline: 'Free delivery today', beat: 'close' },
      { headline: 'Save your first item', subheadline: 'We watch the price for you', beat: 'close' },
    ],
  },
};

/** The beat each position in a screenshot set should hit. */
export function beatForIndex(index: number, total: number): Beat {
  if (index === 0) return 'hook';
  if (total > 3 && index === total - 1) return 'close';
  if (index <= Math.ceil(total / 2)) return 'capability';
  return 'proof';
}

/**
 * Returns one suggestion per slide, walking the hook → capability → proof → close
 * sequence and never repeating a headline within a set.
 */
export function suggestSet(category: Category, count: number): Suggestion[] {
  const bank = BANK[category];
  const used = new Set<string>();
  const out: Suggestion[] = [];

  for (let i = 0; i < count; i += 1) {
    const beat = beatForIndex(i, count);
    // Prefer the beat's own lines, then fall back across every beat. A set of
    // eight must not repeat itself, and one beat alone does not hold eight lines.
    const options = [
      ...bank[beat],
      ...bank.hook,
      ...bank.capability,
      ...bank.proof,
      ...bank.close,
    ];
    const pick = options.find((o) => !used.has(o.headline)) ?? options[0]!;
    used.add(pick.headline);
    out.push({ ...pick, beat });
  }

  return out;
}

export function suggestOne(category: Category, beat: Beat, avoid: string[] = []): Suggestion {
  const options = BANK[category][beat];
  const skip = new Set(avoid);
  return options.find((o) => !skip.has(o.headline)) ?? options[0]!;
}
