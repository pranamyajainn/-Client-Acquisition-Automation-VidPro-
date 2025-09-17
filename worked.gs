/**
 * Enhanced Smart Lead Radar - Complete Script
 * 
 * Deployment Checklist:
 * - Set `NEWSAPI_KEY` in Script Properties.
 * - Set `SERPAPI_KEY` in Script Properties (for web scraping).
 * - Run `setupDefaults()` once.
 * - Set a time-driven trigger for `runDailyLeadScan`.
 * - Run `testConfiguration()`.
 * - Set proper Sheet sharing.
 * - Schedule `resetRequestTracker()` at midnight.
 */

const DEFAULT_CONFIG = {
  industryKeywords: ['tech', 'software', 'AI', 'fintech', 'startup', 'developer', 'engineer', 'programmer'],
  geoKeywords: ['India', 'Bengaluru', 'Bangalore', 'Mumbai', 'Delhi', 'NCR', 'Hyderabad', 'Chennai', 'Pune', 'Kolkata'],
  hiringKeywords: ['hiring', 'recruit', 'job', 'position', 'career', 'opening', 'team expansion', 'new hires'],
  indianHiringKeywords: ['walk-in', 'walk in', 'off-campus', 'campus drive', 'off campus drive', 'job opening', 'positions open', 'join our team', 'recruitment drive', 'apply now', 'interview', 'joining', 'notice period', 'immediate joiners', 'HR'],
  jobPlatforms: {
    linkedin: {
      enabled: true,
      searchTerms: ['software engineer jobs india', 'developer jobs bangalore', 'tech jobs mumbai'],
      priority: 'high'
    },
    naukri: {
      enabled: true,
      searchTerms: ['software developer', 'java developer', 'python developer'],
      priority: 'high'
    },
    indeed: {
      enabled: true,
      searchTerms: ['software engineer', 'full stack developer'],
      priority: 'medium'
    },
    glassdoor: {
      enabled: true,
      searchTerms: ['tech jobs india', 'startup jobs'],
      priority: 'medium'
    }
  },
  sheetName: 'Smart Lead Radar India',
  maxRetries: 3,
  retryDelayMs: 2000,
  logLevel: 'INFO',
  spreadsheetId: '',
  jobScanEnabled: true,
  maxJobsPerPlatform: 20
};

/**
 * Sets up default configuration in Script Properties.
 */
function setupDefaults() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('CONFIG', JSON.stringify(DEFAULT_CONFIG));
}

/**
 * Resets the request counter in Script Properties.
 */
function resetRequestTracker() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SLR_requestCount', '0');
  props.setProperty('SLR_jobRequestCount', '0');
}

/**
 * Loads configuration from Script Properties or uses defaults.
 * @return {Object} The configuration object.
 */
function loadConfig() {
  const props = PropertiesService.getScriptProperties();
  const configStr = props.getProperty('CONFIG');
  return configStr ? JSON.parse(configStr) : DEFAULT_CONFIG;
}

/**
 * Gets the current request count from Script Properties.
 * @return {number} The request count.
 */
function getRequestCount() {
  const props = PropertiesService.getScriptProperties();
  const countStr = props.getProperty('SLR_requestCount');
  return parseInt(countStr || '0', 10);
}

/**
 * Gets the current job request count from Script Properties.
 * @return {number} The job request count.
 */
function getJobRequestCount() {
  const props = PropertiesService.getScriptProperties();
  const countStr = props.getProperty('SLR_jobRequestCount');
  return parseInt(countStr || '0', 10);
}

/**
 * Increments the request count in Script Properties.
 */
function incrementRequestCount() {
  const props = PropertiesService.getScriptProperties();
  const current = getRequestCount();
  props.setProperty('SLR_requestCount', (current + 1).toString());
}

/**
 * Increments the job request count in Script Properties.
 */
function incrementJobRequestCount() {
  const props = PropertiesService.getScriptProperties();
  const current = getJobRequestCount();
  props.setProperty('SLR_jobRequestCount', (current + 1).toString());
}

/**
 * Fetches articles for a given query with error handling and retries.
 * @param {Object} query The query object.
 * @param {Object} CONFIG The configuration.
 * @return {Object|null} The JSON response or null on failure.
 */
function fetchArticles(query, CONFIG) {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('NEWSAPI_KEY');
  if (!apiKey) {
    throw new Error('NEWSAPI_KEY not set in Script Properties.');
  }

  // Use last 3 days instead of just today
  const now = new Date();
  const fromDate = new Date(now.getTime() - (3 * 24 * 60 * 60 * 1000)); // 3 days ago
  const from = Utilities.formatDate(fromDate, 'GMT', 'yyyy-MM-dd');
  const to = Utilities.formatDate(now, 'GMT', 'yyyy-MM-dd');

  const url = 'https://newsapi.org/v2/everything?' +
              'q=' + encodeURIComponent(query.search) +
              '&from=' + from +
              '&to=' + to +
              '&language=en' +
              '&sortBy=publishedAt' +
              '&pageSize=20' +
              '&apiKey=' + apiKey;

  for (let retry = 0; retry <= CONFIG.maxRetries; retry++) {
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      incrementRequestCount();
      const code = response.getResponseCode();
      if (code === 200) {
        return JSON.parse(response.getContentText());
      } else if (code === 429) {
        const delay = CONFIG.retryDelayMs * Math.pow(2, retry) + Math.random() * 1000;
        Utilities.sleep(delay);
        continue;
      } else if (code === 401) {
        throw new Error('Invalid NEWSAPI_KEY.');
      } else {
        throw new Error('HTTP error: ' + code + ' - ' + response.getContentText());
      }
    } catch (e) {
      Logger.log('[WARN] fetchArticles attempt failed: ' + e.message);
      if (retry === CONFIG.maxRetries) {
        handleCriticalError(e);
        return null;
      }
      Utilities.sleep(500 + Math.floor(Math.random() * 500));
    }
  }

  handleCriticalError(new Error('Max retries exceeded for URL: ' + url));
  return null;
}

/**
 * Searches for job postings using SerpAPI (supports multiple platforms)
 * @param {string} query The search query
 * @param {string} platform The platform to search (linkedin, naukri, indeed, etc.)
 * @param {Object} CONFIG The configuration
 * @return {Array|null} Array of job results or null on failure
 */
