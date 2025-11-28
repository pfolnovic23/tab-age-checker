// Tab Age Tracker - Background Service Worker
// Tracks when tabs were last active and updates their favicons with age indicators

const DEFAULT_SETTINGS = {
  freshThreshold: 1,       // minutes - green zone (1 min for fast testing)
  staleThreshold: 2,       // minutes - yellow/orange zone (2 min)
  oldThreshold: 3,         // minutes - red zone (3 min)
  enabled: true,
  indicatorStyle: 'dot',   // 'dot' or 'badge'
  indicatorSize: 12,
  autoDeleteEnabled: false, // Auto-delete old tabs
  autoDeleteThreshold: 60   // minutes before auto-delete
};

// In-memory store for tab data
let tabData = {};
let settings = { ...DEFAULT_SETTINGS };

// Deleted tabs history
let deletedTabs = [];
const MAX_DELETED_HISTORY = 50;

// Color interpolation in HSL space for smooth gradients
// Pass thresholds as parameters to ensure fresh values are used
function getAgeColor(minutesInactive, freshThreshold, staleThreshold, oldThreshold) {
  // Green (140°) -> Yellow (60°) -> Orange (30°) -> Red (0°)
  
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
  
  return `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`;
}

// Convert HSL to hex for canvas operations
function hslToHex(hslString) {
  // Regex handles integers or decimals: hsl(140, 70%, 45%) or hsl(119.5, 73.1%, 46.0%)
  const match = hslString.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
  if (!match) {
    console.error('[TabAge] Failed to parse HSL:', hslString);
    return '#22c55e';
  }
  
  const hDeg = parseFloat(match[1]);
  const sPct = parseFloat(match[2]);
  const lPct = parseFloat(match[3]);
  
  let h = hDeg / 360;
  let s = sPct / 100;
  let l = lPct / 100;
  
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
  
  const result = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  console.log('[TabAge] HSL->Hex:', hslString, '->', result, '(h:', hDeg, 's:', sPct, 'l:', lPct, ')');
  return result;
}

