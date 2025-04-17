type TTSFn = (service: string, language: string, voice: string, text: string) => Promise<any>;

interface CacheItem {
    promise: Promise<any>;
    result?: any;
    timestamp: number;
    size: number;
    status: 'pending' | 'completed' | 'error';
}

export class TTSCacheService {
    // Session settings for each sessionId
    private static sessionSettings = new Map<string, {
        service: string,
        language: string,
        voice: string
    }>();

    // ===== Singleton Instance =====
    private static instance: TTSCacheService | null = null;
    private static initialized = false;

    // ===== Configuration and Dependencies =====
    private static ttsFn: TTSFn;
    private static timeoutMs: number = 5000;
    private static maxSize: number = 10 * 1024 * 1024; // 10 MB
    private static maxItems: number = 100;

    // ===== Cache and Queues =====
    private static cache = new Map<string, CacheItem>();
    private static currentSize = 0;
    private static sessionQueues = new Map<string, string[]>(); // sessionId -> [cacheKeys]
    private static pendingPromises = new Map<string, Promise<any>>(); // key -> promise

    // Private constructor to enforce singleton pattern
    private constructor() {}

    // ===== Public Static Methods =====

    /** Initialize the TTS Cache Service **/

    public static initialize(
        ttsServiceFn: TTSFn,
        maxCacheSize: number = 10 * 1024 * 1024,
        maxCacheItems: number = 100,
        requestTimeoutMs: number = 5000
    ): void {
        TTSCacheService.ttsFn = ttsServiceFn;
        TTSCacheService.timeoutMs = requestTimeoutMs;
        TTSCacheService.maxSize = maxCacheSize;
        TTSCacheService.maxItems = maxCacheItems;
        TTSCacheService.initialized = true;

        // Reset cache if re-initializing
        if (!TTSCacheService.instance) {
            TTSCacheService.instance = new TTSCacheService();
        }
    }

    /** Reset service (for testing) **/

    public static uninitialize(): void {
        TTSCacheService.instance = null;
        TTSCacheService.initialized = false;
        TTSCacheService.cache.clear();
        TTSCacheService.currentSize = 0;
        TTSCacheService.sessionQueues.clear();
        TTSCacheService.sessionSettings.clear();
        TTSCacheService.pendingPromises.clear();
    }

    /** Get cache statistics **/

    public static getCacheStats(): {
        currentItems: number,
        maxItems: number,
        currentSize: number,
        maxSize: number
    } {
        return {
            currentItems: TTSCacheService.cache.size,
            maxItems: TTSCacheService.maxItems,
            currentSize: TTSCacheService.currentSize,
            maxSize: TTSCacheService.maxSize
        };
    }

    /** Check if an item is complete in the cache **/

    public static hasCompletedItem(service: string, language: string, voice: string, text: string): boolean {
        if (!TTSCacheService.initialized) {
            console.warn("TTSCacheService: Not initialized when checking for completed item");
            return false;
        }

        const key = TTSCacheService.generateKey(service, language, voice, text);
        const item = TTSCacheService.cache.get(key);
        return !!item && item.status === 'completed' && !!item.result;
    }

    /** Check if there's a pending request for an item **/

    public static hasPending(service: string, language: string, voice: string, text: string): boolean {
        if (!TTSCacheService.initialized) {
            console.warn("TTSCacheService: Not initialized when checking for pending request");
            return false;
        }

        const key = TTSCacheService.generateKey(service, language, voice, text);
        const item = TTSCacheService.cache.get(key);
        return !!item && item.status === 'pending';
    }

    /** Set session settings for future preloads **/

    public static setSessionSettings(sessionId: string, service: string, language: string, voice: string): void {
        if (!TTSCacheService.initialized) {
            console.warn("TTSCacheService: Not initialized when setting session settings");
            return;
        }

        TTSCacheService.sessionSettings.set(sessionId, { service, language, voice });
    }

    /** Preload TTS content using session settings **/

