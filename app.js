// ==================== State & Globals ====================
let sessions = [];
let dbOnline = false;
let currentMode = 'study'; // 'study' or 'assignment'
let currentUser = null;
let inspectingUserId = null;
let currentAuthTab = 'login';
let inspectInterval = null;
let heartbeatInterval = null;
let inspectClockTickInterval = null;

// Get sessions filtered by active mode
function getActiveSessions() {
  return sessions.filter(s => (s.session_type || 'study') === currentMode);
}

// Timer state
let timerInterval = null;
let elapsedSeconds = 0;
let isRunning = false;
let isPaused = false;
let sessionStartTime = null;
let sessionEndTime = null;
let selectedFocusLevel = null; // 1, 2, 3 or null

// Calendar state
let currentCalendarDate = new Date();
let selectedCalendarDate = new Date();

// Chart instances
let studyTimeChartInstance = null;
let concentrationChartInstance = null;
let activeChartMode = 'daily'; // daily, weekly, monthly

// Subject color palette
const COLORS = [
  '#e8a83e', '#4ecb71', '#5ab8e8', '#e85454', '#c084fc',
  '#f472b6', '#fb923c', '#34d399', '#60a5fa', '#a78bfa',
  '#fbbf24', '#f87171', '#38bdf8', '#a3e635', '#e879f9'
];
const subjectColorMap = {};
let colorIndex = 0;

function getSubjectColor(subject) {
  const key = (subject || 'Unspecified').toLowerCase().trim();
  if (!subjectColorMap[key]) {
    subjectColorMap[key] = COLORS[colorIndex % COLORS.length];
    colorIndex++;
  }
  return subjectColorMap[key];
}

// ==================== Navigation Tabs ====================
document.querySelectorAll('.nav-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
    
    tab.classList.add('active');
    const targetSection = document.getElementById(`sec-${tab.dataset.tab}`);
    if (targetSection) {
      targetSection.classList.add('active');
    }

    // Trigger tab-specific view updates
    if (tab.dataset.tab === 'dashboard') {
      updateDashboard();
    } else if (tab.dataset.tab === 'analytics') {
      setTimeout(initOrUpdateCharts, 50);
    } else if (tab.dataset.tab === 'calendar') {
      renderCalendar();
    } else if (tab.dataset.tab === 'history') {
      updateHistory();
    } else if (tab.dataset.tab === 'admin') {
      loadAdminUsers();
    }
  });
});

// ==================== Mode Toggler ====================
function toggleMode(mode) {
  if (isRunning || isPaused) {
    showToast('Cannot switch modes while timer is active!', 'warning');
    return;
  }
  currentMode = mode;
  
  // Update body theme class to swap dynamic CSS variables (accent colors)
  document.body.className = mode === 'study' ? 'mode-study' : 'mode-assignment';
  
  // Update active state of toggle buttons
  document.getElementById('mode-study-btn').classList.toggle('active', mode === 'study');
  document.getElementById('mode-assignment-btn').classList.toggle('active', mode === 'assignment');
  
  // Update inputs and placeholders
  const isStudy = mode === 'study';
  subjectInput.placeholder = isStudy ? "What are you studying?" : "What are you doing? (Assignment)";
  
  // Dashboard card descriptions
  const dbCard1Title = document.querySelector('#sec-dashboard .dashboard-card:nth-child(1) .dashboard-title');
  const dbCard1Sub = document.querySelector('#sec-dashboard .dashboard-card:nth-child(1) .dashboard-sub');
  const dbCard4Sub = document.querySelector('#sec-dashboard .dashboard-card:nth-child(4) .dashboard-sub');
  const dbCard5Sub = document.querySelector('#sec-dashboard .dashboard-card:nth-child(5) .dashboard-sub');
  const dbCard6Sub = document.querySelector('#sec-dashboard .dashboard-card:nth-child(6) .dashboard-sub');
  
  if (dbCard1Title) dbCard1Title.textContent = isStudy ? "Today's Study" : "Today's Assignment";
  if (dbCard1Sub) dbCard1Sub.innerHTML = isStudy ? '<i class="fa-solid fa-circle-dot"></i> Total studied today' : '<i class="fa-solid fa-circle-dot"></i> Total assignment time today';
  if (dbCard4Sub) dbCard4Sub.innerHTML = isStudy ? '<i class="fa-solid fa-fire"></i> Study streak status' : '<i class="fa-solid fa-fire"></i> Assignment streak status';
  if (dbCard5Sub) dbCard5Sub.textContent = isStudy ? 'Current week study time' : 'Current week assignment time';
  if (dbCard6Sub) dbCard6Sub.textContent = isStudy ? 'Current month study time' : 'Current month assignment time';
  
  // Focus Timer stats summary labels
  const timerTodayLabel = document.querySelector('#sec-timer .stats-row .stat-card:nth-child(1) .stat-label');
  const timerWeekLabel = document.querySelector('#sec-timer .stats-row .stat-card:nth-child(2) .stat-label');
  const timerAllTimeLabel = document.querySelector('#sec-timer .stats-row .stat-card:nth-child(4) .stat-label');
  
  if (timerTodayLabel) timerTodayLabel.textContent = isStudy ? "Today" : "Assignment Today";
  if (timerWeekLabel) timerWeekLabel.textContent = isStudy ? "This Week" : "Assignment Week";
  if (timerAllTimeLabel) timerAllTimeLabel.textContent = isStudy ? "All Time" : "Assignment All Time";
  
  // Destroy old charts to prevent configuration mixing
  if (studyTimeChartInstance) {
    studyTimeChartInstance.destroy();
    studyTimeChartInstance = null;
  }
  if (concentrationChartInstance) {
    concentrationChartInstance.destroy();
    concentrationChartInstance = null;
  }

  showToast(`Switched to ${isStudy ? 'Real Study' : 'Assignment'} Tracker`, 'info');
  updateAll();
}

// ==================== DB Operations & Migration ====================
async function checkDbConnection() {
  const badge = document.getElementById('dbStatusBadge');
  const text = document.getElementById('dbStatusText');
  try {
    const response = await fetch('api.php', { method: 'GET' });
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        dbOnline = true;
        badge.className = 'db-status-badge connected';
        text.textContent = 'Database: Connected';
        return true;
      }
    }
  } catch (e) {
    // API is unreachable
  }
  dbOnline = false;
  badge.className = 'db-status-badge offline';
  text.textContent = 'Database: Offline (Local)';
  return false;
}

function migrateSession(s) {
  const hasNewFields = 'start_time' in s && 'duration_seconds' in s;
  if (hasNewFields) {
    if (!('session_type' in s)) {
      s.session_type = 'study';
    }
    return s;
  }

  const duration = s.duration || 0;
  const timestamp = s.timestamp || new Date().toISOString();
  const startTime = new Date(new Date(timestamp).getTime() - duration * 1000);
  
  return {
    id: String(s.id || Date.now()),
    subject: s.subject || 'Unspecified',
    start_time: startTime.toISOString(),
    end_time: timestamp,
    duration_seconds: duration,
    duration_minutes: Math.max(1, Math.round(duration / 60)),
    concentration_level: null,
    session_type: 'study'
  };
}

