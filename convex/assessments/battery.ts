import type { JevDomain } from "../../shared/contracts";

export type CheckInItem = {
  taskKey: string;
  domain: JevDomain;
  promptVersion: string;
  question: string;
  correctAnswer?: string;
};

// The fixed check-in battery. Open-ended items carry no correctAnswer, so JEV
// judges answer quality instead of exact match. promptVersion stamps every
// response row, so a battery edit shows up as a prompt version change.
export const CHECK_IN_BATTERY: readonly CheckInItem[] = [
  { taskKey: "memory-word-recall-3", domain: "memory", promptVersion: "v1", question: "Read back the three words from the start of this check-in.", correctAnswer: "apple, penny, table" },
  { taskKey: "attention-digit-span", domain: "attention", promptVersion: "v1", question: "Repeat these digits back in reverse order: 4 9 2 7.", correctAnswer: "7 2 9 4" },
  { taskKey: "attention-serial-sevens", domain: "attention", promptVersion: "v1", question: "Count backwards from 100 by sevens, five times.", correctAnswer: "93, 86, 79, 72, 65" },
  { taskKey: "language-fluency", domain: "language", promptVersion: "v1", question: "Name as many animals as you can in 30 seconds." },
  { taskKey: "visuospatial-clock", domain: "visuospatial", promptVersion: "v1", question: "Describe how you would draw a clock face showing ten past eleven." },
  { taskKey: "speed-tap", domain: "speed", promptVersion: "v1", question: "Tap as soon as the shape changes.", correctAnswer: "Tapped promptly, within about 400 ms" },
];

export function itemFor(taskKey: string): CheckInItem {
  const item = CHECK_IN_BATTERY.find((candidate) => candidate.taskKey === taskKey);
  if (!item) throw new Error(`Unknown check-in item: ${taskKey}`);
  return item;
}
