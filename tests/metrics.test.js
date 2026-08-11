import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeVendor,
    normalizeDate,
    nameTokenF1,
    scoreReceipt,
    summarizeScores,
    overallScore
} from '../js/eval/metrics.js';

test('normalizeVendor strips legal suffixes and punctuation', () => {
    assert.equal(normalizeVendor('PENNY-MARKT GMBH'), 'penny markt');
    assert.equal(normalizeVendor('ZARA EUROPA S.L.'), 'zara europa');
    assert.equal(normalizeVendor('H&M SE'), 'h m');
});

test('normalizeDate parses common formats', () => {
    assert.equal(normalizeDate('21.05.2026'), '2026-05-21');
    assert.equal(normalizeDate('21/05/2026'), '2026-05-21');
    assert.equal(normalizeDate('2026-05-21'), '2026-05-21');
    assert.equal(normalizeDate(''), null);
    assert.equal(normalizeDate('not-a-date'), null);
});

test('nameTokenF1 scores exact, partial and disjoint matches', () => {
    assert.equal(nameTokenF1('Orange Juice', 'Orange Juice'), 1);
    assert.ok(nameTokenF1('Orange Juice 1L', 'Orange Juice') > 0.7);
    assert.ok(nameTokenF1('Orange Juice', 'Chocolate Bar') < 0.01);
    assert.equal(nameTokenF1('', ''), 1);
});

test('scoreReceipt grades a perfect parse as all matches', () => {
    const truth = {
        vendor: 'PENNY-MARKT GMBH',
        date: '21.05.2026',
        total_amount: 12.47,
        purchased_items: [['Bread', 1, 1.99, 'EUR', 'Groceries']]
    };
    const predicted = {
        vendor: 'PENNY-MARKT GMBH',
        date: '21.05.2026',
        total_amount: 12.47,
        purchased_items: [['Bread', 1, 1.99, 'EUR', 'Groceries']]
    };
    const s = scoreReceipt(truth, predicted);
    assert.equal(s.valid, true);
    assert.equal(s.vendorExact, true);
    assert.equal(s.vendorNorm, true);
    assert.equal(s.dateExact, true);
    assert.equal(s.totalExact, true);
    assert.equal(s.totalRelErr, 0);
    assert.equal(s.itemCountMatch, true);
    assert.equal(s.itemNameF1, 1);
    assert.equal(s.qtyMatch, 1);
    assert.equal(s.priceRelErr, 0);
    assert.equal(s.categoryMatch, 1);
});

test('scoreReceipt tolerates vendor suffix and date format differences', () => {
    const truth = { vendor: 'PENNY-MARKT GMBH', date: '21.05.2026', total_amount: 10, purchased_items: [] };
    const predicted = { vendor: 'Penny Markt', date: '2026-05-21', total_amount: 10.01, purchased_items: [] };
    const s = scoreReceipt(truth, predicted);
    assert.equal(s.vendorExact, false);
    assert.equal(s.vendorNorm, true);
    assert.equal(s.dateExact, true);
    assert.equal(s.totalExact, false);
    assert.ok(Math.abs(s.totalRelErr - 0.001) < 1e-9);
});

test('scoreReceipt flags invalid and empty model output', () => {
    assert.equal(scoreReceipt({}, null).valid, false);
    assert.equal(scoreReceipt({}, 'junk').valid, false);
    assert.equal(scoreReceipt({}, { vendor: 'x', date: '', total_amount: 1 }).valid, false);
});

test('summarizeScores averages per-receipt metrics and overallScore ranks', () => {
    const perfect = scoreReceipt(
        { vendor: 'A', date: '01.01.2026', total_amount: 5, purchased_items: [['Milk', 1, 2, 'EUR', 'Groceries']] },
        { vendor: 'A', date: '01.01.2026', total_amount: 5, purchased_items: [['Milk', 1, 2, 'EUR', 'Groceries']] }
    );
    const bad = scoreReceipt(
        { vendor: 'A', date: '01.01.2026', total_amount: 5, purchased_items: [['Milk', 1, 2, 'EUR', 'Groceries']] },
        { vendor: 'B', date: '02.02.2026', total_amount: 99, purchased_items: [['Bread', 1, 2, 'EUR', 'Travel']] }
    );

    const good = summarizeScores([perfect]);
    const mixed = summarizeScores([perfect, bad]);

    assert.equal(good.validRate, 100);
    assert.equal(good.vendorNormRate, 100);
    assert.equal(mixed.validRate, 100);
    assert.equal(mixed.vendorNormRate, 50);
    assert.ok(overallScore(good) > overallScore(mixed));
    assert.equal(overallScore(summarizeScores([])), 0);
});
