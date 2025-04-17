import { TTSCacheService } from '../src/TTSCacheService';

// Mock TTS service function
const mockTTSFn = jest.fn(
    (service: string, language: string, voice: string, text: string): Promise<any> => {
        return new Promise((resolve) => {
            // Simulate network delay
            setTimeout(() => {
                resolve({
                    audioData: `Mock audio for: ${text} (${service}, ${language}, ${voice})`,
                    format: 'mp3',
                    duration: text.length * 100, // Mock duration based on text length
                });
            }, 50);
        });
    }
);

// Mock TTS service that fails
const mockFailingTTSFn = jest.fn(
    (): Promise<any> => {
        return new Promise((_, reject) => {
            setTimeout(() => {
                reject(new Error('Mock TTS service failure'));
            }, 50);
        });
    }
);

// Mock TTS service that times out
const mockTimeoutTTSFn = jest.fn(
    (): Promise<any> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                resolve({ audioData: 'Too late!' });
            }, 10000); // Very long delay
        });
    }
);

describe('TTSCacheService', () => {
    beforeEach(() => {
        // Reset before each test
        TTSCacheService.uninitialize();
        jest.clearAllMocks();
    });

    test('initializes correctly', () => {
        TTSCacheService.initialize(mockTTSFn, 1000, 10, 2000);
        expect(TTSCacheService.getCacheStats()).toEqual({
            currentItems: 0,
            maxItems: 10,
            currentSize: 0,
            maxSize: 1000
        });
    });

    test('preloads TTS content', async () => {
        TTSCacheService.initialize(mockTTSFn);

        // Set session settings
        const sessionId = 'test-session';
        TTSCacheService.setSessionSettings(sessionId, 'aws', 'en-US', 'female');

        // Preload content
        TTSCacheService.preloadTTS('Hello world', sessionId);

        // Verify it started the call
        expect(mockTTSFn).toHaveBeenCalledWith('aws', 'en-US', 'female', 'Hello world');

        // Wait for the async operation to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Check if the item is completed
        expect(TTSCacheService.hasCompletedItem('aws', 'en-US', 'female', 'Hello world')).toBe(true);
    });

    test('maintains sequence order', async () => {
        // Create a mock function with variable delays to simulate varying response times
        const mockVariableDelayTTSFn = jest.fn(
            (service: string, language: string, voice: string, text: string): Promise<any> => {
                return new Promise((resolve) => {
                    // Simulate network delay - longer for second item, shorter for third
                    const delay = text === 'Second' ? 200 : (text === 'Third' ? 50 : 100);
                    setTimeout(() => {
                        resolve({
                            audioData: `Mock audio for: ${text}`,
                            sequence: text,
                        });
                    }, delay);
                });
            }
        );

        TTSCacheService.initialize(mockVariableDelayTTSFn);

        const sessionId = 'sequence-test';
        TTSCacheService.setSessionSettings(sessionId, 'aws', 'en-US', 'female');

        // Preload multiple items
        TTSCacheService.preloadTTS('First', sessionId);
        TTSCacheService.preloadTTS('Second', sessionId);
        TTSCacheService.preloadTTS('Third', sessionId);

        // Request them in order and verify sequence is preserved
        const results = [];

        // Third should resolve fastest, but should wait for First and Second
        const resultPromises = [
            TTSCacheService.requestTTS('aws', 'en-US', 'female', 'First', sessionId),
            TTSCacheService.requestTTS('aws', 'en-US', 'female', 'Second', sessionId),
            TTSCacheService.requestTTS('aws', 'en-US', 'female', 'Third', sessionId)
        ];

        for (const promise of resultPromises) {
            const result = await promise;
            results.push(result.sequence);
        }

        // Results should be in original order despite different completion times
        expect(results).toEqual(['First', 'Second', 'Third']);
    });

    test('handles errors gracefully', async () => {
        TTSCacheService.initialize(mockFailingTTSFn);

        const sessionId = 'error-test';
        TTSCacheService.setSessionSettings(sessionId, 'aws', 'en-US', 'female');

        // This should not throw despite the TTS service failing
        const result = await TTSCacheService.requestTTS('aws', 'en-US', 'female', 'Fail test', sessionId);

        // Should return null on error
        expect(result).toBeNull();
    });

    test('handles timeouts', async () => {
        // Initialize with short timeout
        TTSCacheService.initialize(mockTimeoutTTSFn, 10485760, 100, 100); // 100ms timeout

        const sessionId = 'timeout-test';
        TTSCacheService.setSessionSettings(sessionId, 'aws', 'en-US', 'female');

        // This should timeout
        const result = await TTSCacheService.requestTTS('aws', 'en-US', 'female', 'Timeout test', sessionId);

        // Should return null on timeout
        expect(result).toBeNull();
    });

    test('implements LRU cache eviction', async () => {
        // Create cache with small limits
        TTSCacheService.initialize(mockTTSFn, 1000, 3); // Max 3 items

        const sessionId = 'lru-test';
        TTSCacheService.setSessionSettings(sessionId, 'aws', 'en-US', 'female');

        // Add items to fill cache
        await TTSCacheService.requestTTS('aws', 'en-US', 'female', 'Item 1', sessionId);
        await TTSCacheService.requestTTS('aws', 'en-US', 'female', 'Item 2', sessionId);
        await TTSCacheService.requestTTS('aws', 'en-US', 'female', 'Item 3', sessionId);

        // First three items should be in cache
        expect(TTSCacheService.hasCompletedItem('aws', 'en-US', 'female', 'Item 1')).toBe(true);
        expect(TTSCacheService.hasCompletedItem('aws', 'en-US', 'female', 'Item 2')).toBe(true);
        expect(TTSCacheService.hasCompletedItem('aws', 'en-US', 'female', 'Item 3')).toBe(true);

        // Add one more to trigger eviction
        await TTSCacheService.requestTTS('aws', 'en-US', 'female', 'Item 4', sessionId);

        // Item 1 should be evicted (oldest)
        expect(TTSCacheService.hasCompletedItem('aws', 'en-US', 'female', 'Item 1')).toBe(false);
        expect(TTSCacheService.hasCompletedItem('aws', 'en-US', 'female', 'Item 4')).toBe(true);
    });
});