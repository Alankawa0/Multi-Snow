# Discord Multi-Streaming Bot Project

## Overview
A Discord self-bot application that connects multiple user accounts to voice channels simultaneously for multi-streaming purposes. The bot uses discord.js-selfbot-v13 with @discordjs/voice for voice connections.

## Recent Changes (July 20, 2025)
- Fixed voice connection issues with self-bot implementation
- Improved voice adapter for compatibility with discord.js-selfbot-v13
- Enhanced error handling and reconnection logic
- Added proper caching for guilds and channels
- Fixed WebSocket payload sending for voice connections
- Added better logging and debugging capabilities

## Project Architecture
- **Main Process**: Express server running on configurable port
- **Worker Threads**: Each bot token runs in a separate worker for isolation
- **Voice Connections**: Uses @discordjs/voice with custom adapters for self-bots
- **Rate Limiting**: Built-in anti-rate limiting with exponential backoff
- **Configuration**: JSON-based config with support for up to 40+ tokens

## Key Features
- Multi-account voice channel connection
- Anti-rate limiting protection
- Automatic reconnection on failure
- Staggered startup to prevent detection
- Configurable mute/deaf settings per account
- Worker thread isolation for stability

## Technical Stack
- Node.js with discord.js-selfbot-v13
- @discordjs/voice for voice functionality
- Worker threads for multi-processing
- Express for status monitoring
- Custom voice adapters for self-bot compatibility

## Configuration
The project uses config.json with:
- Guild ID and voice channel ID
- Array of token configurations
- Reconnection settings
- Port configuration

## User Preferences
- Working on fixing voice connection issues
- Needs multi-streaming functionality
- Uses self-bot approach (user aware of ToS implications)