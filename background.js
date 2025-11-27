// Tab Age Tracker - Background Service Worker
// Tracks when tabs were last active and updates their favicons with age indicators

const DEFAULT_SETTINGS = {
  freshThreshold: 30,      // minutes - green zone
  staleThreshold: 120,     // minutes - yellow/orange zone  
  oldThreshold: 480,       // minutes - red zone (8 hours)
  enabled: true,
  indicatorStyle: 'dot',   // 'dot', 'ring', or 'badge'
  indicatorSize: 8
};

// In-memory store for tab data
let tabData = {};
let settings = { ...DEFAULT_SETTINGS };

// Color interpolation in HSL space for smooth gradients
function getAgeColor(minutesInactive) {
  // Green (120°) -> Yellow (60°) -> Orange (30°) -> Red (0°)
  const { freshThreshold, staleThreshold, oldThreshold } = settings;
  
  let hue, saturation, lightness;
  
  if (minutesInactive <= freshThreshold) {
    // Fresh: bright green
    hue = 140;
    saturation = 70;
    lightness = 45;
  } else if (minutesInactive <= staleThreshold) {
    // Transitioning green -> yellow -> orange
    const progress = (minutesInactive - freshThreshold) / (staleThreshold - freshThreshold);
    hue = 140 - (progress * 100); // 140 -> 40
    saturation = 70 + (progress * 15);
    lightness = 45 + (progress * 5);
  } else if (minutesInactive <= oldThreshold) {
    // Transitioning orange -> red
    const progress = (minutesInactive - staleThreshold) / (oldThreshold - staleThreshold);
    hue = 40 - (progress * 40); // 40 -> 0
    saturation = 85;
    lightness = 50 - (progress * 5);
  } else {
    // Very old: deep red
    hue = 0;
    saturation = 80;
    lightness = 40;
  }
  
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

// Convert HSL to hex for canvas operations
function hslToHex(hslString) {
  const match = hslString.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
  if (!match) return '#22c55e';
  
  let h = parseInt(match[1]) / 360;
  let s = parseInt(match[2]) / 100;
  let l = parseInt(match[3]) / 100;
  
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  
  const toHex = x => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Initialize extension
async function init() {
  // Load settings
  const stored = await chrome.storage.local.get(['settings', 'tabData']);
  if (stored.settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  if (stored.tabData) {
    tabData = stored.tabData;
  }
  
  // Initialize all existing tabs
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  
  for (const tab of tabs) {
    if (!tabData[tab.id]) {
      tabData[tab.id] = {
        createdAt: now,
        lastActiveAt: tab.active ? now : now,
        url: tab.url,
        title: tab.title
      };
    }
  }
  
  await saveTabData();
  
  // Update all tab indicators
  if (settings.enabled) {
    for (const tab of tabs) {
      await updateTabIndicator(tab.id);
    }
  }
}

// Save tab data to storage
async function saveTabData() {
  await chrome.storage.local.set({ tabData });
}

// Save settings to storage
async function saveSettings() {
  await chrome.storage.local.set({ settings });
}

// Update the visual indicator for a tab
async function updateTabIndicator(tabId) {
  // Re-read settings from storage to ensure freshness
  const stored = await chrome.storage.local.get(['settings']);
  const currentSettings = stored.settings ? { ...DEFAULT_SETTINGS, ...stored.settings } : settings;
  
  if (!currentSettings.enabled) return;
  
  const data = tabData[tabId];
  if (!data) return;
  
  const minutesInactive = (Date.now() - data.lastActiveAt) / (1000 * 60);
  const color = getAgeColor(minutesInactive);
  const hexColor = hslToHex(color);
  
  console.log('[TabAge] Updating tab', tabId, 'with style:', currentSettings.indicatorStyle);
  
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://')) {
      return;
    }
    
    // Inject content script to add indicator
    await chrome.scripting.executeScript({
      target: { tabId },
      func: addFaviconIndicator,
      args: [hexColor, currentSettings.indicatorStyle, currentSettings.indicatorSize, minutesInactive]
    });
  } catch (e) {
    // Tab might not be accessible (chrome:// pages, etc.)
    console.log('[TabAge] Failed to update tab', tabId, e.message);
  }
}

// This function runs in the page context
function addFaviconIndicator(color, style, size, minutesInactive) {
  console.log('[TabAge] Injected indicator - style:', style, 'color:', color);
  
  // Store the original favicon URL in a data attribute on documentElement if not already stored
  let faviconUrl = document.documentElement.getAttribute('data-original-favicon');
  
  if (!faviconUrl) {
    // First time - find and store the original favicon
    const existingFavicon = document.querySelector('link[rel*="icon"]:not([data-tab-age-tracker])');
    if (existingFavicon && existingFavicon.href) {
      faviconUrl = existingFavicon.href;
    } else {
      faviconUrl = '/favicon.ico';
    }
    document.documentElement.setAttribute('data-original-favicon', faviconUrl);
  }
  
  // Remove ALL existing favicons
  document.querySelectorAll('link[rel*="icon"], link[rel="shortcut icon"]').forEach(el => el.remove());
  
  // Create canvas to draw indicator
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  
  const img = new Image();
  img.crossOrigin = 'anonymous';
  
  img.onload = () => {
    // Draw original favicon
    ctx.drawImage(img, 0, 0, 32, 32);
    
    // Draw indicator based on style
    if (style === 'dot') {
      // Bottom-right dot
      ctx.beginPath();
      ctx.arc(32 - size/2 - 1, 32 - size/2 - 1, size/2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else if (style === 'ring') {
      // Ring around the icon
      ctx.beginPath();
      ctx.arc(16, 16, 14, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (style === 'badge') {
      // Top-right badge with time
      const hours = Math.floor(minutesInactive / 60);
      const text = hours > 0 ? `${hours}h` : `${Math.floor(minutesInactive)}m`;
      
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(14, 0, 18, 12, 2);
      ctx.fill();
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, 23, 9);
    }
    
    // Update favicon
    const newFaviconUrl = canvas.toDataURL('image/png');
    
    // Remove any remaining favicons that might have been added
    document.querySelectorAll('link[rel*="icon"], link[rel="shortcut icon"]').forEach(el => el.remove());
    
    // Add new favicon
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = newFaviconUrl;
    link.setAttribute('data-tab-age-tracker', Date.now().toString());
    document.head.appendChild(link);
    console.log('[TabAge] Favicon updated with style:', style);
  };
  
  img.onerror = () => {
    // No favicon, just draw indicator on blank
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, 32, 32);
    
    if (style === 'dot') {
      ctx.beginPath();
      ctx.arc(32 - size/2 - 1, 32 - size/2 - 1, size/2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else if (style === 'ring') {
      ctx.beginPath();
      ctx.arc(16, 16, 14, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else if (style === 'badge') {
      const hours = Math.floor(minutesInactive / 60);
      const text = hours > 0 ? `${hours}h` : `${Math.floor(minutesInactive)}m`;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(14, 0, 18, 12, 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, 23, 9);
    }
    
    // Remove any remaining favicons
    document.querySelectorAll('link[rel*="icon"], link[rel="shortcut icon"]').forEach(el => el.remove());
    
    const newFaviconUrl = canvas.toDataURL('image/png');
    const link = document.createElement('link');
    link.rel = 'icon';
    link.type = 'image/png';
    link.href = newFaviconUrl;
    link.setAttribute('data-tab-age-tracker', Date.now().toString());
    document.head.appendChild(link);
    console.log('[TabAge] Favicon (fallback) updated with style:', style);
  };
  
  img.src = faviconUrl;
}

// Event Listeners

// Tab created
chrome.tabs.onCreated.addListener(async (tab) => {
  const now = Date.now();
  tabData[tab.id] = {
    createdAt: now,
    lastActiveAt: now,
    url: tab.url,
    title: tab.title
  };
  await saveTabData();
});

// Tab activated (user switches to it)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const now = Date.now();
  
  if (tabData[activeInfo.tabId]) {
    tabData[activeInfo.tabId].lastActiveAt = now;
  } else {
    tabData[activeInfo.tabId] = {
      createdAt: now,
      lastActiveAt: now
    };
  }
  
  await saveTabData();
  
  // Update indicator for this tab (now fresh/green)
  await updateTabIndicator(activeInfo.tabId);
});

// Tab updated (URL change, etc.)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete') {
    if (tabData[tabId]) {
      tabData[tabId].url = tab.url;
      tabData[tabId].title = tab.title;
    }
    await saveTabData();
    
    // Re-apply indicator after page load
    setTimeout(() => updateTabIndicator(tabId), 500);
  }
});

// Tab removed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  delete tabData[tabId];
  await saveTabData();
});

