/**
 * Role helper utilities
 */

export const ROLES = {
  PACKAGER: "packager",
  SUPERVISOR: "supervisor",
};

/**
 * Check if user is packager
 */
export function isPackager(role) {
  return role === ROLES.PACKAGER;
}

/**
 * Check if user is supervisor
 */
export function isSupervisor(role) {
  return role === ROLES.SUPERVISOR;
}

/**
 * Check if user has access (supervisor has access to everything packager has)
 */
export function hasAccess(userRole, requiredRole) {
  if (requiredRole === ROLES.PACKAGER) {
    // Both packager and supervisor can access packager features
    return userRole === ROLES.PACKAGER || userRole === ROLES.SUPERVISOR;
  }
  if (requiredRole === ROLES.SUPERVISOR) {
    // Only supervisor can access supervisor features
    return userRole === ROLES.SUPERVISOR;
  }
  return false;
}

