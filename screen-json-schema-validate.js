/**
 * Screen JSON schema validation (browser + shared formatting).
 * Validator implementation is generated: npm run build:schema-validator
 */
import validate from './screen-json-validate-generated.mjs';

/**
 * @param {unknown} data Parsed screen object (before or after ensureCanonicalSchema).
 * @returns {string | null} Human-readable error summary, or null if valid.
 */
export function getScreenJsonSchemaErrorSummary(data) {
    if (validate(data)) return null;
    const errors = validate.errors;
    if (!errors?.length) return 'Screen JSON failed schema validation.';
    const lines = errors.slice(0, 8).map((e) => {
        const p = e.instancePath && e.instancePath.length ? e.instancePath : '/';
        return `${p}: ${e.message}`;
    });
    const more = errors.length > 8 ? `\n… and ${errors.length - 8} more.` : '';
    return lines.join('\n') + more;
}

export { validate as validateScreenJsonAgainstSchema };
