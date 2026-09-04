import './styles/global.css';

// `/admin` is its own surface, not a tab on the public explorer.  Keeping the
// shells separate prevents a future admin feature from accidentally inheriting
// the public navigation or its assumptions about anonymous access.
const isAdminPath = location.pathname === '/admin' || location.pathname === '/admin/';
const publicShell = document.querySelector('dd-shell');

if (isAdminPath) {
  void import('./components/dd-admin-shell.js').then(() => {
    const adminShell = document.createElement('dd-admin-shell');
    publicShell?.replaceWith(adminShell);
  });
} else {
  void import('./components/dd-shell.js');
}
