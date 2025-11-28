// Tab Age Tracker - Popup Script

let tabsData = [];
let settings = {};
let deletedTabsData = [];

// Format time duration with seconds precision
function formatDuration(minutes) {
  const totalSeconds = Math.floor(minutes * 60);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  if (minutes < 60) {
    const mins = Math.floor(minutes);
    const secs = totalSeconds % 60;
    return `${mins}m ${secs}s`;
  }
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.floor(minutes % 60)}m`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return `${days}d ${hours}h`;
}

// Format time ago for history items
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

// Format slider value
function formatSliderValue(minutes) {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours} hr`;
  }
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return hours > 0 ? `${days}d ${hours}h` : `${days} day`;
}

// Parse user input to minutes (supports: "30", "30m", "30 min", "1h", "1 hr", "1h 30m", "2d", etc.)
function parseTimeInput(input) {
  const str = input.trim().toLowerCase();
  
  // Try parsing as just a number (assume minutes)
  if (/^\d+$/.test(str)) {
    return parseInt(str);
  }
  
  let totalMinutes = 0;
  
  // Match days
  const dayMatch = str.match(/(\d+)\s*d/);
  if (dayMatch) totalMinutes += parseInt(dayMatch[1]) * 1440;
  
  // Match hours
  const hourMatch = str.match(/(\d+)\s*h/);
  if (hourMatch) totalMinutes += parseInt(hourMatch[1]) * 60;
  
  // Match minutes
  const minMatch = str.match(/(\d+)\s*m(?:in)?/);
  if (minMatch) totalMinutes += parseInt(minMatch[1]);
  
  return totalMinutes > 0 ? totalMinutes : null;
}

// Get age class
function getAgeClass(minutesInactive) {
  if (minutesInactive <= settings.freshThreshold) return 'fresh';
  if (minutesInactive <= settings.staleThreshold) return 'stale';
  return 'old';
}

// Get domain from URL
function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

// Render tabs list
function renderTabs() {
  const container = document.getElementById('tabsList');
  
  if (tabsData.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <line x1="3" y1="9" x2="21" y2="9"/>
          <line x1="9" y1="3" x2="9" y2="9"/>
        </svg>
        <div>No tabs found</div>
      </div>
    `;
    return;
  }
  
  // Sort by age (oldest first)
  const sortedTabs = [...tabsData].sort((a, b) => {
    const ageA = a.lastActiveAt || Date.now();
    const ageB = b.lastActiveAt || Date.now();
    return ageA - ageB;
  });
  
  container.innerHTML = sortedTabs.map(tab => {
    const minutesInactive = (Date.now() - (tab.lastActiveAt || Date.now())) / (1000 * 60);
    const ageClass = getAgeClass(minutesInactive);
    const duration = formatDuration(minutesInactive);
    
    return `
      <div class="tab-item ${tab.active ? 'active-tab' : ''}" data-tab-id="${tab.id}">
        <img class="tab-favicon" src="${tab.favIconUrl || 'icons/icon16.png'}" onerror="this.src='icons/icon16.png'">
        <div class="tab-info">
          <div class="tab-title">${escapeHtml(tab.title || 'Untitled')}</div>
          <div class="tab-meta">
            <span class="tab-age ${ageClass}">${duration}</span>
            <span class="tab-url">${getDomain(tab.url || '')}</span>
          </div>
        </div>
        <button class="tab-close" data-close-id="${tab.id}" title="Close tab">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    `;
  }).join('');
  
  // Add click handlers
  container.querySelectorAll('.tab-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.tab-close')) return;
      const tabId = parseInt(item.dataset.tabId);
      chrome.tabs.update(tabId, { active: true });
      window.close();
    });
  });
  
  container.querySelectorAll('.tab-close').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = parseInt(btn.dataset.closeId);
      await chrome.runtime.sendMessage({ type: 'closeTab', tabId });
      loadData();
    });
  });
}

// Update stats
function updateStats() {
  const now = Date.now();
  
  let fresh = 0, stale = 0, old = 0;
  let oldestAge = 0;
  let oldestTab = null;
  
  tabsData.forEach(tab => {
    const minutes = (now - (tab.lastActiveAt || now)) / (1000 * 60);
    
    if (minutes <= settings.freshThreshold) fresh++;
    else if (minutes <= settings.staleThreshold) stale++;
    else old++;
    
    if (minutes > oldestAge) {
      oldestAge = minutes;
      oldestTab = tab;
    }
  });
  
  const total = tabsData.length;
  
  document.getElementById('totalTabs').textContent = total;
  document.getElementById('freshCount').textContent = `${fresh} fresh`;
  document.getElementById('staleCount').textContent = `${stale} stale`;
  document.getElementById('oldCount').textContent = `${old} old`;
  
  // Update bar
  const freshPct = total > 0 ? (fresh / total) * 100 : 33;
  const stalePct = total > 0 ? (stale / total) * 100 : 33;
  const oldPct = total > 0 ? (old / total) * 100 : 34;
  
  const bar = document.getElementById('statBar');
  bar.innerHTML = `
    <div class="stat-segment fresh" style="width: ${freshPct}%"></div>
    <div class="stat-segment stale" style="width: ${stalePct}%"></div>
    <div class="stat-segment old" style="width: ${oldPct}%"></div>
  `;
  
  // Oldest tab
  document.getElementById('oldestAge').textContent = oldestTab ? formatDuration(oldestAge) : '-';
  document.getElementById('oldestTitle').textContent = oldestTab ? (oldestTab.title || 'Untitled').substring(0, 40) : '-';
}

// Load deleted tabs history
async function loadDeletedTabs() {
  const response = await chrome.runtime.sendMessage({ type: 'getDeletedTabs' });
  deletedTabsData = response.deletedTabs || [];
  renderHistory();
}

// Render history list
function renderHistory() {
  const container = document.getElementById('historyList');
  
  if (deletedTabsData.length === 0) {
    container.innerHTML = `
      <div class="history-empty">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        <div>No recently closed tabs</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = deletedTabsData.map(entry => {
    const timeAgo = formatTimeAgo(entry.deletedAt);
    const autoDeleteBadge = entry.autoDeleted ? '<span class="auto-badge">AUTO</span>' : '';
    
    return `
      <div class="history-item ${entry.autoDeleted ? 'auto-deleted' : ''}" data-entry-id="${entry.id}">
        <img class="history-favicon" src="${entry.favicon || 'icons/icon16.png'}" onerror="this.src='icons/icon16.png'">
        <div class="history-info">
          <div class="history-title-text">${escapeHtml(entry.title || 'Untitled')}</div>
          <div class="history-meta">
            <span>${timeAgo}</span>
            ${autoDeleteBadge}
          </div>
        </div>
        <div class="history-actions">
          <button class="btn-reopen" data-reopen-id="${entry.id}">Reopen</button>
          <button class="btn-remove" data-remove-id="${entry.id}">×</button>
        </div>
      </div>
    `;
  }).join('');
  
  // Add click handlers for reopen buttons
  container.querySelectorAll('.btn-reopen').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const entryId = parseInt(btn.dataset.reopenId);
      await chrome.runtime.sendMessage({ type: 'reopenTab', entryId });
      loadDeletedTabs();
    });
  });
  
  // Add click handlers for remove buttons
  container.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const entryId = parseInt(btn.dataset.removeId);
      await chrome.runtime.sendMessage({ type: 'removeFromHistory', entryId });
      loadDeletedTabs();
    });
  });
}