function searchJobPostings(query, platform, CONFIG) {
  const props = PropertiesService.getScriptProperties();
  const serpApiKey = props.getProperty('SERPAPI_KEY');
  
  if (!serpApiKey) {
    Logger.log('SERPAPI_KEY not set in Script Properties. Skipping job search.');
    return null;
  }

  let siteFilter = '';
  switch (platform.toLowerCase()) {
    case 'linkedin':
      siteFilter = 'site:linkedin.com/jobs';
      break;
    case 'naukri':
      siteFilter = 'site:naukri.com';
      break;
    case 'indeed':
      siteFilter = 'site:indeed.com';
      break;
    case 'glassdoor':
      siteFilter = 'site:glassdoor.co.in';
      break;
    default:
      siteFilter = '';
  }

  const searchQuery = `${query} ${siteFilter} india hiring`;
  const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${serpApiKey}&num=20`;

  for (let retry = 0; retry <= CONFIG.maxRetries; retry++) {
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      incrementJobRequestCount();
      const code = response.getResponseCode();
      
      if (code === 200) {
        const data = JSON.parse(response.getContentText());
        return data.organic_results || [];
      } else if (code === 429) {
        const delay = CONFIG.retryDelayMs * Math.pow(2, retry) + Math.random() * 1000;
        Utilities.sleep(delay);
        continue;
      } else {
        Logger.log(`Job search error: ${code} - ${response.getContentText()}`);
        return null;
      }
    } catch (e) {
      Logger.log(`Job search attempt failed: ${e.message}`);
      if (retry === CONFIG.maxRetries) {
        return null;
      }
      Utilities.sleep(500 + Math.floor(Math.random() * 500));
    }
  }
  return null;
}

/**
 * Alternative job search using direct API calls where available
 * @param {string} platform The platform name
 * @param {string} query The search query
 * @param {Object} CONFIG The configuration
 * @return {Array|null} Array of job results or null
 */
function searchJobsDirectAPI(platform, query, CONFIG) {
  switch (platform.toLowerCase()) {
    case 'linkedin':
      return searchLinkedInJobs(query, CONFIG);
    case 'naukri':
      return searchNaukriJobs(query, CONFIG);
    default:
      return searchJobPostings(query, platform, CONFIG);
  }
}

/**
 * Search LinkedIn jobs using web scraping approach
 * @param {string} query The search query
 * @param {Object} CONFIG The configuration
 * @return {Array|null} Array of job results
 */
function searchLinkedInJobs(query, CONFIG) {
  const results = searchJobPostings(query, 'linkedin', CONFIG);
  if (!results) return null;
  
  return results.map(result => ({
    title: result.title || '',
    company: extractCompanyFromJobTitle(result.title) || extractCompanyFromSnippet(result.snippet) || 'Unknown',
    platform: 'LinkedIn',
    location: extractLocationFromSnippet(result.snippet) || 'India',
    link: result.link || '',
    snippet: result.snippet || '',
    date: extractDateFromSnippet(result.snippet) || new Date().toISOString()
  })).filter(job => job.company !== 'Unknown');
}

/**
 * Search Naukri.com jobs
 * @param {string} query The search query
 * @param {Object} CONFIG The configuration
 * @return {Array|null} Array of job results
 */
function searchNaukriJobs(query, CONFIG) {
  const results = searchJobPostings(query, 'naukri', CONFIG);
  if (!results) return null;
  
  return results.map(result => ({
    title: result.title || '',
    company: extractCompanyFromJobTitle(result.title) || extractCompanyFromSnippet(result.snippet) || 'Unknown',
    platform: 'Naukri.com',
    location: extractLocationFromSnippet(result.snippet) || 'India',
    link: result.link || '',
    snippet: result.snippet || '',
    date: extractDateFromSnippet(result.snippet) || new Date().toISOString()
  })).filter(job => job.company !== 'Unknown');
}

/**
 * Extract company name from job title
 * @param {string} title The job title
 * @return {string|null} Company name or null
 */
function extractCompanyFromJobTitle(title) {
  if (!title) return null;
  
  const patterns = [
    /at\s+([A-Z][a-zA-Z\s&]+?)(?:\s*[-|]|$)/i,
    /([A-Z][a-zA-Z\s&]+?)\s+(?:is\s+)?hiring/i,
    /([A-Z][a-zA-Z\s&]+?)\s*[-–]\s*Software/i,
    /([A-Z][a-zA-Z\s&]+?)\s*[-–]\s*Developer/i
  ];
  
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match && match[1]) {
      return cleanCompanyName(match[1]);
    }
  }
  
  return null;
}

/**
 * Extract company name from job snippet/description
 * @param {string} snippet The job snippet
 * @return {string|null} Company name or null
 */
function extractCompanyFromSnippet(snippet) {
  if (!snippet) return null;
  
  const patterns = [
    /Company:\s*([A-Z][a-zA-Z\s&]+?)(?:\s|$)/i,
    /at\s+([A-Z][a-zA-Z\s&]+?)(?:\s*[-|.]|$)/i,
    /([A-Z][a-zA-Z\s&]+?)\s+is\s+looking\s+for/i,
    /Join\s+([A-Z][a-zA-Z\s&]+?)(?:\s|$)/i
  ];
  
  for (const pattern of patterns) {
    const match = snippet.match(pattern);
    if (match && match[1]) {
      return cleanCompanyName(match[1]);
    }
  }
  
  return null;
}

/**
 * Extract location from job snippet
 * @param {string} snippet The job snippet
 * @return {string|null} Location or null
 */
function extractLocationFromSnippet(snippet) {
  if (!snippet) return null;
  
  const CONFIG = loadConfig();
  const locations = CONFIG.geoKeywords;
  
  for (const location of locations) {
    if (snippet.toLowerCase().includes(location.toLowerCase())) {
      return location;
    }
  }
  
  return null;
}

/**
 * Extract date from job snippet
 * @param {string} snippet The job snippet
 * @return {string|null} Date string or null
 */
function extractDateFromSnippet(snippet) {
  if (!snippet) return null;
  
  const datePatterns = [
    /(\d{1,2}\s+(?:hours?|days?|weeks?)\s+ago)/i,
    /Posted\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /(\d{4}-\d{2}-\d{2})/
  ];
  
  for (const pattern of datePatterns) {
    const match = snippet.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}

/**
 * Clean and normalize company name
 * @param {string} name Raw company name
 * @return {string} Cleaned company name
 */
function cleanCompanyName(name) {
  if (!name) return '';
  
  return name.trim()
    .replace(/^(The\s+)/i, '')
    .replace(/\s*(Inc|Ltd|LLC|Corp|Pvt|Private|Limited)\.?$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract company name from title using patterns (Original function)
 * @param {string} title The article title.
 * @param {RegExp} pattern The regex pattern.
 * @param {string} fallbackSource Fallback source name.
 * @return {string|null} Cleaned company name or null.
 */
function extractCompanyName(title, pattern, fallbackSource) {
  if (!title || typeof title !== 'string') return null;
  const raw = title.trim();

  function cleanName(n) {
    if (!n || typeof n !== 'string') return null;
    let name = n.trim();
    name = name.replace(/^The\s+/i, '');
    name = name.replace(/'s$/i, '');
    name = name.replace(/,?\s*(Inc|Incorporated|Ltd|LLC|L\.L\.C\.?|Corp|Corporation|Co|Pvt|Pvt\.|PLC|GmbH|S\.A\.|SA|BV)\.?$/i, '');
    name = name.replace(/\s+/g, ' ').trim();
    if (name.length < 2) return null;
    return name;
  }

  const blacklist = new Set([
    'company', 'firm', 'startup', 'business', 'expansion', 'jobs', 'hiring',
    'opening', 'positions', 'position', 'invalid', 'test', 'news', 'report',
    'article', 'press', 'pressrelease', 'press release'
  ]);

  try {
    if (pattern instanceof RegExp) {
      const m = raw.match(pattern);
      if (m && m[1]) {
        const candidate = cleanName(m[1]);
        if (candidate && !blacklist.has(candidate.toLowerCase()) && /^[A-Za-z]/.test(candidate)) {
          if (candidate.split(/\s+/).length > 1 || candidate.length > 2) return candidate;
        }
      }
    }
  } catch (e) {
    // fallthrough
  }

  const multiCap = raw.match(/([A-Z][a-zA-Z&]{2,}(?:\s+[A-Z][a-zA-Z&]{2,}){1,3})/);
  if (multiCap && multiCap[1]) {
    const candidate = cleanName(multiCap[1]);
    if (candidate && !blacklist.has(candidate.toLowerCase())) return candidate;
  }

  const singleCap = raw.match(/\b([A-Z][a-zA-Z&]{2,})\b/);
  if (singleCap && singleCap[1]) {
    const candidate = cleanName(singleCap[1]);
    if (candidate && !blacklist.has(candidate.toLowerCase())) return candidate;
  }

  if (fallbackSource && typeof fallbackSource === 'string') {
    const srcCandidate = cleanName(fallbackSource);
    if (srcCandidate && !blacklist.has(srcCandidate.toLowerCase())) return srcCandidate;
  }

  return null;
}

/**
 * Extracts INR funding amount from text, ignoring non-INR.
 */
function extractFundingAmountINR(text) {
  if (!text || typeof text !== 'string') return null;

  if (/[€£$]/.test(text)) return null;

  const t = text.replace(/\u00A0/g, ' ').trim();

  const curPattern = /(?:₹|INR|Rs\.?)\s*([0-9][0-9,]*(?:\.\d+)?)/i;
  const curMatch = t.match(curPattern);
  if (curMatch && curMatch[1]) {
    const numStr = curMatch[1].replace(/,/g, '');
    const inr = Math.round(parseFloat(numStr));
    if (!isFinite(inr)) return null;
    const lakhs = Number((inr / 100000).toFixed(4));
    return { raw: curMatch[0].trim(), inr: inr, lakhs: lakhs };
  }

  const lakhPattern = /([0-9]+(?:\.\d+)?)\s*(?:lakh|lakhs|l|lac|lacs)\b/i;
  const lakhMatch = t.match(lakhPattern);
  if (lakhMatch && lakhMatch[1]) {
    const num = parseFloat(lakhMatch[1]);
    if (!isFinite(num)) return null;
    const lakhs = Number(num);
    const inr = Math.round(num * 100000);
    return { raw: lakhMatch[0].trim(), inr: inr, lakhs: lakhs };
  }

  const crorePattern = /([0-9]+(?:\.\d+)?)\s*(?:crore|crores|cr|Cr)\b/i;
  const croreMatch = t.match(crorePattern);
  if (croreMatch && croreMatch[1]) {
    const num = parseFloat(croreMatch[1]);
    if (!isFinite(num)) return null;
    const inr = Math.round(num * 10000000);
    const lakhs = Number((inr / 100000).toFixed(4));
    return { raw: croreMatch[0].trim(), inr: inr, lakhs: lakhs };
  }

  const indianNumPattern = /\b([0-9]{1,2}(?:,[0-9]{2})+(?:,[0-9]{3})?(?:\.\d+)?)\b/;
  const indianMatch = t.match(indianNumPattern);
  if (indianMatch && indianMatch[1]) {
    const numStr = indianMatch[1].replace(/,/g, '');
    const inr = Math.round(parseFloat(numStr));
    if (!isFinite(inr)) return null;
    const lakhs = Number((inr / 100000).toFixed(4));
    return { raw: indianMatch[1], inr: inr, lakhs: lakhs };
  }

  return null;
}

/**
 * Parses funding to lakhs or 0.
 */
function parseFundingAmountINRLakhs(fundingObj) {
  return fundingObj ? fundingObj.lakhs : 0;
}

/**
 * Calculates score for an article.
 */
function calculateScore(article, query, fullText, fundingObj, geo, CONFIG) {
  let score = (query.name === 'jobs' || query.name === 'linkedin') ? 20 : 10;
  CONFIG.hiringKeywords.forEach(kw => {
    if (fullText.includes(kw.toLowerCase())) score += 10;
  });
  let indianBonus = 0;
  CONFIG.indianHiringKeywords.forEach(kw => {
    if (fullText.includes(kw.toLowerCase())) indianBonus += 10;
  });
  if (geo && indianBonus > 0) score += indianBonus + 20;
  const lakhs = parseFundingAmountINRLakhs(fundingObj);
  const fundingBoost = Math.min(lakhs / 5, 50);
  if (query.name === 'funding') score += fundingBoost;
  return Math.round(score);
}

/**
 * Normalizes company name for dedupe key.
 */
function normalizeCompanyName(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/(inc|ltd|llc|corp|co|pvt|plc|gmbh|sa|bv)/g, '');
}

/**
 * Processes a single article.
 */
function processArticle(article, query, CONFIG) {
  const title = (article.title || '').toLowerCase();
  const desc = (article.description || '').toLowerCase();
  const fullText = title + ' ' + desc;
  const matchesIndustry = CONFIG.industryKeywords.some(kw => fullText.includes(kw.toLowerCase()));
  const matchedGeos = CONFIG.geoKeywords.filter(kw => fullText.includes(kw.toLowerCase()));
  if (matchedGeos.length === 0) return null;
  const geo = matchedGeos.join(', ') || 'N/A';
  const company = extractCompanyName(article.title, query.companyPattern, article.source && article.source.name);
  if (!company) return null;
  const fundingObj = extractFundingAmountINR(article.title + ' ' + article.description);
  const score = calculateScore(article, query, fullText, fundingObj, geo, CONFIG);

  const lead = {
    company,
    type: query.name,
    score,
    fundingRaw: fundingObj ? fundingObj.raw : 'N/A',
    fundingLakhs: fundingObj ? fundingObj.lakhs : 'N/A',
    fundingInr: fundingObj ? fundingObj.inr : 'N/A',
    geo,
    source: (article.source && article.source.name) ? article.source.name : 'Unknown',
    link: article.url || '',
    title: article.title || '',
    desc: article.description || article.title || '',
    pubDate: article.publishedAt || ''
  };

  return isValidLead(lead) ? lead : null;
}

/**
 * Process job posting and convert to lead format
 * @param {Object} job The job object
 * @param {Object} CONFIG The configuration
 * @return {Object|null} Lead object or null
 */
function processJobPosting(job, CONFIG) {
  if (!job || !job.company || !job.title) return null;
  
  const fullText = `${job.title} ${job.snippet}`.toLowerCase();
  
  // Check for India geo match
  const matchedGeos = CONFIG.geoKeywords.filter(kw => 
    fullText.includes(kw.toLowerCase()) || (job.location && job.location.toLowerCase().includes(kw.toLowerCase()))
  );
  
  if (matchedGeos.length === 0) return null;
  
  const geo = job.location || matchedGeos.join(', ');
  
  // Calculate score based on job relevance
  let score = 25; // Base score for job postings
  
  // Industry keywords boost
  CONFIG.industryKeywords.forEach(kw => {
    if (fullText.includes(kw.toLowerCase())) score += 5;
  });
  
  // Indian hiring keywords boost
  CONFIG.indianHiringKeywords.forEach(kw => {
    if (fullText.includes(kw.toLowerCase())) score += 8;
  });
  
  // Platform priority boost
  if (job.platform === 'LinkedIn') score += 10;
  if (job.platform === 'Naukri.com') score += 8;
  
  // Recent posting boost
  if (job.date && job.date.includes('hours ago')) score += 15;
  if (job.date && job.date.includes('1 day ago')) score += 10;
  
  const lead = {
    company: job.company,
    type: 'job_posting',
    score: Math.round(score),
    fundingRaw: 'N/A',
    fundingLakhs: 'N/A',
    fundingInr: 'N/A',
    geo: geo,
    source: job.platform,
    link: job.link,
    title: job.title,
    desc: job.snippet || job.title,
    pubDate: job.date || new Date().toISOString(),
    platform: job.platform,
    jobType: extractJobType(job.title)
  };
  
  return isValidJobLead(lead) ? lead : null;
}

/**
 * Extract job type from title
 */
function extractJobType(title) {
  if (!title) return 'General';
  
  const titleLower = title.toLowerCase();
  if (titleLower.includes('senior') || titleLower.includes('lead')) return 'Senior';
  if (titleLower.includes('junior') || titleLower.includes('fresher')) return 'Junior';
  if (titleLower.includes('manager') || titleLower.includes('director')) return 'Management';
  if (titleLower.includes('intern')) return 'Internship';
  
  return 'Mid-Level';
}

/**
 * Validate that a lead meets quality standards.
 */
function isValidLead(lead) {
  if (!lead || !lead.company || !lead.type || typeof lead.score !== 'number') {
    return false;
  }

  const company = String(lead.company).trim();
  if (company.length < 2 || company.length > 60) return false;
  if (!/[A-Za-z]/.test(company.charAt(0))) return false;

  const blacklist = [
    'company', 'firm', 'invalid', 'unknown', 'expansion', 'test', 'startup'
  ];
  if (blacklist.indexOf(company.toLowerCase()) !== -1) return false;

  const MIN_SCORE = 15;
  if (lead.score < MIN_SCORE) return false;

  return true;
}

/**
 * Validate job lead quality
 */
function isValidJobLead(lead) {
  if (!lead || !lead.company || !lead.title || typeof lead.score !== 'number') {
    return false;
  }
  
  const company = String(lead.company).trim();
  if (company.length < 2 || company.length > 80) return false;
  
  const blacklist = ['unknown', 'company', 'firm', 'hiring', 'jobs', 'careers'];
  if (blacklist.some(term => company.toLowerCase().includes(term))) return false;
  
  const MIN_JOB_SCORE = 20;
  if (lead.score < MIN_JOB_SCORE) return false;
  
  return true;
}

/**
 * Scan job platforms for new postings
 */
/**
 * Replace your scanJobPlatforms function with this enhanced version
 */
function scanJobPlatforms(CONFIG) {
  if (!CONFIG.jobScanEnabled) return [];
  
  const allJobLeads = [];
  
  Object.keys(CONFIG.jobPlatforms).forEach(platform => {
    const platformConfig = CONFIG.jobPlatforms[platform];
    if (!platformConfig.enabled) return;
    
    Logger.log(`Scanning ${platform} for job announcements...`);
    
    platformConfig.searchTerms.forEach(searchTerm => {
      try {
        const announcements = searchJobAnnouncementsDirectAPI(platform, searchTerm, CONFIG);
        if (announcements && announcements.length > 0) {
          const processedJobs = announcements
            .slice(0, CONFIG.maxJobsPerPlatform)
            .map(announcement => processJobAnnouncementImproved(announcement, platform, CONFIG))
            .filter(lead => lead !== null);
          
          allJobLeads.push(...processedJobs);
          Logger.log(`Found ${processedJobs.length} valid job leads from ${platform} for "${searchTerm}"`);
        }
        
        // Rate limiting between searches
        Utilities.sleep(1000);
      } catch (e) {
        Logger.log(`Error scanning ${platform} for "${searchTerm}": ${e.message}`);
      }
    });
  });
  
  return allJobLeads;
}

/**
 * Test the complete enhanced job platform scanning
 */
function testCompleteJobScan() {
  const CONFIG = loadConfig();
  Logger.log('=== COMPLETE JOB SCAN TEST ===');
  
  const results = scanJobPlatforms(CONFIG);
  
  Logger.log(`Total job leads found: ${results.length}`);
  
  if (results.length > 0) {
    // Show top 10 results sorted by score
    const topResults = results.sort((a, b) => b.score - a.score).slice(0, 10);
    
    Logger.log('\n=== TOP JOB LEADS ===');
    topResults.forEach((lead, i) => {
      Logger.log(`${i + 1}. ${lead.company} (Score: ${lead.score})`);
      Logger.log(`   Type: ${lead.type} | Platform: ${lead.platform}`);
      Logger.log(`   Location: ${lead.geo}`);
      Logger.log(`   Title: ${lead.title}`);
      Logger.log(`   Link: ${lead.link}`);
      Logger.log('---');
    });
    
    // Summary by platform
    const byPlatform = {};
    results.forEach(lead => {
      const platform = lead.platform || lead.source;
      byPlatform[platform] = (byPlatform[platform] || 0) + 1;
    });
    
    Logger.log('\n=== RESULTS BY PLATFORM ===');
    Object.keys(byPlatform).forEach(platform => {
      Logger.log(`${platform}: ${byPlatform[platform]} leads`);
    });
    
  } else {
    Logger.log('No job leads found. Check configuration and API keys.');
  }
  
  return {
    totalLeads: results.length,
    platforms: Object.keys(results.reduce((acc, lead) => {
      acc[lead.platform || lead.source] = true;
      return acc;
    }, {})),
    topScore: results.length > 0 ? Math.max(...results.map(r => r.score)) : 0
  };
}

/**
 * Test the complete daily scan including both news and jobs
 */
function testCompleteDailyScan() {
  Logger.log('=== TESTING COMPLETE DAILY SCAN ===');
  
  const CONFIG = loadConfig();
  const today = Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd');
  
  // Test news leads
  const queries = [
    {
      name: 'funding',
      search: 'funding OR raised OR investment OR venture capital startup',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:raises|raised|secures|announces funding|invested)/i
    }
  ];
  
  let newsLeads = [];
  queries.forEach(query => {
    const json = fetchArticles(query, CONFIG);
    if (json && json.articles) {
      json.articles.forEach(article => {
        const lead = processArticle(article, query, CONFIG);
        if (lead) newsLeads.push(lead);
      });
    }
  });
  
  // Test job leads
  const jobLeads = scanJobPlatforms(CONFIG);
  
  // Combine and deduplicate
  const allLeads = [...newsLeads, ...jobLeads];
  const uniqueLeads = [];
  const seen = {};
  
  allLeads.forEach(lead => {
    const key = normalizeCompanyName(lead.company) + '|' + (lead.source || 'unknown');
    if (!seen[key]) {
      seen[key] = true;
      uniqueLeads.push(lead);
    }
  });
  
  uniqueLeads.sort((a, b) => b.score - a.score);
  
  Logger.log(`News leads: ${newsLeads.length}`);
  Logger.log(`Job leads: ${jobLeads.length}`);
  Logger.log(`Total unique leads: ${uniqueLeads.length}`);
  
  // Show top 5 of each type
  const topNews = newsLeads.sort((a, b) => b.score - a.score).slice(0, 5);
  const topJobs = jobLeads.sort((a, b) => b.score - a.score).slice(0, 5);
  
  if (topNews.length > 0) {
    Logger.log('\n=== TOP NEWS LEADS ===');
    topNews.forEach((lead, i) => {
      Logger.log(`${i + 1}. ${lead.company} (${lead.type}) - Score: ${lead.score}`);
    });
  }
  
  if (topJobs.length > 0) {
    Logger.log('\n=== TOP JOB LEADS ===');
    topJobs.forEach((lead, i) => {
      Logger.log(`${i + 1}. ${lead.company} (${lead.type}) - Score: ${lead.score}`);
    });
  }
  
  return {
    newsLeads: newsLeads.length,
    jobLeads: jobLeads.length,
    totalUnique: uniqueLeads.length,
    status: 'Complete test successful'
  };
}
/**
 * Enhanced main daily function to scan leads including job postings
 */
function runDailyLeadScan() {
  const CONFIG = loadConfig();
  const today = Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd');
  
  const queries = [
    {
      name: 'funding',
      search: 'funding OR raised OR investment OR venture capital startup',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:raises|raised|secures|announces funding|invested)/i
    },
    {
      name: 'expansion',
      search: 'expansion OR new office OR business growth OR scaling up',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:expands|opens|growth|scaling)/i
    },
    {
      name: 'jobs',
      search: 'hiring OR job openings OR recruiting OR now hiring company',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:hiring|seeks|recruiting|jobs)/i
    },
    {
      name: 'linkedin',
      search: 'LinkedIn hiring OR posted jobs OR LinkedIn recruiting announcement',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:hiring|posted|recruiting on LinkedIn)/i
    }
  ];
  
  let allLeads = [];
  
  // Process news articles
  queries.forEach(query => {
    const json = fetchArticles(query, CONFIG);
    if (!json) return;
    const articles = json.articles || [];
    articles.forEach(article => {
      const lead = processArticle(article, query, CONFIG);
      if (lead) allLeads.push(lead);
    });
  });
  
  // Scan job platforms
  const jobLeads = scanJobPlatformsEnhanced(CONFIG);
  allLeads.push(...jobLeads);
  
  // Deduplicate leads
  const uniqueLeads = [];
  const seen = {};
  allLeads.forEach(lead => {
    const key = normalizeCompanyName(lead.company) + '|' + (lead.source || 'unknown');
    if (!seen[key]) {
      seen[key] = true;
      uniqueLeads.push(lead);
    }
  });
  
  uniqueLeads.sort((a, b) => b.score - a.score);
  
  const ss = getOrCreateSpreadsheet(CONFIG);
  let sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.sheetName);
    sheet.getRange(1, 1, 1, 12).setValues([[
      'Date', 'Company', 'Signal Type', 'Score', 'Funding (raw)', 'Funding (lakhs)',
      'Geography', 'Source', 'Article URL', 'Title', 'Description', 'Platform/Job Type'
    ]]);
    sheet.getRange(1, 1, 1, 12).setFontWeight('bold');
  }
  
  const existingUrls = getExistingArticleUrls(sheet);
  
  let appended = 0;
  uniqueLeads.forEach(lead => {
    const url = (lead.link || '').toString().trim().toLowerCase();
    if (!url || existingUrls.has(url)) {
      return;
    }
    
    sheet.appendRow([
      today,
      lead.company,
      lead.type,
      lead.score,
      lead.fundingRaw,
      lead.fundingLakhs,
      lead.geo,
      lead.source,
      lead.link,
      lead.title,
      lead.desc,
      lead.platform || lead.jobType || 'N/A'
    ]);
    
    existingUrls.add(url);
    appended++;
  });
  
  formatSheet(sheet);
  Logger.log(`Daily scan complete: ${appended} new leads appended (${jobLeads.length} from job platforms, ${uniqueLeads.length - jobLeads.length} from news)`);
}

/**
 * Gets or creates the spreadsheet.
 */
function getOrCreateSpreadsheet(CONFIG) {
  if (CONFIG.spreadsheetId) {
    return SpreadsheetApp.openById(CONFIG.spreadsheetId);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Formats the sheet with headers, resize, freeze, and conditional formatting.
 */
function formatSheet(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = 12;
  try { sheet.autoResizeColumns(1, lastCol); } catch (e) { /* ignore */ }
  sheet.setFrozenRows(1);

  const rules = sheet.getConditionalFormatRules() || [];
  if (lastRow > 1) {
    const scoreRange = sheet.getRange(2, 4, Math.max(1, lastRow - 1), 1);
    const highScoreRule = SpreadsheetApp.newConditionalFormatRule()
      .whenNumberGreaterThan(50)
      .setBackground('#B7E1CD')
      .setRanges([scoreRange])
      .build();

    const filtered = rules.filter(r => {
      try { return JSON.stringify(r.getBooleanCondition()) !== JSON.stringify(highScoreRule.getBooleanCondition()); } catch (e) { return true; }
    });
    filtered.push(highScoreRule);
    sheet.setConditionalFormatRules(filtered);

    const dataRange = sheet.getRange(2, 1, lastRow - 1, lastCol);
    const backgrounds = [];
    for (let r = 0; r < lastRow - 1; r++) {
      const rowColor = (r % 2 === 0) ? '#f0f0f0' : '#ffffff';
      const rowArr = new Array(lastCol).fill(rowColor);
      backgrounds.push(rowArr);
    }
    try { dataRange.setBackgrounds(backgrounds); } catch (e) { /* ignore */ }
  } else {
    const headerRange = sheet.getRange(1, 1, 1, lastCol);
    headerRange.setFontWeight('bold');
  }
}

/**
 * Handles critical errors.
 */
function handleCriticalError(error) {
  Logger.log('CRITICAL ERROR: ' + error.message + ' - Stack: ' + error.stack);
}

/**
 * Runs unit tests on canned articles.
 */
function runUnitTests() {
  const CONFIG = loadConfig();

  const queriesMap = {
    funding: {
      name: 'funding',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:raises|raised|secures|announces|closes|raised)/i
    },
    jobs: {
      name: 'jobs',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:is\s+)?(?:hiring|seeks|recruiting|looking for|has)\b/i
    },
    expansion: {
      name: 'expansion',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:expands|opens|launches|scales|announces.*expansion)/i
    }
  };

  const testArticles = [
    { title: 'TechCorp Pvt raises ₹5,00,000 in Bengaluru', description: 'Funding for expansion in India.', source: { name: 'TestSource' } },
    { title: 'Acme hires via walk-in in Mumbai', description: 'Job openings with immediate joiners.', source: { name: 'TestSource' } },
    { title: 'NoGeo Company funding 2 crore', description: 'No India mention.', source: { name: 'TestSource' } },
    { title: 'Indian Startup expansion in Delhi', description: 'Team expansion and recruitment drive.', source: { name: 'TestSource' } },
    { title: 'Fintech Ltd secures 0.5 crore in Hyderabad', description: 'With off-campus drive.', source: { name: 'TestSource' } }
  ];

  function pickQueryForArticle(text) {
    const t = (text || '').toLowerCase();
    if (t.match(/\b(raised|raises|secures|funding|seed|round|cr|crore|lakh|₹|inr|rs\.?)\b/)) return queriesMap.funding;
    if (t.match(/\b(hiring|walk-?in|campus|apply now|job openings|join our team|recruitment|interview|notice period|immediate joiners)\b/)) return queriesMap.jobs;
    if (t.match(/\b(expansion|new office|scaling|opens|launches|expands)\b/)) return queriesMap.expansion;
    return queriesMap.funding;
  }

  const results = testArticles.map(article => {
    const text = (article.title || '') + ' ' + (article.description || '');
    const query = pickQueryForArticle(text);
    const lead = processArticle(article, query, CONFIG);
    return {
      title: article.title,
      pickedQuery: query.name,
      company: lead ? lead.company : null,
      fundingRaw: lead ? lead.fundingRaw : null,
      fundingLakhs: lead ? lead.fundingLakhs : null,
      fundingInr: lead ? (lead.fundingInr !== 'N/A' ? lead.fundingInr : null) : null,
      score: lead ? lead.score : null,
      isValidLead: !!lead
    };
  });

  Logger.log(JSON.stringify(results, null, 2));
  return { status: 'Tests run', passed: results.filter(r => r.isValidLead).length, total: results.length };
}

/**
 * Runs funding extraction tests.
 */
function runFundingTestsINR() {
  const tests = [
    { text: 'Company raised ₹5,00,000 in seed funding', expected: { raw: '₹5,00,000', lakhs: 5, inr: 500000 } },
    { text: 'Acme raised 2.5 crore to expand', expected: { raw: '2.5 crore', lakhs: 250, inr: 25000000 } },
    { text: 'Startup closed a ₹7,50,000 round', expected: { raw: '₹7,50,000', lakhs: 7.5, inr: 750000 } },
    { text: 'No INR funding mentioned here', expected: null }
  ];
  const results = tests.map(test => {
    const result = extractFundingAmountINR(test.text);
    const passed = JSON.stringify(result) === JSON.stringify(test.expected);
    return { text: test.text, result, passed };
  });
  Logger.log(JSON.stringify(results, null, 2));
  return { status: 'Funding tests run', passed: results.filter(r => r.passed).length };
}

/**
 * Test job platform scanning
 */
function testJobPlatformScan() {
  const CONFIG = loadConfig();
  const results = scanJobPlatforms(CONFIG);
  
  Logger.log(`Job platform scan test: Found ${results.length} job leads`);
  results.slice(0, 5).forEach((lead, i) => {
    Logger.log(`${i + 1}. ${lead.company} - ${lead.title} (${lead.platform}) - Score: ${lead.score}`);
  });
  
  return {
    status: 'Job platform test complete',
    totalLeads: results.length,
    platforms: [...new Set(results.map(r => r.platform))]
  };
}

/**
 * Enhanced configuration test
 */
function testConfiguration() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = props.getProperty('NEWSAPI_KEY');
  const serpApiKey = props.getProperty('SERPAPI_KEY');
  const config = loadConfig();
  
  const status = {
    apiKeySet: !!apiKey,
    serpApiKeySet: !!serpApiKey,
    configLoaded: !!config,
    requestCount: getRequestCount(),
    jobRequestCount: getJobRequestCount(),
    jobScanEnabled: config.jobScanEnabled,
    enabledPlatforms: Object.keys(config.jobPlatforms).filter(p => config.jobPlatforms[p].enabled)
  };
  
  Logger.log(JSON.stringify(status, null, 2));
  return status;
}

/**
 * Debug a single query and log the first ~10 article titles.
 */
function debugQuery(queryName) {
  const CONFIG = loadConfig();

  const queries = {
    funding: {
      name: 'funding',
      search: 'funding OR raised OR investment OR venture capital startup',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:raises|raised|secures|announces|invested|closes|closed?)/i
    },
    jobs: {
      name: 'jobs',
      search: 'hiring OR job openings OR recruiting OR now hiring company',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:is\s+)?(?:hiring|hires|seeks|recruiting|looking for|has|is\s+looking)/i
    },
    expansion: {
      name: 'expansion',
      search: 'expansion OR new office OR business growth OR scaling up',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:expands|opens|launches|scales|announces.*expansion)/i
    },
    linkedin: {
      name: 'linkedin',
      search: 'LinkedIn hiring OR posted jobs OR LinkedIn recruiting announcement',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:hiring|posted|recruiting|posting).*(?:LinkedIn|linkedin)?/i
    }
  };

  if (!queryName || !queries[queryName]) {
    Logger.log('debugQuery: invalid queryName, using "funding" as default');
    queryName = 'funding';
  }

  const query = queries[queryName];
  Logger.log('debugQuery: running query -> ' + queryName + '  search: ' + query.search);

  const json = fetchArticles(query, CONFIG);
  if (!json) {
    Logger.log('debugQuery: fetchArticles returned null');
    return { articlesCount: 0 };
  }

  const articles = json.articles || [];
  Logger.log('debugQuery: fetched ' + articles.length + ' articles');

  articles.slice(0, 10).forEach((a, i) => {
    Logger.log((i + 1) + '. ' + (a.title || 'NO TITLE') + '  | source: ' + (a.source && a.source.name ? a.source.name : 'unknown') + ' | publishedAt: ' + (a.publishedAt || 'n/a'));
  });

  return { articlesCount: articles.length };
}

/**
 * Build a Set of article URLs already present in the sheet for quick dedupe.
 */
function getExistingArticleUrls(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return new Set();
  const urlRange = sheet.getRange(2, 9, Math.max(0, lastRow - 1), 1);
  const urlVals = urlRange.getValues().flat().filter(v => v && v.toString().trim().length);
  const s = new Set();
  urlVals.forEach(u => s.add(String(u).trim().toLowerCase()));
  return s;
}

/**
 * Enhanced job search strategies - Add these functions to your script
 */

/**
 * Alternative job search using news-style queries for job announcements
 * @param {string} platform The platform name
 * @param {string} query The search query
 * @param {Object} CONFIG The configuration
 * @return {Array|null} Array of job results or null
 */
function searchJobAnnouncementsDirectAPI(platform, query, CONFIG) {
  const props = PropertiesService.getScriptProperties();
  const serpApiKey = props.getProperty('SERPAPI_KEY');
  
  if (!serpApiKey) {
    Logger.log('SERPAPI_KEY not set. Skipping job announcements search.');
    return null;
  }

  // Modified search queries to find job announcements rather than job boards
  const announcementQueries = [
    `"${query}" "hiring" "join our team" india`,
    `"${query}" "we are hiring" "positions open" india`,
    `"${query}" "job opening" "apply now" india`,
    `"software engineer" "hiring" "${platform}" india`,
    `"developer jobs" "recruitment" "${platform}" india`
  ];

  let allResults = [];

  for (const searchQuery of announcementQueries) {
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${serpApiKey}&num=10`;
    
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      incrementJobRequestCount();
      
      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        const results = data.organic_results || [];
        
        // Filter for actual job announcements (not job board pages)
        const jobAnnouncements = results.filter(result => {
          const title = (result.title || '').toLowerCase();
          const snippet = (result.snippet || '').toLowerCase();
          const fullText = title + ' ' + snippet;
          
          // Include if it mentions hiring/jobs but exclude generic job boards
          return (
            (fullText.includes('hiring') || fullText.includes('job') || fullText.includes('career')) &&
            !title.includes('jobs in india') && // Exclude generic "X jobs in India"
            !title.includes('+ ') && // Exclude "75000+ Software Engineer jobs"
            !result.link.includes('linkedin.com/jobs/') && // Exclude LinkedIn job search pages
            !result.link.includes('naukri.com/jobs-') && // Exclude Naukri search pages
            !result.link.includes('indeed.com/jobs') // Exclude Indeed search pages
          );
        });
        
        allResults.push(...jobAnnouncements);
      }
      
      // Rate limiting
      Utilities.sleep(500);
    } catch (e) {
      Logger.log(`Error in job announcements search: ${e.message}`);
    }
  }

  return allResults;
}

