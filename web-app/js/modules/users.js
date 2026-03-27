import { db } from '../firebase/init.js';
import { collection, doc, setDoc, deleteDoc, getDocs, query, where, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { state, canEdit } from '../core/state.js';
import { $, escHtml, initials, showToast, showLoading, hideLoading, openModal, closeModal } from '../utils/helpers.js';

export function initUsers() {
    window.addEventListener('page-navigate', (e) => {
        if (e.detail.page === 'users') {
            if (!canEdit()) {
                showToast('Solo administradores pueden acceder a Usuarios', 'error');
                window.dispatchEvent(new CustomEvent('nav-request', { detail: { page: 'dashboard' } }));
                return;
            }
            ensureUsersPageInDom();
            setTimeout(() => renderUsersPage(), 50);
        }
    });

    // Provide handler for auth module to auto accept invites on login
    window.addEventListener('user-login-check-invite', async (e) => {
        const role = await checkAndAcceptInvite(e.detail.user);
        if (role) e.detail.callback(role);
    });
}

function ensureUsersPageInDom() {
    if ($('page-users')) return;
    const tpl = $('tpl-page-users');
    if (!tpl) return;
    const clone = tpl.content.cloneNode(true);
    document.querySelector('.main-content').appendChild(clone);
    
    // Bind new events from template
    $('btn-invite-user')?.addEventListener('click', () => {
        $('form-invite').reset();
        openModal('modal-invite');
    });
    $('btn-toggle-inv-section')?.addEventListener('click', () => {
        const sec = $('inv-section');
        if (sec) sec.classList.toggle('hidden');
    });
    $('form-invite')?.addEventListener('submit', saveInvite);
}

export function syncUsersNavVisibility() {
    const li = $('nav-users');
    if (li) li.classList.toggle('hidden', !canEdit());
}

export async function renderUsersPage() {
    showLoading();
    try {
        const usersSnap = await getDocs(collection(db, 'users'));
        const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '', 'es'));

        const invSnap = await getDocs(query(collection(db, 'invites'), where('accepted', '==', false)));
        const invites = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        const countBadge = $('inv-count');
        if (countBadge) countBadge.textContent = invites.length;

        const invList = $('pending-invites-list');
        if (invList) {
            if (invites.length === 0) {
                invList.innerHTML = `<div class="empty-state" style="padding:12px">Sin invitaciones pendientes</div>`;
            } else {
                invList.innerHTML = invites.map(inv => `
                    <div class="student-card" style="padding:12px 16px">
                        <div class="student-info">
                            <div class="student-name">${escHtml(inv.name || inv.email)}</div>
                            <div class="student-meta">${escHtml(inv.email)} · Invitado por ${escHtml(inv.invitedByName || '')}</div>
                        </div>
                        <div class="student-actions">
                            <button class="btn-icon" style="color:var(--red,#ef4444)" title="Cancelar invitación"
                                data-action="cancel" data-id="${escHtml(inv.id)}">🗑️</button>
                        </div>
                    </div>`).join('');
                
                invList.querySelectorAll('[data-action="cancel"]').forEach(btn => {
                    btn.addEventListener('click', (e) => cancelInvite(e.currentTarget.dataset.id));
                });
            }
        }

        const roleLabel = { admin: '🔑 Admin', prof: '👨‍🏫 Profesor' };
        const usersList = $('users-list');
        if (usersList) {
            if (allUsers.length === 0) {
                usersList.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div>Sin usuarios registrados aún</div>`;
            } else {
                usersList.innerHTML = allUsers.map(u => {
                    const isMe = u.id === state.currentUser?.uid;
                    return `
                    <div class="student-card">
                        <div class="student-avatar" style="background:${u.role === 'admin' ? '#fef3c7' : '#ede9fe'};color:${u.role === 'admin' ? '#92400e' : '#7c3aed'}">
                            ${u.photoURL ? `<img src="${escHtml(u.photoURL)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : escHtml(initials(u.displayName?.split(' ')[0] || 'U', u.displayName?.split(' ')[1] || ''))}
                        </div>
                        <div class="student-info">
                            <div class="student-name">${escHtml(u.displayName || u.email)}${isMe ? ' <span style="font-size:11px;color:var(--gray-400)">(vos)</span>' : ''}</div>
                            <div class="student-meta">${escHtml(u.email || '')}</div>
                            <div class="student-meta" style="margin-top:4px;gap:4px;display:flex;flex-wrap:wrap">
                                <span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}" style="font-size:11px">${roleLabel[u.role] || u.role}</span>
                                <span class="badge ${u.active ? 'badge-green' : 'badge-gray'}" style="font-size:11px">${u.active ? 'Activo' : 'Inactivo'}</span>
                            </div>
                        </div>
                        ${!isMe ? `
                        <div class="student-actions">
                            <button class="btn-icon" style="color:var(--gray-600)" title="Editar usuario"
                                data-action="edit" data-id="${escHtml(u.id)}" data-name="${escHtml(u.displayName || u.email)}"
                                data-role="${escHtml(u.role)}" data-active="${u.active}">✏️</button>
                        </div>` : ''}
                    </div>`;
                }).join('');

                usersList.querySelectorAll('[data-action="edit"]').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                       const d = e.currentTarget.dataset;
                       openChangeRoleModal(d.id, d.name, d.role, d.active);
                    });
                });
            }
        }
    } catch (err) {
        showToast('Error cargando usuarios: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}

async function saveInvite(e) {
    e.preventDefault();
    if (!canEdit()) return;
    const btn = $('btn-save-invite');
    const email = $('inv-email').value.trim().toLowerCase();
    const name = $('inv-name').value.trim();

    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        const existing = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
        if (!existing.empty) {
            const u = existing.docs[0].data();
            showToast(`Ya existe una cuenta con ese email (${u.role})`, 'error');
            return;
        }
        const dupInv = await getDocs(query(collection(db, 'invites'), where('email', '==', email), where('accepted', '==', false)));
        if (!dupInv.empty) {
            showToast('Ya hay una invitación pendiente para ese email', 'error');
            return;
        }

        await setDoc(doc(collection(db, 'invites')), {
            email,
            name,
            role: 'admin',
            accepted: false,
            invitedByUid: state.currentUser.uid,
            invitedByName: state.currentUser.displayName || state.currentUser.email || '',
            createdAt: serverTimestamp(),
        });

        showToast(`Invitación guardada ✓ — ${email} quedará como admin al iniciar sesión`, 'success');
        closeModal('modal-invite');
        renderUsersPage();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Enviar invitación';
    }
}

async function cancelInvite(inviteId) {
    if (!canEdit()) return;
    if (!confirm('¿Cancelar esta invitación?')) return;
    try {
        await deleteDoc(doc(db, 'invites', inviteId));
        showToast('Invitación cancelada ✓', 'success');
        renderUsersPage();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

function openChangeRoleModal(uid, name, role, active) {
    $('role-user-name').textContent = name;
    $('role-select').value = role;
    $('role-active').value = String(active) === 'true' ? 'true' : 'false';
    $('form-change-role').dataset.uid = uid;
    
    // Bind events once when opened
    $('form-change-role').onsubmit = saveUserRole;
    $('btn-delete-user').onclick = deleteUser;

    openModal('modal-change-role');
}

async function saveUserRole(e) {
    e.preventDefault();
    if (!canEdit()) return;
    const uid = $('form-change-role').dataset.uid;
    const role = $('role-select').value;
    const active = $('role-active').value === 'true';

    try {
        await setDoc(doc(db, 'users', uid), {
            role,
            active,
            updatedAt: serverTimestamp(),
            updatedBy: state.currentUser.uid,
        }, { merge: true });
        showToast('Usuario actualizado ✓', 'success');
        closeModal('modal-change-role');
        renderUsersPage();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function deleteUser() {
    if (!canEdit()) { showToast('Solo administradores pueden eliminar usuarios', 'error'); return; }
    const uid = $('form-change-role').dataset.uid;
    if (!uid) return;
    if (uid === state.currentUser?.uid) { showToast('No podés eliminar tu propia cuenta', 'error'); return; }

    const name = $('role-user-name').textContent;
    if (!confirm(`¿Eliminar al usuario "${name}"?\n\nEsta acción elimina su registro del sistema. Si vuelve a iniciar sesión quedará nuevamente inactivo.`)) return;
    try {
        await deleteDoc(doc(db, 'users', uid));
        showToast('Usuario eliminado ✓', 'success');
        closeModal('modal-change-role');
        renderUsersPage();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

export async function checkAndAcceptInvite(user) {
    if (!user?.email) return null;
    const email = user.email.toLowerCase();
    try {
        const invSnap = await getDocs(query(
            collection(db, 'invites'),
            where('email', '==', email),
            where('accepted', '==', false)
        ));
        if (invSnap.empty) return null;

        const invDoc = invSnap.docs[0];
        const invData = invDoc.data();

        await setDoc(doc(db, 'invites', invDoc.id), {
            accepted: true,
            acceptedAt: serverTimestamp(),
            acceptedUid: user.uid,
        }, { merge: true });

        await setDoc(doc(db, 'users', user.uid), {
            role: invData.role || 'admin',
            active: true,
        }, { merge: true });

        console.log(`Invite accepted: ${email} is now ${invData.role}`);
        return invData.role;
    } catch (err) {
        console.warn('checkAndAcceptInvite error:', err.message);
        return null;
    }
}
