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

const PROXIES = [
  'http://pf1:aohO1vFtktPqpxrZMF4j@core-residential.evomi.com:1000',
  'http://hp_default_user_9d2ab612:HyPEqCFtcvjB57IubfvNY@hdc2.hypeproxy.host:7823',
  'http://hp_default_user_58fab94e:HYpeRRzxm6wswJlDtlKIn@lte.hypeproxy.host:7216'
];

// Metrics collection for performance monitoring
const metrics = {
  requests: 0,
  successes: 0,
  failures: 0,
  startTime: Date.now(),
  
  recordRequest: function(success) {
    this.requests++;
    if (success) {
      this.successes++;
    } else {
      this.failures++;
    }
  },
  
  getStats: function() {
    const uptime = Date.now() - this.startTime;
    return {
      uptime,
      requests: this.requests,
      successRate: this.requests > 0 ? (this.successes / this.requests) * 100 : 0,
      requestsPerMinute: (this.requests / (uptime / 60000)).toFixed(2)
    };
  }
};

// Structured logging for better monitoring
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Validate and sanitize input URLs
function validateFacebookUrl(url) {
  try {
    const parsedUrl = new URL(url);
    if (!parsedUrl.hostname.includes('facebook.com')) {
      return false;
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Enhanced error handling with specific error types
function handleScrapingError(error, url) {
  if (error.code === 'ECONNREFUSED') {
    return { error: 'Connection refused', status: 503 };
  } else if (error.code === 'ETIMEDOUT') {
    return { error: 'Request timed out', status: 504 };
  } else if (error.message.includes('403')) {
    return { error: 'Access forbidden - possible IP ban', status: 403 };
  }
  return { error: error.message, status: 500 };
}

function countPageIds(html) {
  const matches = html.match(/page_id/g);
  return matches ? matches.length : 0;
}

// Improved regex pattern for better data extraction
function extractSocialMetrics(html) {
  try {
    const input = {
      all: () => [{
        json: {
          data: html
        }
      }]
    };

    const results = input.all().map(item => {
      try {
        const rawData = item?.json?.data;
        if (!rawData) {
          throw new Error("No 'data' field found in the input JSON.");
        }
        
        const matches = [];
        let match;
        // Enhanced regex to catch more variations
        const primaryRegex = /"text":"([\d.,]+(?:\u00a0)?[KM]?)\s*(?:followers?|(?:j'aime|J\u2019aime|likes?|people like this|personnes aiment ça))"/gi;
        const dataString = typeof rawData === "string" ? rawData : JSON.stringify(rawData);
        
        while ((match = primaryRegex.exec(dataString)) !== null) {
          const isLike = /j'aime|J\u2019aime|likes?|people like this|personnes aiment ça/i.test(match[0]);
          const type = isLike ? "like" : "follower";
          
          let value = match[1];
          const hasK = value.includes('K');
          const hasM = value.includes('M');
          
          value = value.replace('\u00a0', '').replace(/[KM]/, '');
          
          if (value.includes(',') && value.includes('.')) {
            value = value.replace(',', '');
          } else if (value.includes(',')) {
            value = value.replace(',', '.');
          }
          
          value = parseFloat(value);
          
          if (hasK) {
            value = value * 1000;
          } else if (hasM) {
            value = value * 1000000;
          }

          matches.push({
            sentence: match[0],
            value: value,
            type: type
          });
        }
        
        return {
          json: {
            matches: matches
          }
        };
      } catch (error) {
        return {
          json: {
            error: error.message,
            matches: []
          }
        };
      }
    });

    const metrics = results[0]?.json?.matches || [];
    const likes = metrics.find(m => m.type === 'like')?.value || null;
    const followers = metrics.find(m => m.type === 'follower')?.value || null;

    return { likes, followers };

  } catch (error) {
    logger.error('Error extracting social metrics', error);
    return { likes: null, followers: null };
  }
}

// Improved proxy rotation strategy for Evomi and HypeProxy
function getNextProxy(attempt, failedProxies = []) {
  // Evomi proxy (first two attempts)
  if (attempt <= 2) {
    return PROXIES[0]; // Evomi proxy - will get a new IP each time
  } 
  // HypeProxy (attempts 3 and 4)
  else if (attempt <= 4) {
    // Use the appropriate HypeProxy based on attempt number
    return PROXIES[attempt - 2]; // PROXIES[1] for attempt 3, PROXIES[2] for attempt 4
  }
  
  return null; // All proxies exhausted
}

// Implement exponential backoff for retries
async function fetchWithExponentialBackoff(url, options, maxAttempts = 4) {
  const failedProxies = [];
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const currentProxy = getNextProxy(attempt, failedProxies);
      
      if (!currentProxy) {
        throw new Error('All proxies have failed');
      }
      
      const randomUserAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
      
      // Log which proxy service we're using
      const proxyService = attempt <= 2 ? 'Evomi' : 'HypeProxy';
      logger.info(`Attempt ${attempt}/${maxAttempts} using ${proxyService}`, { 
        attempt, 
        maxAttempts, 
        proxyService,
        proxy: currentProxy.substring(0, 20) + '...' 
      });

      const proxyAgent = new HttpsProxyAgent(currentProxy);
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
      const pageIdCount = countPageIds(html);
      logger.info(`Found ${pageIdCount} page_ids on attempt ${attempt}`, { pageIdCount, attempt });

      if (pageIdCount <= 2 && attempt < maxAttempts) {
        logger.warn(`Too few page_ids, trying next proxy`, { pageIdCount, attempt });
        failedProxies.push(currentProxy);
        const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
        await sleep(delay);
        continue;
      }

      return { response, html };

    } catch (error) {
      logger.error(`Attempt ${attempt} failed`, error, { attempt, maxAttempts });
      
      if (attempt < maxAttempts) {
        const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
        logger.info(`Waiting ${delay}ms before next attempt...`, { delay });
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }
}

// Input validation middleware
app.use('/scrape', (req, res, next) => {
  const { query } = req.query;
  
  if (!query) {
    return res.status(400).json({ 
      error: 'Missing query parameter',
      example: '/scrape?query=https://www.facebook.com/pagename'
    });
  }
  
  if (!validateFacebookUrl(query)) {
    return res.status(400).json({ 
      error: 'Invalid Facebook URL',
      example: 'https://www.facebook.com/pagename'
    });
  }
  
  next();
});

app.get('/scrape', async (req, res) => {
  const query = req.query.query;
  metrics.recordRequest(false); // Start with failure, will update to success if it works
  
  try {
    const { html } = await fetchWithExponentialBackoff(query, {
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
    });

    // Check for unavailable content
    const contentUnavailable = (
      html.includes("This content isn't available at the moment") ||
      html.includes('"title":"This content isn\'t available at the moment"')
    );

    if (contentUnavailable) {
      logger.warn(`Content unavailable for ${query}`);
      metrics.recordRequest(false);
      return res.status(404).json({
        error: 'Content not available',
        timestamp: new Date().toISOString()
      });
    }

    const { likes, followers } = extractSocialMetrics(html);
    const pageIdCount = countPageIds(html);
    
    metrics.recordRequest(true); // Mark as success

    res.json({ 
      url: query,
      likes,
      followers,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Final error for ${query}`, error);
    metrics.recordRequest(false);
    
    const { error: errorMessage, status } = handleScrapingError(error, query);
    res.status(status).json({ 
      error: 'Scraping failed',
      details: errorMessage,
      timestamp: new Date().toISOString()
    });
  }
});

// Add metrics endpoint
app.get('/metrics', (req, res) => {
  res.json(metrics.getStats());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
});
