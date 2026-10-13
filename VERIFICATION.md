# Cue Daily verification

## Completed

- `npm test`: 65 tests passed, including the inherited Cue checks plus Daily answer prompts, history, media validation, live watch lifecycle, unchanged-frame caching, old-result cancellation, fresh engines after pause/resume, legal one-to-four-ply tracking with ambiguity rejection, castling/en-passant/promotion handling, validated FEN imports, 64-square structured image parsing, automatic same-frame retry, crop caching/relocation, catch-up when the screen changes during analysis, provider backoff, and subprocess UCI failure/recovery.
- `node test/browser-check.cjs`: passed in headless Chromium 153, with native capture and Gemini mocked. Verified text-first chat without capture, mic → visible composer → send, screen attachment → dictated question, typed instructions with Scan, screenshot follow-ups, bounded conversation context, saved conversation, failed-send draft preservation, safe Markdown, settings, collapse, 700/420/320 widths and a 700px-tall desktop window. The composer and toolbar remain within the viewport. No uncaught JavaScript errors or automated axe WCAG2A/AA violations in the checked state. Internal QA screenshots were visually inspected.
- Actual Stockfish 19 Lite WASM UCI integration, installed outside this project: opening returned legal `e2e4`; mate-in-one returned `f7g7` and chess.js confirmed checkmate; checkmate returned no best move; a replayed knight-cycle history returned a legal result. This verified the real engine via a Node subprocess launcher. It did not verify the macOS native executable.
- JavaScript syntax checked; independent package/app/session identity configured. This source project has no original Cue Git remote. Its separate GitHub destination is `IdKwHyo/cue-daily-chess`; the original Cue repository was not modified.
- `node test/chess-browser-check.cjs`: passed with mocked native recognition/Stockfish. Verified the same overlay, visible Load FEN, paste/file imports through the actual FEN validator, invalid-FEN error and focus return, New game, watch/pause, persisted suggestion history across scans/errors/mode switches/reload, deduplication, scroll preservation, late start response handling, current/earlier labels, settings, Daily restore and ignored late Chess events. Checked 700/420/320 widths and no automated axe violations in the overlay, settings or FEN dialog.

## Remaining laptop checks

This environment cannot grant macOS permissions or exercise your real screen/Gemini account. The live capture/recognition/Stockfish pipeline is implemented, but its recognition accuracy and latency on your chosen chess site/theme must be measured on your laptop.

1. Run `npm ci` then `npm start` on macOS; verify it opens as the same compact overlay and uses separate settings from Cue.
2. Add keys and grant Screen Recording permission. Start a Daily conversation with typing and dictation before any capture. Use Attach screen, dictate a question and send; also try Scan with and without a typed instruction.
3. Install native Stockfish, switch to Chess, keep a starting board visible and choose Watch board. Confirm both board orientations and text-only move advice.
4. Move pieces. Confirm advice refreshes automatically, history stays visible while reading, and earlier suggestions are not marked as current. Check captures, castling, en passant and promotions when they arise.
5. Pause/resume, switch Daily/Chess, try the global shortcut, paste/import a full FEN using Load FEN, and verify a briefly obscured board recovers automatically while prior suggestions stay labelled as history.
6. Confirm window protection in the particular sharing application if using it; inherited Cue protection is OS/application dependent.

## Boundaries

Chess uses periodic screen snapshots and Gemini vision for recognition, plus native Stockfish for decisions. It is not local OCR or video streaming. It keeps complete move history only from the starting/imported FEN. It can recover a unique continuation of up to four missed legal plies within a bounded search budget; longer or ambiguous gaps need Load FEN. New game resets the tracker to the standard start. Structured output, retries and temporal checks are covered by fixtures; live recognition accuracy still depends on your board theme, visibility and Gemini response latency. No engine, board artwork, browser extension, chessboard UI, or move automation is bundled.
