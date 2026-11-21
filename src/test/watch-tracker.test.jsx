import { describe, expect, it, vi } from "vitest";
import { createWatchTracker } from "../modules/core.jsx";

// Monetização por vídeos: só conta o vídeo visto até ao fim, sem saltar.
describe("video watched to the end", () => {
  const play = (tracker, from, to, step = 0.25) => { for (let time = from; time <= to + 1e-9; time += step) tracker.update(time, 0, 10); };

  it("counts once when the whole clip is watched", () => {
    const onWatched = vi.fn();
    const tracker = createWatchTracker(onWatched);
    play(tracker, 0, 10);
    play(tracker, 0, 10);
    expect(onWatched).toHaveBeenCalledTimes(1);
  });

  it("does not count when the person skips to the end", () => {
    const onWatched = vi.fn();
    const tracker = createWatchTracker(onWatched);
    play(tracker, 0, 2);
    play(tracker, 9.5, 10);
    expect(onWatched).not.toHaveBeenCalled();
  });

  it("does not count a video stopped halfway", () => {
    const onWatched = vi.fn();
    const tracker = createWatchTracker(onWatched);
    play(tracker, 0, 6);
    expect(onWatched).not.toHaveBeenCalled();
  });
});
