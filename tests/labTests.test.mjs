import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blankLabTest,
  groupTotal,
  netAmount,
  nextSetOrder,
  searchLabTests,
  validateLabTest,
} from '../src/lib/labTests.ts';

const item = (testId, name, amount, setOrder = 1) => ({
  testId,
  name,
  department: 'BIOCHEMISTRY',
  sample: 'SERUM',
  amount,
  setOrder,
  isSubhead: false,
});

const group = (over = {}) => ({ ...blankLabTest(), name: 'KFT', testType: 'GROUP', ...over });

test('the amount is the rate less the discount, to the paisa', () => {
  assert.equal(netAmount(300, 0), 300);
  assert.equal(netAmount(300, 10), 270);
  assert.equal(netAmount(199, 12.5), 174.13);
});

test('a blank or out-of-range rate and discount never produce a negative amount', () => {
  assert.equal(netAmount(Number.NaN, 10), 0);
  assert.equal(netAmount(-50, 0), 0);
  assert.equal(netAmount(200, 150), 0);
  assert.equal(netAmount(200, -20), 200);
});

test('the group amount is the sum of what each test costs inside the group', () => {
  // The screenshot's KFT: 90 + 70 + 100 + 160 + 190 + 160.
  const items = [90, 70, 100, 160, 190, 160].map((a, i) => item(String(i), `T${i}`, a));
  assert.equal(groupTotal(items), 770);
  assert.equal(groupTotal([]), 0);
  assert.equal(groupTotal([item('1', 'A', 0.1), item('2', 'B', 0.2)]), 0.3);
});

test('the next set order follows the highest one in use', () => {
  assert.equal(nextSetOrder([]), 1);
  assert.equal(nextSetOrder([item('1', 'A', 1, 2), item('2', 'B', 1, 6)]), 7);
});

test('a test needs a name', () => {
  assert.equal(validateLabTest(blankLabTest(), [], []), 'Enter the test name.');
  assert.equal(validateLabTest({ ...blankLabTest(), name: 'TSH' }, [], []), null);
});

test('a group test or package needs at least one test, a single test does not', () => {
  assert.match(validateLabTest(group(), [], []), /needs at least one test/);
  assert.match(
    validateLabTest(group({ testType: 'PACKAGE' }), [], []),
    /package needs at least one test/,
  );
  assert.equal(validateLabTest(group(), [item('1', 'CREATININE', 70)], []), null);
});

test('the same test cannot be listed twice in a group', () => {
  const items = [item('1', 'CREATININE', 70), item('1', 'CREATININE', 70, 2)];
  assert.match(validateLabTest(group(), items, []), /"CREATININE" appears twice/);
});

test('a group row with no test chosen is refused', () => {
  assert.match(validateLabTest(group(), [item('', '', 0)], []), /no test chosen/);
});

test('the discount must stay between 0 and 100', () => {
  assert.match(
    validateLabTest({ ...blankLabTest(), name: 'X', discountPercent: 120 }, [], []),
    /Disc%/,
  );
});

test('special rates need a lab name, one row per lab, and a non-negative rate', () => {
  const t = { ...blankLabTest(), name: 'TSH' };
  assert.match(validateLabTest(t, [], [{ refLab: ' ', rate: 10 }]), /no Ref Lab/);
  assert.match(
    validateLabTest(t, [], [
      { refLab: 'Metropolis', rate: 10 },
      { refLab: 'metropolis ', rate: 20 },
    ]),
    /two Special Rate rows/,
  );
  assert.match(validateLabTest(t, [], [{ refLab: 'SRL', rate: -1 }]), /cannot be negative/);
  assert.equal(validateLabTest(t, [], [{ refLab: 'SRL', rate: 90 }]), null);
});

test('the lab rate cannot be negative, and defaults to none quoted', () => {
  assert.equal(blankLabTest().labRate, 0);
  assert.match(
    validateLabTest({ ...blankLabTest(), name: 'X', labRate: -5 }, [], []),
    /lab rate cannot be negative/,
  );
  assert.equal(validateLabTest({ ...blankLabTest(), name: 'X', labRate: 550 }, [], []), null);
});

test('the rate-list fields default to blank so an old form still saves', () => {
  const blank = blankLabTest();
  assert.equal(blank.scheduledDays, '');
  assert.equal(blank.reportingTime, '');
  assert.equal(blank.cutOfTime, '');
});

// The search box is handed every test on record -- the tests made in the
// console and the imported rate list -- and, with nothing typed, offers all.
const master = [
  { name: 'Adrenaline (Epinephrine)', shortName: '', lisCode: 1001 },
  { name: 'Complete Blood Count', shortName: 'CBC', lisCode: 1002 },
  { name: 'Kidney Function Test', shortName: 'KFT', lisCode: 1010 },
  { name: 'Liver Function Test', shortName: 'LFT', lisCode: 2003 },
];
const names = (tests) => tests.map((t) => t.name);

test('the search offers every test, in the order given, until something is typed', () => {
  assert.deepEqual(names(searchLabTests(master, 'name', '')), names(master));
  assert.deepEqual(names(searchLabTests(master, 'name', '   ')), names(master));
  assert.deepEqual(names(searchLabTests(master, 'short', '')), names(master));
  assert.deepEqual(names(searchLabTests(master, 'lis', '')), names(master));
});

test('searching by name finds the text anywhere in it, in any case', () => {
  assert.deepEqual(names(searchLabTests(master, 'name', 'function')), [
    'Kidney Function Test',
    'Liver Function Test',
  ]);
  assert.deepEqual(names(searchLabTests(master, 'name', '  BLOOD ')), ['Complete Blood Count']);
  assert.deepEqual(searchLabTests(master, 'name', 'zzz'), []);
});

test('searching by short name only looks at short names', () => {
  assert.deepEqual(names(searchLabTests(master, 'short', 'cbc')), ['Complete Blood Count']);
  assert.deepEqual(searchLabTests(master, 'short', 'blood'), []);
});

test('searching by Lis Code matches the start of the code', () => {
  assert.deepEqual(names(searchLabTests(master, 'lis', '100')), [
    'Adrenaline (Epinephrine)',
    'Complete Blood Count',
  ]);
  assert.deepEqual(names(searchLabTests(master, 'lis', '10')), [
    'Adrenaline (Epinephrine)',
    'Complete Blood Count',
    'Kidney Function Test',
  ]);
  assert.deepEqual(names(searchLabTests(master, 'lis', '1010')), ['Kidney Function Test']);
  assert.deepEqual(searchLabTests(master, 'lis', '003'), []); // the start, not the middle
});

test('a big master is searched whole, not capped to a handful', () => {
  const big = Array.from({ length: 525 }, (_, i) => ({
    name: `Test ${i + 1}`,
    shortName: '',
    lisCode: 1001 + i,
  }));
  assert.equal(searchLabTests(big, 'name', '').length, 525);
  assert.equal(searchLabTests(big, 'name', 'test').length, 525);
  // "Test 5", "Test 50".."Test 59" and "Test 500".."Test 525": 1 + 10 + 26.
  assert.equal(searchLabTests(big, 'name', 'Test 5').length, 37);
});