/**
 * Enhanced company extraction specifically for job announcements
 * @param {string} title The title
 * @param {string} snippet The snippet
 * @param {string} link The URL
 * @return {string|null} Company name or null
 */
function extractCompanyFromJobAnnouncement(title, snippet, link) {
  if (!title && !snippet) return null;
  
  const fullText = `${title || ''} ${snippet || ''}`;
  
  // Extract from URL domain (often the most reliable)
  if (link) {
    const domainCompany = extractCompanyFromDomain(link);
    if (domainCompany) return domainCompany;
  }
  
  // Enhanced patterns for job announcements
  const patterns = [
    // Direct mentions
    /([A-Z][a-zA-Z\s&.-]+?)\s+(?:is\s+)?(?:hiring|seeks|recruiting|looking for)/i,
    /(?:Join|Come join)\s+([A-Z][a-zA-Z\s&.-]+?)(?:\s|$)/i,
    /([A-Z][a-zA-Z\s&.-]+?)\s+(?:has\s+)?(?:openings?|positions?|vacancies)/i,
    /([A-Z][a-zA-Z\s&.-]+?)\s+(?:team\s+)?(?:expansion|growth)/i,
    /(?:Career(?:s)?|Job(?:s)?)\s+at\s+([A-Z][a-zA-Z\s&.-]+?)(?:\s|$)/i,
    /([A-Z][a-zA-Z\s&.-]+?)\s+(?:jobs?|careers?)\s+/i,
    // Company followed by action
    /([A-Z][a-zA-Z\s&.-]+?)\s*[-–]\s*(?:Now\s+)?(?:Hiring|Jobs|Careers)/i,
    // We are hiring format
    /(?:We|We're)\s+hiring.*?(?:at|for)\s+([A-Z][a-zA-Z\s&.-]+?)(?:\s|$)/i
  ];
  
  for (const pattern of patterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      const candidate = cleanCompanyName(match[1]);
      if (isValidCompanyName(candidate)) {
        return candidate;
      }
    }
  }
  
  return null;
}

