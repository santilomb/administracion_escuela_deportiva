import { db } from '../firebase/init.js';
import { collection, doc, setDoc, deleteDoc, getDocs, query, where, serverTimestamp, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state, canEdit } from '../core/state.js';
import { $, escHtml, initials, showToast, openModal, closeModal } from '../utils/helpers.js';

export function initStaff() {
    window.addEventListener('page-navigate', (e) => {
        if (e.detail.page === 'staff') renderStaffList();
    });

    $('btn-new-staff')?.addEventListener('click', () => openStaffForm(null));
    $('form-staff')?.addEventListener('submit', saveStaff);
    $('btn-delete-staff')?.addEventListener('click', deleteStaff);

    // Provide the helper to other modules (activities) for select populations
    window.addEventListener('activities-updated', () => {
        populateProfessorSelect();
    });
}

export function loadStaff() {
    return new Promise((resolve) => {
        onSnapshot(collection(db, 'staff'), snap => {
            state.staff = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '', 'es'));
            
            if (window.currentPage === 'staff') renderStaffList();
            populateProfessorSelect();
            
            window.dispatchEvent(new CustomEvent('staff-updated'));
            resolve();
        }, err => { console.error('staff snapshot error:', err); resolve(); });
    });
}

export function renderStaffList() {
    const list = $('staff-list');
    if (!list) return;

    if (state.staff.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👨‍🏫</div>No hay profesores registrados aún</div>`;
        return;
    }

    list.innerHTML = state.staff.map(p => `
        <div class="student-card">
            <div class="student-avatar" style="background:#ede9fe;color:#7c3aed">${escHtml(initials(p.firstName, p.lastName))}</div>
            <div class="student-info">
                <div class="student-name">${escHtml(p.lastName)}, ${escHtml(p.firstName)}</div>
                <div class="student-meta">${escHtml(p.email || '')}${p.phone ? ' · ' + escHtml(p.phone) : ''}</div>
                <div class="student-meta" style="margin-top:4px;gap:4px;display:flex;flex-wrap:wrap">
                    ${p.specialty ? `<span class="badge badge-blue" style="font-size:11px">${escHtml(p.specialty)}</span>` : ''}
                    <span class="badge ${p.active !== false ? 'badge-green' : 'badge-gray'}" style="font-size:11px">${p.active !== false ? 'Activo' : 'Inactivo'}</span>
                    <span class="badge ${p.linkedUid ? 'badge-green' : 'badge-gray'}" style="font-size:11px">${p.linkedUid ? '✓ Vinculado' : 'Sin vincular'}</span>
                </div>
            </div>
            ${canEdit() ? `
            <div class="student-actions">
                <button class="btn-icon" style="color:var(--gray-600)" title="Editar profesor" data-action="edit" data-id="${escHtml(p.id)}">✏️</button>
            </div>` : ''}
        </div>`).join('');

    list.querySelectorAll('[data-action="edit"]').forEach(btn => {
        btn.addEventListener('click', (e) => openStaffForm(e.currentTarget.dataset.id));
    });
}

export function openStaffForm(id) {
    if (!canEdit()) return;
    const professor = id ? state.staff.find(p => p.id === id) : null;
    $('modal-staff-title').textContent = professor ? 'Editar Profesor' : 'Nuevo Profesor';
    $('form-staff').reset();
    
    if (professor) {
        $('p-firstName').value = professor.firstName || '';
        $('p-lastName').value = professor.lastName || '';
        $('p-email').value = professor.email || '';
        $('p-phone').value = professor.phone || '';
        $('p-specialty').value = professor.specialty || '';
        $('p-active').value = String(professor.active !== false);
    }
    $('form-staff').dataset.editId = professor ? professor.id : '';

    const delBtn = $('btn-delete-staff');
    if (delBtn) delBtn.classList.toggle('hidden', !professor);

    openModal('modal-staff');
}

export async function deleteStaff() {
    if (!canEdit()) return;
    const editId = $('form-staff').dataset.editId;
    if (!editId) return;
    const prof = state.staff.find(p => p.id === editId);
    if (!confirm(`¿Eliminar al profesor "${prof ? prof.firstName + ' ' + prof.lastName : editId}"?\n\nEsta acción no se puede deshacer.`)) return;
    try {
        await deleteDoc(doc(db, 'staff', editId));
        if (prof?.linkedUid) {
            await setDoc(doc(db, 'users', prof.linkedUid), { staffId: null }, { merge: true });
        }
        showToast('Profesor eliminado ✓', 'success');
        closeModal('modal-staff');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

export async function saveStaff(e) {
    e.preventDefault();
    if (!canEdit()) return;
    const btn = $('btn-save-staff');
    const editId = $('form-staff').dataset.editId;
    const isEdit = !!editId;
    const email = $('p-email').value.trim().toLowerCase();

    const data = {
        firstName: $('p-firstName').value.trim(),
        lastName: $('p-lastName').value.trim(),
        email,
        phone: $('p-phone').value.trim(),
        specialty: $('p-specialty').value.trim(),
        active: $('p-active').value === 'true',
        updatedAt: serverTimestamp(),
        updatedBy: state.currentUser.uid,
    };
    if (!isEdit) { 
        data.createdAt = serverTimestamp(); 
        data.createdBy = state.currentUser.uid; 
        data.linkedUid = null; 
    }

    const ref = isEdit ? doc(db, 'staff', editId) : doc(collection(db, 'staff'));
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        await setDoc(ref, data, { merge: isEdit });
        await tryLinkStaffByEmail(email, ref.id);
        showToast(isEdit ? 'Profesor actualizado ✓' : 'Profesor registrado ✓', 'success');
        closeModal('modal-staff');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Guardar';
    }
}

export async function tryLinkStaffByEmail(email, staffId) {
    if (!email) return;
    try {
        const usersSnap = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
        if (!usersSnap.empty) {
            const userDoc = usersSnap.docs[0];
            await setDoc(doc(db, 'staff', staffId), { linkedUid: userDoc.id }, { merge: true });
            await setDoc(doc(db, 'users', userDoc.id), { role: 'prof', active: true, staffId }, { merge: true });
            showToast('Profesor vinculado a su cuenta Google ✓', 'success');
        }
    } catch (err) { console.warn('tryLinkStaffByEmail:', err.message); }
}

export async function linkStaffOnLogin(user) {
    if (!user?.email) return;
    const email = user.email.toLowerCase();
    try {
        const staffSnap = await getDocs(query(collection(db, 'staff'), where('email', '==', email)));
        if (!staffSnap.empty) {
            const staffDoc = staffSnap.docs[0];
            const isActive = staffDoc.data().active !== false;
            await setDoc(doc(db, 'staff', staffDoc.id), { linkedUid: user.uid }, { merge: true });
            await setDoc(doc(db, 'users', user.uid), {
                role: 'prof', active: isActive, staffId: staffDoc.id
            }, { merge: true });
        }
    } catch (err) { console.warn('linkStaffOnLogin:', err.message); }
}

export function populateProfessorSelect(currentProfId) {
    const sel = $('a-professor');
    if (!sel) return;
    const prev = currentProfId !== undefined ? currentProfId : sel.value;
    sel.innerHTML = '<option value="">— Sin asignar —</option>' +
        state.staff.filter(p => p.active !== false).map(p =>
            `<option value="${escHtml(p.id)}">${escHtml(p.lastName)}, ${escHtml(p.firstName)}</option>`
        ).join('');
    if (prev) sel.value = prev;
}
