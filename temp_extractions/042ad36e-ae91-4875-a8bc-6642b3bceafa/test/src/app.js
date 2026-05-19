/**
 * EcoSphere Dashboard - Main Client Script
 * © 2026 Terratech Solutions
 */

// Global state
const AppState = {
  currentPage: 1,
  pageSize: 10,
  serversData: [],
  notificationsEnabled: false
};

// DOM ready
document.addEventListener('DOMContentLoaded', () => {
  console.log("EcoSphere Dashboard initialisé.");
  initDashboard();
});

function initDashboard() {
  loadServerMetrics(AppState.currentPage);
  
  // Set up standard pagination buttons (conforming to RGESN Uxui2 - no infinite scroll!)
  const prevBtn = document.getElementById('prevPageBtn');
  const nextBtn = document.getElementById('nextPageBtn');
  
  if (prevBtn && nextBtn) {
    prevBtn.addEventListener('click', () => changePage(AppState.currentPage - 1));
    nextBtn.addEventListener('click', () => changePage(AppState.currentPage + 1));
  }
}

/**
 * Load server metrics for a specific page
 * Frugal design pattern: we use classical paging to prevent pulling too many database items at once.
 */
function loadServerMetrics(page) {
  console.log(`[Green UX] Chargement des données pour la page ${page}. (Note: Défilement infini désactivé pour limiter les requêtes et l'impact carbone).`);
  
  // Simulated API call payload
  AppState.serversData = [
    { id: 1, name: "Srv-Prod-01", status: "Active", co2: 0.12 },
    { id: 2, name: "Srv-Prod-02", status: "Active", co2: 0.14 },
    { id: 3, name: "Srv-Dev-01", status: "Idle - Standby", co2: 0.02 },
    { id: 4, name: "Srv-Test-01", status: "Terminated", co2: 0.00 }
  ];
  
  renderTable(AppState.serversData);
}

function changePage(newPage) {
  if (newPage < 1) return;
  AppState.currentPage = newPage;
  loadServerMetrics(AppState.currentPage);
}

function renderTable(data) {
  const container = document.getElementById('serversTableBody');
  if (!container) return;
  
  container.innerHTML = '';
  data.forEach(srv => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${srv.name}</td>
      <td><span class="status-badge ${srv.status.toLowerCase().replace(/ /g, '-')}">${srv.status}</span></td>
      <td>${srv.co2} kg CO2/h</td>
    `;
    container.appendChild(row);
  });
}

/**
 * Notifications Management (Conforming to RGESN Uxui3 - User consent required)
 */
function toggleNotifications(enable) {
  AppState.notificationsEnabled = enable;
  localStorage.setItem('ecosphere_notifications', enable);
  
  if (enable) {
    console.log("Notifications activées après accord de l'utilisateur.");
    // Code to register push subscription...
  } else {
    console.log("Notifications désactivées.");
  }
}