/**
 * Extract company name from domain
 * @param {string} url The URL
 * @return {string|null} Company name or null
 */
function extractCompanyFromDomain(url) {
  if (!url) return null;
  
  try {
    const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    
    // Skip common job sites and generic domains
    const skipDomains = [
      'linkedin.com', 'naukri.com', 'indeed.com', 'glassdoor.com', 'monster.com',
      'timesjobs.com', 'shine.com', 'freshersworld.com', 'google.com', 'youtube.com',
      'facebook.com', 'twitter.com', 'instagram.com', 'github.com'
    ];
    
    if (skipDomains.some(skip => domain.includes(skip))) {
      return null;
    }
    
    // Extract company name from domain
    const domainParts = domain.split('.');
    if (domainParts.length >= 2) {
      const companyPart = domainParts[0];
      
      // Clean and capitalize
      const cleaned = companyPart
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase())
        .trim();
      
      if (cleaned.length >= 3 && cleaned.length <= 30) {
        return cleaned;
      }
    }
  } catch (e) {
    // Ignore domain parsing errors
  }
  
  return null;
}

/**
 * Validate if a string is a reasonable company name
 * @param {string} name The candidate name
 * @return {boolean} True if valid
 */
function isValidCompanyName(name) {
  if (!name || typeof name !== 'string') return false;
  
  const cleaned = name.trim();
  if (cleaned.length < 2 || cleaned.length > 50) return false;
  
  // Must start with letter
  if (!/^[A-Za-z]/.test(cleaned)) return false;
  
  // Blacklist common false positives
  const blacklist = [
    'software', 'engineer', 'developer', 'hiring', 'jobs', 'careers', 'team',
    'positions', 'openings', 'company', 'firm', 'business', 'startup',
    'application', 'resume', 'interview', 'apply', 'join', 'work'
  ];
  
  const lowerName = cleaned.toLowerCase();
  if (blacklist.some(word => lowerName === word || lowerName.includes(word + ' ') || lowerName.includes(' ' + word))) {
    return false;
  }
  
  return true;
}

