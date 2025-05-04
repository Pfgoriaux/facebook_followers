const express = require('express');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fetch = require('node-fetch');
const app = express();

app.use(express.json());

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:106.0) Gecko/20100101 Firefox/106.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0) AppleWebKit/537.36 (KHTML, like Gecko) Firefox/112.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.75 Safari/537.36 Edg/100.0.1185.39",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.5481.100 Safari/537.36 OPR/90.0.1234.567",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 11_2_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15",
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:97.0) Gecko/20100101 Firefox/97.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 12_2_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36 Edg/97.0.1072.62",
  "Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.110 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Gecko/20100101 Firefox/115.0",
  "Mozilla/5.0 (X11; Linux i686; rv:68.0) Gecko/20100101 Firefox/68.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.45 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/95.0.4638.69 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko",
  "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.85 Safari/537.36"
];

// Define proxies with their types for better logging
const PROXIES = [
  { url: 'http://hp_default_user_dec90e40:Hype3JJa6eyMinWSsjoEO@hdc2.hypeproxy.host:7349', type: 'HypeProxy' },
  { url: 'http://pf1:aohO1vFtktPqpxrZMF4j_country-US,GB@core-residential.evomi.com:1000', type: 'Evomi' },
  { url: 'http://hp_default_user_9d2ab612:hypeKZzRwP5MIXPILgf1H@hdc2.hypeproxy.host:7823', type: 'HypeProxy' },
  { url: 'http://hp_default_user_a76d136d:hyPE1mi9i5X7ydshj6Z18@hdc2.hypeproxy.host:7563', type: 'HypeProxy' },
  { url: 'http://hp_default_user_58fab94e:Hype4FWMZDZO9RRlL1Vn5@hdc1.hypeproxy.host:7216', type: 'HypeProxy' }
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
    const regex = /([\d.,]+)\s*(K|M)?\s*(likes?|j’aime|j'aime|J\u2019aime|followers?)/gi;

    let match;
    while ((match = regex.exec(html)) !== null) {
      let value = match[1];
      const unit = match[2];
      const label = match[3].toLowerCase();

      value = parseFloat(value.replace(',', '.'));

      if (unit?.toUpperCase() === 'K') value *= 1000;
      if (unit?.toUpperCase() === 'M') value *= 1000000;

      if (label.includes("like") || label.includes("j’aime") || label.includes("j'aime")) {
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

    const currentProxy = availableProxies[(attempt - 1) % availableProxies.length];
    const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    logger.info(`Attempt ${attempt}/${maxAttempts} using ${currentProxy.type}`, {
      attempt,
      maxAttempts,
      proxyService: currentProxy.type,
      proxy: currentProxy.url.substring(0, 20) + '...'
    });

    try {
      const proxyAgent = new HttpsProxyAgent(currentProxy.url);
      const response = await fetch(url, {
        ...options,
        agent: proxyAgent,
        headers: {
          ...options.headers,
          'User-Agent': randomUserAgent
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      logger.info(`Successfully fetched data on attempt ${attempt}`);
      return html;

    } catch (error) {
      logger.error(`Attempt ${attempt} failed`, error, { attempt, maxAttempts });

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

// ✅ Check for "Shop not found"
if (
  html.includes(`"props":{"title":"This content isn't available at the moment"`) ||
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