async function loadSessions() {
  await checkDbConnection();

  if (dbOnline) {
    try {
      const url = (currentUser && currentUser.role === 'admin' && inspectingUserId) 
        ? `api.php?inspect_user_id=${inspectingUserId}` 
        : 'api.php';
      const response = await fetch(url);
      const data = await response.json();
      if (data.success && Array.isArray(data.sessions)) {
        sessions = data.sessions.map(s => ({
          id: String(s.id),
          subject: s.subject,
          start_time: s.start_time,
          end_time: s.end_time,
          duration_seconds: parseInt(s.duration_seconds),
          duration_minutes: parseInt(s.duration_minutes),
          concentration_level: s.concentration_level !== null ? parseInt(s.concentration_level) : null,
          session_type: s.session_type || 'study'
        }));
        
        if (!inspectingUserId) {
          localStorage.setItem('reinf_sessions', JSON.stringify(sessions));
        }
        updateAll();
        return;
      }
    } catch (e) {
      console.error('Error loading sessions from API', e);
    }
  }

  if (!inspectingUserId) {
    const localData = JSON.parse(localStorage.getItem('reinf_sessions') || '[]');
    sessions = localData.map(migrateSession);
    localStorage.setItem('reinf_sessions', JSON.stringify(sessions));
    updateAll();
  } else {
    sessions = [];
    updateAll();
  }
}