// Initialize extension
async function init() {
  // Load settings
  const stored = await chrome.storage.local.get(['settings', 'tabData', 'deletedTabs']);
  if (stored.settings) {
    settings = { ...DEFAULT_SETTINGS, ...stored.settings };
  }
  if (stored.tabData) {
    tabData = stored.tabData;
  }
  if (stored.deletedTabs) {
    deletedTabs = stored.deletedTabs;
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

// Save deleted tabs to storage
async function saveDeletedTabs() {
  await chrome.storage.local.set({ deletedTabs });
}

// Save tab to deleted history before closing
async function saveToDeletedHistory(tab, tabInfo) {
  const historyEntry = {
    id: Date.now(), // unique ID for the history entry
    url: tab.url,
    title: tab.title || 'Untitled',
    favicon: tab.favIconUrl || '',
    deletedAt: Date.now(),
    lastActiveAt: tabInfo?.lastActiveAt || Date.now(),
    autoDeleted: false // will be set to true if auto-deleted
  };
  
  // Add to beginning of array
  deletedTabs.unshift(historyEntry);
  
  // Keep only the most recent entries
  if (deletedTabs.length > MAX_DELETED_HISTORY) {
    deletedTabs = deletedTabs.slice(0, MAX_DELETED_HISTORY);
  }
  
  await saveDeletedTabs();
  return historyEntry;
}

// Update the visual indicator for a tab
async function updateTabIndicator(tabId) {
  // ALWAYS re-read settings from storage to ensure we have the latest values
  const stored = await chrome.storage.local.get(['settings']);
  const currentSettings = stored.settings ? { ...DEFAULT_SETTINGS, ...stored.settings } : settings;
  
  // Also update the in-memory settings
  settings = currentSettings;
  
  if (!currentSettings.enabled) return;
  
  const data = tabData[tabId];
  if (!data) return;
  
  const minutesInactive = (Date.now() - data.lastActiveAt) / (1000 * 60);
  
  // Pass thresholds directly to ensure color calculation uses fresh values
  const color = getAgeColor(
    minutesInactive, 
    currentSettings.freshThreshold, 
    currentSettings.staleThreshold, 
    currentSettings.oldThreshold
  );
  const hexColor = hslToHex(color);
  
  console.log('[TabAge] Tab', tabId, '- inactive:', minutesInactive.toFixed(1), 'min, thresholds:', 
    currentSettings.freshThreshold, '/', currentSettings.staleThreshold, '/', currentSettings.oldThreshold,
    '- color:', hexColor, '- style:', currentSettings.indicatorStyle);
  
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.url?.startsWith('chrome://') || tab.url?.startsWith('chrome-extension://') || 
        tab.url?.startsWith('brave://') || tab.url?.startsWith('about:')) {
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
      // Bottom-right dot - bigger and bolder
      const dotSize = Math.max(size, 10);
      ctx.beginPath();
      ctx.arc(32 - dotSize/2 - 1, 32 - dotSize/2 - 1, dotSize/2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (style === 'badge') {
      // Top-right badge with time - bigger
      const hours = Math.floor(minutesInactive / 60);
      const text = hours > 0 ? `${hours}h` : `${Math.floor(minutesInactive)}m`;
      
      ctx.fillStyle = color;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(10, 0, 22, 14, 3);
      } else {
        ctx.rect(10, 0, 22, 14);
      }
      ctx.fill();
      
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, 21, 11);
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
      const dotSize = Math.max(size, 10);
      ctx.beginPath();
      ctx.arc(32 - dotSize/2 - 1, 32 - dotSize/2 - 1, dotSize/2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (style === 'badge') {
      const hours = Math.floor(minutesInactive / 60);
      const text = hours > 0 ? `${hours}h` : `${Math.floor(minutesInactive)}m`;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(10, 0, 22, 14, 3);
      } else {
        ctx.rect(10, 0, 22, 14);
      }
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(text, 21, 11);
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

// Periodic update of all tab indicators (every 5 seconds for real-time color changes)
setInterval(async () => {
  if (!settings.enabled) return;
  
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    await updateTabIndicator(tab.id);
  }
  
  // Auto-delete check
  if (settings.autoDeleteEnabled) {
    await autoDeleteOldTabs();
  }
}, 5000); // Update every 5 seconds

// Auto-delete old tabs based on autoDeleteThreshold
async function autoDeleteOldTabs() {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const thresholdMs = settings.autoDeleteThreshold * 60 * 1000;
  
  for (const tab of tabs) {
    const data = tabData[tab.id];
    if (!data) continue;
    
    // Skip active tab, pinned tabs, and special URLs
    if (tab.active || tab.pinned) continue;
    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || 
        tab.url.startsWith('brave://') || tab.url.startsWith('edge://') || tab.url === 'about:blank') continue;
    
    const inactiveTime = now - data.lastActiveAt;
    if (inactiveTime > thresholdMs) {
      // Save to history before deleting
      const historyEntry = await saveToDeletedHistory(tab, data);
      historyEntry.autoDeleted = true;
      await saveDeletedTabs();
      
      // Close the tab
      try {
        await chrome.tabs.remove(tab.id);
        console.log('[TabAge] Auto-deleted tab:', tab.title);
      } catch (e) {
        console.error('[TabAge] Failed to auto-delete tab:', e);
      }
    }
  }
}

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
  
  // Save each tab to history before closing
  for (const tab of tabsToClose) {
    await saveToDeletedHistory(tab, tabData[tab.id]);
  }
  
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
    console.log('[TabAge] Received settings update:', JSON.stringify(message.settings));
    
    (async () => {
      // Merge with current settings
      const newSettings = { ...settings, ...message.settings };
      
      // Update in-memory settings FIRST
      settings = newSettings;
      
      // Persist to storage
      await chrome.storage.local.set({ settings: newSettings });
      console.log('[TabAge] Settings saved - fresh:', newSettings.freshThreshold, 
        'stale:', newSettings.staleThreshold, 'old:', newSettings.oldThreshold,
        'style:', newSettings.indicatorStyle);
      
      // Small delay to ensure storage is fully written
      await new Promise(r => setTimeout(r, 50));
      
      // Update all tabs with new settings
      const tabs = await chrome.tabs.query({});
      console.log('[TabAge] Updating', tabs.length, 'tabs with new settings');
      
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
    (async () => {
      // Get tab info before closing to save to history
      try {
        const tab = await chrome.tabs.get(message.tabId);
        await saveToDeletedHistory(tab, tabData[message.tabId]);
      } catch (e) {
        console.log('[TabAge] Could not get tab info for history:', e);
      }
      await chrome.tabs.remove(message.tabId);
      sendResponse({ success: true });
    })();
    return true;
  }
  
  if (message.type === 'getDeletedTabs') {
    sendResponse({ deletedTabs });
    return true;
  }
  
  if (message.type === 'reopenTab') {
    (async () => {
      const entry = deletedTabs.find(t => t.id === message.entryId);
      if (entry) {
        // Create new tab with the URL
        await chrome.tabs.create({ url: entry.url });
        // Remove from history
        deletedTabs = deletedTabs.filter(t => t.id !== message.entryId);
        await saveDeletedTabs();
      }
      sendResponse({ success: true });
    })();
    return true;
  }
  
  if (message.type === 'removeFromHistory') {
    deletedTabs = deletedTabs.filter(t => t.id !== message.entryId);
    saveDeletedTabs().then(() => sendResponse({ success: true }));
    return true;
  }
  
  if (message.type === 'clearDeletedHistory') {
    deletedTabs = [];
    saveDeletedTabs().then(() => sendResponse({ success: true }));
    return true;
  }
});

// Initialize on install/startup
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);

// Also init immediately
init();