    public static preloadTTS(text: string, sessionId: string): void {
        if (!TTSCacheService.initialized) {
            console.warn("TTSCacheService: Not initialized when preloading TTS");
            return;
        }

        const settings = TTSCacheService.sessionSettings.get(sessionId);
        if (!settings) {
            console.warn(`[preloadTTS] No settings found for session ${sessionId}`);
            return;
        }

        const { service, language, voice } = settings;
        TTSCacheService.preloadWithSettings(service, language, voice, text, sessionId);
    }

    /** Internal method to preload with known setting **/

    private static preloadWithSettings(
        service: string,
        language: string,
        voice: string,
        text: string,
        sessionId: string
    ): void {
        const key = TTSCacheService.generateKey(service, language, voice, text);

        // Skip if already in cache or pending
        if (TTSCacheService.cache.has(key)) {
            return;
        }

        // Create a new promise for this request
        const promise = TTSCacheService.withTimeout(
            TTSCacheService.ttsFn(service, language, voice, text),
            TTSCacheService.timeoutMs
        ).then(result => {
            if (result !== null) {
                const size = TTSCacheService.estimateSize(result);
                const cacheItem: CacheItem = {
                    promise,
                    result,
                    timestamp: Date.now(),
                    size,
                    status: 'completed'
                };
                TTSCacheService.setCacheItem(key, cacheItem);
                return result;
            } else {
                // Handle error case
                const cacheItem: CacheItem = {
                    promise,
                    timestamp: Date.now(),
                    size: 0,
                    status: 'error'
                };
                TTSCacheService.setCacheItem(key, cacheItem);
                return null;
            }
        }).catch(() => {
            // Handle error case
            const cacheItem: CacheItem = {
                promise,
                timestamp: Date.now(),
                size: 0,
                status: 'error'
            };
            TTSCacheService.setCacheItem(key, cacheItem);
            return null;
        });

        TTSCacheService.pendingPromises.set(key, promise);

        // Add as pending item to cache
        const pendingItem: CacheItem = {
            promise,
            timestamp: Date.now(),
            size: 0,
            status: 'pending'
        };
        TTSCacheService.setCacheItem(key, pendingItem);

        // Add to session queue for proper sequencing
        if (!TTSCacheService.sessionQueues.has(sessionId)) {
            TTSCacheService.sessionQueues.set(sessionId, []);
        }
        TTSCacheService.sessionQueues.get(sessionId)!.push(key);
    }

    /** Request TTS data with proper sequence handling **/

    public static async requestTTS(
        service: string,
        language: string,
        voice: string,
        text: string,
        sessionId: string
    ): Promise<any> {
        if (!TTSCacheService.initialized) {
            console.warn("TTSCacheService: Not initialized when requesting TTS");
            return null;
        }

        // Update session settings
        TTSCacheService.setSessionSettings(sessionId, service, language, voice);

        const key = TTSCacheService.generateKey(service, language, voice, text);

        // Ensure this item is in the session queue (in case it wasn't preloaded)
        if (!TTSCacheService.sessionQueues.has(sessionId)) {
            TTSCacheService.sessionQueues.set(sessionId, []);
        }

        const sessionQueue = TTSCacheService.sessionQueues.get(sessionId)!;
        if (!sessionQueue.includes(key)) {
            // Preload if not in queue yet
            TTSCacheService.preloadWithSettings(service, language, voice, text, sessionId);
        }

        // Wait for all previous items in the queue to resolve first
        await TTSCacheService.waitForPrecedingItems(sessionId, key);

        // Now get this item
        try {
            const item = TTSCacheService.cache.get(key);

            if (item && item.status === 'completed' && item.result) {
                // Item is already completed, return result
                return item.result;
            } else if (item && item.promise) {
                // Wait for pending promise
                const result = await item.promise;
                return result;
            } else {
                // Item not in cache, need to request it
                const promise = TTSCacheService.withTimeout(
                    TTSCacheService.ttsFn(service, language, voice, text),
                    TTSCacheService.timeoutMs
                );

                try {
                    const result = await promise;
                    if (result !== null) {
                        const size = TTSCacheService.estimateSize(result);
                        TTSCacheService.setCacheItem(key, {
                            promise,
                            result,
                            timestamp: Date.now(),
                            size,
                            status: 'completed'
                        });
                    }
                    return result;
                } catch (error) {
                    console.error("Error in TTS request:", error);
                    return null;
                }
            }
        } catch (error) {
            console.error("Error in requestTTS:", error);
            return null;
        }
    }