async function dbSaveSession(session) {
  if (dbOnline) {
    try {
      const payload = {
        action: 'save',
        ...session
      };
      if (currentUser && currentUser.role === 'admin' && inspectingUserId) {
        payload.inspect_user_id = inspectingUserId;
      }
      const response = await fetch('api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data.success) return true;
    } catch (e) {
      console.error('Error saving session to DB', e);
    }
  }
  return false;
}

async function dbDeleteSession(id) {
  if (dbOnline) {
    try {
      const payload = {
        action: 'delete',
        id: id
      };
      if (currentUser && currentUser.role === 'admin' && inspectingUserId) {
        payload.inspect_user_id = inspectingUserId;
      }
      const response = await fetch('api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data.success) return true;
    } catch (e) {
      console.error('Error deleting session from DB', e);
    }
  }
  return false;
}

async function dbClearAll() {
  if (dbOnline) {
    try {
      const payload = { action: 'clear', session_type: currentMode };
      if (currentUser && currentUser.role === 'admin' && inspectingUserId) {
        payload.inspect_user_id = inspectingUserId;
      }
      const response = await fetch('api.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (data.success) return true;
    } catch (e) {
      console.error('Error clearing sessions from DB', e);
    }
  }
  return false;
}

// ==================== Timer Engine ====================
const timerDisplay = document.getElementById('timerDisplay');
const timerStatus = document.getElementById('timerStatus');
const timerSection = document.getElementById('timerSection');
const btnStart = document.getElementById('btnStart');
const btnPause = document.getElementById('btnPause');
const btnStop = document.getElementById('btnStop');
const subjectInput = document.getElementById('subjectInput');

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

function formatShort(totalSeconds) {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDateMySQL(date) {
  if (!date) return null;
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function updateTimerDisplay() {
  timerDisplay.textContent = formatTime(elapsedSeconds);
}

function startTimer() {
  if (isPaused) {
    isPaused = false;
    isRunning = true;
  } else {
    elapsedSeconds = 0;
    isRunning = true;
    isPaused = false;
    sessionStartTime = new Date();
  }
  timerSection.classList.add('running');
  timerStatus.textContent = 'Focusing...';
  timerStatus.classList.add('active');
  btnStart.disabled = true;
  btnPause.disabled = false;
  btnStop.disabled = false;
  subjectInput.disabled = true;

  timerInterval = setInterval(() => {
    elapsedSeconds++;
    updateTimerDisplay();
    document.title = `${formatTime(elapsedSeconds)} - ${currentMode === 'study' ? 'Study' : 'Assignment'}`;
  }, 1000);

  showToast('Session started. Stay focused!', 'success');
  sendHeartbeat();
}

function pauseTimer() {
  if (!isRunning) return;
  isPaused = true;
  isRunning = false;
  clearInterval(timerInterval);
  timerSection.classList.remove('running');
  timerStatus.textContent = 'Paused';
  timerStatus.classList.remove('active');
  btnStart.disabled = false;
  btnStart.innerHTML = '<i class="fa-solid fa-play"></i> Resume';
  btnPause.disabled = true;

  showToast('Session paused.', 'warning');
  sendHeartbeat();
}

function stopTimer() {
  if (elapsedSeconds < 5) {
    showToast('Session too short to save (min 5s).', 'info');
    resetTimer();
    return;
  }

  clearInterval(timerInterval);
  sessionEndTime = new Date();
  
  // Show Focus Rating Modal
  openFocusModal();
}

function resetTimer() {
  clearInterval(timerInterval);
  elapsedSeconds = 0;
  isRunning = false;
  isPaused = false;
  sessionStartTime = null;
  sessionEndTime = null;
  updateTimerDisplay();
  timerSection.classList.remove('running');
  timerStatus.textContent = 'Ready to focus';
  timerStatus.classList.remove('active');
  btnStart.disabled = false;
  btnStart.innerHTML = '<i class="fa-solid fa-play"></i> Start';
  btnPause.disabled = true;
  btnStop.disabled = true;
  subjectInput.disabled = false;
  document.title = 'reinF Study Time Tracker';
  sendHeartbeat();
}

// ==================== Focus Rating Modal ====================
function openFocusModal() {
  selectedFocusLevel = null;
  document.querySelectorAll('.focus-option').forEach(opt => opt.classList.remove('selected'));
  document.getElementById('btnSaveFocus').disabled = true;
  document.getElementById('focusModal').classList.add('show');
}

function closeFocusModal() {
  document.getElementById('focusModal').classList.remove('show');
}

function selectFocusLevel(level) {
  selectedFocusLevel = level;
  document.querySelectorAll('.focus-option').forEach(opt => opt.classList.remove('selected'));
  
  const selectedOpt = document.getElementById(`focus-opt-${level}`);
  if (selectedOpt) {
    selectedOpt.classList.add('selected');
  }
  document.getElementById('btnSaveFocus').disabled = false;
}

async function saveSessionWithFocus(focusLevel) {
  closeFocusModal();
  
  const subject = subjectInput.value.trim() || 'Unspecified';
  
  const newSession = {
    id: String(Date.now()),
    subject: subject,
    start_time: formatDateMySQL(sessionStartTime),
    end_time: formatDateMySQL(sessionEndTime),
    duration_seconds: elapsedSeconds,
    duration_minutes: Math.max(1, Math.round(elapsedSeconds / 60)),
    concentration_level: focusLevel,
    session_type: currentMode
  };

  sessions.unshift(newSession);
  localStorage.setItem('reinf_sessions', JSON.stringify(sessions));
  
  const synced = await dbSaveSession(newSession);
  if (synced) {
    showToast(`Saved to Database: ${subject} — ${formatShort(elapsedSeconds)}`, 'success');
  } else {
    showToast(`Saved Locally (Offline): ${subject} — ${formatShort(elapsedSeconds)}`, 'info');
  }

  resetTimer();
  updateAll();
  sendHeartbeat();
}

function saveSessionWithFocusSelected() {
  saveSessionWithFocus(selectedFocusLevel);
}

// ==================== Dashboard Analytics ====================
function updateDashboard() {
  const now = new Date();
  const todayStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
  const activeSess = getActiveSessions();

  // Filters
  const todaySessions = activeSess.filter(s => {
    const sDate = new Date(s.start_time).toLocaleDateString('en-CA');
    return sDate === todayStr;
  });

  // Calculate Today's Time & Sessions
  let todaySec = 0;
  let focusSum = 0;
  let focusCount = 0;

  todaySessions.forEach(s => {
    todaySec += s.duration_seconds;
    if (s.concentration_level !== null) {
      focusSum += s.concentration_level;
      focusCount++;
    }
  });

  const todayHours = Math.floor(todaySec / 3600);
  const todayMins = Math.floor((todaySec % 3600) / 60);
  document.getElementById('dashTodayTime').textContent = `${todayHours}h ${String(todayMins).padStart(2, '0')}m`;
  document.getElementById('dashTodaySessions').textContent = todaySessions.length;

  const avgFocus = focusCount > 0 ? (focusSum / focusCount) : 0;
  document.getElementById('dashAvgFocus').textContent = avgFocus > 0 ? avgFocus.toFixed(1) : 'N/A';
  
  const starsContainer = document.getElementById('dashAvgFocusStars');
  if (avgFocus === 0) {
    starsContainer.textContent = 'No Ratings';
  } else {
    starsContainer.textContent = '⭐'.repeat(Math.round(avgFocus));
  }

  const streak = calculateStreak();
  document.getElementById('dashStreak').textContent = `${streak} Day${streak !== 1 ? 's' : ''}`;

  // Weekly Total (Last 7 Days)
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(now.getDate() - 7);
  let weekSec = 0;
  activeSess.forEach(s => {
    const sDate = new Date(s.start_time);
    if (sDate >= oneWeekAgo) {
      weekSec += s.duration_seconds;
    }
  });
  const weekHours = (weekSec / 3600).toFixed(1);
  document.getElementById('dashWeekTotal').textContent = `${weekHours} Hours`;

  // Monthly Total (Last 30 Days)
  const oneMonthAgo = new Date();
  oneMonthAgo.setDate(now.getDate() - 30);
  let monthSec = 0;
  activeSess.forEach(s => {
    const sDate = new Date(s.start_time);
    if (sDate >= oneMonthAgo) {
      monthSec += s.duration_seconds;
    }
  });
  const monthHours = (monthSec / 3600).toFixed(1);
  document.getElementById('dashMonthTotal').textContent = `${monthHours} Hours`;
}

function calculateStreak() {
  const activeSess = getActiveSessions();
  if (activeSess.length === 0) return 0;

  const daySet = new Set();
  activeSess.forEach(s => {
    const d = new Date(s.start_time);
    daySet.add(d.toLocaleDateString('en-CA'));
  });

  let streak = 0;
  const checkDate = new Date();
  checkDate.setHours(0, 0, 0, 0);

  const todayKey = checkDate.toLocaleDateString('en-CA');
  checkDate.setDate(checkDate.getDate() - 1);
  const yesterdayKey = checkDate.toLocaleDateString('en-CA');

  let currentKey = todayKey;
  if (!daySet.has(todayKey)) {
    if (daySet.has(yesterdayKey)) {
      currentKey = yesterdayKey;
    } else {
      return 0; // Streak broken
    }
  }

  const iterDate = new Date(currentKey);
  while (true) {
    const key = iterDate.toLocaleDateString('en-CA');
    if (daySet.has(key)) {
      streak++;
      iterDate.setDate(iterDate.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

// ==================== Analytics Line Charts ====================
function setChartMode(mode) {
  activeChartMode = mode;
  document.querySelectorAll('.chart-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`chart-btn-${mode}`).classList.add('active');
  initOrUpdateCharts();
}

function initOrUpdateCharts() {
  const now = new Date();
  let labels = [];
  let timeData = [];
  let focusData = [];
  const activeSess = getActiveSessions();

  if (activeChartMode === 'daily') {
    labels = ["12AM", "2AM", "4AM", "6AM", "8AM", "10AM", "12PM", "2PM", "4PM", "6PM", "8PM", "10PM"];
    timeData = new Array(12).fill(0);
    const focusSum = new Array(12).fill(0);
    const focusCount = new Array(12).fill(0);

    const todayStr = now.toLocaleDateString('en-CA');
    activeSess.forEach(s => {
      const sDate = new Date(s.start_time);
      if (sDate.toLocaleDateString('en-CA') === todayStr) {
        const hour = sDate.getHours();
        const index = Math.floor(hour / 2);
        
        timeData[index] += s.duration_minutes;
        if (s.concentration_level !== null) {
          focusSum[index] += s.concentration_level;
          focusCount[index]++;
        }
      }
    });

    focusData = focusCount.map((count, i) => count > 0 ? parseFloat((focusSum[i] / count).toFixed(2)) : null);

  } else if (activeChartMode === 'weekly') {
    labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    timeData = new Array(7).fill(0);
    const focusSum = new Array(7).fill(0);
    const focusCount = new Array(7).fill(0);

    const currentMonday = new Date(now);
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    currentMonday.setDate(diff);
    currentMonday.setHours(0,0,0,0);

    activeSess.forEach(s => {
      const sDate = new Date(s.start_time);
      if (sDate >= currentMonday) {
        const dayOfWeek = (sDate.getDay() + 6) % 7;
        timeData[dayOfWeek] += s.duration_minutes / 60.0;
        if (s.concentration_level !== null) {
          focusSum[dayOfWeek] += s.concentration_level;
          focusCount[dayOfWeek]++;
        }
      }
    });

    timeData = timeData.map(val => parseFloat(val.toFixed(1)));
    focusData = focusCount.map((count, i) => count > 0 ? parseFloat((focusSum[i] / count).toFixed(2)) : null);

  } else if (activeChartMode === 'monthly') {
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    labels = Array.from({ length: daysInMonth }, (_, i) => String(i + 1));
    timeData = new Array(daysInMonth).fill(0);
    const focusSum = new Array(daysInMonth).fill(0);
    const focusCount = new Array(daysInMonth).fill(0);

    activeSess.forEach(s => {
      const sDate = new Date(s.start_time);
      if (sDate.getFullYear() === now.getFullYear() && sDate.getMonth() === now.getMonth()) {
        const dateIndex = sDate.getDate() - 1;
        timeData[dateIndex] += s.duration_minutes / 60.0;
        if (s.concentration_level !== null) {
          focusSum[dateIndex] += s.concentration_level;
          focusCount[dateIndex]++;
        }
      }
    });

    timeData = timeData.map(val => parseFloat(val.toFixed(1)));
    focusData = focusCount.map((count, i) => count > 0 ? parseFloat((focusSum[i] / count).toFixed(2)) : null);
  }

  // Study Time Chart accent configurations
  const accentColor = currentMode === 'study' ? '#e8a83e' : '#5ab8e8';
  const accentDimColor = currentMode === 'study' ? 'rgba(232, 168, 62, 0.1)' : 'rgba(90, 184, 232, 0.1)';

  // Time Chart
  const timeCtx = document.getElementById('studyTimeChart').getContext('2d');
  if (studyTimeChartInstance) {
    studyTimeChartInstance.data.labels = labels;
    studyTimeChartInstance.data.datasets[0].data = timeData;
    studyTimeChartInstance.data.datasets[0].label = activeChartMode === 'daily' ? 'Minutes Tracked' : 'Hours Tracked';
    studyTimeChartInstance.data.datasets[0].borderColor = accentColor;
    studyTimeChartInstance.data.datasets[0].backgroundColor = accentDimColor;
    studyTimeChartInstance.data.datasets[0].pointBackgroundColor = accentColor;
    studyTimeChartInstance.update();
  } else {
    studyTimeChartInstance = new Chart(timeCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: activeChartMode === 'daily' ? 'Minutes Tracked' : 'Hours Tracked',
          data: timeData,
          borderColor: accentColor,
          backgroundColor: accentDimColor,
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointBackgroundColor: accentColor
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: '#2a2b36' },
            ticks: { color: '#8a8997', font: { family: 'Space Grotesk' } }
          },
          y: {
            grid: { color: '#2a2b36' },
            ticks: { color: '#8a8997', font: { family: 'Space Grotesk' } },
            beginAtZero: true
          }
        }
      }
    });
  }

  // Concentration Focus Chart
  const focusCtx = document.getElementById('concentrationChart').getContext('2d');
  if (concentrationChartInstance) {
    concentrationChartInstance.data.labels = labels;
    concentrationChartInstance.data.datasets[0].data = focusData;
    concentrationChartInstance.update();
  } else {
    concentrationChartInstance = new Chart(focusCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Avg Focus Rating (1-3)',
          data: focusData,
          borderColor: '#5ab8e8',
          backgroundColor: 'rgba(90, 184, 232, 0.1)',
          fill: true,
          tension: 0.35,
          borderWidth: 2,
          pointBackgroundColor: '#5ab8e8',
          spanGaps: true
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            grid: { color: '#2a2b36' },
            ticks: { color: '#8a8997', font: { family: 'Space Grotesk' } }
          },
          y: {
            grid: { color: '#2a2b36' },
            ticks: { color: '#8a8997', font: { family: 'Space Grotesk' }, stepSize: 1 },
            min: 1,
            max: 3
          }
        }
      }
    });
  }
}

// ==================== Calendar View Renderer ====================
const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

function renderCalendar() {
  const calendarGrid = document.getElementById('calendarGrid');
  const monthYearLabel = document.getElementById('calendarMonthYear');
  const activeSess = getActiveSessions();
  
  calendarGrid.innerHTML = '';
  
  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();
  
  monthYearLabel.textContent = `${months[month]} ${year}`;
  
  const firstDay = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  
  for (let i = 0; i < firstDay; i++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day empty';
    calendarGrid.appendChild(cell);
  }
  
  const today = new Date();
  
  for (let dayNum = 1; dayNum <= totalDays; dayNum++) {
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    
    if (today.getDate() === dayNum && today.getMonth() === month && today.getFullYear() === year) {
      cell.classList.add('today');
    }
    
    if (selectedCalendarDate.getDate() === dayNum && selectedCalendarDate.getMonth() === month && selectedCalendarDate.getFullYear() === year) {
      cell.classList.add('active-select');
    }

    const numSpan = document.createElement('span');
    numSpan.className = 'calendar-day-num';
    numSpan.textContent = dayNum;
    cell.appendChild(numSpan);
    
    const dayDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const daySessions = activeSess.filter(s => {
      const sDateStr = new Date(s.start_time).toLocaleDateString('en-CA');
      return sDateStr === dayDateStr;
    });
    
    if (daySessions.length > 0) {
      let totalSec = daySessions.reduce((acc, s) => acc + s.duration_seconds, 0);
      const infoDiv = document.createElement('div');
      infoDiv.className = 'calendar-day-info';
      infoDiv.textContent = `✓ ${formatShort(totalSec)}`;
      cell.appendChild(infoDiv);
    }
    
    cell.addEventListener('click', () => {
      document.querySelectorAll('.calendar-day').forEach(c => c.classList.remove('active-select'));
      cell.classList.add('active-select');
      selectedCalendarDate = new Date(year, month, dayNum);
      showDayDetails(dayDateStr, daySessions);
    });
    
    calendarGrid.appendChild(cell);
  }
  
  const activeDateStr = `${selectedCalendarDate.getFullYear()}-${String(selectedCalendarDate.getMonth() + 1).padStart(2, '0')}-${String(selectedCalendarDate.getDate()).padStart(2, '0')}`;
  const currentMonthSelected = selectedCalendarDate.getMonth() === month && selectedCalendarDate.getFullYear() === year;
  
  if (currentMonthSelected) {
    const daySessions = activeSess.filter(s => {
      const sDateStr = new Date(s.start_time).toLocaleDateString('en-CA');
      return sDateStr === activeDateStr;
    });
    showDayDetails(activeDateStr, daySessions);
  } else {
    document.getElementById('dayDetailsPanel').style.display = 'none';
  }
}

function changeMonth(direction) {
  currentCalendarDate.setMonth(currentCalendarDate.getMonth() + direction);
  renderCalendar();
}

function showDayDetails(dateStr, daySessions) {
  const panel = document.getElementById('dayDetailsPanel');
  const dateText = document.getElementById('selectedDateText');
  const dateTotal = document.getElementById('selectedDateTotal');
  const sessionsTimeline = document.getElementById('selectedDateSessions');
  
  panel.style.display = 'block';
  
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const dateObj = new Date(dateStr + 'T00:00:00');
  dateText.textContent = dateObj.toLocaleDateString(undefined, options);
  
  if (daySessions.length === 0) {
    dateTotal.textContent = 'No records';
    dateTotal.style.background = 'rgba(232, 84, 84, 0.1)';
    dateTotal.style.color = 'var(--danger)';
    dateTotal.style.borderColor = 'rgba(232, 84, 84, 0.2)';
    
    sessionsTimeline.innerHTML = `
      <div class="empty-state" style="padding: 20px 0;">
        <i class="fa-solid fa-calendar-xmark" style="font-size: 24px; opacity: 0.4;"></i>
        <p style="font-size: 12px; margin-top: 6px;">No sessions recorded on this day.</p>
      </div>`;
    return;
  }
  
  let totalSec = daySessions.reduce((acc, s) => acc + s.duration_seconds, 0);
  dateTotal.textContent = `✓ ${formatShort(totalSec)} tracked`;
  dateTotal.style.background = 'rgba(78, 203, 113, 0.08)';
  dateTotal.style.color = 'var(--success)';
  dateTotal.style.borderColor = 'rgba(78, 203, 113, 0.2)';
  
  const sortedSessions = [...daySessions].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  
  sessionsTimeline.innerHTML = sortedSessions.map(s => {
    const start = new Date(s.start_time);
    const end = new Date(s.end_time);
    const startStr = start.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endStr = end.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    let focusHTML = '';
    if (s.concentration_level !== null) {
      focusHTML = `<div class="timeline-session-focus">${'⭐'.repeat(s.concentration_level)}</div>`;
    } else {
      focusHTML = `<div class="timeline-session-focus" style="color: var(--fg-muted);">No rating</div>`;
    }
    
    return `
      <div class="timeline-session-item">
        <div class="timeline-session-dot" style="background: ${getSubjectColor(s.subject)}"></div>
        <div class="timeline-session-content">
          <div class="timeline-session-left">
            <h4>${escapeHtml(s.subject)}</h4>
            <p>${startStr} – ${endStr}</p>
            ${focusHTML}
          </div>
          <div class="timeline-session-right">
            <div class="timeline-session-duration">${formatShort(s.duration_seconds)}</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ==================== History Tab Renderer ====================
function updateHistory() {
  renderSessionList();
  renderBreakdown();
  renderWeeklyChart();
}

function renderSessionList() {
  const list = document.getElementById('sessionList');
  const count = document.getElementById('sessionCount');
  const activeSess = getActiveSessions();
  count.textContent = activeSess.length;

  if (activeSess.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-book-open"></i>
        <p>No study sessions yet.<br>Start your first session above.</p>
      </div>`;
    return;
  }

  list.innerHTML = activeSess.map(s => {
    const date = new Date(s.start_time);
    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    const color = getSubjectColor(s.subject);
    
    let stars = '';
    if (s.concentration_level !== null) {
      stars = `<span class="session-focus-stars">${'⭐'.repeat(s.concentration_level)}</span>`;
    }

    return `
      <div class="session-item" data-id="${s.id}">
        <div class="session-left">
          <div class="session-dot" style="background: ${color}"></div>
          <div class="session-info">
            <div class="session-subject">${escapeHtml(s.subject)}</div>
            <div class="session-time-label">${dateStr} at ${timeStr}</div>
          </div>
        </div>
        <div class="session-right">
          <div class="session-duration">${formatShort(s.duration_seconds)}</div>
          ${stars}
          <button class="session-delete" onclick="deleteSession('${s.id}')" aria-label="Delete session">
            <i class="fa-solid fa-xmark"></i> remove
          </button>
        </div>
      </div>`;
  }).join('');
}

async function deleteSession(id) {
  sessions = sessions.filter(s => s.id !== id);
  localStorage.setItem('reinf_sessions', JSON.stringify(sessions));
  await dbDeleteSession(id);
  updateAll();
  showToast('Session removed.', 'info');
}

function renderBreakdown() {
  const list = document.getElementById('breakdownList');
  const activeSess = getActiveSessions();
  if (activeSess.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-chart-pie"></i>
        <p>Study data will appear<br>here after your first session.</p>
      </div>`;
    return;
  }

  const map = {};
  activeSess.forEach(s => {
    const key = s.subject;
    if (!map[key]) map[key] = { total: 0, color: getSubjectColor(s.subject) };
    map[key].total += s.duration_seconds;
  });

  const sorted = Object.entries(map).sort((a, b) => b[1].total - a[1].total);
  const maxTime = sorted[0][1].total;

  list.innerHTML = sorted.map(([name, data]) => {
    const pct = Math.max(5, (data.total / maxTime) * 100);
    return `
      <div class="breakdown-item">
        <div class="breakdown-header">
          <span class="breakdown-name">
            <span class="dot" style="background: ${data.color}"></span>
            ${escapeHtml(name)}
          </span>
          <span class="breakdown-time">${formatShort(data.total)}</span>
        </div>
        <div class="breakdown-bar">
          <div class="breakdown-fill" style="width: ${pct}%; background: ${data.color}"></div>
        </div>
      </div>`;
  }).join('');
}

function renderWeeklyChart() {
  const chart = document.getElementById('weeklyChart');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const activeSess = getActiveSessions();

  const weekData = new Array(7).fill(0);
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - dayOfWeek);
  startOfWeek.setHours(0, 0, 0, 0);

  activeSess.forEach(s => {
    const d = new Date(s.start_time);
    if (d >= startOfWeek) {
      weekData[d.getDay()] += s.duration_seconds;
    }
  });

  const maxVal = Math.max(1, ...weekData);
  const accentColor = currentMode === 'study' ? 'var(--accent)' : 'var(--accent)';

  chart.innerHTML = weekData.map((sec, i) => {
    const h = Math.max(2, (sec / maxVal) * 72);
    const isToday = i === dayOfWeek;
    const fill = sec > 0
      ? `background: ${isToday ? accentColor : 'var(--accent-dim)'}; border: 1px solid var(--accent)`
      : `background: var(--border); opacity: 0.3`;
    return `
      <div class="chart-col ${isToday ? 'today' : ''}">
        <div class="chart-bar-bg">
          <div class="chart-bar-fill" style="height: ${h}px; ${fill}"></div>
        </div>
        <span class="chart-label">${days[i]}</span>
      </div>`;
  }).join('');
}

// ==================== Subject Quick Tags ====================
function renderSubjectTags() {
  const tags = document.getElementById('subjectTags');
  const activeSess = getActiveSessions();
  const subjects = [...new Set(activeSess.map(s => s.subject).filter(Boolean))];
  if (subjects.length === 0) {
    tags.innerHTML = '';
    return;
  }
  tags.innerHTML = subjects.slice(0, 6).map(s =>
    `<span class="subject-tag" onclick="pickSubject('${s.replace(/'/g, "\\'")}')">${s}</span>`
  ).join('');
}

function pickSubject(name) {
  if (inspectingUserId) return;
  subjectInput.value = name;
  subjectInput.focus();
}

// ==================== Stats Summary Engine ====================
function updateStatsSummary() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const activeSess = getActiveSessions();

  const dayOfWeek = now.getDay();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - dayOfWeek);
  weekStart.setHours(0, 0, 0, 0);

  let todaySec = 0, todayCount = 0;
  let weekSec = 0, weekCount = 0;
  let allSec = 0;

  activeSess.forEach(s => {
    const d = new Date(s.start_time);
    allSec += s.duration_seconds;
    if (d >= todayStart) { todaySec += s.duration_seconds; todayCount++; }
    if (d >= weekStart) { weekSec += s.duration_seconds; weekCount++; }
  });

  document.getElementById('statToday').textContent = formatShort(todaySec);
  document.getElementById('statTodaySessions').textContent = `${todayCount} block${todayCount !== 1 ? 's' : ''}`;
  document.getElementById('statWeek').textContent = formatShort(weekSec);
  document.getElementById('statWeekSessions').textContent = `${weekCount} block${weekCount !== 1 ? 's' : ''}`;
  document.getElementById('statAllTime').textContent = formatShort(allSec);
  document.getElementById('statAllTimeSessions').textContent = `${activeSess.length} block${activeSess.length !== 1 ? 's' : ''}`;

  const streak = calculateStreak();
  document.getElementById('statStreak').textContent = streak;
}