// Periodic update of all tab indicators
setInterval(async () => {
  if (!settings.enabled) return;
  
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await updateTabIndicator(tab.id);
  }
}, 60000); // Update every minute

// Handle keyboard commands
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'sort-by-age') {
    await sortTabsByAge();
  } else if (command === 'close-old-tabs') {
    await closeOldTabs();
  }
});

// Sort tabs by age (oldest first)
async function sortTabsByAge() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  
  const tabsWithAge = tabs.map(tab => ({
    tab,
    lastActiveAt: tabData[tab.id]?.lastActiveAt || Date.now()
  }));
  
  // Sort by last active time (oldest first)
  tabsWithAge.sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  
  // Move tabs to new positions
  for (let i = 0; i < tabsWithAge.length; i++) {
    await chrome.tabs.move(tabsWithAge[i].tab.id, { index: i });
  }
}

// Close tabs older than threshold
async function closeOldTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const now = Date.now();
  const thresholdMs = settings.oldThreshold * 60 * 1000;
  
  const tabsToClose = tabs.filter(tab => {
    const data = tabData[tab.id];
    if (!data) return false;
    return (now - data.lastActiveAt) > thresholdMs && !tab.active;
  });
  
  if (tabsToClose.length > 0) {
    await chrome.tabs.remove(tabsToClose.map(t => t.id));
  }
}

// Message handler for popup communication
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'getTabData') {
    chrome.tabs.query({}).then(tabs => {
      const result = tabs.map(tab => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
        active: tab.active,
        ...tabData[tab.id]
      }));
      sendResponse({ tabs: result, settings });
    });
    return true; // async response
  }
  
  if (message.type === 'updateSettings') {
    // Update in-memory settings first
    settings = { ...settings, ...message.settings };
    console.log('[TabAge] Settings updated:', settings.indicatorStyle);
    
    // Persist to storage, then update all tabs sequentially
    (async () => {
      await chrome.storage.local.set({ settings });
      console.log('[TabAge] Settings saved to storage');
      
      const tabs = await chrome.tabs.query({});
      // Update tabs sequentially to avoid race conditions
      for (const tab of tabs) {
        await updateTabIndicator(tab.id);
      }
      sendResponse({ success: true });
    })();
    return true;
  }
  
  if (message.type === 'sortTabs') {
    sortTabsByAge().then(() => sendResponse({ success: true }));
    return true;
  }
  
  if (message.type === 'closeOldTabs') {
    closeOldTabs().then(() => sendResponse({ success: true }));
    return true;
  }
  
  if (message.type === 'closeTab') {
    chrome.tabs.remove(message.tabId).then(() => sendResponse({ success: true }));
    return true;
  }
});

// Initialize on install/startup
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

// Also init immediately
init();