    // ===== Private Helper Methods =====

    /** Wait for all preceding items in the session queue**/

    private static async waitForPrecedingItems(sessionId: string, currentKey: string): Promise<void> {
        const queue = TTSCacheService.sessionQueues.get(sessionId) || [];
        const currentIndex = queue.indexOf(currentKey);

        if (currentIndex <= 0) {
            return; // No preceding items
        }

        const precedingKeys = queue.slice(0, currentIndex);
        const promises: Promise<any>[] = [];

        for (const key of precedingKeys) {
            const item = TTSCacheService.cache.get(key);
            if (item && item.promise) {
                promises.push(item.promise.catch(() => null)); // Catch errors to prevent rejection
            }
        }

        if (promises.length > 0) {
            await Promise.all(promises);
        }
    }

    /** Generate cache key **/

    private static generateKey(service: string, language: string, voice: string, text: string): string {
        return `${service}::${language}::${voice}::${text}`;
    }

    /** Estimate size of an object **/

    private static estimateSize(obj: any): number {
        try {
            return JSON.stringify(obj).length;
        } catch (e) {
            return 1000; // Default size if can't stringify
        }
    }

    /** Set an item in the cache with LRU management **/

    private static setCacheItem(key: string, item: CacheItem): void {
        if (TTSCacheService.cache.has(key)) {
            const oldItem = TTSCacheService.cache.get(key)!;
            TTSCacheService.currentSize -= oldItem.size;
        }

        TTSCacheService.cache.set(key, item);
        TTSCacheService.currentSize += item.size;

        // Enforce cache limits (LRU eviction)
        TTSCacheService.enforceCacheLimits();
    }

    /** Enforce cache size and item count limits (LRU) **/

    private static enforceCacheLimits(): void {
        // Convert to array to sort by timestamp
        if (TTSCacheService.cache.size > TTSCacheService.maxItems ||
            TTSCacheService.currentSize > TTSCacheService.maxSize) {

            const entries = Array.from(TTSCacheService.cache.entries());

            // Sort by timestamp (oldest first)
            entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

            // Remove the oldest entries until within limits
            while (entries.length > 0 &&
            (TTSCacheService.cache.size > TTSCacheService.maxItems ||
                TTSCacheService.currentSize > TTSCacheService.maxSize)) {

                const [oldestKey, oldestItem] = entries.shift()!;

                // Skip if it's a pending item
                if (oldestItem.status === 'pending') {
                    continue;
                }

                TTSCacheService.cache.delete(oldestKey);
                TTSCacheService.currentSize -= oldestItem.size;

                // Also clean up from pendingPromises if needed
                TTSCacheService.pendingPromises.delete(oldestKey);

                // Remove from all session queues
                for (const [sessionId, queue] of TTSCacheService.sessionQueues.entries()) {
                    const index = queue.indexOf(oldestKey);
                    if (index !== -1) {
                        queue.splice(index, 1);
                    }
                }
            }
        }
    }

    /** Add timeout to a promise **/

    private static withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T | null> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                console.warn(`TTS request timed out after ${timeout}ms`);
                resolve(null);
            }, timeout);

            promise.then(result => {
                clearTimeout(timer);
                resolve(result);
            }).catch(error => {
                console.error("Error in TTS service:", error);
                clearTimeout(timer);
                resolve(null); // Handle error internally
            });
        });
    }

}
