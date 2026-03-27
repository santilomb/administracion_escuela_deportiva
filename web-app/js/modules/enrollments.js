import { db } from '../firebase/init.js';
import { collection, doc, setDoc, query, where, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state } from '../core/state.js';
import { $, escHtml, daysLabel, openModal, showToast } from '../utils/helpers.js';

export function initEnrollments() {
    window.addEventListener('open-enroll-modal', (e) => {
        openEnrollModal(e.detail.studentId);
    });

    // Make enrollStudent available globally or use event delegation inside openEnrollModal
    // For rendering innerHTML, we might unfortunately need a global fallback, or we bind dynamically.
    // I'll attach a listener in the dynamically generated HTML container.
    $('enroll-activities-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-enroll');
        if (btn) {
            enrollStudent(btn.dataset.student, btn.dataset.activity, btn);
        }
    });
}

export async function openEnrollModal(studentId) {
    const student = state.students.find(s => s.id === studentId);
    if (!student) return;

    $('enroll-student-name').textContent = `${student.lastName}, ${student.firstName}`;
    $('enroll-activities-list').innerHTML = '<div class="loading-spinner">Cargando...</div>';
    openModal('modal-enroll');

    const enrollSnap = await getDocs(query(collection(db, 'enrollments'), where('studentId', '==', studentId)));
    const enrolledIds = new Set(enrollSnap.docs.map(d => d.data().activityId));

    const activeActivities = state.activities.filter(a => a.status === 'active');
    if (activeActivities.length === 0) {
        $('enroll-activities-list').innerHTML = '<div class="empty-state">No hay actividades activas</div>';
        return;
    }

    $('enroll-activities-list').innerHTML = activeActivities.map(a => `
    <div class="enroll-activity-item">
      <div>
        <div style="font-weight:600;font-size:14px">${escHtml(a.name)}</div>
        <div style="font-size:12px;color:var(--gray-500)">${daysLabel(a.days || [])} · ${a.startTime || ''}–${a.endTime || ''}</div>
      </div>
      ${enrolledIds.has(a.id)
            ? `<span class="badge badge-green">Inscripto ✓</span>`
            : `<button class="btn-primary btn-sm btn-enroll" data-student="${escHtml(studentId)}" data-activity="${escHtml(a.id)}">Inscribir</button>`
        }
    </div>`).join('');
}

export async function enrollStudent(studentId, activityId, btn) {
    btn.disabled = true; btn.textContent = '...';
    const student = state.students.find(s => s.id === studentId);
    const activity = state.activities.find(a => a.id === activityId);
    try {
        const enrollId = `${studentId}_${activityId}`;
        await setDoc(doc(db, 'enrollments', enrollId), {
            id: enrollId,
            studentId,
            studentName: student ? `${student.firstName} ${student.lastName}` : studentId,
            activityId,
            activityName: activity ? activity.name : activityId,
            active: true,
            createdAt: serverTimestamp(),
            createdBy: state.currentUser.uid,
        });
        const badge = document.createElement('span');
        badge.className = 'badge badge-green';
        badge.textContent = 'Inscripto ✓';
        btn.replaceWith(badge);
        showToast('Inscripción exitosa ✓', 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Inscribir';
    }
}
