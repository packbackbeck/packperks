import { useAuth, hasPermission } from './AuthContext';
import { useViewRole } from '../context/ViewRole';
import { TAB_BY_ID } from '../lib/access';
import './PermissionGate.css';

/* The dashboard tab each action changes. A role that can only view that
 * tab doesn't get the action, whatever its old role name allows. */
const ACTION_TAB = {
  'claim.approve': 'claims',
  'claim.hide_image': 'claims',
  'reward.edit': 'rewards',
  'reward.publish': 'rewards',
  'cupqr.generate': 'cupqr',
  'customer.adjust': 'users',
  'team.invite': 'master',
  'team.role': 'master',
  'team.password': 'master',
  'team.block': 'master',
  'team.delete': 'master',
  'org.edit': 'master',
  'audit.read': 'master',
  'settings.maintenance': 'settings',
};

/* Permission-aware wrapper. Three render modes (pick whichever fits the
 * surrounding UI):
 *
 *   <PermissionGate action="claim.approve">
 *     <button>Approve</button>          // children rendered as-is when allowed
 *   </PermissionGate>
 *
 *   <PermissionGate action="..." mode="hide">
 *     <button>Approve</button>          // mode="hide": rendered or nothing
 *   </PermissionGate>
 *
 *   <PermissionGate action="..." mode="disable" tooltip="Needs admin">
 *     <button>Approve</button>          // disabled clone with tooltip on hover
 *   </PermissionGate>
 *
 * Default mode is "disable" — better UX than hiding because the user can
 * see what they would have access to with a higher role.
 *
 * `tooltip` is optional; when omitted we derive one from the role
 * requirement, e.g. "Requires Admin role". */
export default function PermissionGate({
  action,
  mode = 'disable',
  tooltip,
  children,
}) {
  const { profile } = useAuth();
  const { access } = useViewRole();
  const tab = ACTION_TAB[action];
  const tabAllows = !access || !tab || access.canEdit(tab);
  const allowed = profile ? hasPermission(profile.role, action) && tabAllows : false;

  if (allowed) return children;

  if (mode === 'hide') return null;

  // Disable mode — clone the child element with disabled + a hover tooltip.
  // We wrap in a span so the tooltip survives even if the child intercepts
  // pointer events when disabled.
  const reason = tooltip || (!tabAllows && TAB_BY_ID[tab]
    ? `Your role can view ${TAB_BY_ID[tab].label} but not change it`
    : requiredRoleLabel(action));
  return (
    <span className="pg-wrap" data-tooltip={reason}>
      <span className="pg-blocker" aria-hidden="true" />
      {Array.isArray(children) ? children : cloneDisabled(children)}
    </span>
  );
}

function cloneDisabled(el) {
  // Disable interactive children without breaking layout. We rely on the
  // .pg-blocker overlay (above) to swallow clicks for non-form elements.
  if (!el || typeof el !== 'object') return el;
  const props = { ...(el.props || {}) };
  props.disabled = true;
  props['aria-disabled'] = 'true';
  props.tabIndex = -1;
  props.onClick = (e) => { e.preventDefault(); e.stopPropagation(); };
  return { ...el, props };
}

function requiredRoleLabel(action) {
  // Mirror of the permission matrix in AuthContext. Surfaces the minimum
  // role that grants the action so the tooltip is helpful instead of vague.
  const minRole = {
    'claim.approve':       'Manager',
    'reward.edit':         'Manager',
    'reward.publish':      'Manager',
    'cupqr.generate':      'Manager',
    'customer.adjust':     'Master',
    'team.invite':         'Master',
    'team.role':           'Master',
    'team.password':       'Master',
    'team.block':          'Master',
    'team.delete':         'Master',
    'org.edit':            'Master',
    'audit.read':          'Master',
    'settings.maintenance':'Master',
  };
  const role = minRole[action] || 'a higher role';
  return `Requires ${role} access`;
}
