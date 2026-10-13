# Cue Daily

A separate desktop project based on [Cue](https://github.com/IdKwHyo/Cue), with two modes in the same floating control bar and text popup. This project has its own package identity, app ID, settings directory, session storage and Git history. The original Cue repository is unchanged.

- **Daily:** Cue’s existing scan, voice, draft review, follow-up, copy and read-aloud workflow. Replies fit the actual task: an ordinary explanation, message, translation, code snippet or concise answer. No automatic Answer / Hints / Talking Points / interview template. Scanning sends the screenshot directly to an everyday answer rather than extracting an assessment.
- **Chess:** Choose **Chess → Watch board**. Cue watches the display under your pointer, locates the board and checks for changed board images automatically. Gemini reads piece placement; local Stockfish evaluates the legally tracked position. The same popup shows text such as **White · Bishop e4 → f5**. There is no chessboard/game UI and no automatic clicking of moves.

## Run on your Mac

Install Node.js 22 or newer and [Stockfish](https://stockfishchess.org/download/). With Homebrew:

```sh
brew install stockfish
```

Clone the project, then run:

```sh
git clone https://github.com/IdKwHyo/cue-daily-chess.git
cd cue-daily-chess
npm ci
npm start
```

You can also double-click `Start-Cue-Daily.command` after granting it executable permission if needed (`chmod +x Start-Cue-Daily.command`). The source launcher installs Node dependencies when missing.

Open Settings and add your Gemini API key. The model is configurable, as in Cue. Add the Groq key only if you use Groq/Whisper dictation. This app uses its own settings; it does not copy keys or sessions out of the original Cue.

Grant Screen Recording permission to **Cue Daily** (or **Electron** when running from source) and quit/reopen the app. Daily uses the existing one-shot capture. Chess takes background snapshots while watching; switching to Daily pauses watching. Keep the complete board visible and keep the overlay/settings away from it.

## Chess setup

In Chess mode, open the same Settings sheet. Stockfish is discovered from PATH, `/opt/homebrew/bin/stockfish` or `/usr/local/bin/stockfish` on macOS. You can set an explicit executable path or `STOCKFISH_PATH` if needed. Click **Save chess setup** to apply these separate chess settings.

- **Orientation:** automatic detection uses visible board coordinates. Choose White/Black at the bottom when coordinates cannot be read.
- **Check interval:** 2, 4 or 8 seconds, plus recognition/search time. The application keeps one read/search in flight and skips identical board crops. Highlights and other visual changes can still trigger recognition. It is snapshot polling, not a video stream.
- **Starting position:** `start` means a new game. For a game already in progress, paste its complete FEN once (piece placement, turn, castling rights, en passant, halfmove and fullmove). A screenshot alone cannot reveal that history. From a confirmed position, the tracker matches one or two legal plies and retains the resulting UCI move history. If more moves are missed or recognition is ambiguous, the popup asks for a fresh full FEN.

The first localization reads the full display; subsequent recognized board crops are sent to your configured Gemini model. These API requests can incur provider usage costs. Screenshots are held in memory and are excluded from saved session exports. Stockfish move evaluation runs locally. The app clears old move text while reading a changed board or when recognition fails. Pause/resume preserves confirmed game history; saving chess setup resets it.

If you start another game, save `start` in Chess setup before watching again. If you move/resize the board and it cannot be recognized, pause/resume to locate it again. Window content protection is inherited from Cue; its effectiveness depends on the OS and sharing application, and this project does not claim broader invisibility guarantees.

## Development and verification

```sh
npm test
npx playwright install chromium
npm run test:browser
```

`npm run web` opens the Daily preview at `http://127.0.0.1:4318`. Automatic Chess capture is desktop-only.

See `VERIFICATION.md` for completed checks and remaining Mac checks. This project has independent Git history and uses the separate [cue-daily-chess repository](https://github.com/IdKwHyo/cue-daily-chess). It has no original Cue remote.

## Sources and licenses

Cue’s MIT license and FreeFlow attribution are retained. Headless position validation uses [chess.js](https://jhlywa.github.io/chess.js/), under BSD-2-Clause; its license is in `licenses/`. Stockfish is a separately installed executable using [UCI](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html) and is not bundled. Stockfish itself is GPLv3; any future bundled engine must include its applicable license/source requirements.
