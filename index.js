const express = require('express');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.json());

const stealthProfiles = JSON.parse(fs.readFileSync(path.join(__dirname, 'stealth.json'), 'utf-8'));

// Define proxies with their types for better logging
const PROXIES = [
    { url: 'http://hp_default_user_58fab94e:Hype4FWMZDZO9RRlL1Vn5@hdc1.hypeproxy.host:7216', type: 'HypeProxy' },
  { url: 'http://pf1:aohO1vFtktPqpxrZMF4j_country-US,GB@core-residential.evomi.com:1000', type: 'Evomi' },
  { url: 'http://hp_default_user_9d2ab612:hypeKZzRwP5MIXPILgf1H@hdc2.hypeproxy.host:7823', type: 'HypeProxy' },
  { url: 'http://hp_default_user_a76d136d:hyPE1mi9i5X7ydshj6Z18@hdc2.hypeproxy.host:7563', type: 'HypeProxy' },
    { url: 'http://hp_default_user_dec90e40:Hype3JJa6eyMinWSsjoEO@hdc2.hypeproxy.host:7349', type: 'HypeProxy' }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Enhanced structured logging
const logger = {
  info: (message, data = {}) => {
    console.log(JSON.stringify({
      level: 'info',
      timestamp: new Date().toISOString(),
      message,
      ...data
    }));
  },
  error: (message, error, data = {}) => {
    console.error(JSON.stringify({
      level: 'error',
      timestamp: new Date().toISOString(),
      message,
      error: error.message,
      stack: error.stack,
      ...data
    }));
  },
  warn: (message, data = {}) => {
    console.warn(JSON.stringify({
      level: 'warn',
      timestamp: new Date().toISOString(),
      message,
      ...data
    }));
  }
};

function countPageIds(html) {
  const matches = html.match(/page_id/g);
  return matches ? matches.length : 0;
}

function extractFacebookId(html) {
  try {
    const primaryRegex = /\\"throwback_story_fbid\\":\\"(\d+)\\",\\"page_id\\":\\"(\d+)\\"/g;
    const primaryMatch = primaryRegex.exec(html);
    
    if (primaryMatch) {
      return {
        throwback_story_fbid: primaryMatch[1],
        page_id: primaryMatch[2]
      };
    }
    
    const fallbackRegex = /"is_business_page_active":(true|false),"id":"(\d+)"/g;
    const fallbackMatch = fallbackRegex.exec(html);
    
    if (fallbackMatch) {
      return {
        is_business_page_active: fallbackMatch[1] === "true",
        page_id: fallbackMatch[2]
      };
    }
    
    return null;
  } catch (error) {
    logger.error('Error extracting Facebook ID', error);
    return null;
  }
}

function extractSocialMetrics(html) {
  try {
    const metrics = {
      likes: null,
      followers: null
    };

    // Match things like "3.8K likes" or "4K followers" in any order
    const regex = /([\d.,]+)\s*(K|M)?\s*(likes?|j'aime|j'aime|J\u2019aime|followers?)/gi;

    let match;
    while ((match = regex.exec(html)) !== null) {
      let value = match[1];
      const unit = match[2];
      const label = match[3].toLowerCase();

      value = parseFloat(value.replace(',', '.'));

      if (unit?.toUpperCase() === 'K') value *= 1000;
      if (unit?.toUpperCase() === 'M') value *= 1000000;

      if (label.includes("like") || label.includes("j'aime") || label.includes("j'aime")) {
        metrics.likes = value;
      } else if (label.includes("follower")) {
        metrics.followers = value;
      }
    }

    return metrics;

  } catch (error) {
    logger.error("Error extracting social metrics", error);
    return { likes: null, followers: null };
  }
}

// A request ID generator to track concurrent requests
let requestCounter = 0;
function getRequestId() {
  return `req-${Date.now()}-${++requestCounter}`;
}

async function fetchWithExponentialBackoff(url, options, maxAttempts = 5) {
  const failedProxies = new Set();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const availableProxies = PROXIES.filter(p => !failedProxies.has(p.url));
    if (availableProxies.length === 0) {
      throw new Error('All proxies have failed');
    }

    // Rotation séquentielle : toujours prendre le premier proxy disponible
    const currentProxy = availableProxies[0];
    const stealth = stealthProfiles[Math.floor(Math.random() * stealthProfiles.length)];

    logger.info(`Attempt ${attempt}/${maxAttempts} using ${currentProxy.type}`, {
      attempt,
      maxAttempts,
      proxyService: currentProxy.type,
      proxy: currentProxy.url.substring(0, 20) + '...'
    });

    // Créer un AbortController pour le timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000); // 30 secondes de timeout

    try {
      const proxyAgent = new HttpsProxyAgent(currentProxy.url);
      
      const headers = {
        ...stealth.extraHTTPHeaders,
        'User-Agent': stealth.userAgent,
        ...(options.headers || {})
      };

      const cookieHeader = Object.entries(stealth.cookies)
        .map(([key, val]) => `${key}=${val}`)
        .join('; ');

      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }

      const response = await fetch(url, {
        ...options,
        agent: proxyAgent,
        headers,
        signal: controller.signal,  // Ajouter le signal pour le timeout
        timeout: 30000             // Backup timeout (node-fetch)
      });

      clearTimeout(timeoutId); // Nettoyer le timeout si succès

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      logger.info(`Successfully fetched data on attempt ${attempt}`);
      return html;

    } catch (error) {
      clearTimeout(timeoutId); // Nettoyer le timeout en cas d'erreur
      
      if (error.name === 'AbortError') {
        logger.error(`Attempt ${attempt} timed out after 30 seconds`, error, { attempt, maxAttempts });
      } else {
        logger.error(`Attempt ${attempt} failed`, error, { attempt, maxAttempts });
      }

      // Mark proxy as failed (use the `.url` for Set comparison)
      failedProxies.add(currentProxy.url);

      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt - 1) * 3000;
        logger.info(`Waiting ${delay / 1000} seconds before next attempt...`, { delay });
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}

app.get('/', (req, res) => {
  res.status(200).json({ status: 'healthy' });
});

app.get('/scrape', async (req, res) => {
  const requestId = getRequestId();
  logger.info('New scrape request received', { requestId });
  
  const query = req.query.query;
  if (!query) {
    logger.warn('Missing query parameter', { requestId });
    return res.status(400).json({ error: 'Missing query parameter' });
  }

  try {
    logger.info(`Starting scrape for: ${query}`, { requestId });
    
    const html = await fetchWithExponentialBackoff(query, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1'
      },
      timeout: 10000
    }, 5, requestId);

    if (
      html.includes(`"props":{"title":"This content isn't available at the moment"`) ||
      html.includes(`"props":{"title":"This content isn't available right now"`) ||
      html.includes(`"props":{"title":"Ce contenu n\\u2019est pas disponible pour le moment"`)
    ) {
      logger.warn(`Facebook Down`, { requestId, url: query });
      return res.status(404).json({
        error: 'Facebook Down',
        url: query,
        timestamp: new Date().toISOString()
      });
    }

    const facebookId = extractFacebookId(html);
    const { likes, followers } = extractSocialMetrics(html);
    const pageIdCount = countPageIds(html);

    logger.info('Scrape completed successfully', { 
      requestId, 
      url: query,
      pageIdCount,
      hasLikes: likes !== null,
      hasFollowers: followers !== null,
      hasFacebookId: facebookId !== null
    });

    res.json({ 
      url: query,
      pageIdCount,
      likes,
      followers,
      ...facebookId,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Final error for ${query}`, error, { requestId });
    
    res.status(500).json({ 
      error: 'Scraping failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
});
