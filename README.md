# Cue Daily

A separate desktop project based on [Cue](https://github.com/IdKwHyo/Cue), with two modes in the same floating control bar and text popup. This project has its own package identity, app ID, settings directory, session storage and Git history. The original Cue repository is unchanged.

- **Daily:** Open **Cue ↓** and type in **Message Cue**, or use **Mic** to dictate and then send. A screenshot is optional. Replies fit the actual task: an ordinary conversation, explanation, message, translation, code snippet or concise answer. **Scan screen** answers the visible questions (using your typed message if present); **Attach screen** captures without answering so you can type or speak your question afterward. The current screenshot stays attached for follow-ups until removed. Conversation text is saved locally; the latest eight exchanges are sent as context. Draft review, hints, copy and read-aloud remain available without a forced interview template.
- **Chess:** Choose **Chess → Watch board**. Cue watches the display under your pointer, locates the board and checks for changed board images automatically. Gemini reads piece placement; local Stockfish evaluates the legally tracked position. The same popup keeps a scrollable history of suggestions such as **White · Bishop e4 → f5**. Earlier suggestions remain readable while a changed board is scanned. There is no chessboard/game UI and no automatic clicking of moves.

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

The Chess popup has **Load FEN** directly below its move history. Paste all six FEN fields or import a `.fen` / `.txt` file, then choose **Load position**. Invalid positions show an error without replacing the current position. **New game** returns to the standard starting position. If watching is active, loading a valid position resumes watching automatically.

In Chess mode, open the same Settings sheet. Stockfish is discovered from PATH, `/opt/homebrew/bin/stockfish` or `/usr/local/bin/stockfish` on macOS. You can set an explicit executable path or `STOCKFISH_PATH` if needed. Click **Save chess setup** to apply these separate chess settings.

- **Orientation:** automatic detection uses visible board coordinates. Choose White/Black at the bottom when coordinates cannot be read.
- **Check interval:** 2, 4 or 8 seconds between checks, subject to recognition/search latency. The application keeps one read/search in flight, skips identical board crops and waits briefly for moving pieces to settle. Highlights and other visual changes can still trigger recognition. It is snapshot polling, not a video stream.
- **Starting position:** `start` means a new game. For a game already in progress, paste its complete FEN once (piece placement, turn, castling rights, en passant, halfmove and fullmove). A screenshot alone cannot reveal that history. From a confirmed position, the tracker searches for the shortest matching legal continuation, up to four plies (individual player moves), with a bounded search budget. A unique resulting game state is required; differing turns, rights or move counters are never guessed. Longer or ambiguous gaps need **Load FEN**.

The first localization reads the full display; subsequent board crops retain a small border to protect edge pieces and coordinates. Gemini reports all 64 squares in a structured response; code constructs and legally validates the placement. An uncertain read is retried automatically, repeated crop failures trigger full-display relocation, and rate limits/server failures use a bounded backoff. A final capture detects if the board changed during analysis before advice is displayed. Board images are sent to your configured Gemini model. These API requests can incur provider usage costs. Screenshots are held in memory and are excluded from saved session exports. Stockfish move evaluation runs locally. The latest 400 suggestions are saved locally as move history. During scanning or errors, old entries are labelled **Earlier suggestion**, and Copy move is disabled until a current suggestion is ready. **Clear history** clears this text log. Pause/resume preserves the confirmed position; loading a FEN, New game or saving chess setup resets legal tracking while retaining the text history. Chess suggestion history is separate from Daily session exports.

If you start another game, choose **New game** before watching again. If a moved or resized board is not recognized, Cue retries localization automatically; pause/resume also forces a fresh search. Window content protection is inherited from Cue; its effectiveness depends on the OS and sharing application, and this project does not claim broader invisibility guarantees.

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