// Load data from background
async function loadData() {
  const response = await chrome.runtime.sendMessage({ type: 'getTabData' });
  tabsData = response.tabs || [];
  settings = response.settings || {};
  
  renderTabs();
  updateStats();
  updateSettingsUI();
  loadDeletedTabs();
}

// Update settings UI
function updateSettingsUI() {
  document.getElementById('freshSlider').value = settings.freshThreshold || 30;
  document.getElementById('staleSlider').value = settings.staleThreshold || 120;
  document.getElementById('oldSlider').value = settings.oldThreshold || 480;
  
  document.getElementById('freshValue').value = formatSliderValue(settings.freshThreshold || 30);
  document.getElementById('staleValue').value = formatSliderValue(settings.staleThreshold || 120);
  document.getElementById('oldValue').value = formatSliderValue(settings.oldThreshold || 480);
  
  // Update toggle
  const toggle = document.getElementById('enableToggle');
  if (settings.enabled !== false) {
    toggle.classList.add('active');
  } else {
    toggle.classList.remove('active');
  }
  
  // Update style options
  document.querySelectorAll('.style-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.style === (settings.indicatorStyle || 'dot'));
  });
  
  // Update auto-delete settings
  const autoDeleteToggle = document.getElementById('autoDeleteToggle');
  const autoDeleteSettings = document.getElementById('autoDeleteSettings');
  const autoDeleteSlider = document.getElementById('autoDeleteSlider');
  
  if (settings.autoDeleteEnabled) {
    autoDeleteToggle.classList.add('active');
    autoDeleteSettings.classList.add('visible');
  } else {
    autoDeleteToggle.classList.remove('active');
    autoDeleteSettings.classList.remove('visible');
  }
  
  autoDeleteSlider.value = settings.autoDeleteThreshold || 60;
  document.getElementById('autoDeleteValue').value = formatSliderValue(settings.autoDeleteThreshold || 60);
}

