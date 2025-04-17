import { TTSCacheService } from "./TTSCacheService";

// Fake TTS function for test
const fakeTTS = async (service: string, lang: string, voice: string, text: string) => {
    return new Promise(resolve => {
        setTimeout(() => {
            resolve(`[AUDIO]: ${text}`);
        }, 200);
    });
};

// Initialize the service
TTSCacheService.initialize(fakeTTS);
console.log("TTSCacheService initialized");

// Create a test session
const sessionId = 'test-session';
TTSCacheService.setSessionSettings(sessionId, 'test', 'en', 'voice1');

// Add items using the proper public API
for (let i = 0; i < 105; i++) {
    const text = `Hello ${i}`;
    // This will properly add the item to cache through the public API
    TTSCacheService.preloadTTS(text, sessionId);
}

// Wait a moment for async operations to complete
setTimeout(() => {
    // Get stats using public API
    const stats = TTSCacheService.getCacheStats();
    console.log("Items in cache:", stats.currentItems);
    console.log("Current size:", stats.currentSize);
    console.log("Has pending items:", TTSCacheService.hasPending("test", "en", "voice1", "Hello 0"));

    // Request an item to demonstrate it works
    TTSCacheService.requestTTS("test", "en", "voice1", "Hello 1", sessionId)
        .then(result => {
            console.log("Retrieved item:", result);
        });
}, 500);