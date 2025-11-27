// Tab Age Tracker - Popup Script

let tabsData = [];
let settings = {};

// Format time duration
function formatDuration(minutes) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${Math.floor(minutes)}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${Math.floor(minutes % 60)}m`;
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  return `${days}d ${hours}h`;
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

// Load data from background
async function loadData() {
  const response = await chrome.runtime.sendMessage({ type: 'getTabData' });
  tabsData = response.tabs || [];
  settings = response.settings || {};
  
  renderTabs();
  updateStats();
  updateSettingsUI();
}

// Update settings UI
function updateSettingsUI() {
  document.getElementById('freshSlider').value = settings.freshThreshold || 30;
  document.getElementById('staleSlider').value = settings.staleThreshold || 120;
  document.getElementById('oldSlider').value = settings.oldThreshold || 480;
  
  document.getElementById('freshValue').textContent = formatSliderValue(settings.freshThreshold || 30);
  document.getElementById('staleValue').textContent = formatSliderValue(settings.staleThreshold || 120);
  document.getElementById('oldValue').textContent = formatSliderValue(settings.oldThreshold || 480);
  
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
  
  // Auto-refresh every 2 seconds for real-time updates
  setInterval(() => {
    loadData();
  }, 2000);
  
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
    document.getElementById('freshValue').textContent = formatSliderValue(value);
  });
  
  document.getElementById('freshSlider').addEventListener('change', (e) => {
    saveSettings({ freshThreshold: parseInt(e.target.value) });
  });
  
  document.getElementById('staleSlider').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('staleValue').textContent = formatSliderValue(value);
  });
  
  document.getElementById('staleSlider').addEventListener('change', (e) => {
    saveSettings({ staleThreshold: parseInt(e.target.value) });
  });
  
  document.getElementById('oldSlider').addEventListener('input', (e) => {
    const value = parseInt(e.target.value);
    document.getElementById('oldValue').textContent = formatSliderValue(value);
  });
  
  document.getElementById('oldSlider').addEventListener('change', (e) => {
    saveSettings({ oldThreshold: parseInt(e.target.value) });
  });
  
  // Style options
  document.querySelectorAll('.style-option').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('.style-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      saveSettings({ indicatorStyle: opt.dataset.style });
    });
  });
});
