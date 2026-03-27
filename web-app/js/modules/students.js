import { db } from '../firebase/init.js';
import { collection, doc, setDoc, query, where, getDocs, writeBatch, serverTimestamp, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state, canEdit } from '../core/state.js';
import { $, escHtml, initials, showToast, openModal, closeModal } from '../utils/helpers.js';

export function initStudents() {
    $('student-search')?.addEventListener('input', renderStudentsList);
    $('btn-new-student')?.addEventListener('click', () => openStudentForm(null));
    $('form-student')?.addEventListener('submit', saveStudent);
    $('btn-disable-student')?.addEventListener('click', toggleStudentActive);

    window.addEventListener('page-navigate', (e) => {
        if (e.detail.page === 'students') renderStudentsList();
    });
}

export function loadStudents() {
    return new Promise((resolve) => {
        onSnapshot(collection(db, 'students'), snap => {
            state.students = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => {
                    const last = (a.lastName || '').localeCompare(b.lastName || '', 'es');
                    return last !== 0 ? last : (a.firstName || '').localeCompare(b.firstName || '', 'es');
                });
            if (window.currentPage === 'students') renderStudentsList();
            
            window.dispatchEvent(new CustomEvent('students-updated'));
            resolve();
        }, err => { console.error('students snapshot error:', err); resolve(); });
    });
}

export function renderStudentsList() {
    const search = ($('student-search')?.value || '').toLowerCase().trim();
    const list = $('students-list');
    if (!list) return;

    const activeStudents = state.students.filter(s => s.active !== false);

    const filtered = activeStudents.filter(s => {
        if (!search) return true;
        return (s.firstName + ' ' + s.lastName).toLowerCase().includes(search);
    });

    if (activeStudents.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👨‍🎓</div>No hay alumnos activos registrados</div>`;
        return;
    }
    if (filtered.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div>Sin resultados para "${escHtml(search)}"</div>`;
        return;
    }

    list.innerHTML = filtered.map(s => {
        const phone = s.guardianPhone || (s.guardian && s.guardian.phone) || '';
        return `
    <div class="student-card">
      <div class="student-avatar">${escHtml(initials(s.firstName, s.lastName))}</div>
      <div class="student-info">
        <div class="student-name">${escHtml(s.lastName)}, ${escHtml(s.firstName)}</div>
        <div class="student-meta">${phone ? '📞 ' + escHtml(phone) : ''}</div>
        <div class="student-meta" style="margin-top:2px;display:flex;gap:4px;flex-wrap:wrap">
            ${s.school ? `<span class="badge badge-blue" style="font-size:10px">🏫 ${escHtml(s.school)}</span>` : ''}
            ${s.grade ? `<span class="badge badge-gray" style="font-size:10px">${escHtml(s.grade)}</span>` : ''}
        </div>
      </div>
      <div class="student-actions">
        <button class="btn-icon" style="color:var(--blue)" title="Inscribir" data-action="enroll" data-id="${escHtml(s.id)}">📋</button>
        <button class="btn-icon" style="color:var(--gray-600)" title="Editar" data-action="edit" data-id="${escHtml(s.id)}">✏️</button>
      </div>
    </div>`;
    }).join('');

    list.querySelectorAll('.student-actions button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.currentTarget.dataset.action;
            const id = e.currentTarget.dataset.id;
            if (action === 'edit') openStudentForm(id);
            if (action === 'enroll') {
               window.dispatchEvent(new CustomEvent('open-enroll-modal', { detail: { studentId: id } }));
            }
        });
    });
}

export function openStudentForm(id) {
    const student = id ? state.students.find(s => s.id === id) : null;
    $('modal-student-title').textContent = student ? 'Editar Alumno' : 'Nuevo Alumno';
    $('form-student').reset();

    const disableBtn = $('btn-disable-student');
    if (disableBtn) {
        if (canEdit() && student) {
            disableBtn.classList.remove('hidden');
            const isActive = student.active !== false;
            disableBtn.textContent = isActive ? 'Deshabilitar alumno' : 'Habilitar alumno';
            disableBtn.style.background = isActive ? 'var(--red-bg)' : 'var(--green-bg)';
            disableBtn.style.color = isActive ? 'var(--red)' : 'var(--green)';
        } else {
            disableBtn.classList.add('hidden');
        }
    }

    if (student) {
        $('s-firstName').value = student.firstName || '';
        $('s-lastName').value = student.lastName || '';
        $('s-guardianPhone').value = student.guardianPhone || (student.guardian && student.guardian.phone) || '';
        $('s-school').value = student.school || '';
        $('s-grade').value = student.grade || '';
    }
    $('form-student').dataset.editId = student ? student.id : '';
    openModal('modal-student');
}

