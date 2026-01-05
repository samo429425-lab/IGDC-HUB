/*
 IGDC / IGTC Role Permission Map
 목적:
 - Auth0에서 내려온 최종 role string(31종)을 기준으로
 - 프론트 전체에서 '접근/표시/실행' 권한을 단일 규칙으로 통제
 - 페이지 접근, 버튼 노출, 모달 탭, 승인/검토 권한까지 일관 처리

 사용:
   import { hasPermission, canAccessPage, PERMISSIONS } from '/assets/js/role-permission-map.js';
*/

/* =========================
   Permission Keys
========================= */
export const PERMISSIONS = {
  READ_NOTICE: 'read_notice',
  WRITE_NOTICE: 'write_notice',
  DELETE_OWN_NOTICE: 'delete_own_notice',
  DELETE_ANY_NOTICE: 'delete_any_notice',

  WRITE_REVIEW: 'write_review',
  BUY_PRODUCT: 'buy_product',
  ACCESS_PREMIUM: 'access_premium',

  APPLY_STANDARD: 'apply_standard',
  APPLY_PREMIUM: 'apply_premium',
  APPLY_COMMERCE: 'apply_commerce',

  UPLOAD_PRODUCT: 'upload_product',
  MANAGE_OWN_PRODUCTS: 'manage_own_products',

  VIEW_COMMERCE_DASHBOARD: 'view_commerce_dashboard',
  VIEW_PARTNER_PAGE: 'view_partner_page',

  APPROVE_MEMBERS: 'approve_members',
  ASSIGN_ROLES: 'assign_roles',

  MANAGE_SITE: 'manage_site',
  MANAGE_MULTI_SITE: 'manage_multi_site',
  MANAGE_PLATFORM: 'manage_platform'
};

/* =========================
   Role Normalization
========================= */
export function normalizeRole(role) {
  if (!role) return 'guest';
  if (role.startsWith('site_manager')) return 'site_manager';
  if (role.startsWith('commerce_manager')) return 'commerce_manager';
  if (role.startsWith('member_premium')) return 'member_premium';
  if (role.startsWith('member_standard')) return 'member_standard';
  if (role.startsWith('member')) return 'member';
  return role;
}

/* =========================
   Permission Map
========================= */
const ROLE_PERMISSION_MAP = {
  guest: {
    [PERMISSIONS.READ_NOTICE]: true
  },

  member: {
    [PERMISSIONS.READ_NOTICE]: true,
    [PERMISSIONS.WRITE_REVIEW]: true,
    [PERMISSIONS.BUY_PRODUCT]: true,
    [PERMISSIONS.APPLY_STANDARD]: true
  },

  member_standard: {
    [PERMISSIONS.READ_NOTICE]: true,
    [PERMISSIONS.WRITE_REVIEW]: true,
    [PERMISSIONS.BUY_PRODUCT]: true,
    [PERMISSIONS.APPLY_PREMIUM]: true
  },

  member_premium: {
    [PERMISSIONS.READ_NOTICE]: true,
    [PERMISSIONS.WRITE_REVIEW]: true,
    [PERMISSIONS.BUY_PRODUCT]: true,
    [PERMISSIONS.ACCESS_PREMIUM]: true
  },

  commerce_manager: {
    [PERMISSIONS.READ_NOTICE]: true,
    [PERMISSIONS.UPLOAD_PRODUCT]: true,
    [PERMISSIONS.MANAGE_OWN_PRODUCTS]: true,
    [PERMISSIONS.VIEW_COMMERCE_DASHBOARD]: true,
    [PERMISSIONS.VIEW_PARTNER_PAGE]: true
  },

  site_manager: {
    [PERMISSIONS.READ_NOTICE]: true,
    [PERMISSIONS.WRITE_NOTICE]: true,
    [PERMISSIONS.DELETE_OWN_NOTICE]: true,
    [PERMISSIONS.APPROVE_MEMBERS]: true,
    [PERMISSIONS.MANAGE_SITE]: true
  },

  coordinator_director: {
    [PERMISSIONS.READ_NOTICE]: true,
    [PERMISSIONS.WRITE_NOTICE]: true,
    [PERMISSIONS.DELETE_OWN_NOTICE]: true,
    [PERMISSIONS.APPROVE_MEMBERS]: true,
    [PERMISSIONS.MANAGE_MULTI_SITE]: true
  },

  director: {
    [PERMISSIONS.READ_NOTICE]: true,
    [PERMISSIONS.WRITE_NOTICE]: true,
    [PERMISSIONS.DELETE_ANY_NOTICE]: true,
    [PERMISSIONS.APPROVE_MEMBERS]: true,
    [PERMISSIONS.MANAGE_MULTI_SITE]: true
  },

  admin: {
    [PERMISSIONS.READ_NOTICE]: true,
    [PERMISSIONS.WRITE_NOTICE]: true,
    [PERMISSIONS.DELETE_ANY_NOTICE]: true,
    [PERMISSIONS.APPROVE_MEMBERS]: true,
    [PERMISSIONS.ASSIGN_ROLES]: true,
    [PERMISSIONS.MANAGE_PLATFORM]: true
  },

  owner: {
    [PERMISSIONS.READ_NOTICE]: true,
    [PERMISSIONS.WRITE_NOTICE]: true,
    [PERMISSIONS.DELETE_ANY_NOTICE]: true,
    [PERMISSIONS.APPROVE_MEMBERS]: true,
    [PERMISSIONS.ASSIGN_ROLES]: true,
    [PERMISSIONS.MANAGE_PLATFORM]: true
  }
};

/* =========================
   Public API
========================= */
export function hasPermission(role, permission) {
  const baseRole = normalizeRole(role);
  return !!ROLE_PERMISSION_MAP[baseRole]?.[permission];
}

export function canAccessPage(role, requiredPermission) {
  return hasPermission(role, requiredPermission);
}
