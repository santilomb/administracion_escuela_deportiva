import { GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut as firebaseSignOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { auth, db } from '../firebase/init.js';
import { state } from './state.js';
import { $, showToast } from '../utils/helpers.js';

export async function signInWithGoogle() {
    const btn = $('btn-google-login');
    const err = $('login-error');
    if(btn) { btn.disabled = true; btn.textContent = 'Iniciando sesión...'; }
    if(err) err.classList.add('hidden');
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (e) {
        if(err) {
            err.textContent = 'Error al iniciar sesión: ' + (e.message || 'Inténtalo de nuevo');
            err.classList.remove('hidden');
        }
        if(btn) {
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Iniciar sesión con Google`;
            btn.disabled = false;
        }
    }
}

export async function signOut() {
    if (!confirm('¿Cerrar sesión?')) return;
    await firebaseSignOut(auth);
}

export function showLoginError(msg) {
    const screenLogin = $('screen-login');
    const screenApp = $('screen-app');
    if (screenLogin) {
        screenLogin.classList.remove('hidden');
        screenLogin.classList.add('active');
    }
    if (screenApp) {
        screenApp.classList.add('hidden');
        screenApp.classList.remove('active');
    }
    const errEl = $('login-error');
    if (errEl) {
        errEl.textContent = msg;
        errEl.classList.remove('hidden');
    }
    const btn = $('btn-google-login');
    if(btn) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Iniciar sesión con Google`;
    }
}

export function initAuth() {
    $('btn-google-login')?.addEventListener('click', signInWithGoogle);
    $('btn-signout-top')?.addEventListener('click', signOut);
    $('btn-signout-sidebar')?.addEventListener('click', signOut);

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            state.currentUser = user;

            try {
                const userRef = doc(db, 'users', user.uid);
                const uSnap = await getDoc(userRef);

                if (!uSnap.exists()) {
                    let grantedRole = null;
                    if (window._checkAndAcceptInvite) {
                         grantedRole = await window._checkAndAcceptInvite(user);
                    }

                    await setDoc(userRef, {
                        uid: user.uid,
                        email: user.email || '',
                        displayName: user.displayName || '',
                        photoURL: user.photoURL || '',
                        role: grantedRole || 'prof',
                        active: grantedRole ? true : false,
                        createdAt: serverTimestamp(),
                    });

                    if (!grantedRole) {
                        showLoginError('Tu cuenta fue creada pero NO está activa. Un administrador debe habilitarla.');
                        await firebaseSignOut(auth);
                        return;
                    }
                    const freshSnap = await getDoc(userRef);
                    state.currentRole = freshSnap.data().role || 'admin';
                } else {
                    const data = uSnap.data();
                    await setDoc(userRef, {
                        email: user.email || '',
                        displayName: user.displayName || '',
                        photoURL: user.photoURL || '',
                        lastLogin: serverTimestamp()
                    }, { merge: true });

                    if (!data.active) {
                        showLoginError('Tu cuenta está inactiva. Contactá a un administrador.');
                        await firebaseSignOut(auth);
                        return;
                    }
                    state.currentRole = data.role || 'prof';
                }

                $('screen-login')?.classList.add('hidden');
                $('screen-login')?.classList.remove('active');
                $('screen-app')?.classList.remove('hidden');
                $('screen-app')?.classList.add('active');

                // Populate user avatar and sidebar info
                const avatarEl = $('user-avatar');
                if (avatarEl) {
                    if (user.photoURL) {
                        avatarEl.innerHTML = `<img src="${user.photoURL}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`;
                    } else {
                        avatarEl.textContent = (user.displayName || user.email || 'U').charAt(0).toUpperCase();
                    }
                    avatarEl.title = user.displayName || user.email || '';
                }

                const sidebarInfo = $('sidebar-user-info');
                if (sidebarInfo) {
                    sidebarInfo.innerHTML = `<strong>${user.displayName || ''}</strong><br><small>${user.email || ''}</small>`;
                }

                window.dispatchEvent(new CustomEvent('auth-success', { detail: { user } }));

            } catch (err) {
                console.error("Auth error:", err);
                showLoginError('Error verificando usuario: ' + err.message);
                await firebaseSignOut(auth);
            }
        } else {
            state.currentUser = null;
            $('screen-login')?.classList.remove('hidden');
            $('screen-login')?.classList.add('active');
            $('screen-app')?.classList.add('hidden');
            $('screen-app')?.classList.remove('active');
        }
    });
}
