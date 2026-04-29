import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * shadcn-style class utility — merges Tailwind classes intelligently
 * (later classes override earlier ones for the same property family).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
