import { db } from '../firebase/init.js';
import { collection, doc, setDoc, deleteDoc, serverTimestamp, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state, canEdit } from '../core/state.js';
import { $, escHtml, daysLabel, formatCurrency, showToast, openModal, closeModal } from '../utils/helpers.js';

export function initActivities() {
    $('btn-new-activity')?.addEventListener('click', () => openActivityForm(null));
    $('form-activity')?.addEventListener('submit', saveActivity);
    $('btn-delete-activity')?.addEventListener('click', deleteActivity);

    window.addEventListener('page-navigate', (e) => {
        if (e.detail.page === 'activities') renderActivitiesList();
    });
}

export function loadActivities() {
    return new Promise((resolve) => {
        onSnapshot(collection(db, 'activities'), snap => {
            state.activities = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
            if (window.currentPage === 'activities') renderActivitiesList();
            
            window.dispatchEvent(new CustomEvent('activities-updated'));
            resolve();
        }, err => { console.error('activities snapshot error:', err); resolve(); });
    });
}

export function renderActivitiesList() {
    const list = $('activities-list');
    if (!list) return;

    const newBtn = $('btn-new-activity');
    if (newBtn) newBtn.style.display = canEdit() ? '' : 'none';

    if (state.activities.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏃</div>No hay actividades aún</div>`;
        return;
    }

    list.innerHTML = state.activities.map(a => `
    <div class="activity-card">
      <div class="activity-card-header">
        <div>
          <div class="activity-name">${escHtml(a.name)}</div>
          <div class="activity-meta">${daysLabel(a.days || [])} · ${a.startTime || ''}–${a.endTime || ''}</div>
          ${a.professorName ? `<div class="activity-meta" style="margin-top:2px">👨‍🏫 ${escHtml(a.professorName)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div class="activity-fee">${formatCurrency(a.currentFee || 0)}</div>
          <span class="badge ${a.status === 'active' ? 'badge-green' : 'badge-gray'}">${a.status === 'active' ? 'Activa' : 'Inactiva'}</span>
        </div>
      </div>
      ${canEdit() ? `
      <div class="activity-actions">
        <button class="btn-secondary btn-sm" data-action="edit" data-id="${escHtml(a.id)}">✏️ Editar</button>
      </div>` : ''}
    </div>`).join('');

    list.querySelectorAll('button[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            openActivityForm(e.currentTarget.dataset.id);
        });
    });
}

export function openActivityForm(id) {
    if (!canEdit()) { showToast('Solo administradores pueden editar actividades', 'error'); return; }
    const activity = id ? state.activities.find(a => a.id === id) : null;
    $('modal-activity-title').textContent = activity ? 'Editar Actividad' : 'Nueva Actividad';
    $('form-activity').reset();

    const yr = new Date().getFullYear();
    const defaultStart = `${yr}-03-01`;
    const defaultEnd = `${yr}-12-31`;

    const fmtDate = (v) => {
        if (!v) return null;
        if (v.toDate) return v.toDate().toISOString().slice(0, 10);
        return String(v).slice(0, 10);
    };

    document.querySelectorAll('#a-days input[type=checkbox]').forEach(cb => { cb.checked = false; });

    if (activity) {
        $('a-name').value = activity.name || '';
        $('a-startTime').value = activity.startTime || '';
        $('a-endTime').value = activity.endTime || '';
        $('a-fee').value = activity.currentFee || '';
        $('a-status').value = activity.status || 'active';
        $('a-startDate').value = fmtDate(activity.startDate) || defaultStart;
        $('a-endDate').value = fmtDate(activity.endDate) || defaultEnd;
        (activity.days || []).forEach(d => {
            const cb = document.querySelector(`#a-days input[value="${d}"]`);
            if (cb) cb.checked = true;
        });
    } else {
        $('a-startDate').value = defaultStart;
        $('a-endDate').value = defaultEnd;
    }
    $('form-activity').dataset.editId = activity ? activity.id : '';

    const delBtn = $('btn-delete-activity');
    if (delBtn) delBtn.classList.toggle('hidden', !canEdit() || !activity);

    openModal('modal-activity');
}

export async function deleteActivity() {
    if (!canEdit()) return;
    const editId = $('form-activity').dataset.editId;
    if (!editId) return;
    const act = state.activities.find(a => a.id === editId);
    if (!confirm(`¿Eliminar la actividad "${act?.name || editId}"?\n\nEsta acción no se puede deshacer. Las inscripciones y pagos relacionados quedarán en el historial.`)) return;
    try {
        await deleteDoc(doc(db, 'activities', editId));
        showToast('Actividad eliminada ✓', 'success');
        closeModal('modal-activity');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

export async function saveActivity(e) {
    e.preventDefault();
    const btn = $('btn-save-activity');
    const editId = $('form-activity').dataset.editId;
    const isEdit = !!editId;

    const days = [...document.querySelectorAll('#a-days input:checked')].map(cb => +cb.value);
    if (days.length === 0) { showToast('Seleccioná al menos un día', 'error'); return; }

    const data = {
        name: $('a-name').value.trim(),
        days,
        startTime: $('a-startTime').value,
        endTime: $('a-endTime').value,
        currentFee: parseFloat($('a-fee').value),
        status: $('a-status').value,
        startDate: $('a-startDate').value || null,
        endDate: $('a-endDate').value || null,
        updatedAt: serverTimestamp(),
        updatedBy: state.currentUser.uid,
    };
    if (!isEdit) {
        data.createdAt = serverTimestamp();
        data.createdBy = state.currentUser.uid;
        data.feeHistory = [];
    }

    const ref = isEdit ? doc(db, 'activities', editId) : doc(collection(db, 'activities'));
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        await setDoc(ref, data, { merge: isEdit });
        showToast(isEdit ? 'Actividad actualizada ✓' : 'Actividad creada ✓', 'success');
        closeModal('modal-activity');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Guardar';
    }
}