/**
 * Process job announcement and convert to lead format
 * @param {Object} announcement The announcement object from search results
 * @param {string} platform The platform name
 * @param {Object} CONFIG The configuration
 * @return {Object|null} Lead object or null
 */
/**
 * Improved company extraction - Replace the existing functions with these
 */

/**
 * Enhanced company extraction from domain with better parsing
 */
function extractCompanyFromDomain(url) {
  if (!url) return null;
  
  try {
    const domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    
    // Skip common job sites and generic domains
    const skipDomains = [
      'linkedin.com', 'naukri.com', 'indeed.com', 'glassdoor.com', 'monster.com',
      'timesjobs.com', 'shine.com', 'freshersworld.com', 'google.com', 'youtube.com',
      'facebook.com', 'twitter.com', 'instagram.com', 'github.com', 'careers.com'
    ];
    
    if (skipDomains.some(skip => domain.includes(skip))) {
      return null;
    }
    
    // Special handling for career subdomains
    if (domain.startsWith('careers.')) {
      const mainDomain = domain.replace('careers.', '');
      const companyPart = mainDomain.split('.')[0];
      return capitalizeCompanyName(companyPart);
    }
    
    // Extract company name from domain
    const domainParts = domain.split('.');
    if (domainParts.length >= 2) {
      const companyPart = domainParts[0];
      
      // Skip if it's clearly not a company domain
      if (['careers', 'jobs', 'hiring', 'www', 'mail', 'app', 'api'].includes(companyPart.toLowerCase())) {
        return null;
      }
      
      return capitalizeCompanyName(companyPart);
    }
  } catch (e) {
    // Ignore domain parsing errors
  }
  
  return null;
}

