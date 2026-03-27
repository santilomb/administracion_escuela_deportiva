import { db } from '../firebase/init.js';
import { collection, doc, setDoc, query, where, getDoc, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state } from '../core/state.js';
import { $, escHtml, daysLabel, todayISO, showToast } from '../utils/helpers.js';

export const MONTH_NAMES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export function initAttendance() {
    window.addEventListener('page-navigate', (e) => {
        if (e.detail.page === 'attendance') {
            initAttendancePage();
        }
    });

    $('attendance-activity-select')?.addEventListener('change', loadAttendanceGrid);
    $('attendance-month-select')?.addEventListener('change', loadAttendanceGrid);
}

export function initAttendancePage() {
    populateAttendanceActivitySelect();
    populateAttendanceMonthSelect();
}

function populateAttendanceActivitySelect() {
    const sel = $('attendance-activity-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Seleccionar actividad —</option>' +
        state.activities.filter(a => a.status === 'active').map(a =>
            `<option value="${escHtml(a.id)}">${escHtml(a.name)} (${daysLabel(a.days || [])})</option>`
        ).join('');
    if (prev) sel.value = prev;
}

function populateAttendanceMonthSelect() {
    const sel = $('attendance-month-select');
    if (!sel) return;
    const now = new Date();
    const yr = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    sel.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const key = `${yr}-${String(m).padStart(2, '0')}`;
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = MONTH_NAMES_ES[m - 1];
        if (m === curMonth) opt.selected = true;
        sel.appendChild(opt);
    }
}

export async function loadAttendanceGrid() {
    const actId = $('attendance-activity-select').value;
    const monthKey = $('attendance-month-select').value;
    const cont = $('attendance-grid');
    if (!actId || !monthKey) { cont.innerHTML = ''; return; }

    cont.innerHTML = '<div class="loading-spinner">Cargando...</div>';
    try {
        const enrollSnap = await getDocs(query(collection(db, 'enrollments'), where('activityId', '==', actId)));
        const studentIds = enrollSnap.docs.map(d => d.data().studentId);
        const enrolledStudents = studentIds
            .map(id => state.students.find(s => s.id === id))
            .filter(Boolean)
            .filter(s => s.active !== false)
            .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es'));

        if (enrolledStudents.length === 0) {
            cont.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>Sin alumnos inscriptos en esta actividad</div>';
            return;
        }

        const docId = `${actId}_${monthKey}`;
        const attSnap = await getDoc(doc(db, 'attendance_v2', docId));
        let sessions = attSnap.exists() ? (attSnap.data().sessions || []) : [];

        const today = todayISO();
        const inThisMonth = today.startsWith(monthKey);
        const hasSessionToday = sessions.some(s => s.date === today);

        if (inThisMonth && !hasSessionToday && sessions.length < 12) {
            sessions = [...sessions, {
                sessionIndex: sessions.length + 1,
                date: today,
                records: {}
            }];
        }

        renderAttendanceGrid(enrolledStudents, sessions, actId, monthKey, docId);
    } catch (e) {
        $('attendance-grid').innerHTML = `<div class="empty-state">Error: ${escHtml(e.message)}</div>`;
    }
}