// ==================== Common Updates Trigger ====================
function updateAll() {
  updateStatsSummary();
  renderSubjectTags();
  
  const activeTab = document.querySelector('.nav-tab.active').dataset.tab;
  if (activeTab === 'dashboard') {
    updateDashboard();
  } else if (activeTab === 'analytics') {
    initOrUpdateCharts();
  } else if (activeTab === 'calendar') {
    renderCalendar();
  } else if (activeTab === 'history') {
    updateHistory();
  }
}

// ==================== Export ====================
function exportData() {
  const activeSess = getActiveSessions();
  if (activeSess.length === 0) {
    showToast('No data to export.', 'info');
    return;
  }
  const csv = 'Subject,Start Time,End Time,Duration (seconds),Duration (minutes),Concentration Level (1-3),Session Type\n' +
    activeSess.map(s => {
      const level = s.concentration_level !== null ? s.concentration_level : '';
      const type = s.session_type || 'study';
      return `"${s.subject}","${s.start_time}","${s.end_time}",${s.duration_seconds},${s.duration_minutes},"${level}","${type}"`;
    }).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${currentMode}_analytics_data_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Data exported as CSV.', 'success');
}

// ==================== Clear Modal Operations ====================
function openClearModal() {
  const activeSess = getActiveSessions();
  if (activeSess.length === 0) {
    showToast('No sessions to clear in this mode.', 'info');
    return;
  }
  document.getElementById('clearModal').classList.add('show');
}
function closeClearModal() {
  document.getElementById('clearModal').classList.remove('show');
}
async function confirmClearAll() {
  // Clear only active mode sessions from local cache
  sessions = sessions.filter(s => (s.session_type || 'study') !== currentMode);
  localStorage.setItem('reinf_sessions', JSON.stringify(sessions));
  
  await dbClearAll();
  closeClearModal();
  resetTimer();
  updateAll();
  showToast(`All ${currentMode === 'study' ? 'study' : 'assignment'} sessions cleared.`, 'info');
}

