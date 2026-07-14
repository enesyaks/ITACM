/** Role → UI permission map, shared by both auth providers.
 *
 * Owner is the highest role: everything an Admin can do, PLUS instance-level
 * branding/company settings (logo, company info, handover terms, lifecycles,
 * document-storage configuration) and the ability to grant/revoke the Owner
 * role itself. The first account created during onboarding becomes the Owner.
 */
const ROLES = Object.freeze(['Owner', 'Admin', 'Helpdesk', 'Viewer']);

function buildPermissions(role) {
  const isOwner = role === 'Owner';
  const isAdmin = role === 'Admin';
  const isStaff = isOwner || isAdmin || role === 'Helpdesk';
  return {
    canViewDashboard: true,
    canManageAssets: isStaff,
    canExecuteHandovers: isStaff,
    canManageMaintenance: isStaff,
    canManageUsers: isOwner || isAdmin,
    canViewAudit: isOwner || isAdmin,
    canViewConfidentialContracts: isOwner || isAdmin,
    canManageBranding: isOwner, // logo, company info, terms, lifecycles, storage
    canManageOwner: isOwner, // only an Owner may create/assign Owner or Admin
    isOwner,
  };
}

/** Owner / Admin may see contracts marked Confidential. */
function canViewConfidentialContracts(role) {
  return role === 'Owner' || role === 'Admin';
}

module.exports = { ROLES, buildPermissions, canViewConfidentialContracts };
