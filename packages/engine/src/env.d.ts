// Globals available in both Node and browsers that the engine may use. The
// engine deliberately has no DOM or Node typings (it must run in both), so
// declare just what we need here.

declare function structuredClone<T>(value: T): T;

/** Only for timing in tests; never use the clock in game logic. */
declare const performance: { now(): number };