// ==================== Toast Alerts ====================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const icons = {
    success: 'fa-circle-check',
    info: 'fa-circle-info',
    warning: 'fa-triangle-exclamation'
  };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i> ${escapeHtml(message)}`;
  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 3200);
}

// ==================== HTML Escape Utility ====================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== Keyboard Shortcuts ====================
document.addEventListener('keydown', (e) => {
  if (inspectingUserId) return;
  
  if (e.target === subjectInput) {
    if (e.key === 'Enter' && !isRunning && !isPaused) {
      startTimer();
    }
    return;
  }
  
  if (document.getElementById('focusModal').classList.contains('show') ||
      document.getElementById('clearModal').classList.contains('show')) {
    return;
  }

  if (e.code === 'Space') {
    e.preventDefault();
    if (!isRunning && !isPaused) startTimer();
    else if (isRunning) pauseTimer();
    else if (isPaused) startTimer();
  }
  if (e.code === 'Escape' && (isRunning || isPaused)) {
    stopTimer();
  }
});

// ==================== Authentication UI & Logic ====================
function toggleAuthTab(tab) {
  currentAuthTab = tab;
  document.getElementById('auth-tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('auth-tab-register').classList.toggle('active', tab === 'register');
  
  const submitBtn = document.getElementById('btnAuthSubmit');
  if (tab === 'login') {
    submitBtn.innerHTML = 'Login <i class="fa-solid fa-right-from-bracket"></i>';
  } else {
    submitBtn.innerHTML = 'Register <i class="fa-solid fa-user-plus"></i>';
  }
  document.getElementById('authErrorMsg').textContent = '';
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('authUsername');
  const passwordInput = document.getElementById('authPassword');
  const errorMsg = document.getElementById('authErrorMsg');
  
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  
  if (!username || !password) {
    errorMsg.textContent = 'Please fill in all fields';
    return;
  }
  
  const submitBtn = document.getElementById('btnAuthSubmit');
  submitBtn.disabled = true;
  
  try {
    const response = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: currentAuthTab,
        username: username,
        password: password
      })
    });
    
    const data = await response.json();
    if (data.success && data.user) {
      currentUser = data.user;
      
      // Update UI
      document.getElementById('authOverlay').style.display = 'none';
      
      const badge = document.getElementById('userBadge');
      badge.style.display = 'flex';
      badge.dataset.role = currentUser.role;
      document.getElementById('userBadgeName').textContent = currentUser.username;
      document.getElementById('userBadgeRole').textContent = currentUser.role;
      
      // Show/hide admin tab
      const adminTab = document.getElementById('nav-tab-admin');
      if (currentUser.role === 'admin') {
        adminTab.style.display = 'inline-block';
      } else {
        adminTab.style.display = 'none';
      }
      
      showToast(currentAuthTab === 'login' ? 'Logged in successfully' : 'Account registered successfully', 'success');
      
      // Clear forms
      usernameInput.value = '';
      passwordInput.value = '';
      errorMsg.textContent = '';
      
      await loadSessions();
      if (!heartbeatInterval) heartbeatInterval = setInterval(sendHeartbeat, 10000);
      sendHeartbeat();
    } else {
      errorMsg.textContent = data.error || 'Authentication failed';
    }
  } catch (err) {
    console.error(err);
    errorMsg.textContent = 'Network error occurred. Please try again.';
  } finally {
    submitBtn.disabled = false;
  }
}

async function logout() {
  // If timer is running, stop it
  if (isRunning || isPaused) {
    stopTimer();
  }
  
  try {
    await fetch('api.php?action=logout');
  } catch (e) {
    console.error('Logout request failed', e);
  }
  
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  if (inspectInterval) {
    clearInterval(inspectInterval);
    inspectInterval = null;
  }
  if (inspectClockTickInterval) {
    clearInterval(inspectClockTickInterval);
    inspectClockTickInterval = null;
  }

  // Clear local storage and state
  localStorage.removeItem('reinf_sessions');
  sessions = [];
  currentUser = null;
  inspectingUserId = null;
  
  // Reset tabs to default (Focus Timer tab active)
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === 'timer');
  });
  document.querySelectorAll('.page-section').forEach(s => {
    s.classList.toggle('active', s.id === 'sec-timer');
  });
  
  showAuthOverlay();
  showToast('Logged out successfully', 'info');
}

function showAuthOverlay() {
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('userBadge').style.display = 'none';
  document.getElementById('nav-tab-admin').style.display = 'none';
  document.getElementById('inspectBanner').style.display = 'none';
  
  document.getElementById('authUsername').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authErrorMsg').textContent = '';
  
  toggleAuthTab('login');
}

async function checkAuthAndLoad() {
  try {
    const response = await fetch('api.php?action=me');
    if (response.ok) {
      const data = await response.json();
      if (data.success && data.user) {
        currentUser = data.user;
        
        document.getElementById('authOverlay').style.display = 'none';
        
        const badge = document.getElementById('userBadge');
        badge.style.display = 'flex';
        badge.dataset.role = currentUser.role;
        document.getElementById('userBadgeName').textContent = currentUser.username;
        document.getElementById('userBadgeRole').textContent = currentUser.role;
        
        const adminTab = document.getElementById('nav-tab-admin');
        if (currentUser.role === 'admin') {
          adminTab.style.display = 'inline-block';
        } else {
          adminTab.style.display = 'none';
        }
        
        await loadSessions();
        if (!heartbeatInterval) heartbeatInterval = setInterval(sendHeartbeat, 10000);
        sendHeartbeat();
        return;
      }
    }
  } catch (e) {
    console.error('Auth check error', e);
  }
  showAuthOverlay();
}

// ==================== Admin Panel Actions ====================
async function loadAdminUsers() {
  if (!currentUser || currentUser.role !== 'admin') return;
  
  try {
    const response = await fetch('api.php?action=admin_users');
    const data = await response.json();
    if (data.success && Array.isArray(data.users)) {
      document.getElementById('adminUserCount').textContent = data.users.length;
      
      const tbody = document.getElementById('adminUserList');
      if (data.users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--fg-muted);">No users found</td></tr>';
        return;
      }
      
      tbody.innerHTML = data.users.map(u => {
        const durationStr = formatShort(parseInt(u.total_duration));
        const createdDate = new Date(u.created_at).toLocaleDateString();
        const roleLabel = u.role === 'admin' 
          ? `<span class="user-role-tag" style="background:rgba(78,203,113,0.15); color:var(--success);">Admin</span>` 
          : `<span class="user-role-tag">User</span>`;
          
        // Status Pill and activity description
        let statusPill = '';
        let currentActivity = '';
        
        if (!u.is_online) {
          statusPill = `<span class="status-pill"><span class="live-pulse-dot offline"></span> Offline</span>`;
        } else {
          if (u.timer_status === 'focusing') {
            statusPill = `<span class="status-pill focusing"><span class="live-pulse-dot focusing"></span> Focusing</span>`;
            currentActivity = `<span class="user-status-text"><i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(u.timer_subject || 'Unspecified')}</span>`;
          } else if (u.timer_status === 'paused') {
            statusPill = `<span class="status-pill paused"><span class="live-pulse-dot paused"></span> Paused</span>`;
            currentActivity = `<span class="user-status-text"><i class="fa-solid fa-pause"></i> ${escapeHtml(u.timer_subject || 'Unspecified')}</span>`;
          } else {
            statusPill = `<span class="status-pill online"><span class="live-pulse-dot online"></span> Online</span>`;
            currentActivity = `<span class="user-status-text">Idle</span>`;
          }
        }
          
        return `
          <tr>
            <td><strong>${escapeHtml(u.username)}</strong></td>
            <td>
              ${statusPill}
              ${currentActivity}
            </td>
            <td>${roleLabel}</td>
            <td>${u.total_sessions}</td>
            <td>${durationStr}</td>
            <td>${createdDate}</td>
            <td>
              <div class="admin-action-group">
                <button class="btn btn-primary btn-sm" onclick="inspectUserDashboard(${u.id}, '${escapeHtml(u.username)}')">
                  <i class="fa-solid fa-eye"></i> Inspect
                </button>
                <button class="btn btn-secondary btn-sm" onclick="openEditUserModal(${u.id}, '${escapeHtml(u.username)}', '${u.role}')">
                  <i class="fa-solid fa-user-pen"></i> Edit
                </button>
                <button class="btn btn-danger btn-sm" onclick="openDeleteUserModal(${u.id}, '${escapeHtml(u.username)}')" ${u.id == currentUser.id ? 'disabled' : ''}>
                  <i class="fa-solid fa-trash"></i> Delete
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    } else {
      showToast(data.error || 'Failed to load user list', 'warning');
    }
  } catch (e) {
    console.error('Error loading users', e);
    showToast('Failed to connect to user management database', 'warning');
  }
}

