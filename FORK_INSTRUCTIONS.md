# remote-opencode-voice — Clean Fork Ready

## What's in the fork

The fork at `C:\Users\mccra\Documents\remote-opencode-fork` contains:

### Your additions (highlighted in README):
1. **Voice Channel Support** — Join voice channels and interact with OpenCode through voice
2. **Speech-to-Text (STT)** — Using Soniox API for accurate speech transcription
3. **Text-to-Speech (TTS)** — Using Edge TTS for natural-sounding speech
4. **Voice Lines** — Pre-generated voice acknowledgments
5. **Agent Command** — Managing OpenCode agents through Discord

### Files included:
- `dist/` — Compiled JavaScript files (your additions are in there)
- `package.json` — Updated with new name and your authorship
- `README.md` — New README highlighting YOUR contributions
- `LICENSE` — MIT license (same as original)
- `.gitignore` — Prevents sensitive files from being committed
- `.opencode/` — OpenCode configuration
- `package-lock.json` — Dependency lock file

### What's NOT included:
- `node_modules/` — Dependencies (can be reinstalled with `npm install`)
- `.cocoindex_code/` — Local indexing database
- Any hardcoded credentials or sensitive data

## Next steps

1. **Review the README** — Make sure it accurately describes your additions
2. **Initialize git repository**:
   ```bash
   cd C:\Users\mccra\Documents\remote-opencode-fork
   git init
   git add .
   git commit -m "Initial commit - voice-enhanced fork"
   ```

3. **Create GitHub repository** and push:
   ```bash
   git remote add origin https://github.com/YOUR_USERNAME/remote-opencode-voice.git
   git push -u origin main
   ```

4. **Update package.json** — Replace `YOUR_USERNAME` with your actual GitHub username

## Key changes from original

- **Name**: `remote-opencode` → `remote-opencode-voice`
- **Version**: `1.5.3` → `1.6.0`
- **Author**: Added "Parth"
- **Description**: Updated to mention voice features
- **Keywords**: Added voice, speech-to-text, text-to-speech, stt, tts
- **README**: Completely rewritten to highlight YOUR additions

## Credit to original

The README clearly credits:
- Original project: [remote-opencode](https://github.com/RoundTable02/remote-opencode)
- Original author: [RoundTable02](https://github.com/RoundTable02)
- Links to original repository and author profile

The fork is ready to ship!
