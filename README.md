# TTSCacheService

A TypeScript service for efficient Text-to-Speech (TTS) caching and sequencing to improve audio playback experience.

## Overview

TTSCacheService is a singleton utility designed to optimize TTS operations by:

1. Caching previously generated audio to reduce redundant TTS API calls
2. Managing sequential playback to ensure proper order of speech segments
3. Handling error cases and timeouts gracefully
4. Implementing LRU (Least Recently Used) cache eviction strategy

## Features

- **Efficient Caching**: Stores TTS results to avoid regenerating the same audio
- **Sequencing Control**: Ensures TTS segments are played back in the correct order
- **Session Management**: Organizes requests by session for better context handling
- **Error Handling**: Gracefully manages TTS service failures
- **Resource Management**: Implements size and count limits with LRU eviction
- **Timeout Handling**: Prevents stuck requests from blocking the application

## Installation

```bash
npm install
```

## Build

```bash
npm run build
```

## Run the Example

```bash
npm start
```

## Usage

### Initialize the Service

```typescript
import { TTSCacheService } from "./TTSCacheService";

// Initialize with your TTS service function
TTSCacheService.initialize(
  yourTTSFunction,   // Required: Function that generates TTS
  10 * 1024 * 1024,  // Optional: Max cache size in bytes (default: 10MB)
  100,               // Optional: Max items in cache (default: 100)
  5000               // Optional: Request timeout in ms (default: 5000ms)
);
```

### Set Session Settings

```typescript
// Create and configure a session
const sessionId = 'user-123';
TTSCacheService.setSessionSettings(sessionId, 'aws', 'en-US', 'female');
```

### Preload TTS Content

```typescript
// Preload content for future use
TTSCacheService.preloadTTS('Welcome to our application', sessionId);
```

### Request TTS Audio

```typescript
// When you need the audio (resolves immediately if cached)
const audio = await TTSCacheService.requestTTS(
  'aws',                         // TTS service to use
  'en-US',                       // Language
  'female',                      // Voice
  'Welcome to our application',  // Text to speak
  sessionId                      // Session ID
);
```

### Check Cache Status

```typescript
// Check if content is available in cache
const isReady = TTSCacheService.hasCompletedItem('aws', 'en-US', 'female', 'Hello world');

// Get cache statistics
const stats = TTSCacheService.getCacheStats();
console.log(`Cache has ${stats.currentItems}/${stats.maxItems} items, using ${stats.currentSize}/${stats.maxSize} bytes`);
```

## How it Works

1. **Caching Strategy**: Uses a key-based cache (`service::language::voice::text`) to store TTS results
2. **Preloading**: Allows preloading speech segments before they're needed
3. **Sequential Processing**: Ensures segments are played in the correct order even if they complete out of order
4. **LRU Eviction**: When cache limits are reached, removes least recently used items first
5. **Timeouts**: Automatically resolves requests that take too long to prevent blocking

## Testing

Run the test suite:

```bash
npm test
```

The test suite verifies:
- Correct initialization and configuration
- Proper caching behavior
- Sequential ordering of audio segments
- Error handling and timeouts
- LRU cache eviction policy

## Use Cases

- **Voice assistants**: Preload responses for common queries
- **Navigation systems**: Cache directions and notifications
- **Accessibility tools**: Improve responsiveness of screen readers
- **Language learning apps**: Cache pronunciation examples
- **Games**: Pre-cache voiced dialogue for smoother gameplay

## Architecture

TTSCacheService uses a singleton pattern to maintain a global cache state. The service employs:

- **Promise-based API**: For asynchronous operations
- **LRU Eviction Strategy**: For memory management
- **Session-based Sequencing**: For ordered playback
- **Error Handling**: For graceful fallbacks

## License

ISC