export function renderAttendanceGrid(enrolledStudents, sessions, actId, monthKey, docId) {
    const cont = $('attendance-grid');
    const today = todayISO();
    const expanded = !!window._attExpanded;

    const pastSessions = sessions.filter(s => s.date !== today);
    const todaySession = sessions.find(s => s.date === today) || null;

    const [yr, mo] = monthKey.split('-');
    const monthLabel = `${MONTH_NAMES_ES[+mo - 1]} ${yr}`;

    if (sessions.length === 0) {
        cont.innerHTML = `<div class="card" style="padding:24px;text-align:center">
            <div style="font-size:40px;margin-bottom:12px">📅</div>
            <div style="font-weight:600;font-size:15px;color:var(--gray-700)">Sin clases registradas en ${monthLabel}</div>
            <div style="font-size:13px;color:var(--gray-500);margin-top:6px">Abrí esta pantalla el día que tengas clase y se creará la primera sesión automáticamente.</div>
          </div>`;
        window._attState = { sessions, actId, monthKey, docId, enrolledStudents };
        return;
    }

    let headers = `<th class="att-student-header">ALUMNO / COLEGIO</th>`;

    if (pastSessions.length > 0) {
        if (expanded) {
            headers += pastSessions.map(s => {
                const dl = s.date ? s.date.slice(5).replace('-', '/') : '';
                return `<th class="att-col-header att-past-col" title="${s.date}">
                    <div>C${s.sessionIndex}</div><div class="att-date-label">${dl}</div>
                </th>`;
            }).join('');
            headers += `<th class="att-col-header att-past-col">
                <button class="att-toggle-btn btn-toggle-history" title="Colapsar historial">◀</button>
            </th>`;
        } else {
            const range = pastSessions.length === 1
                ? `C${pastSessions[0].sessionIndex}`
                : `C1–C${pastSessions[pastSessions.length - 1].sessionIndex}`;
            headers += `<th class="att-col-header att-past-col att-collapsed-header">
                <button class="att-toggle-btn btn-toggle-history" title="Ver historial completo">▶</button>
                <div class="att-date-label">${range}</div>
            </th>`;
        }
    }

    if (todaySession) {
        const dl = todaySession.date.slice(5).replace('-', '/');
        headers += `<th class="att-col-header att-today-col" title="${todaySession.date}">
            <div>C${todaySession.sessionIndex}</div><div class="att-date-label">${dl}</div>
        </th>`;
    }

    headers += `<th class="att-total-header">TOT</th>`;

    const rows = enrolledStudents.map(s => {
        let totalPres = 0;
        let pastPres = 0;
        let cells = '';

        if (pastSessions.length > 0) {
            if (expanded) {
                cells += pastSessions.map(session => {
                    const state = (session.records && session.records[s.id]) || '';
                    if (state === 'P') { pastPres++; totalPres++; }
                    const cls = state === 'P' ? 'att-cell att-present att-past'
                        : state === 'A' ? 'att-cell att-absent att-past'
                            : 'att-cell att-empty att-past';
                    return `<td><div class="${cls} att-cell-clickable"
                        data-session="${session.sessionIndex}" data-student="${escHtml(s.id)}">${state || '·'}</div></td>`;
                }).join('');
                cells += `<td></td>`;
            } else {
                pastSessions.forEach(session => {
                    if (session.records && session.records[s.id] === 'P') { pastPres++; totalPres++; }
                });
                cells += `<td><div class="att-past-summary">${pastPres > 0 ? `<span>${pastPres}</span>` : '—'}</div></td>`;
            }
        }

        if (todaySession) {
            const state = (todaySession.records && todaySession.records[s.id]) || '';
            if (state === 'P') totalPres++;
            const cls = state === 'P' ? 'att-cell att-present att-today-cell'
                : state === 'A' ? 'att-cell att-absent att-today-cell'
                    : 'att-cell att-empty att-today-cell';
            cells += `<td><div class="${cls} att-cell-clickable"
                data-session="${todaySession.sessionIndex}" data-student="${escHtml(s.id)}">${state || '·'}</div></td>`;
        }

        return `<tr>
            <td class="att-student-cell">
                <div class="att-student-name">${escHtml(s.lastName)}, ${escHtml(s.firstName)}</div>
                <div class="att-student-sub">${s.school ? escHtml(s.school) : ''}${s.grade ? ' · ' + escHtml(s.grade) : ''}</div>
            </td>
            ${cells}
            <td><div class="att-total">${totalPres > 0 ? totalPres : ''}</div></td>
        </tr>`;
    }).join('');

    cont.innerHTML = `<div class="card att-card">
        <div class="att-header">
            <span class="att-month-label">📅 ${monthLabel}</span>
            <span class="att-enrolled-count">${enrolledStudents.length} alumno(s) · ${sessions.length} clase(s)</span>
        </div>
        <div class="att-table-wrap">
            <table class="att-grid-table">
                <thead><tr>${headers}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
      </div>`;

    window._attState = { sessions, actId, monthKey, docId, enrolledStudents };

    cont.querySelectorAll('.btn-toggle-history').forEach(btn => {
        btn.addEventListener('click', toggleAttHistory);
    });

    cont.querySelectorAll('.att-cell-clickable').forEach(cell => {
        cell.addEventListener('click', (e) => {
            cycleAttendanceCell(actId, monthKey, docId, parseInt(e.currentTarget.dataset.session), e.currentTarget.dataset.student);
        });
    });
}

function toggleAttHistory() {
    window._attExpanded = !window._attExpanded;
    const s = window._attState;
    if (s) renderAttendanceGrid(s.enrolledStudents, s.sessions, s.actId, s.monthKey, s.docId);
}

export async function cycleAttendanceCell(actId, monthKey, docId, sessionIndex, studentId) {
    const s = window._attState;
    if (!s) return;

    const session = s.sessions.find(ses => ses.sessionIndex === sessionIndex);
    if (!session) return;
    if (!session.records) session.records = {};

    const cur = session.records[studentId] || '';
    const next = cur === '' ? 'P' : cur === 'P' ? 'A' : '';
    if (next === '') {
        delete session.records[studentId];
    } else {
        session.records[studentId] = next;
    }

    renderAttendanceGrid(s.enrolledStudents, s.sessions, s.actId, s.monthKey, s.docId);

    clearTimeout(window._attSaveTimer);
    window._attSaveTimer = setTimeout(
        () => saveAttendanceDoc(actId, monthKey, docId, s.sessions),
        800
    );
}

async function saveAttendanceDoc(actId, monthKey, docId, sessions) {
    try {
        await setDoc(doc(db, 'attendance_v2', docId), {
            id: docId,
            activityId: actId,
            monthKey,
            sessions,
            updatedAt: serverTimestamp(),
            updatedBy: state.currentUser?.uid || '',
        });
    } catch (e) {
        showToast('Error al guardar asistencia: ' + e.message, 'error');
    }
}
