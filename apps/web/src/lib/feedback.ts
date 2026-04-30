import { useSyncExternalStore } from 'react';

export type FeedbackTone = 'info' | 'success' | 'error';

export interface FeedbackMessage {
  id: string;
  tone: FeedbackTone;
  title: string;
  description?: string;
}

type FeedbackInput = Omit<FeedbackMessage, 'id'> & {
  durationMs?: number;
};

const listeners = new Set<() => void>();
let messages: FeedbackMessage[] = [];
let nextID = 0;

function emit() {
  for (const listener of listeners) listener();
}

function getSnapshot() {
  return messages;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useFeedbackMessages() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function dismissFeedback(id: string) {
  messages = messages.filter((message) => message.id !== id);
  emit();
}

export function showFeedback(input: FeedbackInput) {
  const id = `feedback-${++nextID}`;
  const { durationMs = input.tone === 'error' ? 7000 : 4000, ...message } = input;
  messages = [...messages, { id, ...message }].slice(-4);
  emit();

  if (typeof window !== 'undefined' && durationMs > 0) {
    window.setTimeout(() => dismissFeedback(id), durationMs);
  }

  return id;
}

export function showSuccess(title: string, description?: string) {
  return showFeedback({ tone: 'success', title, description });
}

export function showError(error: unknown, fallback = 'Something went wrong.') {
  return showFeedback({
    tone: 'error',
    title: fallback,
    description: toUserErrorMessage(error),
  });
}

export function toUserErrorMessage(error: unknown, fallback = 'Try again in a moment.') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}
