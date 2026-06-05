# remote-opencode-voice

> Enhanced Discord bot for remote OpenCode CLI access — now with voice channel support, speech-to-text, and text-to-speech.

> **Based on [remote-opencode](https://github.com/RoundTable02/remote-opencode) by [RoundTable02](https://github.com/RoundTable02)**

## What's New in This Fork

This enhanced version adds voice interaction capabilities to the original remote-opencode bot. Now you can interact with your AI coding assistant using your voice, not just text.

### Voice Channel Support

- **Join voice channels** — The bot can join Discord voice channels
- **Real-time voice interaction** — Speak to the bot and get spoken responses
- **Voice acknowledgments** — Pre-generated voice lines for "let me check", "one sec", "done", etc.
- **Audio playback** — Bot can play audio files in voice channels

### Speech-to-Text (STT)

- **Soniox integration** — Uses Soniox API for accurate speech transcription
- **Voice message transcription** — Send voice messages that are automatically transcribed
- **Real-time processing** — Transcribes audio in real-time while you speak

### Text-to-Speech (TTS)

- **Edge TTS** — Uses Microsoft Edge TTS for natural-sounding speech
- **Multiple voices** — Support for different voices and languages
- **Table parsing** — Automatically converts markdown tables to spoken format
- **Streaming responses** — Speaks responses as they're generated

### Voice Lines

Pre-generated voice acknowledgments for better user experience:
- "Let me check"
- "One sec"  
- "Looking into it"
- "Hang on"
- "Give me a moment"
- "Something went wrong"
- "Done"
- "Here you go"

### Agent Management

- **`/agent` command** — List, set, and manage OpenCode agents
- **Agent prompts** — Load agent-specific prompts from configuration
- **Channel-specific agents** — Set different agents for different channels

## Original Features

This fork includes all features from the original remote-opencode:

- Real-time streaming of OpenCode output
- Slash commands for remote control
- Session management
- Worktree support
- Queue management
- Voice message transcription (text-only)
- And more...

See the [original README](README.md) for complete documentation.

## Installation

### Prerequisites

- **Node.js 22+** — [Download](https://nodejs.org/)
- **OpenCode CLI** — Must be installed and working on your machine
- **Discord Account** — With a server where you have admin permissions
- **Soniox API Key** — For speech-to-text (optional)
- **OpenAI API Key** — For voice transcription (optional)

### Install from source

```bash
git clone https://github.com/YOUR_USERNAME/remote-opencode-voice.git
cd remote-opencode-voice
npm install
npm run build
npm link  # Makes 'remote-opencode-voice' available globally
```

### Setup

```bash
# Run the interactive setup wizard
remote-opencode-voice setup

# Start the bot
remote-opencode-voice start
```

## Configuration

### Voice Configuration

The bot uses the following APIs for voice features:

- **Soniox API** — For speech-to-text transcription
- **Edge TTS** — For text-to-speech (no API key required)
- **OpenAI API** — For voice message transcription (optional)

### Environment Variables

```bash
# Optional: OpenAI API key for voice transcription
export OPENAI_API_KEY="your-openai-api-key"

# Optional: Soniox API key for STT
export SONIOX_API_KEY="your-soniox-api-key"
```

### Voice Settings

Voice settings are configured in the source code:

- **Default voice**: `en-US-MichelleNeural` (Edge TTS)
- **Speech rate**: `+10%`
- **Audio format**: `audio-24khz-48kbitrate-mono-mp3`

## Discord Commands

### Voice Commands

- `/voice join` — Join the current voice channel
- `/voice leave` — Leave the voice channel
- `/voice status` — Show voice channel status

### Agent Commands

- `/agent list` — List all available agents
- `/agent set <name>` — Set the agent for the current channel
- `/agent clear` — Clear the agent setting

### Original Commands

All original commands are preserved. See the [original README](README.md) for details.

## Usage

### Voice Interaction

1. Join a voice channel in Discord
2. Use `/voice join` to have the bot join you
3. Send a voice message or type in the channel
4. The bot will transcribe your voice, process it, and respond with spoken audio

### Text Interaction

All original text-based interaction methods are preserved. You can still use:

- `/opencode` — Send text prompts
- `/code` — Enable passthrough mode
- `/session` — Manage sessions
- And all other original commands

## Technical Details

### Voice Processing Pipeline

1. **Audio capture** — Captures audio from Discord voice channels
2. **Transcription** — Sends audio to Soniox API for transcription
3. **Processing** — Forwards transcribed text to OpenCode
4. **Response generation** — OpenCode generates response
5. **Text-to-speech** — Converts response to audio using Edge TTS
6. **Playback** — Plays the audio in the voice channel

### Voice Lines

Pre-generated voice lines are stored in `dist/src/services/voiceLines/`:

- Generated using Edge TTS
- MP3 format, 24kHz sample rate
- Used for acknowledgments and error messages

## Credits

This project is based on [remote-opencode](https://github.com/RoundTable02/remote-opencode) by [RoundTable02](https://github.com/RoundTable02).

The original project provides an excellent foundation for remote OpenCode CLI access via Discord. This fork adds voice interaction capabilities while preserving all original functionality.

## License

MIT — Same as the original project.

## Contributing

Contributions welcome! Please open issues or pull requests for:

- Voice feature improvements
- New voice lines
- Additional language support
- Bug fixes
