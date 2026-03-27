export const state = {
    currentUser: null,
    currentRole: 'prof',
    students: [],
    activities: [],
    staff: []
};

export function canEdit() { 
    return state.currentRole === 'admin'; 
}
