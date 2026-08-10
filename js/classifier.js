// Simple, dependency-free Naive Bayes Text Classifier in Vanilla JS
// Used for on-device automatic categorization of expense descriptions

export class NaiveBayesClassifier {
    constructor() {
        this.categories = new Set();
        this.tokenCount = {};     // { categoryId: { token: count } }
        this.categoryCount = {};  // { categoryId: docCount }
        this.totalDocs = 0;
    }

    tokenize(text) {
        if (!text) return [];
        return String(text)
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')
            .split(/\s+/)
            .filter(t => t.trim().length > 1);
    }

    train(text, categoryId) {
        if (!text || !categoryId) return;
        const tokens = this.tokenize(text);
        if (tokens.length === 0) return;

        if (!this.categoryCount[categoryId]) {
            this.categoryCount[categoryId] = 0;
            this.tokenCount[categoryId] = {};
        }
        this.categoryCount[categoryId]++;
        this.totalDocs++;
        this.categories.add(categoryId);

        tokens.forEach(token => {
            this.tokenCount[categoryId][token] = (this.tokenCount[categoryId][token] || 0) + 1;
        });
    }

    predict(text) {
        if (this.totalDocs === 0 || this.categories.size === 0) return null;
        const tokens = this.tokenize(text);
        if (tokens.length === 0) return null;

        let bestCategory = null;
        let maxScore = -Infinity;

        this.categories.forEach(categoryId => {
            // Prior probability: P(Category)
            let score = Math.log(this.categoryCount[categoryId] / this.totalDocs);

            // Sum of all token counts in this category
            const catTokenCounts = this.tokenCount[categoryId];
            const catTotalTokens = Object.values(catTokenCounts).reduce((sum, val) => sum + val, 0);

            tokens.forEach(token => {
                const count = catTokenCounts[token] || 0;
                // Laplace smoothing with vocabulary approximation size
                const probability = (count + 1) / (catTotalTokens + 1000);
                score += Math.log(probability);
            });

            if (score > maxScore) {
                maxScore = score;
                bestCategory = categoryId;
            }
        });

        return bestCategory;
    }
}

/**
 * Safely normalizes raw merchant names to eliminate common OCR / store variations.
 * Examples:
 *   "ZARA.COM" -> "zara"
 *   "ZARA EUROPA" -> "zara"
 *   "H & M SE" -> "h&m"
 *   "HM.COM" -> "h&m"
 */
