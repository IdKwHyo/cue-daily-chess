# Cue Daily verification

## Completed

- `npm test`: 57 tests passed, including the inherited Cue checks plus Daily answer prompts, history, media validation, live watch lifecycle, unchanged-frame caching, old-result cancellation, fresh engines after pause/resume, legal one/two-ply tracking, castling/en-passant/promotion handling, validated FEN imports, image JSON parser validation, and subprocess UCI failure/recovery.
- `node test/browser-check.cjs`: passed in headless Chromium 153, with native capture and Gemini mocked. Verified existing collapsed Cue toolbar, Daily screenshot to direct answer, follow-up, safe Markdown, settings sizing, collapse, 700/420/320 widths, no uncaught JavaScript errors and no automated axe WCAG2A/AA violations in the checked state. Internal QA screenshots were visually inspected.
- Actual Stockfish 19 Lite WASM UCI integration, installed outside this project: opening returned legal `e2e4`; mate-in-one returned `f7g7` and chess.js confirmed checkmate; checkmate returned no best move; a replayed knight-cycle history returned a legal result. This verified the real engine via a Node subprocess launcher. It did not verify the macOS native executable.
- JavaScript syntax checked; independent package/app/session identity configured. This source project has no original Cue Git remote. Its separate GitHub destination is `IdKwHyo/cue-daily-chess`; the original Cue repository was not modified.
- `node test/chess-browser-check.cjs`: passed with mocked native recognition/Stockfish. Verified identical overlay, watch/pause, move rendering, late start response handling, stale-move suppression, settings, Daily restore, ignored late Chess events, 700/420/320 widths, compact toolbar clipping checks, and no automated axe violations in the checked toolbar or settings dialog.

## Remaining laptop checks

This environment cannot grant macOS permissions or exercise your real screen/Gemini account. The live capture/recognition/Stockfish pipeline is implemented, but its recognition accuracy and latency on your chosen chess site/theme must be measured on your laptop.

1. Run `npm ci` then `npm start` on macOS; verify it opens as the same compact overlay and uses separate settings from Cue.
2. Add keys and grant Screen Recording permission. Use Daily Scan and Dictation; check ordinary replies and follow-ups without the old forced interview format.
3. Install native Stockfish, switch to Chess, keep a starting board visible and choose Watch board. Confirm both board orientations and text-only move advice.
4. Move pieces. Confirm advice refreshes automatically and is cleared while the board is being read. Check captures, castling, en passant and promotions when they arise.
5. Pause/resume, switch Daily/Chess, try the global shortcut, import a full FEN midgame, and verify an obscured/unreadable board produces a waiting message without an old recommendation.
6. Confirm window protection in the particular sharing application if using it; inherited Cue protection is OS/application dependent.

## Boundaries

Chess uses periodic screen snapshots and Gemini vision for recognition, plus native Stockfish for decisions. It is not local OCR or video streaming. It keeps complete move history only from the starting/imported FEN. It can recover up to two missed legal plies; beyond that a fresh FEN is needed. A new game should reset Chess setup to `start`. No engine, board artwork, browser extension, chessboard UI, or move automation is bundled.
