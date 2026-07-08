/*
 * Capability matrix — single source of truth for "can role X do action Y?"
 *
 * Used by:
 *   - server/services/* to authorize requests
 *   - renderer to gate UI (hide buttons the user can't use)
 *
 * Global admins are short-circuited to true for every capability in the
 * `can()` helper below; they never need an entry in the matrix.
 */

const { PROJECT_ROLES } = require('./roles');

const CAPS = Object.freeze({
  PROJECT_VIEW:           'project:view',
  PROJECT_EDIT:           'project:edit',
  PROJECT_DELETE:         'project:delete',
  MEMBERS_MANAGE:         'members:manage',
  SOURCE_UPLOAD:          'source:upload',
  SOURCE_DELETE:          'source:delete',
  ASSESSMENT_EDIT:        'assessment:edit',
  VOUCHERVISION_RUN:      'vouchervision:run',
  // Create/rename/delete tags and attach them to items in the Library.
  SOURCE_TAG:             'source:tag',
});

// project role → set of capabilities
const PROJECT_CAPABILITIES = Object.freeze({
  [PROJECT_ROLES.OWNER]: new Set([
    CAPS.PROJECT_VIEW, CAPS.PROJECT_EDIT, CAPS.PROJECT_DELETE,
    CAPS.MEMBERS_MANAGE,
    CAPS.SOURCE_UPLOAD, CAPS.SOURCE_DELETE, CAPS.SOURCE_TAG,
    CAPS.ASSESSMENT_EDIT, CAPS.VOUCHERVISION_RUN,
  ]),
  [PROJECT_ROLES.EDITOR]: new Set([
    CAPS.PROJECT_VIEW,
    CAPS.SOURCE_UPLOAD, CAPS.SOURCE_DELETE, CAPS.SOURCE_TAG,
    CAPS.ASSESSMENT_EDIT, CAPS.VOUCHERVISION_RUN,
  ]),
  [PROJECT_ROLES.UPLOADER]: new Set([
    CAPS.PROJECT_VIEW,
    CAPS.SOURCE_UPLOAD,
  ]),
});

function can(projectRole, capability) {
  const set = PROJECT_CAPABILITIES[projectRole];
  return !!(set && set.has(capability));
}

module.exports = { CAPS, PROJECT_CAPABILITIES, can };
