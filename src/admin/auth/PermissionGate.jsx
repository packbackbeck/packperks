import { useAuth, hasPermission } from './AuthContext';
import './PermissionGate.css';

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
  const allowed = profile ? hasPermission(profile.role, action) : false;

  if (allowed) return children;

  if (mode === 'hide') return null;

  // Disable mode — clone the child element with disabled + a hover tooltip.
  // We wrap in a span so the tooltip survives even if the child intercepts
  // pointer events when disabled.
  const reason = tooltip || requiredRoleLabel(action);
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
    'reward.publish':      'Admin',
    'cupqr.generate':      'Manager',
    'customer.adjust':     'Admin',
    'team.invite':         'Admin',
    'team.role':           'Admin',
    'team.password':       'Admin',
    'team.block':          'Admin',
    'team.delete':         'Owner',
    'org.edit':            'Admin',
    'audit.read':          'Admin',
    'settings.maintenance':'Admin',
  };
  const role = minRole[action] || 'a higher role';
  return `Requires ${role} access`;
}
