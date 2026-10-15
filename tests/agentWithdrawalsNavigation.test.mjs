import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allowedModules,
  canAccess,
  MODULES,
} from '../src/config/permissions.ts';

test('agent withdrawals is a dedicated admin approval module', () => {
  const module = MODULES.find((item) => item.key === 'agent_withdrawals');

  assert.deepEqual(module, {
    key: 'agent_withdrawals',
    label: 'Agent Withdrawals',
    path: '/agent-withdrawals',
    icon: 'accounts',
    description: 'Verify, approve and record agent earnings withdrawals',
  });
  assert.equal(canAccess({ role: 'superadmin' }, 'agent_withdrawals'), true);
  assert.equal(canAccess({ role: 'admin' }, 'agent_withdrawals'), true);
  assert.equal(canAccess({ role: 'pharmacy' }, 'agent_withdrawals'), false);
  assert.equal(canAccess({ role: 'lab' }, 'agent_withdrawals'), false);
  assert.equal(canAccess({ role: 'appointments' }, 'agent_withdrawals'), false);
  assert.equal(canAccess({ role: 'delivery' }, 'agent_withdrawals'), false);
  assert.equal(
    allowedModules({ role: 'admin' }).filter((item) => item.path === '/agent-withdrawals').length,
    1,
  );
});
