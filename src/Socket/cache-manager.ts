import NodeCache from '@cacheable/node-cache'
import { DEFAULT_CACHE_TTLS } from '../Defaults'
import { CacheStore } from '../Types'

/**
 * Centralized cache manager for Socket operations
 * Provides type-safe cache instances with proper configuration
 */
export class CacheManager {
	private static instances = new Map<string, CacheStore>()

	/**
	 * Get or create a cache instance with the specified configuration
	 */
	static getInstance(type: keyof typeof DEFAULT_CACHE_TTLS, customTTL?: number): CacheStore {
		const cacheKey = `${type}_${customTTL || DEFAULT_CACHE_TTLS[type]}`

		if(!this.instances.has(cacheKey)) {
			const cache = new NodeCache({
				stdTTL: customTTL || DEFAULT_CACHE_TTLS[type],
				useClones: false,
				checkperiod: Math.max(60, (customTTL || DEFAULT_CACHE_TTLS[type]) / 10), // Cleanup expired keys
				maxKeys: this.getMaxKeysForType(type)
			}) as CacheStore

			this.instances.set(cacheKey, cache)
		}

		return this.instances.get(cacheKey)!
	}

	/**
	 * Clear all cache instances
	 */
	static clearAll(): void {
		this.instances.forEach(cache => cache.flushAll())
		this.instances.clear()
	}

	/**
	 * Get memory usage statistics for all caches
	 */
	static getStats(): Record<string, unknown> {
		const stats: Record<string, unknown> = {}

		this.instances.forEach((cache, key) => {
			try {
				// Try to get stats if the cache implementation supports it
				const nodeCache = cache as { keys?: () => string[]; getStats?: () => unknown }
				stats[key] = {
					keys: nodeCache.keys?.() || [],
					stats: nodeCache.getStats?.() || {}
				}
			} catch{
				stats[key] = { error: 'Unable to retrieve stats' }
			}
		})

		return stats
	}

	private static getMaxKeysForType(type: keyof typeof DEFAULT_CACHE_TTLS): number {
		const limits: Record<string, number> = {
			USER_DEVICES: 1000,
			MSG_RETRY: 5000,
			CALL_OFFER: 100,
			ON_WHATSAPP: 10000
		}

		return limits[type] || 1000
	}
}
