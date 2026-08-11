import assert from 'node:assert';
import { test } from 'node:test';
import { classifyExpense, normalizeMerchantName } from '../js/classifier.js';

// Mock categories matching the canonical SnapSpend database setup
// (Groceries, Pharmacy, Travel, Households, Miscellaneous)
const mockCategories = [
    { id: 'cat-groc-1', name: 'Groceries' },
    { id: 'cat-phar-2', name: 'Pharmacy' },
    { id: 'cat-trav-3', name: 'Travel' },
    { id: 'cat-hous-4', name: 'Households' },
    { id: 'cat-misc-5', name: 'Miscellaneous' }
];

test('Test 1: Zara clothing receipt -> Miscellaneous (no Shopping category in canonical set)', () => {
    const result = classifyExpense({
        merchant: 'Zara',
        items: [{ item_name: 'T-shirt', price: 19.99 }, { item_name: 'Jeans', price: 49.99 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Miscellaneous');
    assert.strictEqual(result.categoryId, 'cat-misc-5');
    assert.ok(result.confidence >= 0.85);
});

test('Test 2: H&M clothing receipt (with OCR variations) -> Miscellaneous', () => {
    const result1 = classifyExpense({ merchant: 'H&M', items: [{ item_name: 'Jacket', price: 59.99 }] }, mockCategories);
    const result2 = classifyExpense({ merchant: 'H & M SE', items: [{ item_name: 'Jacket', price: 59.99 }] }, mockCategories);
    const result3 = classifyExpense({ merchant: 'HM.COM', items: [{ item_name: 'Jacket', price: 59.99 }] }, mockCategories);

    assert.strictEqual(result1.categoryName, 'Miscellaneous');
    assert.strictEqual(result2.categoryName, 'Miscellaneous');
    assert.strictEqual(result3.categoryName, 'Miscellaneous');
});

test('Test 3: Nike sporting/apparel receipt -> Miscellaneous', () => {
    const result = classifyExpense({
        merchant: 'Nike Store',
        items: [{ item_name: 'Running Shoes', price: 120.00 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Miscellaneous');
});

test('Test 4: Supermarket receipt -> Groceries', () => {
    const result = classifyExpense({
        merchant: 'Lidl Supermarket',
        items: [{ item_name: 'Milk 1L', price: 1.20 }, { item_name: 'Bread', price: 1.50 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Groceries');
    assert.strictEqual(result.categoryId, 'cat-groc-1');
});

test('Test 5: Restaurant / Fast food receipt -> Travel (dining maps to Travel)', () => {
    const result = classifyExpense({
        merchant: "McDonald's",
        items: [{ item_name: 'Big Mac Meal', price: 9.50 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Travel');
    assert.strictEqual(result.categoryId, 'cat-trav-3');
});

test('Test 6: Airline ticket receipt -> Travel', () => {
    const result = classifyExpense({
        merchant: 'Lufthansa Airlines',
        items: [{ item_name: 'Flight Ticket FRA-LHR', price: 210.00 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Travel');
});

test('Test 7: Hotel receipt -> Travel', () => {
    const result = classifyExpense({
        merchant: 'Hilton Hotel',
        items: [{ item_name: 'Standard Room 2 Nights', price: 340.00 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Travel');
});

test('Test 8: Unknown merchant with insufficient information -> Miscellaneous', () => {
    const result = classifyExpense({
        merchant: 'Unregistered Vendor X99',
        items: [{ item_name: 'Unknown Item Code 001', price: 5.00 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Miscellaneous');
    assert.strictEqual(result.categoryId, 'cat-misc-5');
    assert.strictEqual(result.confidence, 0.10);
});

test('Test 9: Unknown merchant name but clear clothing item evidence -> Miscellaneous', () => {
    const result = classifyExpense({
        merchant: 'Boutique Store 404',
        items: [{ item_name: 'Cotton T-shirt', price: 25.00 }, { item_name: 'Denim Pants', price: 65.00 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Miscellaneous');
    assert.ok(result.confidence >= 0.85);
});

test('Test 10: Explicit user category selection -> Preserved with confidence 1.0', () => {
    const result = classifyExpense({
        merchant: 'Zara',
        userSelectedCategoryId: 'cat-trav-3'
    }, mockCategories);

    assert.strictEqual(result.categoryId, 'cat-trav-3');
    assert.strictEqual(result.categoryName, 'Travel');
    assert.strictEqual(result.confidence, 1.0);
    assert.strictEqual(result.reason, 'Explicit user selection');
});

test('Test 11: Pharmacy merchant receipt -> Pharmacy', () => {
    const result1 = classifyExpense({ merchant: 'Boots Pharmacy', items: [{ item_name: 'Ibuprofen', price: 4.50 }] }, mockCategories);
    const result2 = classifyExpense({ merchant: 'Apotheke am Markt', items: [{ item_name: 'Vitamin D', price: 8.90 }] }, mockCategories);
    const result3 = classifyExpense({ merchant: 'dm-drogerie markt', items: [{ item_name: 'Shampoo', price: 3.20 }] }, mockCategories);

    assert.strictEqual(result1.categoryName, 'Pharmacy');
    assert.strictEqual(result2.categoryName, 'Pharmacy');
    assert.strictEqual(result3.categoryName, 'Pharmacy');
});

test('Test 12: Medicine item evidence -> Pharmacy', () => {
    const result = classifyExpense({
        merchant: 'Some Unknown Store',
        items: [{ item_name: 'Paracetamol 500mg', price: 2.10 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Pharmacy');
});

test('Test 13: Households merchant receipt -> Households', () => {
    const result1 = classifyExpense({ merchant: 'IKEA', items: [{ item_name: 'Lamp', price: 29.99 }] }, mockCategories);
    const result2 = classifyExpense({ merchant: 'Hornbach Baumarkt', items: [{ item_name: 'Paint', price: 15.00 }] }, mockCategories);

    assert.strictEqual(result1.categoryName, 'Households');
    assert.strictEqual(result2.categoryName, 'Households');
});

test('Test 14: Furniture item evidence -> Households', () => {
    const result = classifyExpense({
        merchant: 'Generic Home Store',
        items: [{ item_name: 'Wardrobe', price: 199.00 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Households');
});

test('Test 15: Substring regression — "pharmacy" must not match "macy" (Shopping)', () => {
    const result = classifyExpense({ merchant: 'Boots Pharmacy', items: [{ item_name: 'Medicine', price: 5.00 }] }, mockCategories);
    assert.strictEqual(result.categoryName, 'Pharmacy');
    assert.notStrictEqual(result.categoryName, 'Miscellaneous');
});

test('Test 16: Substring regression — "cab" must not match "cabbage" (Travel)', () => {
    const result = classifyExpense({ merchant: 'Farmers Market', items: [{ item_name: 'Cabbage', price: 1.80 }] }, mockCategories);
    assert.strictEqual(result.categoryName, 'Groceries');
});

test('Test 17: Substring regression — "bag" must not match "bagel" (Shopping)', () => {
    const result = classifyExpense({ merchant: 'Whole Foods Market', items: [{ item_name: 'Bagel', price: 1.50 }] }, mockCategories);
    assert.strictEqual(result.categoryName, 'Groceries');
});

test('normalizeVendor-related: normalizeMerchantName still handles H&M variations', () => {
    assert.strictEqual(normalizeMerchantName('H & M SE'), 'h&m');
    assert.strictEqual(normalizeMerchantName('HM.COM'), 'h&m');
});
