/**
 * EcoSphere Server - Cache Middleware
 * Green IT: Prevents unnecessary database queries and heavy CPU compute cycles.
 */

const redis = require('redis');

// Initialize Redis client if configured
let redisClient = null;
if (process.env.REDIS_URL) {
  redisClient = redis.createClient({ url: process.env.REDIS_URL });
  redisClient.on('error', (err) => console.error('[Cache] Redis Client Error', err));
  redisClient.connect().catch(console.error);
}

// In-Memory cache fallback if Redis is unavailable
const localCache = new Map();
const CACHE_TTL_SECONDS = 300; // 5 minutes cache

/**
 * Cache middleware for Express API routes
 */
async function cacheMiddleware(req, res, next) {
  const cacheKey = `ecosphere_cache:${req.originalUrl || req.url}`;
  
  // Set default client-side browser caching headers
  res.setHeader('Cache-Control', `public, max-age=${CACHE_TTL_SECONDS}`);
  
  try {
    // 1. Try Redis cache
    if (redisClient && redisClient.isOpen) {
      const cachedData = await redisClient.get(cacheKey);
      if (cachedData) {
        console.log(`[Cache Server] Hit (Redis) pour ${cacheKey}`);
        return res.status(200).json(JSON.parse(cachedData));
      }
    } 
    // 2. Try in-memory fallback cache
    else {
      const cached = localCache.get(cacheKey);
      if (cached && cached.expiry > Date.now()) {
        console.log(`[Cache Server] Hit (In-Memory) pour ${cacheKey}`);
        return res.status(200).json(cached.data);
      }
    }
    
    // Cache Miss - override res.json to capture response before sending
    console.log(`[Cache Server] Miss pour ${cacheKey}. Requête relayée à la base de données...`);
    const originalJson = res.json;
    res.json = (body) => {
      res.json = originalJson;
      
      // Store in caches
      if (redisClient && redisClient.isOpen) {
        redisClient.setEx(cacheKey, CACHE_TTL_SECONDS, JSON.stringify(body))
          .catch(err => console.error('[Cache Server] Échec d\'écriture Redis', err));
      } else {
        localCache.set(cacheKey, {
          data: body,
          expiry: Date.now() + (CACHE_TTL_SECONDS * 1000)
        });
      }
      
      return originalJson.call(res, body);
    };
    
    next();
    
  } catch (error) {
    console.warn('[Cache Server] Erreur cache, continuité sans cache...', error);
    next();
  }
}

module.exports = {
  cacheMiddleware
};
