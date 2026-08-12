// eval/config.mjs
// Default matrix for the evaluation CLI and default setups for the dataset
// builder. Model IDs are curated against the live OpenRouter catalog
// (Aug 2026); the CLI verifies them at runtime via --list-models.

// --- Evaluation matrix -----------------------------------------------------

export const EVAL_MODELS = {
    // Free vision-capable endpoints (verified live).
    free: [
        'google/gemma-4-31b-it:free',
        'google/gemma-4-26b-a4b-it:free',
        'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        'nvidia/nemotron-nano-12b-v2-vl:free',
        'openrouter/free', // router — picks a suitable free model per request
    ],
    // Cheap paid workhorses (pennies per run; the production default parser).
    workhorse: [
        'google/gemini-3.1-flash-lite',
        'google/gemini-3.6-flash',
        'openai/gpt-4o-mini',
    ],
    // Frontier tier — opt-in via --include-paid (or --models).
    frontier: [
        'anthropic/claude-haiku-4.5',
        'openai/gpt-5.5',
    ],
};

// Prompts applied per combination (id from eval/lib/prompts.mjs).
export const DEFAULT_PROMPT_IDS = ['default', 'careful'];

export const DEFAULT_TEMPERATURE = 0.1;
export const DEFAULT_CONCURRENCY = 2;
// Pacing between OpenRouter calls. Free tiers are limited to ~20 req/min.
export const DEFAULT_DELAY_MS = 0;
export const FREE_DELAY_MS = 3100;
export const PAID_DELAY_MS = 250;

export const DEFAULT_IMAGES_DIR = 'eval/Dataset/Images';
export const DEFAULT_TRUTH_DIR = 'eval/Dataset/ground_truth';
export const DEFAULT_OUTPUT_DIR = 'eval/results';

// --- Dataset builder default setups ----------------------------------------

export const DATASET_SETUPS = [
    {
        name: 'ocr_gemini_3.1_flash_lite',
        pipeline: 'ocr',
        model: 'google/gemma-4-26b-a4b-it:free', // transcription stage
        structureModel: 'google/gemini-3.1-flash-lite',
        promptId: 'default',
        temperature: 0.1,
    },
    {
        name: 'gemini_3.6_flash_direct',
        pipeline: 'direct',
        model: 'google/gemini-3.6-flash',
        promptId: 'default',
        temperature: 0.1,
    },
    {
        name: 'gemma_4_31b_direct',
        pipeline: 'direct',
        model: 'google/gemma-4-31b-it:free',
        promptId: 'default',
        temperature: 0.1,
    },
    {
        name: 'nemotron_omni_direct',
        pipeline: 'direct',
        model: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
        promptId: 'default',
        temperature: 0.1,
    },
    {
        name: 'openrouter_free_direct',
        pipeline: 'direct',
        model: 'openrouter/free',
        promptId: 'default',
        temperature: 0.1,
    },
];