/**
 * Capitalize and clean company name from domain
 */
function capitalizeCompanyName(name) {
  if (!name) return null;
  
  const cleaned = name
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase())
    .trim();
  
  if (cleaned.length >= 2 && cleaned.length <= 30) {
    return cleaned;
  }
  
  return null;
}

/**
 * Enhanced company extraction specifically for job announcements
 */
function extractCompanyFromJobAnnouncement(title, snippet, link) {
  if (!title && !snippet) return null;
  
  const fullText = `${title || ''} ${snippet || ''}`;
  
  // First try to extract from URL domain (most reliable for career pages)
  if (link) {
    const domainCompany = extractCompanyFromDomain(link);
    if (domainCompany) return domainCompany;
  }
  
  // Enhanced patterns for job announcements with better matching
  const patterns = [
    // "Company is hiring" or "Company hiring"
    /([A-Z][a-zA-Z\s&.-]{1,25}?)\s+(?:is\s+)?(?:hiring|seeks|recruiting|looking for)/i,
    // "Join Company" format
    /(?:Join|Come join)\s+([A-Z][a-zA-Z\s&.-]{1,25}?)(?:\s|$|!)/i,
    // "Company has openings" format
    /([A-Z][a-zA-Z\s&.-]{1,25}?)\s+(?:has\s+)?(?:openings?|positions?|vacancies)/i,
    // "Jobs at Company" format
    /(?:Career(?:s)?|Job(?:s)?)\s+at\s+([A-Z][a-zA-Z\s&.-]{1,25}?)(?:\s|$|!|\|)/i,
    // "Company - Job Title" format
    /^([A-Z][a-zA-Z\s&.-]{1,25}?)\s*[-–]\s*(?:Now\s+)?(?:Hiring|Jobs|Careers)/i,
    // "Company Name | Hiring" format
    /^([A-Z][a-zA-Z\s&.-]{1,25}?)\s*\|\s*(?:Hiring|Jobs|Careers)/i,
    // Extract from "Software Engineer at Company"
    /Software\s+Engineer\s+(?:at|in)\s+([A-Z][a-zA-Z\s&.-]{1,25}?)(?:\s|$|\|)/i,
    // "We are hiring" with context
    /([A-Z][a-zA-Z\s&.-]{1,25}?)\s+(?:Team\s+)?(?:is\s+)?(?:We|We're)\s+hiring/i,
  ];
  
  for (const pattern of patterns) {
    const match = fullText.match(pattern);
    if (match && match[1]) {
      const candidate = cleanCompanyName(match[1]);
      if (isValidCompanyName(candidate)) {
        return candidate;
      }
    }
  }
  
  // Last resort: try to extract any capitalized sequence that looks like a company
  const companyPattern = /\b([A-Z][a-zA-Z]{1,15}(?:\s+[A-Z][a-zA-Z]{1,15}){0,2})\b/g;
  const matches = fullText.match(companyPattern);
  
  if (matches) {
    for (const match of matches) {
      const candidate = cleanCompanyName(match);
      if (isValidCompanyName(candidate) && candidate.length >= 3) {
        return candidate;
      }
    }
  }
  
  return null;
}

/**
 * Improved company name validation
 */
function isValidCompanyName(name) {
  if (!name || typeof name !== 'string') return false;
  
  const cleaned = name.trim();
  if (cleaned.length < 2 || cleaned.length > 40) return false;
  
  // Must start with letter
  if (!/^[A-Za-z]/.test(cleaned)) return false;
  
  // Enhanced blacklist - be more specific to avoid blocking real companies
  const blacklist = [
    // Generic terms
    'software', 'engineer', 'developer', 'hiring', 'jobs', 'careers', 'team',
    'positions', 'openings', 'company', 'firm', 'business', 'startup',
    'application', 'resume', 'interview', 'apply', 'join', 'work',
    // Location terms that might be extracted
    'india', 'bangalore', 'mumbai', 'delhi', 'pune', 'hyderabad', 'chennai',
    // Common false positives
    'review', 'about', 'contact', 'home', 'search', 'login', 'register',
    'careers', 'job', 'role', 'position', 'opportunity', 'candidate'
  ];
  
  const lowerName = cleaned.toLowerCase();
  
  // Check if the entire name is a blacklisted word
  if (blacklist.includes(lowerName)) {
    return false;
  }
  
  // Check if it starts or ends with blacklisted terms (but allow them in middle)
  const startsWithBad = blacklist.some(word => lowerName.startsWith(word + ' '));
  const endsWithBad = blacklist.some(word => lowerName.endsWith(' ' + word));
  
  if (startsWithBad || endsWithBad) {
    return false;
  }
  
  // Additional checks for quality
  // Should have at least one vowel (real company names usually do)
  if (!/[aeiouAEIOU]/.test(cleaned)) {
    return false;
  }
  
  // Shouldn't be all uppercase (usually indicates an acronym that needs context)
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 4) {
    return false;
  }
  
  return true;
}

/**
 * Test the improved extraction with your actual results
 */
function testImprovedExtraction() {
  const testCases = [
    {
      title: "Software Engineering Jobs at Intuit India | Hiring now!",
      snippet: "Software Engineer 2, Front End. Bengaluru, Karnataka · Software Engineering ... About IntuitJoin Our...",
      link: "https://www.intuit.com/in/careers/software-engineering/"
    },
    {
      title: "Software Engineer in Pune, India | Principal Global Services",
      snippet: "... is hiring a Software Engineer in Pune, India. Review all of the job ... We are seeking an experi...",
      link: "https://careers.principal.com/in/jobs/47925?lang=en-us"
    },
    {
      title: "Software Engineer",
      snippet: "Texas Instruments (TI) Radar Software Team is looking for an experienced Lead software engineer to j...",
      link: "https://careers.ti.com/en/sites/CX/job/25006554"
    },
    {
      title: "Atlassian Careers: Join the Team",
      snippet: "They influence choices in identity, actions, and hiring. They're ingrained ... Senior Software Engin...",
      link: "https://www.atlassian.com/company/careers"
    }
  ];
  
  Logger.log('=== IMPROVED EXTRACTION TEST ===');
  
  testCases.forEach((testCase, i) => {
    Logger.log(`${i + 1}. "${testCase.title}"`);
    Logger.log(`   Link: ${testCase.link}`);
    
    const company = extractCompanyFromJobAnnouncement(testCase.title, testCase.snippet, testCase.link);
    const isValid = isValidCompanyName(company);
    
    Logger.log(`   Extracted company: ${company || 'FAILED'}`);
    Logger.log(`   Is valid: ${isValid}`);
    Logger.log('---');
  });
}

/**
 * Updated process job announcement with better scoring
 */
function processJobAnnouncementImproved(announcement, platform, CONFIG) {
  if (!announcement || !announcement.title) return null;
  
  const title = announcement.title || '';
  const snippet = announcement.snippet || '';
  const link = announcement.link || '';
  const fullText = `${title} ${snippet}`.toLowerCase();
  
  // Check for India geo match
  const matchedGeos = CONFIG.geoKeywords.filter(kw => 
    fullText.includes(kw.toLowerCase())
  );
  
  if (matchedGeos.length === 0) return null;
  
  // Extract company name with improved method
  const company = extractCompanyFromJobAnnouncement(title, snippet, link);
  if (!company || !isValidCompanyName(company)) return null;
  
  const geo = matchedGeos.join(', ');
  
  // Enhanced scoring
  let score = 35; // Base score for job announcements
  
  // Industry keywords boost
  CONFIG.industryKeywords.forEach(kw => {
    if (fullText.includes(kw.toLowerCase())) score += 4;
  });
  
  // Indian hiring keywords boost
  CONFIG.indianHiringKeywords.forEach(kw => {
    if (fullText.includes(kw.toLowerCase())) score += 6;
  });
  
  // Urgency indicators
  if (fullText.includes('immediate') || fullText.includes('urgent')) score += 8;
  if (fullText.includes('walk-in') || fullText.includes('walk in')) score += 12;
  if (fullText.includes('hiring now') || fullText.includes('apply now')) score += 5;
  
  // Company-specific boosts (well-known companies)
  const wellKnownCompanies = ['google', 'microsoft', 'amazon', 'apple', 'meta', 'netflix', 'uber', 'airbnb', 'spotify', 'adobe', 'oracle', 'salesforce', 'intuit', 'atlassian', 'slack', 'zoom', 'dropbox'];
  if (wellKnownCompanies.some(known => company.toLowerCase().includes(known))) {
    score += 15;
  }
  
  // Domain quality boost (company's own career page vs third party)
  if (link && link.includes(company.toLowerCase().replace(/\s+/g, ''))) {
    score += 10;
  }
  
  const lead = {
    company: company,
    type: 'job_announcement',
    score: Math.round(score),
    fundingRaw: 'N/A',
    fundingLakhs: 'N/A',
    fundingInr: 'N/A',
    geo: geo,
    source: platform || 'Web Search',
    link: link,
    title: title,
    desc: snippet || title,
    pubDate: new Date().toISOString(),
    platform: platform,
    jobType: extractJobType(title)
  };
  
  return lead;
}
/**
 * Updated scan job platforms function using announcements
 * @param {Object} CONFIG The configuration
 * @return {Array} Array of job leads
 */
