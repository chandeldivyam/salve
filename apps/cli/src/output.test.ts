import assert from 'node:assert/strict';
import { test } from 'node:test';
import { colorize, dataRows, outputMode } from './output/format.js';

test('outputMode defaults to json for pipes and honors explicit flags', () => {
  assert.equal(outputMode({}), 'json');
  assert.equal(outputMode({ json: true }), 'json');
  assert.equal(outputMode({ jsonl: true }), 'jsonl');
});

test('dataRows extracts paginated rows for jsonl output', () => {
  assert.deepEqual(dataRows({ data: [{ id: 'one' }, { id: 'two' }], hasMore: false }), [
    { id: 'one' },
    { id: 'two' },
  ]);
  assert.deepEqual(dataRows({ id: 'single' }), [{ id: 'single' }]);
});

test('colorize respects --no-color and NO_COLOR', () => {
  const previousNoColor = process.env.NO_COLOR;

  try {
    assert.equal(colorize({ color: false }).red('error'), 'error');

    process.env.NO_COLOR = '1';
    assert.equal(colorize({}).green('ok'), 'ok');
  } finally {
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previousNoColor;
    }
  }
});
