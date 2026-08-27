import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAsyncAction } from "./use-async-action";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAsyncAction", () => {
  it("sets pending true immediately, then false once the action resolves", async () => {
    const { result } = renderHook(() => useAsyncAction());
    const { promise, resolve } = deferred<void>();

    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run(() => promise);
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.error).toBeNull();

    resolve();
    await act(async () => runPromise);
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("captures an Error's message on failure", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("boom")));
    });
    expect(result.current.error).toBe("boom");
    expect(result.current.pending).toBe(false);
  });

  it("falls back to a generic message for a non-Error throw", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject("plain string"));
    });
    expect(result.current.error).toBe("Something went wrong");
  });

  it("calls onError with the same message when provided", async () => {
    const { result } = renderHook(() => useAsyncAction());
    const onError = vi.fn();
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("nope")), { onError });
    });
    expect(onError).toHaveBeenCalledWith("nope");
  });

  it("clears a previous error at the start of a new run", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("first")));
    });
    expect(result.current.error).toBe("first");

    const { promise, resolve } = deferred<void>();
    let runPromise!: Promise<void>;
    act(() => {
      runPromise = result.current.run(() => promise);
    });
    expect(result.current.error).toBeNull();
    resolve();
    await act(async () => runPromise);
  });

  it("clearError resets error to null", async () => {
    const { result } = renderHook(() => useAsyncAction());
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("x")));
    });
    expect(result.current.error).toBe("x");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
