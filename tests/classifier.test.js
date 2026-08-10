import assert from 'node:assert';
import { test } from 'node:test';
import { classifyExpense, normalizeMerchantName } from '../js/classifier.js';

// Standard mock categories matching default SnapSpend database setup
const mockCategories = [
    { id: 'cat-misc-1', name: 'Miscellaneous' },
    { id: 'cat-shop-2', name: 'Shopping' },
    { id: 'cat-trav-3', name: 'Travel' },
    { id: 'cat-out-4', name: 'Trips / Outings' }
];

test('Test 1: Zara clothing receipt -> Shopping', () => {
    const result = classifyExpense({
        merchant: 'Zara',
        items: [{ item_name: 'T-shirt', price: 19.99 }, { item_name: 'Jeans', price: 49.99 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Shopping');
    assert.strictEqual(result.categoryId, 'cat-shop-2');
    assert.ok(result.confidence >= 0.85);
});

test('Test 2: H&M clothing receipt (with OCR variations) -> Shopping', () => {
    const result1 = classifyExpense({ merchant: 'H&M', items: [{ item_name: 'Jacket', price: 59.99 }] }, mockCategories);
    const result2 = classifyExpense({ merchant: 'H & M SE', items: [{ item_name: 'Jacket', price: 59.99 }] }, mockCategories);
    const result3 = classifyExpense({ merchant: 'HM.COM', items: [{ item_name: 'Jacket', price: 59.99 }] }, mockCategories);

    assert.strictEqual(result1.categoryName, 'Shopping');
    assert.strictEqual(result2.categoryName, 'Shopping');
    assert.strictEqual(result3.categoryName, 'Shopping');
});

test('Test 3: Nike sporting/apparel receipt -> Shopping', () => {
    const result = classifyExpense({
        merchant: 'Nike Store',
        items: [{ item_name: 'Running Shoes', price: 120.00 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Shopping');
});

test('Test 4: Supermarket receipt -> Groceries / Shopping (closest available category)', () => {
    // A) With default categories (Shopping, Travel, Trips / Outings, Miscellaneous)
    const resDefault = classifyExpense({
        merchant: 'Lidl Supermarket',
        items: [{ item_name: 'Milk 1L', price: 1.20 }, { item_name: 'Bread', price: 1.50 }]
    }, mockCategories);
    assert.ok(resDefault.categoryName === 'Shopping' || resDefault.categoryName === 'Trips / Outings');

    // B) With a custom Groceries category added
    const categoriesWithGroceries = [
        ...mockCategories,
        { id: 'cat-groc-5', name: 'Groceries' }
    ];
    const resCustom = classifyExpense({
        merchant: 'Lidl Supermarket',
        items: [{ item_name: 'Milk 1L', price: 1.20 }, { item_name: 'Bread', price: 1.50 }]
    }, categoriesWithGroceries);

    assert.strictEqual(resCustom.categoryName, 'Groceries');
    assert.strictEqual(resCustom.categoryId, 'cat-groc-5');
});

test('Test 5: Restaurant / Fast food receipt -> Trips / Outings', () => {
    const result = classifyExpense({
        merchant: "McDonald's",
        items: [{ item_name: 'Big Mac Meal', price: 9.50 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Trips / Outings');
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
    assert.strictEqual(result.categoryId, 'cat-misc-1');
    assert.strictEqual(result.confidence, 0.10);
});

test('Test 9: Unknown merchant name but clear clothing item evidence -> Shopping', () => {
    const result = classifyExpense({
        merchant: 'Boutique Store 404',
        items: [{ item_name: 'Cotton T-shirt', price: 25.00 }, { item_name: 'Denim Pants', price: 65.00 }]
    }, mockCategories);

    assert.strictEqual(result.categoryName, 'Shopping');
    assert.ok(result.confidence >= 0.85);
});

test('Test 10: Explicit user category selection -> Preserved with confidence 1.0', () => {
    const result = classifyExpense({
        merchant: 'Zara',
        userSelectedCategoryId: 'cat-shop-2'
    }, mockCategories);

    assert.strictEqual(result.categoryId, 'cat-shop-2');
    assert.strictEqual(result.categoryName, 'Shopping');
    assert.strictEqual(result.confidence, 1.0);
    assert.strictEqual(result.reason, 'Explicit user selection');
});