// Add User Modal
function openAddUserModal() {
  document.getElementById('newUsername').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('newRole').value = 'user';
  document.getElementById('addUserError').textContent = '';
  document.getElementById('addUserModal').classList.add('show');
}
function closeAddUserModal() {
  document.getElementById('addUserModal').classList.remove('show');
}
async function handleAdminCreateUser(e) {
  e.preventDefault();
  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = document.getElementById('newRole').value;
  const errorDiv = document.getElementById('addUserError');
  
  if (!username || !password) {
    errorDiv.textContent = 'Username and password are required';
    return;
  }
  
  try {
    const response = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'admin_create_user',
        username: username,
        password: password,
        role: role
      })
    });
    const data = await response.json();
    if (data.success) {
      closeAddUserModal();
      showToast(`User "${username}" created successfully`, 'success');
      loadAdminUsers();
    } else {
      errorDiv.textContent = data.error || 'Failed to create user';
    }
  } catch (err) {
    errorDiv.textContent = 'Network error occurred';
  }
}

// Edit User Modal
function openEditUserModal(id, username, role) {
  document.getElementById('editUserId').value = id;
  document.getElementById('editUsername').value = username;
  document.getElementById('editPassword').value = '';
  document.getElementById('editRole').value = role;
  document.getElementById('editUserError').textContent = '';
  document.getElementById('editUserModal').classList.add('show');
}
function closeEditUserModal() {
  document.getElementById('editUserModal').classList.remove('show');
}
async function handleAdminEditUser(e) {
  e.preventDefault();
  const userId = document.getElementById('editUserId').value;
  const username = document.getElementById('editUsername').value.trim();
  const password = document.getElementById('editPassword').value;
  const role = document.getElementById('editRole').value;
  const errorDiv = document.getElementById('editUserError');
  
  try {
    const response = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'admin_update_user',
        user_id: userId,
        username: username,
        password: password,
        role: role
      })
    });
    const data = await response.json();
    if (data.success) {
      closeEditUserModal();
      showToast('User updated successfully', 'success');
      
      // If admin edited themselves, check profile/auth updates
      if (parseInt(userId) === parseInt(currentUser.id)) {
        checkAuthAndLoad();
      }
      
      loadAdminUsers();
    } else {
      errorDiv.textContent = data.error || 'Failed to update user';
    }
  } catch (err) {
    errorDiv.textContent = 'Network error occurred';
  }
}