export function normalizeMerchantName(rawName) {
    if (!rawName || typeof rawName !== 'string') return '';

    let str = rawName.toLowerCase().trim();

    // Strip protocols and web domain structures
    str = str.replace(/https?:\/\//g, '').replace(/www\./g, '');
    str = str.replace(/\.(com|de|eu|org|net|co\.uk|io|ai|store|shop|se)\b/gi, '');

    // Common legal or corporate suffixes to strip
    const suffixes = [
        'inc', 'inc.', 'ltd', 'ltd.', 'gmbh', 'corp', 'corp.', 'corporation',
        'llc', 'co.', 'co', 'company', 'store', 'stores', 'shop', 'europa', 'express',
        'international', 'online', 'official', 'se', 'uk', 'usa', 'de'
    ];

    // Split on delimiters
    let words = str.split(/[\s,_\-\/\.\&]+/).filter(Boolean);

    // H&M variation handling: h, m -> h&m
    if (str.includes('h&m') || str.includes('h & m') || (words.length === 2 && words[0] === 'h' && words[1] === 'm') || str === 'hm' || str.startsWith('hm ')) {
        return 'h&m';
    }

    // Filter out trailing legal/location suffixes
    words = words.filter(w => !suffixes.includes(w));

    return words.join(' ');
}

/**
 * Known Merchant Rules Mapping to Canonical Category Concepts
 */
const KNOWN_MERCHANT_MAP = [
    {
        concept: 'Shopping',
        keywords: [
            'zara', 'h&m', 'hm', 'uniqlo', 'nike', 'adidas', 'puma', 'mango', 'gap',
            'levis', 'levi', 'forever 21', 'urban outfitters', 'gucci', 'prada',
            'decathlon', 'nordstrom', 'macy', 'macys', 'target', 'walmart', 'sephora', 'victoria secret',
            'asos', 'zalando', 'shein', 'bershka', 'pull&bear', 'stradivarius', 'primark',
            'apple', 'best buy', 'apple store', 'mediamarkt', 'currys', 'b&h', 'micro center'
        ]
    },
    {
        concept: 'Travel',
        keywords: [
            'lufthansa', 'emirates', 'delta', 'united', 'united airlines', 'ryanair', 'easyjet',
            'british airways', 'singapore airlines', 'air france', 'air india', 'qantas',
            'southwest', 'american airlines', 'klm', 'air canada', 'etihad', 'qatar airways',
            'booking.com', 'booking', 'expedia', 'airbnb', 'agoda', 'trip.com', 'kayak',
            'trivago', 'skyscanner', 'hotels.com',
            'amtrak', 'eurostar', 'deutsche bahn', 'flixbus', 'uber', 'lyft', 'grab', 'bolt',
            'hilton', 'marriott', 'hyatt', 'sheraton', 'holiday inn', 'radisson', 'hostel',
            'hotel', 'resort', 'motel'
        ]
    },
    {
        concept: 'Trips / Outings',
        keywords: [
            'mcdonalds', 'mcdonald', 'burger king', 'kfc', 'subway', 'dominos', 'domino',
            'pizza hut', 'starbucks', 'dunkin', 'chipotle', 'taco bell', 'wendys', 'wendy',
            'nandos', 'five guys', 'shake shack', 'popeyes',
            'cafe', 'coffee', 'bistro', 'restaurant', 'diner', 'pub', 'bar', 'pizzeria', 'sushi',
            'cinema', 'amc', 'cinemark', 'regal', 'netflix', 'spotify', 'ticketmaster',
            'eventbrite', 'concert', 'theater', 'bowling', 'zoo', 'museum', 'theme park', 'disney'
        ]
    },
    {
        concept: 'Groceries',
        keywords: [
            'carrefour', 'tesco', 'lidl', 'aldi', 'sainsbury', 'asda', 'waitrose', 'rewe',
            'edeka', 'monoprix', 'auchan', 'mercadona', 'kroger', 'trader joe', 'whole foods',
            'safeway', 'publix', 'woolworths', 'coles', 'supermarket', 'grocery', 'market'
        ]
    }
];

/**
 * Product Item / Description Keywords Mapping to Canonical Category Concepts
 */
const ITEM_KEYWORD_MAP = [
    {
        concept: 'Shopping',
        keywords: [
            'shirt', 't-shirt', 'tshirt', 'trousers', 'pants', 'jeans', 'jacket', 'coat',
            'shoes', 'sneakers', 'boots', 'dress', 'skirt', 'sweater', 'hoodie', 'socks',
            'underwear', 'clothing', 'apparel', 'wear', 'fashion', 'bag', 'handbag', 'hat',
            'cap', 'laptop', 'phone', 'headphone', 'cable', 'gadget', 'watch', 'electronics',
            'accessory', 'perfume', 'makeup', 'cosmetics'
        ]
    },
    {
        concept: 'Travel',
        keywords: [
            'flight', 'flight ticket', 'boarding pass', 'airline', 'hotel', 'hotel room',
            'stay', 'lodging', 'resort', 'accommodation', 'train', 'railway', 'fare', 'cab',
            'taxi', 'car rental', 'toll', 'baggage', 'luggage', 'passport'
        ]
    },
    {
        concept: 'Trips / Outings',
        keywords: [
            'burger', 'pizza', 'coffee', 'latte', 'cappuccino', 'espresso', 'sandwich',
            'pasta', 'sushi', 'noodle', 'beer', 'wine', 'cocktail', 'meal', 'lunch',
            'dinner', 'breakfast', 'brunch', 'movie', 'movie ticket', 'cinema', 'show',
            'concert', 'entry fee', 'park entry', 'drink', 'beverage', 'dessert', 'snack'
        ]
    },
    {
        concept: 'Groceries',
        keywords: [
            'milk', 'bread', 'vegetables', 'fruit', 'apples', 'bananas', 'cheese', 'butter',
            'eggs', 'yogurt', 'rice', 'flour', 'sugar', 'meat', 'chicken', 'beef', 'pork',
            'fish', 'seafood', 'produce', 'grocery', 'cereal', 'oil', 'pasta'
        ]
    }
];

/**
 * Maps a canonical category concept ('Shopping', 'Travel', 'Trips / Outings', 'Groceries', etc.)
 * to the best available user category in `userCategories`.
 */
export function resolveConceptToUserCategory(concept, userCategories) {
    if (!Array.isArray(userCategories) || userCategories.length === 0) {
        return null;
    }

    const normConcept = concept.toLowerCase().trim();

    // 1. Direct exact name match
    let match = userCategories.find(c => c.name.toLowerCase().trim() === normConcept);
    if (match) return match;

    // 2. Alias mapping fallback matrix based on available user categories
    const conceptAliases = {
        'shopping': ['shopping', 'clothing', 'apparel', 'retail', 'stores', 'electronics', 'goods'],
        'travel': ['travel', 'trips', 'vacation', 'transport', 'transportation', 'flights', 'hotels'],
        'trips / outings': ['trips / outings', 'trips/outings', 'outings', 'dining', 'restaurants', 'entertainment', 'food & dining', 'food'],
        'groceries': ['groceries', 'grocery', 'food', 'supermarket', 'food & groceries', 'shopping', 'trips / outings']
    };

    const aliases = conceptAliases[normConcept] || [normConcept];

    for (const alias of aliases) {
        match = userCategories.find(c => c.name.toLowerCase().trim() === alias);
        if (match) return match;
    }

    // 3. Partial substring match
    for (const alias of aliases) {
        match = userCategories.find(c => c.name.toLowerCase().includes(alias) || alias.includes(c.name.toLowerCase()));
        if (match) return match;
    }

    // 4. Default fallback category ('Miscellaneous' or userCategories[0])
    const miscCat = userCategories.find(c => c.name.toLowerCase().trim() === 'miscellaneous');
    return miscCat || userCategories[0];
}

/**
 * Centralized Category Classifier
 * Analyzes receipt metadata, merchant name, purchased items, and fallback models.
 * Returns: { categoryId, categoryName, confidence, reason }
 */
export function classifyExpense(data, userCategories, naiveBayesClassifier = null) {
    if (!Array.isArray(userCategories) || userCategories.length === 0) {
        return { categoryId: null, categoryName: 'Uncategorized', confidence: 0, reason: 'No categories available' };
    }

    // Priority A: Explicit user-supplied category
    if (data && data.userSelectedCategoryId) {
        const selected = userCategories.find(c => c.id === data.userSelectedCategoryId);
        if (selected) {
            return {
                categoryId: selected.id,
                categoryName: selected.name,
                confidence: 1.0,
                reason: 'Explicit user selection'
            };
        }
    }

    const merchantRaw = data?.merchant || data?.vendor || '';
    const merchantNorm = normalizeMerchantName(merchantRaw);
    const noteRaw = (data?.note || data?.description || '').toLowerCase();

    // Extract items
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.purchasedItems) ? data.purchasedItems : []);
    const itemNames = items.map(it => {
        if (typeof it === 'string') return it.toLowerCase();
        if (Array.isArray(it)) return (it[0] || '').toLowerCase();
        return (it?.item_name || it?.name || '').toLowerCase();
    }).filter(Boolean);
    const itemCategories = items.map(it => {
        if (typeof it === 'object' && it !== null) {
            return (it.category || '').toLowerCase();
        }
        return '';
    }).filter(Boolean);

    const fullText = [merchantRaw, noteRaw, ...itemNames, ...itemCategories].join(' ').toLowerCase();

    // Special handling for general online retailers (Amazon, eBay, AliExpress)
    const isGeneralRetailer = merchantNorm.includes('amazon') || merchantNorm.includes('ebay') || merchantNorm.includes('aliexpress');
    if (isGeneralRetailer && itemNames.length > 0) {
        for (const rule of ITEM_KEYWORD_MAP) {
            for (const kw of rule.keywords) {
                if (itemNames.some(name => name.includes(kw))) {
                    const matchedCat = resolveConceptToUserCategory(rule.concept, userCategories);
                    if (matchedCat) {
                        return {
                            categoryId: matchedCat.id,
                            categoryName: matchedCat.name,
                            confidence: 0.88,
                            reason: `Matched item keyword "${kw}" for online merchant "${merchantRaw}"`
                        };
                    }
                }
            }
        }
    }

    // Priority B: Known Merchant Rule Matching
    if (merchantNorm) {
        for (const rule of KNOWN_MERCHANT_MAP) {
            for (const kw of rule.keywords) {
                const kwNorm = normalizeMerchantName(kw);
                if (merchantNorm === kwNorm || merchantNorm.startsWith(kwNorm + ' ') || merchantNorm.includes(kwNorm)) {
                    const matchedCat = resolveConceptToUserCategory(rule.concept, userCategories);
                    if (matchedCat) {
                        return {
                            categoryId: matchedCat.id,
                            categoryName: matchedCat.name,
                            confidence: 0.95,
                            reason: `Matched merchant rule "${kw}" for vendor "${merchantRaw}"`
                        };
                    }
                }
            }
        }
    }

    // Priority C: Product / Item Keyword Evidence Matching
    if (itemNames.length > 0 || noteRaw) {
        for (const rule of ITEM_KEYWORD_MAP) {
            for (const kw of rule.keywords) {
                if (fullText.includes(kw)) {
                    const matchedCat = resolveConceptToUserCategory(rule.concept, userCategories);
                    if (matchedCat) {
                        return {
                            categoryId: matchedCat.id,
                            categoryName: matchedCat.name,
                            confidence: 0.85,
                            reason: `Matched product keyword "${kw}" in text/items`
                        };
                    }
                }
            }
        }
    }

    // Priority D: Receipt Sub-Category Evidence (Gemini OCR category output)
    if (itemCategories.length > 0) {
        const catFreq = {};
        itemCategories.forEach(c => { catFreq[c] = (catFreq[c] || 0) + 1; });
        const topSubCat = Object.keys(catFreq).sort((a, b) => catFreq[b] - catFreq[a])[0];

        if (topSubCat && topSubCat !== 'other') {
            const matchedCat = resolveConceptToUserCategory(topSubCat, userCategories);
            if (matchedCat && matchedCat.name.toLowerCase() !== 'miscellaneous') {
                return {
                    categoryId: matchedCat.id,
                    categoryName: matchedCat.name,
                    confidence: 0.80,
                    reason: `Matched OCR line item category "${topSubCat}"`
                };
            }
        }
    }

    // Priority E: Naive Bayes ML Classifier Fallback (trained on historical transactions)
    if (naiveBayesClassifier && (merchantRaw || noteRaw)) {
        const predictedId = naiveBayesClassifier.predict(`${merchantRaw} ${noteRaw}`);
        if (predictedId) {
            const matched = userCategories.find(c => c.id === predictedId);
            if (matched) {
                return {
                    categoryId: matched.id,
                    categoryName: matched.name,
                    confidence: 0.70,
                    reason: 'Naive Bayes historical prediction'
                };
            }
        }
    }

    // Priority F: Miscellaneous Fallback
    const miscCat = userCategories.find(c => c.name.toLowerCase().trim() === 'miscellaneous') || userCategories[0];
    return {
        categoryId: miscCat.id,
        categoryName: miscCat.name,
        confidence: 0.10,
        reason: 'Fallback to Miscellaneous (no category rules matched)'
    };
}

