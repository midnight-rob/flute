import { useLayoutEffect, useRef } from "react";

export function useFrameBatch<T>(apply: (value: T) => void, merge: (previous: T, next: T) => T = (_, next) => next) {
  const pending = useRef<{ value: T; frame: number } | null>(null);
  const callback = useRef(apply);
  useLayoutEffect(() => { callback.current = apply; }, [apply]);
  useLayoutEffect(() => () => {
    if (pending.current) cancelAnimationFrame(pending.current.frame);
    pending.current = null;
  }, []);

  function take() {
    const next = pending.current;
    if (!next) return;
    cancelAnimationFrame(next.frame);
    pending.current = null;
    return next.value;
  }

  function flush() {
    const value = take();
    if (value !== undefined) callback.current(value);
  }

  function schedule(value: T) {
    if (pending.current) {
      pending.current.value = merge(pending.current.value, value);
    } else {
      pending.current = { value, frame: requestAnimationFrame(flush) };
    }
  }

  return { schedule, take, flush };
}