function scanJobPlatformsEnhanced(CONFIG) {
  if (!CONFIG.jobScanEnabled) return [];
  
  const allJobLeads = [];
  
  Object.keys(CONFIG.jobPlatforms).forEach(platform => {
    const platformConfig = CONFIG.jobPlatforms[platform];
    if (!platformConfig.enabled) return;
    
    Logger.log(`Scanning ${platform} for job announcements...`);
    
    platformConfig.searchTerms.forEach(searchTerm => {
      try {
        const announcements = searchJobAnnouncementsDirectAPI(platform, searchTerm, CONFIG);
        if (announcements && announcements.length > 0) {
          const processedJobs = announcements
            .slice(0, CONFIG.maxJobsPerPlatform)
            .map(announcement => processJobAnnouncement(announcement, platform, CONFIG))
            .filter(lead => lead !== null);
          
          allJobLeads.push(...processedJobs);
          Logger.log(`Found ${processedJobs.length} valid job leads from ${platform} for "${searchTerm}"`);
        }
        
        // Rate limiting between searches
        Utilities.sleep(1000);
      } catch (e) {
        Logger.log(`Error scanning ${platform} for "${searchTerm}": ${e.message}`);
      }
    });
  });
  
  return allJobLeads;
}

/**
 * Test the enhanced job announcement search
 */
function testJobAnnouncementSearch() {
  const CONFIG = loadConfig();
  Logger.log('=== JOB ANNOUNCEMENT SEARCH TEST ===');
  
  const results = searchJobAnnouncementsDirectAPI('general', 'software engineer', CONFIG);
  
  if (results && results.length > 0) {
    Logger.log(`Found ${results.length} job announcements`);
    
    results.slice(0, 5).forEach((result, i) => {
      Logger.log(`${i + 1}. ${result.title || 'NO TITLE'}`);
      Logger.log(`   Link: ${result.link || 'NO LINK'}`);
      Logger.log(`   Snippet: ${(result.snippet || '').substring(0, 100)}...`);
      
      // Test company extraction
      const company = extractCompanyFromJobAnnouncement(result.title, result.snippet, result.link);
      Logger.log(`   Extracted company: ${company || 'FAILED'}`);
      
      // Test processing
      const lead = processJobAnnouncement(result, 'web', CONFIG);
      Logger.log(`   Valid lead: ${lead ? 'YES (Score: ' + lead.score + ')' : 'NO'}`);
      Logger.log('---');
    });
  } else {
    Logger.log('No job announcements found');
  }
}

/**
 * Install a daily trigger to run the lead scan automatically.
 */
// Delete old trigger and create new one
function updateDailyTrigger() {
  // Delete existing triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (trigger.getHandlerFunction() === 'runDailyLeadScan') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Create new trigger for fresh scan
  ScriptApp.newTrigger('runFreshDailyLeadScan')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
}
// Add this line anywhere in your script to create an alias
function processJobAnnouncement(announcement, platform, CONFIG) {
  return processJobAnnouncementImproved(announcement, platform, CONFIG);
}
/**
 * Update config to enable job scanning
 */
function enableJobScanning() {
  const props = PropertiesService.getScriptProperties();
  const config = loadConfig();
  config.jobScanEnabled = true;
  props.setProperty('CONFIG', JSON.stringify(config));
  Logger.log('Job scanning enabled in configuration');
}

/**
 * Disable job scanning
 */
function disableJobScanning() {
  const props = PropertiesService.getScriptProperties();
  const config = loadConfig();
  config.jobScanEnabled = false;
  props.setProperty('CONFIG', JSON.stringify(config));
  Logger.log('Job scanning disabled in configuration');
}

/**
 * Enhanced Fresh Job Scanner - focuses on recent postings
 * Add these improved functions to your script
 */

/**
 * Enhanced job search with recency filters and better validation
 */
