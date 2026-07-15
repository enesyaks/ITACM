/** Role → UI permission map, shared by both auth providers.
 *
 * Owner is the highest role: everything an Admin can do, PLUS instance-level
 * branding/company settings (logo, company info, handover terms, lifecycles,
 * document-storage configuration) and the ability to grant/revoke the Owner
 * role itself. The first account created during onboarding becomes the Owner.
 *
 * NOTE: `canViewConfidentialContracts` is a LEGACY UI hint only.
 * Real authorization is now handled by IAM `checkPermission(user, 'contract', 'view_confidential')`
 * in permissionService.js — which allows custom groups to have this access without being Owner/Admin.
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
    canViewConfidentialContracts: isOwner || isAdmin, // LEGACY: UI hint only — real auth via IAM
    canViewContractCosts: isOwner || isAdmin,
    canViewLineCosts: isOwner || isAdmin,
    canViewLicenseCosts: isOwner || isAdmin,
    canViewMaintenanceCosts: isOwner || isAdmin,
    canReadDocuments: isOwner || isAdmin,
    canDownloadDocuments: isOwner || isAdmin,
    canUploadDocuments: isOwner || isAdmin,
    canDeleteDocuments: isOwner || isAdmin,
    canManageBranding: isOwner, // logo, company info, terms, lifecycles, storage
    canManageOwner: isOwner, // only an Owner may create/assign Owner or Admin
    isOwner,
    canAccessIntegrations: isOwner || isAdmin,
  };
}

/**
 * @deprecated Since IAM (022_iam_system). Use `checkPermission(user, 'contract', 'view_confidential')`
 * from permissionService instead. This function only checks for hard-coded Owner/Admin roles;
 * custom groups with the `view_confidential` action will not be recognized by this function.
 *
 * Kept for backward compatibility during migration period.
 */
function canViewConfidentialContracts(role) {
  return role === 'Owner' || role === 'Admin';
}

module.exports = { ROLES, buildPermissions, canViewConfidentialContracts };
