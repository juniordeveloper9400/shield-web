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
  assert.equal(canAccess('superadmin', 'agent_withdrawals'), true);
  assert.equal(canAccess('admin', 'agent_withdrawals'), true);
  assert.equal(canAccess('pharmacy', 'agent_withdrawals'), false);
  assert.equal(canAccess('lab', 'agent_withdrawals'), false);
  assert.equal(canAccess('appointments', 'agent_withdrawals'), false);
  assert.equal(canAccess('delivery', 'agent_withdrawals'), false);
  assert.equal(
    allowedModules('admin').filter((item) => item.path === '/agent-withdrawals').length,
    1,
  );
});
