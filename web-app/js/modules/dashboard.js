import { db } from '../firebase/init.js';
import { collection, query, where, getDocs } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state } from '../core/state.js';
import { $, escHtml, formatCurrency, todayWeekday, nowMonthKey } from '../utils/helpers.js';

export function initDashboard() {
    window.addEventListener('page-navigate', (e) => {
        if (e.detail.page === 'dashboard') {
            renderDashboard();
        }
    });

    window.addEventListener('students-updated', () => {
        if (window.currentPage === 'dashboard') renderDashboard();
    });

    window.addEventListener('activities-updated', () => {
        if (window.currentPage === 'dashboard') renderDashboard();
    });
}

export async function renderDashboard() {
    const activeStudents = state.students.filter(s => s.active !== false).length;
    const activeActivities = state.activities.filter(a => a.status === 'active').length;
    if ($('stat-students')) $('stat-students').textContent = activeStudents;
    if ($('stat-activities')) $('stat-activities').textContent = activeActivities;

    const monthKey = nowMonthKey();
    if ($('stat-paid') && $('stat-pending')) {
        try {
            const pSnap = await getDocs(query(collection(db, 'payments'), where('monthKey', '==', monthKey)));
            const payments = pSnap.docs.map(d => d.data());
            const paid = payments.filter(p => p.status === 'paid').length;
            const pending = payments.filter(p => p.status === 'pending' || !p.status).length;
            $('stat-paid').textContent = paid;
            $('stat-pending').textContent = pending;
        } catch { 
            $('stat-paid').textContent = '—'; 
            $('stat-pending').textContent = '—'; 
        }
    }

    const dow = todayWeekday();
    const todayActivities = state.activities.filter(a => a.status === 'active' && (a.days || []).includes(dow));
    const todayLabel = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    if ($('today-label')) $('today-label').textContent = todayLabel;

    const listEl = $('today-activities');
    if (listEl) {
        if (todayActivities.length === 0) {
            listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎉</div>No hay actividades hoy</div>`;
        } else {
            listEl.innerHTML = todayActivities.map(a => `
          <div class="activity-list-item">
            <div style="width:36px;height:36px;border-radius:8px;background:var(--blue-bg);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🏃</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:600;font-size:14px">${escHtml(a.name)}</div>
              <div style="font-size:12px;color:var(--gray-500)">${a.startTime || ''}–${a.endTime || ''} · ${formatCurrency(a.currentFee || 0)}/mes</div>
            </div>
            <button class="btn-primary btn-sm btn-nav-attendance" data-activity="${escHtml(a.id)}">Asistencia</button>
          </div>`).join('');

          listEl.querySelectorAll('.btn-nav-attendance').forEach(btn => {
              btn.addEventListener('click', (e) => {
                  window.dispatchEvent(new CustomEvent('navigate-to-attendance', {
                      detail: { activityId: e.currentTarget.dataset.activity }
                  }));
              });
          });
        }
    }

    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('loading-pulse'));
}