// Delete User Modal
function openDeleteUserModal(id, username) {
  document.getElementById('deleteUserId').value = id;
  document.getElementById('deleteUserDisplay').textContent = username;
  document.getElementById('deleteUserModal').classList.add('show');
}
function closeDeleteUserModal() {
  document.getElementById('deleteUserModal').classList.remove('show');
}
async function confirmDeleteUser() {
  const userId = document.getElementById('deleteUserId').value;
  try {
    const response = await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'admin_delete_user',
        user_id: userId
      })
    });
    const data = await response.json();
    if (data.success) {
      closeDeleteUserModal();
      showToast('User account deleted', 'info');
      
      // If we were inspecting that user, stop inspecting
      if (parseInt(userId) === parseInt(inspectingUserId)) {
        stopInspecting();
      }
      
      loadAdminUsers();
    } else {
      showToast(data.error || 'Failed to delete user', 'warning');
    }
  } catch (err) {
    showToast('Network error occurred', 'warning');
  }
}

// Inspection Logic
function inspectUserDashboard(id, username) {
  inspectingUserId = id;
  
  // Reset live status display initially
  document.getElementById('inspectLivePulse').className = 'live-pulse-dot';
  document.getElementById('inspectLiveStatusText').textContent = 'Checking live status...';
  
  // Show Inspect banner
  const banner = document.getElementById('inspectBanner');
  document.getElementById('inspectUserName').textContent = username;
  banner.style.display = 'flex';
  
  // Switch tab to Focus Timer / Dashboard
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === 'dashboard');
  });
  document.querySelectorAll('.page-section').forEach(s => {
    s.classList.toggle('active', s.id === 'sec-dashboard');
  });
  
  showToast(`Viewing dashboard of "${username}"`, 'info');
  
  // Reload sessions for the inspected user and update view
  loadSessions();
  
  // Start live status polling
  if (inspectInterval) clearInterval(inspectInterval);
  inspectInterval = setInterval(fetchInspectedUserTimerStatus, 3000);
  fetchInspectedUserTimerStatus();
}