export async function saveStudent(e) {
    e.preventDefault();
    const btn = $('btn-save-student');
    const editId = $('form-student').dataset.editId;
    const isEdit = !!editId;

    const firstName = $('s-firstName').value.trim();
    const lastName = $('s-lastName').value.trim();

    let docId = editId;
    if (!isEdit) {
        docId = `${lastName}_${firstName}_${Date.now()}`.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9_]/g, '_');
    }

    const studentData = {
        firstName,
        lastName,
        guardianPhone: $('s-guardianPhone').value.trim(),
        school: $('s-school').value.trim(),
        grade: $('s-grade').value.trim(),
        active: true,
        updatedAt: serverTimestamp(),
        updatedBy: state.currentUser.uid,
    };

    if (isEdit) {
        const existing = state.students.find(s => s.id === editId);
        if (existing) studentData.active = existing.active !== false;
    } else {
        studentData.createdAt = serverTimestamp();
        studentData.createdBy = state.currentUser.uid;
    }

    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        await setDoc(doc(db, 'students', docId), studentData, { merge: isEdit });
        showToast(isEdit ? 'Alumno actualizado ✓' : 'Alumno registrado ✓', 'success');
        closeModal('modal-student');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Guardar';
    }
}

export async function toggleStudentActive() {
    if (!canEdit()) { showToast('Solo administradores pueden deshabilitar alumnos', 'error'); return; }
    const editId = $('form-student').dataset.editId;
    if (!editId) return;
    const student = state.students.find(s => s.id === editId);
    if (!student) return;
    const nextActive = student.active === false;

    const confirmMsg = nextActive
        ? `¿Habilitar al alumno ${student.firstName} ${student.lastName}?\n\nVolverá a estar visible. Deberás reinscribirlo en las actividades si corresponde.`
        : `¿Deshabilitar al alumno ${student.firstName} ${student.lastName}?\n\n• Desaparecerá del listado de alumnos\n• Se eliminarán sus inscripciones en actividades\n• Sus pagos históricos quedarán guardados`;

    if (!confirm(confirmMsg)) return;
    try {
        const batch = writeBatch(db);
        const studentRef = doc(db, 'students', editId);
        batch.set(studentRef, {
            active: nextActive,
            updatedAt: serverTimestamp(),
            updatedBy: state.currentUser.uid,
        }, { merge: true });

        if (!nextActive) {
            const enrollSnap = await getDocs(
                query(collection(db, 'enrollments'), where('studentId', '==', editId))
            );
            enrollSnap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            showToast(`Alumno deshabilitado y removido de ${enrollSnap.size} actividad(es) ✓`, 'success');
        } else {
            await batch.commit();
            showToast('Alumno habilitado ✓', 'success');
        }

        closeModal('modal-student');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

export async function checkAndResetFichas() {
    const yr = new Date().getFullYear();
    const settingsRef = doc(db, 'settings', 'fichaReset');
    const snap = await getDoc(settingsRef);

    const lastReset = snap.exists() ? (snap.data().lastResetYear || 0) : 0;
    if (lastReset >= yr) return;

    const studentsSnap = await getDocs(collection(db, 'students'));
    const batch = writeBatch(db);

    studentsSnap.docs.forEach(d => {
        if (d.data().fichamedica === true) {
            batch.update(d.ref, {
                fichamedica: false,
                fichamedicaYear: lastReset || yr - 1,
            });
        }
    });

    batch.set(settingsRef, {
        lastResetYear: yr,
        resetAt: serverTimestamp(),
        resetBy: state.currentUser?.uid || 'system',
    }, { merge: true });

    await batch.commit();
}