// Save settings
async function saveSettings(newSettings) {
  settings = { ...settings, ...newSettings };
  await chrome.runtime.sendMessage({ type: 'updateSettings', settings: newSettings });
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadData();
  
  // Auto-refresh every 1 second for real-time updates
  setInterval(() => {
    loadData();
  }, 1000);
  
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(`${btn.dataset.tab}-panel`).classList.add('active');
    });
  });
  
  // Enable toggle
  document.getElementById('enableToggle').addEventListener('click', () => {
    const toggle = document.getElementById('enableToggle');
    const enabled = !toggle.classList.contains('active');
    toggle.classList.toggle('active', enabled);
    saveSettings({ enabled });
  });
  
  // Sort button
  document.getElementById('sortBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'sortTabs' });
    loadData();
  });
  
  // Close old button
  document.getElementById('closeOldBtn').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'closeOldTabs' });
    loadData();
  });
  
  // Sliders
  document.getElementById('freshSlider').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('freshValue').value = formatSliderValue(value);
  });
  
  document.getElementById('freshSlider').addEventListener('change', (e) => {
    saveSettings({ freshThreshold: parseInt(e.target.value) });
  });
  
  document.getElementById('staleSlider').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('staleValue').value = formatSliderValue(value);
  });
  
  document.getElementById('staleSlider').addEventListener('change', (e) => {
    saveSettings({ staleThreshold: parseInt(e.target.value) });
  });
  
  document.getElementById('oldSlider').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('oldValue').value = formatSliderValue(value);
  });
  
  document.getElementById('oldSlider').addEventListener('change', (e) => {
    saveSettings({ oldThreshold: parseInt(e.target.value) });
  });
  
  // Editable input fields for thresholds
  document.getElementById('freshValue').addEventListener('change', (e) => {
    const minutes = parseTimeInput(e.target.value);
    if (minutes !== null && minutes >= 1 && minutes <= 120) {
      document.getElementById('freshSlider').value = minutes;
      e.target.value = formatSliderValue(minutes);
      saveSettings({ freshThreshold: minutes });
    } else {
      e.target.value = formatSliderValue(settings.freshThreshold || 5);
    }
  });
  
  document.getElementById('staleValue').addEventListener('change', (e) => {
    const minutes = parseTimeInput(e.target.value);
    if (minutes !== null && minutes >= 2 && minutes <= 480) {
      document.getElementById('staleSlider').value = minutes;
      e.target.value = formatSliderValue(minutes);
      saveSettings({ staleThreshold: minutes });
    } else {
      e.target.value = formatSliderValue(settings.staleThreshold || 30);
    }
  });
  
  document.getElementById('oldValue').addEventListener('change', (e) => {
    const minutes = parseTimeInput(e.target.value);
    if (minutes !== null && minutes >= 5 && minutes <= 1440) {
      document.getElementById('oldSlider').value = minutes;
      e.target.value = formatSliderValue(minutes);
      saveSettings({ oldThreshold: minutes });
    } else {
      e.target.value = formatSliderValue(settings.oldThreshold || 60);
    }
  });
  
  // Select all text on focus for easy editing
  document.querySelectorAll('.setting-value, .auto-delete-value').forEach(input => {
    input.addEventListener('focus', (e) => e.target.select());
  });
  
  // Stepper button handlers
  document.querySelectorAll('.stepper-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      const sliderId = btn.dataset.target;
      const slider = document.getElementById(sliderId);
      const min = parseInt(slider.min);
      const max = parseInt(slider.max);
      let value = parseInt(slider.value);
      
      // Determine step size based on current value
      let step = 1;
      if (value >= 60) step = 5;
      if (value >= 120) step = 10;
      if (value >= 480) step = 30;
      
      if (action === 'increase') {
        value = Math.min(max, value + step);
      } else {
        value = Math.max(min, value - step);
      }
      
      slider.value = value;
      slider.dispatchEvent(new Event('input'));
      slider.dispatchEvent(new Event('change'));
    });
  });
  
  // Style options
  document.querySelectorAll('.style-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.style-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      saveSettings({ indicatorStyle: opt.dataset.style });
    });
  });
  
  // Auto-delete toggle
  document.getElementById('autoDeleteToggle').addEventListener('click', () => {
    const toggle = document.getElementById('autoDeleteToggle');
    const settingsDiv = document.getElementById('autoDeleteSettings');
    const enabled = !toggle.classList.contains('active');
    toggle.classList.toggle('active', enabled);
    settingsDiv.classList.toggle('visible', enabled);
    saveSettings({ autoDeleteEnabled: enabled });
  });
  
  // Auto-delete slider
  document.getElementById('autoDeleteSlider').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('autoDeleteValue').value = formatSliderValue(value);
  });
  
  document.getElementById('autoDeleteSlider').addEventListener('change', (e) => {
    saveSettings({ autoDeleteThreshold: parseInt(e.target.value) });
  });
  
  // Auto-delete editable input
  document.getElementById('autoDeleteValue').addEventListener('change', (e) => {
    const minutes = parseTimeInput(e.target.value);
    if (minutes !== null && minutes >= 5 && minutes <= 1440) {
      document.getElementById('autoDeleteSlider').value = minutes;
      e.target.value = formatSliderValue(minutes);
      saveSettings({ autoDeleteThreshold: minutes });
    } else {
      e.target.value = formatSliderValue(settings.autoDeleteThreshold || 60);
    }
  });
  
  document.getElementById('autoDeleteValue').addEventListener('focus', (e) => e.target.select());
  
  // Clear history button
  document.getElementById('clearHistoryBtn').addEventListener('click', async () => {
    if (deletedTabsData.length === 0) return;
    await chrome.runtime.sendMessage({ type: 'clearDeletedHistory' });
    loadDeletedTabs();
  });
});
