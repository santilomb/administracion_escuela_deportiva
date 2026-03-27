export const $ = id => document.getElementById(id);

export function showToast(msg, type = '') {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = `toast${type ? ' ' + type : ''}`;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
}

export function showLoading() { $('loading-overlay')?.classList.remove('hidden'); }
export function hideLoading() { $('loading-overlay')?.classList.add('hidden'); }

export function openModal(id) { $(id)?.classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
export function closeModal(id) { $(id)?.classList.add('hidden'); document.body.style.overflow = ''; }

export function formatCurrency(n) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

export function nowMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function activityMonthKeys(activity) {
    const year = new Date().getFullYear();
    const parseDate = (v, defaultDate) => {
        if (!v) return defaultDate;
        if (v.toDate) return v.toDate();
        const d = new Date(v);
        return isNaN(d) ? defaultDate : d;
    };
    const start = parseDate(activity.startDate, new Date(year, 2, 1));
    const end = parseDate(activity.endDate, new Date(year, 11, 31));

    const keys = [];
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMon = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= endMon) {
        keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
        cur.setMonth(cur.getMonth() + 1);
    }
    return keys;
}

export function recentMonthKeys(count = 6) {
    const months = [];
    const d = new Date();
    for (let i = 0; i < count; i++) {
        months.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        d.setMonth(d.getMonth() - 1);
    }
    return months;
}

export function monthKeyToLabel(key) {
    const [y, m] = key.split('-');
    const d = new Date(+y, +m - 1, 1);
    return d.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
}

export function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DAY_NAMES = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie' };
export const DAY_FULL = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' };

export function daysLabel(days) {
    return days.map(d => DAY_NAMES[d] || d).join(' · ');
}

export function initials(first, last) {
    return ((first[0] || '') + (last[0] || '')).toUpperCase();
}

export function todayWeekday() {
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
}

export function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