function searchFreshJobAnnouncements(platform, query, CONFIG) {
  const props = PropertiesService.getScriptProperties();
  const serpApiKey = props.getProperty('SERPAPI_KEY');
  
  if (!serpApiKey) {
    Logger.log('SERPAPI_KEY not set. Skipping fresh job search.');
    return null;
  }

  // Enhanced search queries focused on recent postings
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const recentQueries = [
    // Today's postings
    `"${query}" "hiring" "posted today" OR "today" india`,
    `"${query}" "job opening" "apply now" "2025" india`,
    // This week's postings
    `"${query}" "we are hiring" "join our team" "posted" india`,
    `"${query}" "recruitment" "immediate joining" india`,
    // Platform-specific recent searches
    `"${query}" "linkedin" "posted" "hours ago" OR "days ago" india`,
    `"software engineer" "hiring" "${platform}" "recent" india`
  ];

  let allResults = [];

  for (const searchQuery of recentQueries) {
    // Add date filter to Google search
    const url = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(searchQuery)}&api_key=${serpApiKey}&num=15&tbs=qdr:w`; // qdr:w = past week
    
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      incrementJobRequestCount();
      
      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        const results = data.organic_results || [];
        
        // Enhanced filtering for fresh content
        const freshResults = results.filter(result => {
          const title = (result.title || '').toLowerCase();
          const snippet = (result.snippet || '').toLowerCase();
          const fullText = title + ' ' + snippet;
          const link = result.link || '';
          
          return (
            // Must mention hiring/jobs
            (fullText.includes('hiring') || fullText.includes('job') || fullText.includes('career') || fullText.includes('opening')) &&
            // Must mention India/Indian cities
            (fullText.includes('india') || CONFIG.geoKeywords.some(city => fullText.includes(city.toLowerCase()))) &&
            // Exclude generic job board pages
            !title.includes('jobs in india') &&
            !title.includes('+ ') && // "75000+ jobs"
            !link.includes('linkedin.com/jobs/search') &&
            !link.includes('naukri.com/jobs-') &&
            !link.includes('indeed.com/jobs?') &&
            // Exclude very old results
            !fullText.includes('2021') &&
            !fullText.includes('2022') &&
            !fullText.includes('2023') &&
            // Prefer recent indicators
            (fullText.includes('2025') || fullText.includes('recent') || fullText.includes('new') || 
             fullText.includes('now') || fullText.includes('today') || fullText.includes('this week') ||
             fullText.includes('days ago') || fullText.includes('hours ago'))
          );
        });
        
        allResults.push(...freshResults);
      }
      
      // Rate limiting
      Utilities.sleep(800);
    } catch (e) {
      Logger.log(`Error in fresh job search: ${e.message}`);
    }
  }

  return allResults;
}

/**
 * Enhanced date extraction with better patterns
 */
function extractPostingDate(title, snippet) {
  if (!title && !snippet) return null;
  
  const fullText = `${title || ''} ${snippet || ''}`.toLowerCase();
  
  // Recent posting patterns (prioritized)
  const recentPatterns = [
    /(\d{1,2})\s*(?:hours?|hrs?)\s*ago/i,
    /(\d{1,2})\s*(?:days?)\s*ago/i,
    /(today|yesterday)/i,
    /(?:posted|published).*?(\d{1,2})\s*(?:hours?|days?)\s*ago/i,
    /(?:posted|published).*?(today|yesterday)/i,
    // Current year patterns
    /(january|february|march|april|may|june|july|august|september|october|november|december)\s*\d{1,2},?\s*2025/i,
    /\d{1,2}[-/]\d{1,2}[-/]2025/i,
    /2025[-/]\d{1,2}[-/]\d{1,2}/i
  ];
  
  for (const pattern of recentPatterns) {
    const match = fullText.match(pattern);
    if (match) {
      return {
        raw: match[0],
        isRecent: match[0].includes('hour') || match[0].includes('day') || match[0].includes('today'),
        matchedPattern: pattern.toString()
      };
    }
  }
  
  return null;
}

/**
 * Validate if a link is accessible and not 404
 */
function validateJobLink(url) {
  if (!url) return false;
  
  try {
    // Quick HEAD request to check if link exists
    const response = UrlFetchApp.fetch(url, {
      method: 'HEAD',
      muteHttpExceptions: true,
      followRedirects: true
    });
    
    const responseCode = response.getResponseCode();
    return responseCode >= 200 && responseCode < 400; // Success codes
  } catch (e) {
    Logger.log(`Link validation failed for ${url}: ${e.message}`);
    return false; // Assume invalid if we can't check
  }
}

/**
 * Enhanced processing with freshness scoring and link validation
 */
function processFreshJobAnnouncement(announcement, platform, CONFIG) {
  if (!announcement || !announcement.title) return null;
  
  const title = announcement.title || '';
  const snippet = announcement.snippet || '';
  const link = announcement.link || '';
  const fullText = `${title} ${snippet}`.toLowerCase();
  
  // Check for India geo match
  const matchedGeos = CONFIG.geoKeywords.filter(kw => 
    fullText.includes(kw.toLowerCase())
  );
  
  if (matchedGeos.length === 0) return null;
  
  // Extract company name
  const company = extractCompanyFromJobAnnouncement(title, snippet, link);
  if (!company || !isValidCompanyName(company)) return null;
  
  // Validate link (optional - comment out if too slow)
  // const isValidLink = validateJobLink(link);
  // if (!isValidLink) {
  //   Logger.log(`Skipping invalid link: ${link}`);
  //   return null;
  // }
  
  const geo = matchedGeos.join(', ');
  const postingDate = extractPostingDate(title, snippet);
  
  // Enhanced scoring with freshness boost
  let score = 40; // Higher base score for job announcements
  
  // Freshness scoring (major factor)
  if (postingDate) {
    if (postingDate.raw.includes('hour')) score += 25; // Posted today
    else if (postingDate.raw.includes('day') && !postingDate.raw.includes('days')) score += 20; // 1 day ago
    else if (postingDate.raw.includes('today')) score += 25;
    else if (postingDate.raw.includes('yesterday')) score += 15;
    else if (postingDate.raw.includes('2025')) score += 10; // This year
  }
  
  // Industry keywords boost
  CONFIG.industryKeywords.forEach(kw => {
    if (fullText.includes(kw.toLowerCase())) score += 3;
  });
  
  // Indian hiring keywords boost
  CONFIG.indianHiringKeywords.forEach(kw => {
    if (fullText.includes(kw.toLowerCase())) score += 5;
  });
  
  // Urgency indicators (higher boost for immediate needs)
  if (fullText.includes('immediate') || fullText.includes('urgent')) score += 15;
  if (fullText.includes('walk-in') || fullText.includes('walk in')) score += 20;
  if (fullText.includes('hiring now') || fullText.includes('apply now')) score += 10;
  if (fullText.includes('immediate joining') || fullText.includes('immediate joiner')) score += 18;
  
  // Company quality boost
  const wellKnownCompanies = [
    'google', 'microsoft', 'amazon', 'apple', 'meta', 'netflix', 'uber', 
    'airbnb', 'spotify', 'adobe', 'oracle', 'salesforce', 'intuit', 
    'atlassian', 'slack', 'zoom', 'dropbox', 'flipkart', 'zomato', 
    'swiggy', 'paytm', 'byju', 'ola', 'phonepe', 'razorpay'
  ];
  
  if (wellKnownCompanies.some(known => company.toLowerCase().includes(known))) {
    score += 20;
  }
  
  // Platform authenticity boost
  if (link && link.includes(company.toLowerCase().replace(/\s+/g, ''))) {
    score += 8; // Company's own website
  }
  
  const lead = {
    company: company,
    type: 'fresh_job_posting',
    score: Math.round(score),
    fundingRaw: 'N/A',
    fundingLakhs: 'N/A',
    fundingInr: 'N/A',
    geo: geo,
    source: platform || 'Fresh Job Search',
    link: link,
    title: title,
    desc: snippet || title,
    pubDate: new Date().toISOString(),
    platform: platform,
    jobType: extractJobType(title),
    postingDate: postingDate ? postingDate.raw : 'Unknown',
    isRecent: postingDate ? postingDate.isRecent : false
  };
  
  return lead;
}

/**
 * Updated fresh job platform scanner
 */
function scanFreshJobPlatforms(CONFIG) {
  if (!CONFIG.jobScanEnabled) return [];
  
  const allJobLeads = [];
  
  Object.keys(CONFIG.jobPlatforms).forEach(platform => {
    const platformConfig = CONFIG.jobPlatforms[platform];
    if (!platformConfig.enabled) return;
    
    Logger.log(`Scanning ${platform} for FRESH job postings...`);
    
    platformConfig.searchTerms.forEach(searchTerm => {
      try {
        const announcements = searchFreshJobAnnouncements(platform, searchTerm, CONFIG);
        if (announcements && announcements.length > 0) {
          const processedJobs = announcements
            .slice(0, CONFIG.maxJobsPerPlatform)
            .map(announcement => processFreshJobAnnouncement(announcement, platform, CONFIG))
            .filter(lead => lead !== null);
          
          allJobLeads.push(...processedJobs);
          Logger.log(`Found ${processedJobs.length} FRESH job leads from ${platform} for "${searchTerm}"`);
        }
        
        // Rate limiting
        Utilities.sleep(1200);
      } catch (e) {
        Logger.log(`Error scanning ${platform} for "${searchTerm}": ${e.message}`);
      }
    });
  });
  
  // Sort by freshness and score
  allJobLeads.sort((a, b) => {
    // Prioritize recent posts
    if (a.isRecent && !b.isRecent) return -1;
    if (!a.isRecent && b.isRecent) return 1;
    // Then by score
    return b.score - a.score;
  });
  
  return allJobLeads;
}

/**
 * Updated daily scan to use fresh job scanner
 */
function runFreshDailyLeadScan() {
  const CONFIG = loadConfig();
  const today = Utilities.formatDate(new Date(), 'GMT', 'yyyy-MM-dd');
  
  Logger.log('=== STARTING FRESH DAILY LEAD SCAN ===');
  
  const queries = [
    {
      name: 'funding',
      search: 'funding OR raised OR investment OR venture capital startup',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:raises|raised|secures|announces funding|invested)/i
    },
    {
      name: 'expansion',
      search: 'expansion OR new office OR business growth OR scaling up',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:expands|opens|growth|scaling)/i
    },
    {
      name: 'jobs',
      search: 'hiring OR job openings OR recruiting OR now hiring company',
      companyPattern: /([A-Z][a-zA-Z\s&]+?)\s+(?:hiring|seeks|recruiting|jobs)/i
    }
  ];
  
  let allLeads = [];
  
  // Process news articles
  queries.forEach(query => {
    try {
      const json = fetchArticles(query, CONFIG);
      if (!json) return;
      const articles = json.articles || [];
      articles.forEach(article => {
        const lead = processArticle(article, query, CONFIG);
        if (lead) allLeads.push(lead);
      });
    } catch (e) {
      Logger.log(`Error processing news query ${query.name}: ${e.message}`);
    }
  });
  
  // Scan FRESH job platforms
  try {
    const freshJobLeads = scanFreshJobPlatforms(CONFIG);
    allLeads.push(...freshJobLeads);
    Logger.log(`Fresh job scanning completed: ${freshJobLeads.length} fresh job leads found`);
  } catch (e) {
    Logger.log(`Error in fresh job platform scanning: ${e.message}`);
  }
  
  // Enhanced deduplication
  const uniqueLeads = [];
  const seen = {};
  allLeads.forEach(lead => {
    const key = normalizeCompanyName(lead.company) + '|' + (lead.source || 'unknown') + '|' + (lead.title || '').substring(0, 50);
    if (!seen[key]) {
      seen[key] = true;
      uniqueLeads.push(lead);
    }
  });
  
  // Sort by freshness first, then score
  uniqueLeads.sort((a, b) => {
    if (a.isRecent && !b.isRecent) return -1;
    if (!a.isRecent && b.isRecent) return 1;
    return b.score - a.score;
  });
  
  // Write to spreadsheet
  const ss = getOrCreateSpreadsheet(CONFIG);
  let sheet = ss.getSheetByName(CONFIG.sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.sheetName);
    sheet.getRange(1, 1, 1, 13).setValues([[
      'Date', 'Company', 'Signal Type', 'Score', 'Funding (raw)', 'Funding (lakhs)',
      'Geography', 'Source', 'Article URL', 'Title', 'Description', 'Platform/Job Type', 'Posting Date'
    ]]);
    sheet.getRange(1, 1, 1, 13).setFontWeight('bold');
  }
  
  const existingUrls = getExistingArticleUrls(sheet);
  
  let appended = 0;
  let freshJobsAppended = 0;
  let newsAppended = 0;
  
  uniqueLeads.forEach(lead => {
    const url = (lead.link || '').toString().trim().toLowerCase();
    if (!url || existingUrls.has(url)) {
      return;
    }
    
    sheet.appendRow([
      today,
      lead.company,
      lead.type,
      lead.score,
      lead.fundingRaw,
      lead.fundingLakhs,
      lead.geo,
      lead.source,
      lead.link,
      lead.title,
      lead.desc,
      lead.platform || lead.jobType || 'N/A',
      lead.postingDate || 'N/A'
    ]);
    
    existingUrls.add(url);
    appended++;
    
    if (lead.type === 'fresh_job_posting') {
      freshJobsAppended++;
    } else {
      newsAppended++;
    }
  });
  
  formatSheet(sheet);
  Logger.log(`=== FRESH DAILY SCAN COMPLETE ===`);
  Logger.log(`${appended} new leads appended (${freshJobsAppended} fresh jobs, ${newsAppended} news)`);
  
  // Log top fresh leads
  const topFreshLeads = uniqueLeads.filter(l => l.isRecent).slice(0, 5);
  if (topFreshLeads.length > 0) {
    Logger.log('\n=== TOP FRESH JOB LEADS ===');
    topFreshLeads.forEach((lead, i) => {
      Logger.log(`${i + 1}. ${lead.company} (Score: ${lead.score}) - ${lead.postingDate}`);
    });
  }
  
  return {
    totalAppended: appended,
    freshJobsAppended: freshJobsAppended,
    newsAppended: newsAppended,
    topFreshCount: topFreshLeads.length
  };
}

/**
 * Test fresh job scanning
 */
function testFreshJobScan() {
  const CONFIG = loadConfig();
  Logger.log('=== TESTING FRESH JOB SCANNING ===');
  
  const freshLeads = scanFreshJobPlatforms(CONFIG);
  
  Logger.log(`Found ${freshLeads.length} fresh job leads`);
  
  if (freshLeads.length > 0) {
    const recentLeads = freshLeads.filter(lead => lead.isRecent);
    const todayLeads = freshLeads.filter(lead => lead.postingDate && (lead.postingDate.includes('hour') || lead.postingDate.includes('today')));
    
    Logger.log(`Recent leads (posted recently): ${recentLeads.length}`);
    Logger.log(`Today's leads: ${todayLeads.length}`);
    
    Logger.log('\n=== TOP FRESH LEADS ===');
    freshLeads.slice(0, 8).forEach((lead, i) => {
      Logger.log(`${i + 1}. ${lead.company} (Score: ${lead.score})`);
      Logger.log(`   Posted: ${lead.postingDate}`);
      Logger.log(`   Recent: ${lead.isRecent ? 'YES' : 'NO'}`);
      Logger.log(`   Title: ${lead.title}`);
      Logger.log(`   Link: ${lead.link}`);
      Logger.log('---');
    });
  }
  
  return { freshLeads: freshLeads.length, recentCount: freshLeads.filter(l => l.isRecent).length };
}
