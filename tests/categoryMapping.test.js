import assert from 'node:assert';
import { test } from 'node:test';
import { resolveCanonicalCategory } from '../js/categoryMapping.js';

test('granular map labels (beverages -> Groceries)', () => {
    assert.strictEqual(resolveCanonicalCategory('beverages'), 'Groceries');
    assert.strictEqual(resolveCanonicalCategory('Beverages'), 'Groceries');
});

test('classifier fallback: groceries items', () => {
    assert.strictEqual(resolveCanonicalCategory('milk'), 'Groceries');
    assert.strictEqual(resolveCanonicalCategory('bread'), 'Groceries');
    assert.strictEqual(resolveCanonicalCategory('apples'), 'Groceries');
});

test('classifier fallback: clothing/apparel resolves to Miscellaneous', () => {
    assert.strictEqual(resolveCanonicalCategory('clothes'), 'Miscellaneous');
    assert.strictEqual(resolveCanonicalCategory('shirt'), 'Miscellaneous');
    assert.strictEqual(resolveCanonicalCategory('jeans'), 'Miscellaneous');
    assert.strictEqual(resolveCanonicalCategory('clothing'), 'Miscellaneous');
});

test('known merchants resolve to their canonical category', () => {
    assert.strictEqual(resolveCanonicalCategory('Lidl'), 'Groceries');
    assert.strictEqual(resolveCanonicalCategory('Rossmann'), 'Pharmacy');
    assert.strictEqual(resolveCanonicalCategory('Bolt'), 'Travel');
    assert.strictEqual(resolveCanonicalCategory('IKEA'), 'Households');
});

test('unknown merchant with no evidence falls back to Miscellaneous', () => {
    assert.strictEqual(resolveCanonicalCategory('Zara'), 'Miscellaneous');
});

test('canonical names pass through', () => {
    assert.strictEqual(resolveCanonicalCategory('pharmacy'), 'Pharmacy');
    assert.strictEqual(resolveCanonicalCategory('travel'), 'Travel');
    assert.strictEqual(resolveCanonicalCategory('households'), 'Households');
    assert.strictEqual(resolveCanonicalCategory('misc'), 'Miscellaneous');
});

test('empty input returns null', () => {
    assert.strictEqual(resolveCanonicalCategory(''), null);
    assert.strictEqual(resolveCanonicalCategory('   '), null);
    assert.strictEqual(resolveCanonicalCategory(null), null);
});