function stopInspecting() {
  inspectingUserId = null;
  document.getElementById('inspectBanner').style.display = 'none';
  
  if (inspectInterval) {
    clearInterval(inspectInterval);
    inspectInterval = null;
  }
  if (inspectClockTickInterval) {
    clearInterval(inspectClockTickInterval);
    inspectClockTickInterval = null;
  }
  
  // Switch back to Admin Panel
  document.querySelectorAll('.nav-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === 'admin');
  });
  document.querySelectorAll('.page-section').forEach(s => {
    s.classList.toggle('active', s.id === 'sec-admin');
  });
  
  showToast('Returned to Admin Panel', 'info');
  
  // Reset and re-enable timer display controls
  resetTimer();
  document.getElementById('subjectInput').value = '';
  
  // Reload admin's own sessions
  loadSessions();
  loadAdminUsers();
}

// ==================== Live Heartbeat & Inspection Polling ====================
async function sendHeartbeat() {
  if (!currentUser || !dbOnline) return;
  
  let status = 'idle';
  if (isRunning) status = 'focusing';
  else if (isPaused) status = 'paused';
  
  const subjectVal = document.getElementById('subjectInput').value.trim() || '';
  const startedAt = (status === 'focusing' || status === 'paused') && sessionStartTime
    ? formatDateMySQL(sessionStartTime)
    : null;
    
  try {
    await fetch('api.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'heartbeat',
        timer_status: status,
        timer_subject: subjectVal,
        timer_started_at: startedAt
      })
    });
  } catch (e) {
    console.error('Heartbeat failed', e);
  }
}

function disableTimerControlsForAdmin() {
  document.getElementById('btnStart').disabled = true;
  document.getElementById('btnPause').disabled = true;
  document.getElementById('btnStop').disabled = true;
  document.getElementById('subjectInput').disabled = true;
}

async function fetchInspectedUserTimerStatus() {
  if (!inspectingUserId || !currentUser || currentUser.role !== 'admin') return;
  
  const pulseDot = document.getElementById('inspectLivePulse');
  const statusText = document.getElementById('inspectLiveStatusText');
  
  try {
    const response = await fetch(`api.php?action=user_timer_status&user_id=${inspectingUserId}`);
    const data = await response.json();
    if (data.success && data.user_timer) {
      const u = data.user_timer;
      
      // Reset classes
      pulseDot.className = 'live-pulse-dot';
      
      // Force disable controls during active inspection
      disableTimerControlsForAdmin();
      
      if (!u.is_online) {
        pulseDot.classList.add('offline');
        statusText.textContent = 'Status: Offline';
        
        if (inspectClockTickInterval) {
          clearInterval(inspectClockTickInterval);
          inspectClockTickInterval = null;
        }
        
        if (document.getElementById('sec-timer').classList.contains('active')) {
          document.getElementById('timerDisplay').textContent = '00:00:00';
          document.getElementById('timerStatus').textContent = 'User is offline';
          document.getElementById('subjectInput').value = '';
        }
      } else {
        if (u.timer_status === 'focusing') {
          pulseDot.classList.add('focusing');
          
          if (u.timer_subject) {
            document.getElementById('subjectInput').value = u.timer_subject;
          }
          
          const startTimeStr = u.timer_started_at;
          const updateClock = () => {
            let diffSec = 0;
            if (startTimeStr) {
              const start = new Date(startTimeStr.replace(/-/g, '/'));
              diffSec = Math.max(0, Math.floor((new Date() - start) / 1000));
            }
            const timeStr = formatTime(diffSec);
            statusText.innerHTML = `<i class="fa-solid fa-graduation-cap"></i> Status: Live Focusing on "${escapeHtml(u.timer_subject || 'Unspecified')}" (${timeStr})`;
            
            if (document.getElementById('sec-timer').classList.contains('active')) {
              document.getElementById('timerDisplay').textContent = timeStr;
              document.getElementById('timerStatus').textContent = `User is focusing on: ${escapeHtml(u.timer_subject || 'Unspecified')}`;
            }
          };
          
          updateClock();
          if (inspectClockTickInterval) clearInterval(inspectClockTickInterval);
          inspectClockTickInterval = setInterval(updateClock, 1000);
          
        } else if (u.timer_status === 'paused') {
          pulseDot.classList.add('paused');
          statusText.textContent = `Status: Paused on "${escapeHtml(u.timer_subject || 'Unspecified')}"`;
          
          if (u.timer_subject) {
            document.getElementById('subjectInput').value = u.timer_subject;
          }
          
          if (inspectClockTickInterval) {
            clearInterval(inspectClockTickInterval);
            inspectClockTickInterval = null;
          }
          
          if (document.getElementById('sec-timer').classList.contains('active')) {
            document.getElementById('timerStatus').textContent = `Focus paused on: ${escapeHtml(u.timer_subject || 'Unspecified')}`;
          }
        } else {
          pulseDot.classList.add('online');
          statusText.textContent = 'Status: Online (Idle)';
          
          document.getElementById('subjectInput').value = '';
          
          if (inspectClockTickInterval) {
            clearInterval(inspectClockTickInterval);
            inspectClockTickInterval = null;
          }
          
          if (document.getElementById('sec-timer').classList.contains('active')) {
            document.getElementById('timerDisplay').textContent = '00:00:00';
            document.getElementById('timerStatus').textContent = 'User is idle';
          }
        }
      }
    }
  } catch (e) {
    console.error('Error fetching live status', e);
  }
}

// ==================== Init ====================
window.addEventListener('load', () => {
  // Initialize with Study mode accent variables
  document.body.className = 'mode-study';
  checkAuthAndLoad();
  setInterval(checkDbConnection, 10000);
});
